/* Self-contained Marmalade Library runtime: bundled for GitHub ZIP download. */

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

const VIDEO_EXTENSIONS = /\.(3g2|3gp|asf|avi|divx|f4v|flv|m1v|m2ts|m4v|mkv|mov|mp4|mpe|mpeg|mpg|mts|ogv|qt|rm|rmvb|ts|vob|webm|wmv)$/i;
const IGNORE_DIRS = new Set(['.git', 'node_modules', '$recycle.bin', 'system volume information', '__macosx']);

const isVideoName = (name) => VIDEO_EXTENSIONS.test(name || '');

function normalizeTitle(name) {
  return String(name || '').replace(/\.[^.]+$/, '').replace(/[._]+/g, ' ')
    .replace(/\b(?:2160p|1080p|720p|480p|UHD|BluRay|BDRip|WEB[- ]?DL|WEBRip|HDR10?|DVDRip|REMUX|x264|x265|HEVC|H264|H265)\b.*$/i, '')
    .replace(/\s*\[[^\]]*\]\s*/g, ' ').replace(/\s+/g, ' ').trim() || String(name || '');
}

function describeFile(name, path, libraryKind) {
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

function makeItem(folder, path, file, kind) {
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
async function ensureHandlePermission(handle, ask) {
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
async function scanDirectoryHandle(folder, rootHandle, kind) {
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
function itemsFromFileList(folder, files, kind) {
  const items = [];
  for (const file of files) {
    if (!isVideoName(file.name)) continue;
    const parts = (file.webkitRelativePath || '').split('/').filter(Boolean);
    const path = parts.length > 1 ? parts.slice(1).join('/') : file.name;
    items.push(makeItem(folder, path, file, kind));
  }
  return items;
}

function sharedRootName(files) {
  const segments = new Map();
  for (const f of files) {
    const seg = (f.webkitRelativePath || '').split('/')[0];
    if (seg) segments.set(seg, (segments.get(seg) || 0) + 1);
  }
  return [...segments.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'Selected Folder';
}


/* Extension-side persistence: catalog + (Chromium) directory handles in the
   EXTENSION's own IndexedDB (chrome-extension:// origin). This storage is
   independent of marmaladeum.com's origin storage: clearing the site's data
   or its service-worker cache does not touch it. */

const DB_NAME = 'marmalade-extension-library:v1';
const STORE = 'libraries';

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE))
        request.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function op(db,mode,method,payload){
  return new Promise((resolve,reject)=>{
    let finished=false,result;
    const done=(error,value)=>{
      if(finished)return;
      finished=true;
      error?reject(error):resolve(value);
    };
    try{
      const tx=db.transaction(STORE,mode);
      const request=tx.objectStore(STORE)[method](payload);
      request.onsuccess=()=>{result=request.result;};
      request.onerror=()=>done(request.error||new Error('IndexedDB request failed'));
      tx.oncomplete=()=>done(null,result);
      tx.onerror=()=>done(tx.error||new Error('IndexedDB transaction failed'));
      tx.onabort=()=>done(tx.error||new Error('IndexedDB transaction aborted'));
    }catch(error){done(error);}
  });
}

async function loadLibraries() {
  const db = await openDb();
  try { return (await op(db, 'readonly', 'getAll')) || []; }
  finally { db.close(); }
}

async function saveLibrary(lib) {
  const db = await openDb();
  try {
    await op(db, 'readwrite', 'put', lib);
  } catch (error) {
    // A browser may reject structured cloning FileSystemHandles. Preserve
    // every catalog entry and report the degraded access honestly.
    try{
      await op(db,'readwrite','put',
        {...lib,folders:lib.folders.map(f=>({...f,handle:null}))});
    }catch(failure){
      throw new AggregateError([error,failure],
        'Extension library could not be saved. Existing catalog was not deleted.');
    }
  } finally { db.close(); }
}

async function deleteLibrary(id) {
  const db = await openDb();
  try { await op(db, 'readwrite', 'delete', id); }
  finally { db.close(); }
}

/* Public catalog shape shared with the web app: metadata only, never handles. */
function publicCatalog(libraries) {
  return libraries.map((lib) => ({
    id: lib.id, name: lib.name, kind: lib.kind, lastScan: lib.lastScan || 0,
    folders: (lib.folders || []).map((f) => ({
      id: f.id, name: f.name, source: f.handle ? 'extension-handle' : 'extension-session'
    })),
    items: (lib.items || []).map(({ id, folderId, path, name, size, lastModified,
      title, show, season, episode, year, type, metadataPending }) => ({
      id, folderId, path, name, size, lastModified, title, show, season,
      episode, year, type, metadataPending: !!metadataPending
    }))
  }));
}


/* Marmalade Library Extension — library page.
   This page is the persistent library holder: it owns folder picks, scans,
   the IndexedDB catalog + handles, and in-page playback. */
const $ = (id) => document.getElementById(id);
const status = (msg) => { $('status').textContent = msg || ''; };
const newId = () => 'ext' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);

let libraries = [];
let sessionFiles = new Map();
let pendingFallbackKind='folder'; // folderId|path -> File (fallback imports)

async function mirrorSnapshot() {
  try { await chrome.storage.local.set({ catalogSnapshot: publicCatalog(libraries) }); }
  catch { /* storage mirror is best-effort; IndexedDB is authoritative */ }
}

async function persist(lib) {
  await saveLibrary(lib);
  await mirrorSnapshot();
}

async function addFolderToLibrary(lib, folder, items) {
  if(!items.length){status('No videos found. Existing library unchanged.');return;}
  if(!libraries.some(candidate=>candidate.id===lib.id))libraries.push(lib);
  lib.folders = [...(lib.folders || []).filter((f) => f.id !== folder.id), folder];
  lib.items = [...(lib.items || []).filter((i) => i.folderId !== folder.id), ...items];
  lib.lastScan = Date.now();
  await persist(lib);
  render();
}

async function rememberFolder() {
  const name = $('libName').value.trim() || 'My Library';
  const kind = $('libKind').value;
  let lib = libraries.find((l) => l.name.toLowerCase() === name.toLowerCase());
  if (!lib) {
    lib = { id: newId(), name, kind, folders: [], items: [], createdAt: Date.now(), lastScan: 0 };
    // Only add a new library AFTER one or more video files were indexed.
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
      if (error?.name === 'AbortError') {
        status('Browser blocked that folder or selection was canceled. Use + Folder / + Videos instead.');return;
      }
      // Fall through to the directory-input fallback below.
    }
  }
  $('dirInput').value = '';
  pendingFallbackLib = lib;
  $('dirInput').click();
}

let pendingFallbackLib = null;
async function onFallbackFiles(files) {
  const lib = pendingFallbackLib; pendingFallbackLib = null;
  if (!lib || !files.length) {
    status('No files selected. Existing catalogs are unchanged.');
    return;
  }
  const valid=files.filter(file=>isVideoName(file.name));
  if(!valid.length){status('No videos found. Nothing was saved.');return;}
  const root = files.some(file=>file.webkitRelativePath)?
    sharedRootName(files):'Selected Videos';
  const prior=(lib.folders||[]).find(folder=>folder.name===root);
  const folder = { id: prior?.id||newId(), name: root,
    handle: prior?.handle||null };
  const items=itemsFromFileList(folder,valid,lib.kind);
  const unique=new Set();
  for(let n=0;n<items.length;n++){
    const file=valid[n],original=items[n].path;
    let path=original,k=2;
    while(unique.has(path)){
      const dot=original.lastIndexOf('.'),slash=original.lastIndexOf('/');
      path=dot>slash?original.slice(0,dot)+' ('+k+++')'+original.slice(dot):
        original+' ('+k+++')';
    }
    unique.add(path);items[n].id=folder.id+'|'+path;items[n].path=path;
    sessionFiles.set(items[n].id,file);
  }
  const previous=new Map((lib.items||[]).filter(item=>item.folderId===folder.id)
    .map(item=>[item.path,item]));
  for(const item of items){
    const old=previous.get(item.path);
    if(old)Object.assign(item,{...old,id:item.id,path:item.path,
      folderId:item.folderId,name:item.name,size:item.size,lastModified:item.lastModified});
  }
  await addFolderToLibrary(lib, folder, items);
  status(items.length+' video files indexed and playable. Catalog retained in extension. '+
    'After restart, Firefox/Safari may require file selection again.');
}

async function rescan(lib, folder) {
  if (!folder.handle) {
    $('libName').value=lib.name;$('libKind').value=lib.kind;
    status('Select the original folder again. The extension keeps existing titles and metadata.');
    chooseStandard('folder');return;
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
    $('libName').value=lib.name;
    status('Catalog retained. Use + Folder / + Videos to restore file access, then Play.');
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
    const q=$('librarySearch').value.trim().toLowerCase();
    const matches=(lib.items||[]).filter(item=>!q||
      String(item.title||item.name).toLowerCase().includes(q)||
      String(item.path||'').toLowerCase().includes(q));
    for (const item of matches.slice(0, 200)) {
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
      if(!confirm('Remove '+lib.name+' from the extension catalog? The original video files will not be deleted.'))return;
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

function chooseStandard(kind){
  const name=$('libName').value.trim()||'My Library',libKind=$('libKind').value;
  pendingFallbackLib=libraries.find(lib=>lib.name.toLowerCase()===name.toLowerCase())||
    {id:newId(),name,kind:libKind,folders:[],items:[],createdAt:Date.now(),lastScan:0};
  pendingFallbackKind=kind;
  const input=kind==='folder'?$('dirInput'):$('filesInput');
  input.value='';input.click();
}
$('addFolder').addEventListener('click',()=>chooseStandard('folder'));
$('addFiles').addEventListener('click',()=>chooseStandard('files'));
$('rememberFolder').hidden=typeof window.showDirectoryPicker!=='function';
$('rememberFolder').addEventListener('click',()=>{void rememberFolder();});
for(const picker of ['dirInput','filesInput']){
  $(picker).addEventListener('change',event=>{
    const chosen=Array.from(event.target.files||[]);
    event.target.value='';
    void onFallbackFiles(chosen).catch(error=>
      status('Video import failed: '+(error?.message||error)));
  });
}
$('closePlayer').addEventListener('click', () => {
  $('player').pause(); $('playerWrap').hidden = true;
});


async function showBackupStatus(){
  const get=keys=>new Promise(resolve=>chrome.storage.local.get(keys,result=>resolve(result||{})));
  const backup=(await get(['siteCatalog'])).siteCatalog;
  const count=(backup?.libraries||[]).reduce((n,lib)=>n+(lib.items||[]).length,0);
  $('backupStatus').textContent=(backup?.libraries||[]).length+
    ' Marmaladeum collections · '+count+' titles backed up in this extension.';
}
async function exportBackup(){
  const snapshot=await new Promise(resolve=>chrome.storage.local.get(
    ['siteCatalog'],result=>resolve(result||{})));
  const json=JSON.stringify({version:1,extensionLibraries:publicCatalog(libraries),
    siteCatalog:snapshot.siteCatalog||null,exportedAt:Date.now()},null,2);
  const url=URL.createObjectURL(new Blob([json],{type:'application/json'}));
  const link=document.createElement('a');
  link.href=url;link.download='marmalade-library-backup.json';
  document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1200);
  status('Catalog exported. Media files are not included.');
}
async function importBackup(file){
  if(!file)return;
  try{
    const data=JSON.parse(await file.text());
    if(data.version!==1||!Array.isArray(data.extensionLibraries))
      throw Error('Not a valid Marmalade catalog backup.');
    let added=0;
    for(const source of data.extensionLibraries.slice(0,300)){
      if(!source?.id||!source?.name||!Array.isArray(source.items)||
        libraries.some(lib=>lib.id===source.id))continue;
      const lib={id:String(source.id),name:String(source.name),kind:source.kind||'movie',
        folders:(source.folders||[]).slice(0,500).map(f=>({
          id:String(f.id),name:String(f.name),handle:null})),
        items:source.items.filter(x=>x?.id&&x?.folderId&&x?.name),
        createdAt:Date.now(),lastScan:source.lastScan||0};
      await saveLibrary(lib);
      libraries.push(lib);added++;
    }
    if(data.siteCatalog&&Array.isArray(data.siteCatalog.libraries))
      await chrome.storage.local.set({siteCatalog:data.siteCatalog});
    await mirrorSnapshot();render();
    status(added+' libraries restored from exported catalog. File access may need reauthorization.');
  }catch(error){status('Catalog restore failed: '+(error?.message||error));}
}
$('librarySearch').addEventListener('input',render);
$('exportBackup').addEventListener('click',()=>{void exportBackup();});
$('importBackup').addEventListener('click',()=>{$('backupFile').click();});
$('backupFile').addEventListener('change',event=>{
  const file=event.currentTarget.files?.[0];
  event.currentTarget.value='';
  void importBackup(file);
});

libraries = await loadLibraries();
await mirrorSnapshot();
render();
void showBackupStatus();

// Playback handoff from marmaladeum.com: #play=<itemId>
const wanted = decodeURIComponent(location.hash.replace(/^#play=/, ''));
if (wanted && location.hash.startsWith('#play=')) {
  for (const lib of libraries) {
    const item = (lib.items || []).find((i) => i.id === wanted);
    if (item) { void play(lib, item); break; }
  }
}
