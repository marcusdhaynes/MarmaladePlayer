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
  if (!lib || !files.length) return;
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
