/* Marmalade Library — one content bridge for Chromium, Firefox and Safari.
   No native Minternet API. Only marmaladeum.com and the development site
   are allowed by the manifest. Keep all files and handles inside the
   extension/browser; only sanitized metadata crosses the window bridge. */
'use strict';
const ext=globalThis.browser||globalThis.chrome;
const ORIGIN=location.origin;
document.documentElement.dataset.marmaladeExtension='installed';

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
        addedAt:Number(entry.addedAt)||0
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
    ext.runtime.sendMessage({type:'marmalade:ping'},reply=>{
      // No access to filesystem handles is exposed to web origins.
      toPage({type:'pong',version:reply?.version||'0.2.0'});
    });
    return;
  }
  if(data.type==='get-catalog'){
    ext.storage.local.get(['catalogSnapshot','siteCatalog'],result=>{
      toPage({type:'catalog',
        libraries:Array.isArray(result?.catalogSnapshot)?result.catalogSnapshot:[],
        siteLibraries:Array.isArray(result?.siteCatalog?.libraries)?
          result.siteCatalog.libraries:[]});
    });
    return;
  }
  if(data.type==='backup-site-catalog'){
    const libraries=cleanLibraries(data.libraries);
    const revision=Number(data.revision)||Date.now();
    // Store only metadata in extension storage. Never store media bytes.
    void Promise.resolve(ext.storage.local.set({
      siteCatalog:{libraries,revision,updatedAt:Date.now()}
    })).then(()=>toPage({type:'backup-saved',revision}))
      .catch(()=>toPage({type:'backup-error',revision}));
    return;
  }
  if(data.type==='play'){
    ext.runtime.sendMessage({type:'marmalade:open-library',
      itemId:safeText(data.itemId,680)},()=>toPage({type:'play-accepted'}));
  }
});
