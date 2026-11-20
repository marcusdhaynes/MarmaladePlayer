/* Marmalade Library Extension — library page.
   This page is the persistent library holder: it owns folder picks, scans,
   the IndexedDB catalog + handles, and in-page playback. */
import {
  scanDirectoryHandle, itemsFromFileList, sharedRootName,
  ensureHandlePermission, isVideoName
} from './lib/catalog.mjs';
import { loadLibraries, saveLibrary, deleteLibrary, publicCatalog } from './lib/store.mjs';

const $ = (id) => document.getElementById(id);
const status = (msg) => { $('status').textContent = msg || ''; };
const newId = () => 'ext' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);

let libraries = [];
let sessionFiles = new Map(); // folderId|path -> File (fallback imports)

async function mirrorSnapshot() {
  try { await chrome.storage.local.set({ catalogSnapshot: publicCatalog(libraries) }); }
  catch { /* storage mirror is best-effort; IndexedDB is authoritative */ }
}

async function persist(lib) {
  await saveLibrary(lib);
  await mirrorSnapshot();
}

async function addFolderToLibrary(lib, folder, items) {
  lib.folders = [...(lib.folders || []).filter((f) => f.id !== folder.id), folder];
  lib.items = [...(lib.items || []).filter((i) => i.folderId !== folder.id), ...items];
  lib.lastScan = Date.now();
  await persist(lib);
  render();
}

async function pickFolder() {
  const name = $('libName').value.trim() || 'My Library';
  const kind = $('libKind').value;
  let lib = libraries.find((l) => l.name.toLowerCase() === name.toLowerCase());
  if (!lib) {
    lib = { id: newId(), name, kind, folders: [], items: [], createdAt: Date.now(), lastScan: 0 };
    libraries.push(lib);
  }
  if (typeof window.showDirectoryPicker === 'function') {
    try {
      const handle = await window.showDirectoryPicker({ mode: 'read' });
      // Permission request immediately, while the picker gesture is active.
      await ensureHandlePermission(handle, true);
      const folder = { id: newId(), name: handle.name || 'Video Folder', handle };
      status('Scanning ' + folder.name + '…');
      const items = await scanDirectoryHandle(folder, handle, lib.kind);
      await addFolderToLibrary(lib, folder, items);
      status(items.length + ' video' + (items.length === 1 ? '' : 's') +
        ' saved in ' + lib.name + ' (extension storage).');
      return;
    } catch (error) {
      if (error?.name === 'AbortError') { status('Folder selection canceled.'); return; }
      // Fall through to the directory-input fallback below.
    }
  }
  $('dirInput').value = '';
  $('dirInput').click();
  pendingFallbackLib = lib;
}

let pendingFallbackLib = null;
async function onFallbackFiles(files) {
  const lib = pendingFallbackLib; pendingFallbackLib = null;
  if (!lib || !files.length) return;
  const root = sharedRootName(files);
  const folder = { id: newId(), name: root, handle: null };
  for (const file of files) {
    if (!isVideoName(file.name)) continue;
    const parts = (file.webkitRelativePath || '').split('/').filter(Boolean);
    const path = parts.length > 1 ? parts.slice(1).join('/') : file.name;
    sessionFiles.set(folder.id + '|' + path, file);
  }
  const items = itemsFromFileList(folder, files, lib.kind);
  await addFolderToLibrary(lib, folder, items);
  status(items.length + ' videos cataloged in ' + lib.name +
    '. This browser cannot remember folder access, so files need re-picking before playback — the catalog itself is saved.');
}

async function rescan(lib, folder) {
  if (!folder.handle) {
    status('This folder was imported without a remembered handle. Re-pick it with + Add Folder to rescan.');
    return;
  }
  // Click = user gesture, so requestPermission is allowed here.
  if (!await ensureHandlePermission(folder.handle, true)) {
    status('Access to ' + folder.name + ' was not granted.');
    return;
  }
  status('Scanning ' + folder.name + '…');
  const items = await scanDirectoryHandle(folder, folder.handle, lib.kind);
  await addFolderToLibrary(lib, folder, items);
  status(items.length + ' videos in ' + folder.name + '.');
}

async function play(lib, item) {
  const folder = (lib.folders || []).find((f) => f.id === item.folderId);
  let file = sessionFiles.get(item.id);
  if (!file && folder?.handle) {
    if (!await ensureHandlePermission(folder.handle, true)) {
      status('Click Play again and allow access to ' + folder.name + '.');
      return;
    }
    let dir = folder.handle;
    const parts = item.path.split('/').filter(Boolean);
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
    file = await (await dir.getFileHandle(parts[parts.length - 1])).getFile();
  }
  if (!file) {
    status('This browser did not retain access to that file. Re-pick the folder once with + Add Folder, then Play.');
    return;
  }
  const player = $('player');
  if (player.src) URL.revokeObjectURL(player.src);
  player.src = URL.createObjectURL(file);
  $('nowPlaying').textContent = item.title || file.name;
  $('playerWrap').hidden = false;
  await player.play().catch(() => {});
}

function render() {
  const wrap = $('libraries');
  wrap.replaceChildren();
  for (const lib of libraries) {
    const section = document.createElement('section');
    const heading = document.createElement('h2');
    heading.textContent = lib.name + ' · ' + (lib.items || []).length + ' videos';
    section.append(heading);
    for (const folder of lib.folders || []) {
      const row = document.createElement('div'); row.className = 'card';
      const count = (lib.items || []).filter((i) => i.folderId === folder.id).length;
      const label = document.createElement('span');
      label.textContent = '▣ ' + folder.name + ' · ' + count + ' videos' +
        (folder.handle ? ' · Remembered' : ' · Catalog only (re-pick to play)');
      const rescanBtn = document.createElement('button');
      rescanBtn.className = 'secondary'; rescanBtn.textContent = 'Rescan';
      rescanBtn.addEventListener('click', () => void rescan(lib, folder));
      row.append(label, rescanBtn);
      section.append(row);
    }
    for (const item of (lib.items || []).slice(0, 200)) {
      const row = document.createElement('div'); row.className = 'card';
      const label = document.createElement('span');
      label.textContent = item.title + (item.year ? ' (' + item.year + ')' : '');
      const playBtn = document.createElement('button');
      playBtn.textContent = 'Play';
      playBtn.addEventListener('click', () => void play(lib, item));
      row.append(label, playBtn);
      section.append(row);
    }
    const del = document.createElement('button');
    del.className = 'secondary'; del.textContent = 'Remove Library';
    del.addEventListener('click', async () => {
      libraries = libraries.filter((l) => l.id !== lib.id);
      await deleteLibrary(lib.id); await mirrorSnapshot(); render();
    });
    section.append(del);
    wrap.append(section);
  }
  if (!libraries.length) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'No libraries yet. Name one above and choose + Add Folder.';
    wrap.append(p);
  }
}

$('addFolder').addEventListener('click', () => void pickFolder());
$('dirInput').addEventListener('change', (event) => {
  void onFallbackFiles([...event.target.files || []]);
  event.target.value = '';
});
$('closePlayer').addEventListener('click', () => {
  $('player').pause(); $('playerWrap').hidden = true;
});

libraries = await loadLibraries();
await mirrorSnapshot();
render();

// Playback handoff from marmaladeum.com: #play=<itemId>
const wanted = decodeURIComponent(location.hash.replace(/^#play=/, ''));
if (wanted && location.hash.startsWith('#play=')) {
  for (const lib of libraries) {
    const item = (lib.items || []).find((i) => i.id === wanted);
    if (item) { void play(lib, item); break; }
  }
}
