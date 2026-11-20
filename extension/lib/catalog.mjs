/* Marmalade Library Extension — shared catalog logic.
   Pure functions (no browser globals except the directory-handle protocol),
   so the same code runs in the extension page and in Node tests.

   Persistence model (honest):
   - The CATALOG (folder names, file paths, titles, sizes, mtimes) is plain
     data. It is stored in the extension's own IndexedDB and survives page
     reloads, marmaladeum.com cache clears, and browser restarts, in every
     browser that runs the extension.
   - In Chromium, FileSystemDirectoryHandle objects can also be stored in
     that same IndexedDB. After a restart Chrome may return the handle with
     permission "prompt"; one click on Rescan / Play in the extension page
     (a user gesture) re-grants it. There is no web-platform API that lets
     any extension silently re-grant a revoked file permission with zero
     interaction, and this code does not pretend otherwise.
   - Firefox/Safari have no persistent directory handles at all; the
     fallback there stores the catalog from a directory-input import, and
     files must be re-picked before playback. The catalog still persists. */

export const VIDEO_EXTENSIONS = /\.(3g2|3gp|asf|avi|divx|f4v|flv|m1v|m2ts|m4v|mkv|mov|mp4|mpe|mpeg|mpg|mts|ogv|qt|rm|rmvb|ts|vob|webm|wmv)$/i;
export const IGNORE_DIRS = new Set(['.git', 'node_modules', '$recycle.bin', 'system volume information', '__macosx']);

export const isVideoName = (name) => VIDEO_EXTENSIONS.test(name || '');

export function normalizeTitle(name) {
  return String(name || '').replace(/\.[^.]+$/, '').replace(/[._]+/g, ' ')
    .replace(/\b(?:2160p|1080p|720p|480p|UHD|BluRay|BDRip|WEB[- ]?DL|WEBRip|HDR10?|DVDRip|REMUX|x264|x265|HEVC|H264|H265)\b.*$/i, '')
    .replace(/\s*\[[^\]]*\]\s*/g, ' ').replace(/\s+/g, ' ').trim() || String(name || '');
}

export function describeFile(name, path, libraryKind) {
  const raw = normalizeTitle(name);
  const episode = raw.match(/\bS(\d{1,2})\s*E(\d{1,3})\b/i) || raw.match(/\b(\d{1,2})x(\d{1,3})\b/i);
  const show = episode ? (raw.slice(0, episode.index).replace(/[\s(._-]+$/, '').trim() ||
    path.split('/').filter(Boolean)[0] || 'TV Series') : '';
  const episodeName = episode ? raw.slice(episode.index + episode[0].length).replace(/^[-\s._]+/, '').trim() : '';
  const y = raw.match(/\b(19\d{2}|20\d{2})\b/);
  const type = episode ? 'tv' : libraryKind === 'tv' ? 'tv' : 'movie';
  return {
    title: episode ? (episodeName || 'Episode ' + Number(episode[2])) :
      raw.replace(/\s*[\[(]?(?:19|20)\d{2}[\])]?\s*$/, '').trim() || raw,
    show: episode ? show : (libraryKind === 'tv' ? path.split('/')[0] || raw : ''),
    season: episode ? Number(episode[1]) : null,
    episode: episode ? Number(episode[2]) : null,
    year: y ? Number(y[1]) : null, type
  };
}

export function makeItem(folder, path, file, kind) {
  const info = describeFile(file.name || path.split('/').pop(), path, kind);
  return {
    id: folder.id + '|' + path, folderId: folder.id, path,
    name: file.name, size: file.size || 0, lastModified: file.lastModified || 0,
    addedAt: Date.now(), ...info
  };
}

/* Request read permission for a stored handle. Must be called from a user
   gesture (click) for requestPermission to succeed. Returns true only when
   access is actually granted — never fakes success. */
export async function ensureHandlePermission(handle, ask) {
  if (!handle) return false;
  try {
    let result = typeof handle.queryPermission === 'function'
      ? await handle.queryPermission({ mode: 'read' }) : 'granted';
    if (result !== 'granted' && ask && typeof handle.requestPermission === 'function')
      result = await handle.requestPermission({ mode: 'read' });
    return result === 'granted';
  } catch { return false; }
}

/* Recursively scan a FileSystemDirectoryHandle. Handles both the standard
   async-iterator protocol (dir.entries() / dir.values(), also exposed as
   dir[Symbol.asyncIterator]) and plain-object test doubles.
   Returns an array of catalog items, including files that sit directly in
   the chosen root folder (path === bare filename) and nested files
   (path === "Sub/File.mp4"). Files whose getFile() fails are still indexed
   by name with metadataPending, matching the web app's behaviour. */
export async function scanDirectoryHandle(folder, rootHandle, kind) {
  const items = [];
  async function walk(dir, prefix) {
    let entries = [];
    if (typeof dir.entries === 'function') {
      for await (const entry of dir.entries()) entries.push(entry);
      // Standard handles yield [name, handle] pairs; test doubles may too.
      entries = entries.map((e) => Array.isArray(e) ? e : [e.name, e]);
    } else if (typeof dir.values === 'function') {
      for await (const handle of dir.values()) entries.push([handle.name, handle]);
    } else if (dir[Symbol.asyncIterator]) {
      for await (const handle of dir) entries.push([handle.name, handle]);
    }
    for (const [name, entry] of entries) {
      if (!name || name.startsWith('.') || IGNORE_DIRS.has(String(name).toLowerCase())) continue;
      const path = prefix + name;
      if (entry.kind === 'directory') {
        await walk(entry, path + '/');
      } else if (entry.kind === 'file' && isVideoName(name)) {
        try {
          const file = await entry.getFile();
          items.push(makeItem(folder, path, file, kind));
        } catch {
          const placeholder = makeItem(folder, path, { name, size: 0, lastModified: 0 }, kind);
          placeholder.metadataPending = true;
          items.push(placeholder);
        }
      }
    }
  }
  await walk(rootHandle, '');
  return items;
}

/* Build catalog items from a directory-input FileList (Firefox/Safari
   fallback). Derives the shared root by voting on the first path segment,
   keeps root-level files under their bare filename. */
export function itemsFromFileList(folder, files, kind) {
  const items = [];
  for (const file of files) {
    if (!isVideoName(file.name)) continue;
    const parts = (file.webkitRelativePath || '').split('/').filter(Boolean);
    const path = parts.length > 1 ? parts.slice(1).join('/') : file.name;
    items.push(makeItem(folder, path, file, kind));
  }
  return items;
}

export function sharedRootName(files) {
  const segments = new Map();
  for (const f of files) {
    const seg = (f.webkitRelativePath || '').split('/')[0];
    if (seg) segments.set(seg, (segments.get(seg) || 0) + 1);
  }
  return [...segments.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'Selected Folder';
}
