/* Marmalade Library — one content bridge for Chromium, Firefox and Safari.
   No native Minternet API. Only marmaladeum.com and the development site
   are allowed by the manifest. Keep all files and handles inside the
   extension/browser; only sanitized metadata crosses the window bridge. */
'use strict';
const ext=globalThis.browser||globalThis.chrome;
const usesPromises=!!globalThis.browser;
const ORIGIN=location.origin;
const getStore=keys=>usesPromises?ext.storage.local.get(keys):
  new Promise(resolve=>ext.storage.local.get(keys,result=>resolve(result||{})));
const setStore=value=>usesPromises?ext.storage.local.set(value):
  new Promise((resolve,reject)=>ext.storage.local.set(value,()=>{
    const error=ext.runtime.lastError;
    error?reject(new Error(error.message)):resolve();
  }));
const send=message=>usesPromises?ext.runtime.sendMessage(message):
  new Promise(resolve=>ext.runtime.sendMessage(message,reply=>resolve(reply)));
if(document.documentElement)document.documentElement.dataset.marmaladeExtension='installed';
else document.addEventListener('DOMContentLoaded',()=>{
  if(document.documentElement)document.documentElement.dataset.marmaladeExtension='installed';
},{once:true});

function toPage(message){
  window.postMessage({source:'marmalade-extension',...message},ORIGIN);
}
const safeText=(value,max=512)=>String(value??'').slice(0,max);
function cleanLibraries(value){
  if(!Array.isArray(value))return [];
  return value.slice(0,300).flatMap(lib=>{
    if(!lib||typeof lib!=='object'||!lib.id||!lib.name)return [];
    const id=safeText(lib.id,140);
    if(id.startsWith('addon:')||id.startsWith('extlib:'))return [];
    const folders=(Array.isArray(lib.folders)?lib.folders:[]).slice(0,500)
      .map(f=>({id:safeText(f.id,140),name:safeText(f.name,240),
        source:'session'})).filter(f=>f.id);
    const itemIds=new Set();
    const items=[];
    for(const entry of (Array.isArray(lib.items)?lib.items:[]).slice(0,50000)){
      if(!entry?.id||!entry.folderId||!entry.name)continue;
      const itemId=safeText(entry.id,680);
      if(itemIds.has(itemId))continue;
      itemIds.add(itemId);
      items.push({
        id:itemId,folderId:safeText(entry.folderId,140),
        path:safeText(entry.path,1024),name:safeText(entry.name,512),
        title:safeText(entry.title||entry.name,512),
        show:safeText(entry.show,512),type:safeText(entry.type,16),
        size:Number(entry.size)||0,lastModified:Number(entry.lastModified)||0,
        year:Number(entry.year)||null,season:Number(entry.season)||null,
        episode:Number(entry.episode)||null,
        favorite:entry.favorite===true,watched:entry.watched===true,
        watchlist:entry.watchlist===true,addedAt:Number(entry.addedAt)||0,
        poster:safeText(entry.poster,250000),
        posterCustomized:entry.posterCustomized===true,
        overview:safeText(entry.overview,3500),
        runtimeSec:Number(entry.runtimeSec)||null,
        collections:Array.isArray(entry.collections)?entry.collections.slice(0,100)
          .map(x=>safeText(x,180)):[],
        playlists:Array.isArray(entry.playlists)?entry.playlists.slice(0,100)
          .map(x=>safeText(x,180)):[],
        metadataSource:safeText(entry.metadataSource,180),
        customized:entry.customized===true,analyzedAt:Number(entry.analyzedAt)||null
      });
    }
    return [{id,name:safeText(lib.name,240),kind:safeText(lib.kind,16),
      folders,items,hiddenIds:Array.isArray(lib.hiddenIds)?
        lib.hiddenIds.slice(0,50000).map(x=>safeText(x,680)):[],
      createdAt:Number(lib.createdAt)||0,lastScan:Number(lib.lastScan)||0}];
  });
}
window.addEventListener('message',event=>{
  if(event.source!==window||event.origin!==ORIGIN)return;
  const data=event.data;
  if(!data||data.source!=='marmalade-web')return;
  if(data.type==='ping'){
    void send({type:'marmalade:ping'})
      .then(reply=>toPage({type:'pong',version:reply?.version||'0.2.0'}))
      .catch(()=>toPage({type:'pong',version:'0.2.0'}));
    return;
  }
  if(data.type==='get-catalog'){
    void getStore(['catalogSnapshot','siteCatalog'])
      .then(result=>toPage({type:'catalog',
        libraries:Array.isArray(result?.catalogSnapshot)?result.catalogSnapshot:[],
        siteLibraries:Array.isArray(result?.siteCatalog?.libraries)?
          result.siteCatalog.libraries:[]}))
      .catch(()=>toPage({type:'catalog',libraries:[],siteLibraries:[]}));
    return;
  }
  if(data.type==='backup-site-catalog'){
    const libraries=cleanLibraries(data.libraries);
    const revision=Number(data.revision)||Date.now();
    // Store only metadata in extension storage. Never store media bytes.
    void setStore({
      siteCatalog:{libraries,revision,updatedAt:Date.now()}
    }).then(()=>toPage({type:'backup-saved',revision}))
      .catch(()=>toPage({type:'backup-error',revision}));
    return;
  }
  if(data.type==='play'){
    void send({type:'marmalade:open-library',
      itemId:safeText(data.itemId,680)})
      .then(()=>toPage({type:'play-accepted'})).catch(()=>{});
  }
});
