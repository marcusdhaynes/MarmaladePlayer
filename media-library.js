/* Marmaladeum Local Library · Plex-style local catalog.
   Folder permissions stay on-device. No file contents or handles leave the origin.
   The browser's File System Access API is used when available; folder-input
   fallback works for the current session but cannot re-open without consent. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const panel=$('mediaLibraryPanel'),row=$('movieInfoRow');
  if(!panel||!row||window.MarmaladeMediaLibrary)return;
  const ui={
    shelves:$('mlShelves'),cards:$('mlCards'),status:$('mlStatus'),
    title:$('mlCurrentShelf'),count:$('mlCount'),search:$('mlSearch'),
    filter:$('mlKindFilter'),collections:$('mlCollectionFilter'),sort:$('mlSort'),view:$('mlView'),
    posterZoom:$('mlPosterZoom'),posterSmaller:$('mlPosterSmaller'),posterLarger:$('mlPosterLarger'),
    rescan:$('mlRescan'),manage:$('mlManage'),quickAdd:$('mlQuickAdd'),
    art:$('mlFindArt'),crumbs:$('mlCrumbs'),
    dialog:$('mlDialog'),dialogTitle:$('mlDialogTitle'),name:$('mlLibraryName'),
    kind:$('mlLibraryKind'),folderList:$('mlFolderList'),
    delete:$('mlDeleteLibrary'),pick:$('mlPickFolder'),
    directoryInput:$('mlDirectoryInput'),videoInput:$('mlFilesInput'),save:$('mlDialogSave'),
    menu:$('mlContextMenu'),itemDialog:$('mlItemDialog'),itemBody:$('mlItemDialogBody'),
    itemTitle:$('mlItemDialogTitle'),itemSave:$('mlItemDialogSave')
  };
  const PAGE_SIZE=120;
  const KEY='marmalade:media-library:visible';
  const AUTO_NEXT_KEY='marmalade:media-library:auto-next';
  let episodeSelection=null,episodeGeneration=0;
  const DB='marmalade:local-library:v1';
  const VIDEO=/\.(3g2|3gp|amv|asf|avi|divx|drc|f4v|flv|gifv|m1v|m2p|m2t|m2ts|m2v|m4v|mjpeg|mjpg|mk3d|mkv|mov|mp4|mpe|mpeg|mpg|mpv|mts|mxf|nsv|ogv|qt|rm|rmvb|roq|rv|ts|vob|webm|wmv|xvid|y4m|yuv)$/i;
  const IGNORE=new Set(['.git','node_modules','$recycle.bin','system volume information','__macosx']);
  const state={
    db:null,libraries:[],selected:'all',query:'',kind:'all',collection:'all',sort:'title',
    list:false,posterColumns:4,folderMode:false,folder:null,series:null,page:0,
    editing:null,pending:null,relink:null,autoAttachDraft:null,scanning:false,scanSeq:0,
    sessionFiles:new Map(),sessionFolderLoaded:new Set(),status:'',ready:false,
    pendingScans:new Set(),scanProblems:new Map(),artworkBusy:false,storageAvailable:true,
    menuTarget:null,itemEditing:null,menuOpen:false,posterRenderPending:false,playingId:null,
    backupReady:false
  };
  const now=()=>Date.now();
  const id=()=>('ml'+now().toString(36)+Math.random().toString(36).slice(2,9));
  const readLocal=(key,otherwise)=>{try{return localStorage.getItem(key)??otherwise;}catch{return otherwise;}};
  const setLocal=(key,value)=>{try{localStorage.setItem(key,String(value));}catch{}};
  const create=(tag,cls,content)=>{
    const n=document.createElement(tag);
    if(cls)n.className=cls;
    if(content!==undefined)n.textContent=String(content);
    return n;
  };
  const append=(parent,tag,cls,content)=>{
    const n=create(tag,cls,content);parent.append(n);return n;
  };
  const countLabel=n=>n.toLocaleString()+(n===1?' Video':' Videos');

  const SMART_KEY='marmalade:media-library:smart-collections:v1';
  function normalizeSmart(value){
    if(!value||typeof value.id!=='string'||!/^[-a-z0-9]{1,80}$/i.test(value.id))return null;
    const name=String(value.name||'').trim().slice(0,80);
    if(!name)return null;
    const bound=(v,min,max)=>v===''||v===null||v===undefined?null:
      Number.isInteger(Number(v))&&Number(v)>=min&&Number(v)<=max?Number(v):null;
    return {id:value.id,name,kind:['all','movie','tv'].includes(value.kind)?value.kind:'all',
      status:['all','unwatched','watched','favorites','watchlist','continue'].includes(value.status)?value.status:'all',
      yearFrom:bound(value.yearFrom,1880,2100),yearTo:bound(value.yearTo,1880,2100),
      maxMinutes:bound(value.maxMinutes,1,1440),recentDays:bound(value.recentDays,1,3650),
      text:String(value.text||'').trim().slice(0,160)};
  }
  function loadSmart(){
    try{const records=JSON.parse(readLocal(SMART_KEY,'[]'));
      if(!Array.isArray(records))return [];
      const seen=new Set();return records.slice(0,100).map(normalizeSmart).filter(r=>r&&!seen.has(r.id)&&seen.add(r.id));
    }catch{return [];}
  }
  let smartCollections=loadSmart();
  let refreshSmartEditor=()=>{};
  const builtInSmart=[{id:'recent',name:'Recently Added (30 Days)',kind:'all',status:'all',recentDays:30},
    {id:'short-unwatched',name:'Unwatched Movies Under 90 Minutes',kind:'movie',status:'unwatched',maxMinutes:90}].map(normalizeSmart);
  function smartRule(key){
    if(!key.startsWith('smart:'))return null;
    return [...builtInSmart,...smartCollections].find(r=>r.id===key.slice(6))||null;
  }
  function smartMatches(item,rule,records,at){
    if(rule.kind!=='all'&&item.type!==rule.kind)return false;
    if(rule.status==='watched'&&!item.watched||rule.status==='unwatched'&&item.watched||
       rule.status==='favorites'&&!item.favorite||rule.status==='watchlist'&&!item.watchlist||
       rule.status==='continue'&&!progressFor(item,records))return false;
    const year=Number(item.year),runtime=Number(item.runtimeSec),added=Number(item.addedAt);
    if(rule.yearFrom!==null&&(!year||year<rule.yearFrom)||rule.yearTo!==null&&(!year||year>rule.yearTo))return false;
    if(rule.maxMinutes!==null&&(!runtime||runtime>rule.maxMinutes*60))return false;
    if(rule.recentDays!==null&&(!added||added>at||at-added>rule.recentDays*86400000))return false;
    const text=rule.text.toLocaleLowerCase();
    return !text||[item.title,item.show,item.name].some(v=>String(v||'').toLocaleLowerCase().includes(text));
  }
  function saveSmart(next){
    try{localStorage.setItem(SMART_KEY,JSON.stringify(next));smartCollections=next;return true;}
    catch{notify('Smart collection could not be saved on this device.');return false;}
  }
  function addSmartEditor(parent){
    const details=append(parent,'details','ml-smart-editor');details.id='mlSmartEditor';
    append(details,'summary','','Smart Collections');
    append(details,'p','','Automatically include matching videos. All specified rules must match.');
    const form=append(details,'div','ml-smart-form');
    const field=(label,key,type,options)=>{
      const wrap=append(form,'label','',label);
      const input=append(wrap,type==='select'?'select':'input');input.id='mlSmart'+key;input.setAttribute('aria-label',label);
      if(type==='select')for(const [value,text] of options){const o=append(input,'option','',text);o.value=value;}
      else input.type=type;
      return input;
    };
    const select=field('Edit Collection','Select','select',[]);
    const name=field('Name','Name','text');name.maxLength=80;
    const kind=field('Media Type','Kind','select',[['all','Any'],['movie','Movies'],['tv','TV Shows']]);
    const status=field('Watch Status','Status','select',[['all','Any'],['unwatched','Unwatched'],['watched','Watched'],['favorites','Favorites'],['watchlist','Watchlist'],['continue','In Progress']]);
    const yearFrom=field('From Year','YearFrom','number'),yearTo=field('Through Year','YearTo','number');
    const runtime=field('Maximum Minutes','Runtime','number'),recent=field('Added Within Days','Recent','number');
    const text=field('Title Contains','Text','text');text.maxLength=160;
    for(const [input,min,max] of [[yearFrom,1880,2100],[yearTo,1880,2100],[runtime,1,1440],[recent,1,3650]]){input.min=String(min);input.max=String(max);input.step='1';input.placeholder='Any';}
    const actions=append(details,'div','ml-backup-actions');
    const save=append(actions,'button','ml-primary','Save Collection');save.type='button';save.id='mlSmartSave';
    const remove=append(actions,'button','','Delete Collection');remove.type='button';remove.id='mlSmartDelete';
    const reset=(key='')=>{
      select.replaceChildren();const first=append(select,'option','','New Collection');first.value='';
      for(const rule of smartCollections){const o=append(select,'option','',rule.name);o.value=rule.id;}
      select.value=key;const r=smartCollections.find(x=>x.id===key);
      name.value=r?.name||'';kind.value=r?.kind||'all';status.value=r?.status||'all';
      yearFrom.value=r?.yearFrom??'';yearTo.value=r?.yearTo??'';runtime.value=r?.maxMinutes??'';
      recent.value=r?.recentDays??'';text.value=r?.text||'';remove.disabled=!r;
    };
    select.addEventListener('change',()=>reset(select.value));
    save.addEventListener('click',()=>{
      if(!name.value.trim()){notify('Enter a collection name.');name.focus();return;}
      if([yearFrom,yearTo,runtime,recent].some(input=>!input.checkValidity())||
        (yearFrom.value&&yearTo.value&&Number(yearFrom.value)>Number(yearTo.value))){notify('Check the year range and numeric rules.');return;}
      if(!select.value&&smartCollections.length>=100){notify('Up to 100 smart collections are supported.');return;}
      const r=normalizeSmart({id:select.value||id(),name:name.value,kind:kind.value,status:status.value,
        yearFrom:yearFrom.value,yearTo:yearTo.value,maxMinutes:runtime.value,recentDays:recent.value,text:text.value});
      if(!r)return;
      if(!saveSmart([...smartCollections.filter(x=>x.id!==r.id),r]))return;
      reset(r.id);state.page=0;renderCollectionFilter();ui.collections.value='smart:'+r.id;state.collection=ui.collections.value;
      renderCards();notify('Smart collection saved.');
    });
    remove.addEventListener('click',()=>{
      if(!select.value)return;const key=select.value;
      if(!saveSmart(smartCollections.filter(r=>r.id!==key)))return;
      if(state.collection==='smart:'+key){state.collection='all';ui.collections.value='all';state.page=0;}
      reset();render();notify('Smart collection deleted. Videos were not removed.');
    });
    refreshSmartEditor=()=>reset(select.value);
    reset();
  }

  const AUTO_POSTERS_KEY='marmalade:media-library:auto-posters';
  const MAX_POSTER_QUEUE=120;
  const POSTER_MISSES_KEY='marmalade:media-library:poster-misses';
  const POSTER_COLUMNS_KEY='marmalade:media-library:poster-columns';
  const MIN_POSTER_COLUMNS=1,MAX_POSTER_COLUMNS=12;
  const posterQueue=[],posterQueued=new Set(),posterSeen=new Set();
  let posterWorker=false;
  const posterMisses=(()=>{
    try{
      const data=JSON.parse(readLocal(POSTER_MISSES_KEY,'{}'));
      return data&&typeof data==='object'&&!Array.isArray(data)?data:{};
    }catch{return {};}
  })();
  // Keep the underlying filename and year unchanged: these helpers only
  // determine what is shown on a poster and what title is matched publicly.
  function posterDisplayTitle(title){
    return String(title||'').replace(/\s*\((?:18|19|20|21)\d{2}\)(?=\s|$)/g,'')
      .replace(/\s{2,}/g,' ').trim();
  }
  const posterNormalize=value=>posterDisplayTitle(value).toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g,' ').trim();
  const autoPostersEnabled=()=>readLocal(AUTO_POSTERS_KEY,'true')!=='false';
  function rememberPosterMiss(key){
    posterMisses[key]=now();
    const entries=Object.entries(posterMisses).sort((a,b)=>b[1]-a[1]).slice(0,400);
    for(const old of Object.keys(posterMisses))delete posterMisses[old];
    for(const [k,v] of entries)posterMisses[k]=v;
    setLocal(POSTER_MISSES_KEY,JSON.stringify(posterMisses));
  }
  function scheduleAutoPoster(item){
    if(panel.hidden||!autoPostersEnabled()||!item||item.poster||item.posterCustomized)return;
    const title=posterDisplayTitle(item.type==='tv'?(item.show||item.title):item.title);
    if(!title||title.length>160)return;
    const kind=item.type==='tv'?'tv':'movie',year=Number(item.year)||null;
    const key=kind+'|'+posterNormalize(title)+'|'+(year||'');
    if(posterQueued.has(key)||posterSeen.has(key))return;
    if(Number(posterMisses[key])>now()-24*60*60*1000)return;
    if(posterQueue.length>=MAX_POSTER_QUEUE)return;
    posterQueued.add(key);posterQueue.push({key,title,kind,year});
    if(!posterWorker)void processAutoPosters();
  }
  async function processAutoPosters(){
    if(posterWorker)return;
    posterWorker=true;
    try{
      while(posterQueue.length&&autoPostersEnabled()&&!panel.hidden){
        const job=posterQueue.shift();posterQueued.delete(job.key);posterSeen.add(job.key);
        const source=window.MarmaladePublicMovieInfo;
        if(typeof source?.lookup!=='function')continue;
        try{
          // Only the normalized title/year/kind are sent to public catalog
          // services. Video bytes, file paths and folder names never leave.
          const result=await source.lookup({
            title:job.title,year:job.year,kind:job.kind,season:null,episode:null
          });
          const match=result?.record;
          if(!match?.poster||!/^https:\/\//i.test(match.poster)||!match.title||
             posterNormalize(match.title)!==posterNormalize(job.title)||
             (job.year&&match.year&&Number(match.year)!==job.year)){
            rememberPosterMiss(job.key);
            continue;
          }
          let updated=false;
          for(const lib of state.libraries){
            for(const entry of lib.items||[]){
              if(entry.poster||entry.posterCustomized)continue;
              const title=entry.type==='tv'?(entry.show||entry.title):entry.title;
              if((entry.type==='tv'?'tv':'movie')!==job.kind||
                 posterNormalize(title)!==posterNormalize(job.title)||
                 (job.year&&entry.year&&Number(entry.year)!==job.year))continue;
              const previous=entry.poster;
              entry.poster=match.poster;
              try{
                await persistNativeItem(lib,entry);
                await persist(lib);
                updated=true;
              }catch(error){
                if(!entry.posterCustomized&&entry.poster===match.poster)entry.poster=previous;
                console.debug('Automatic poster could not be saved',error);
              }
            }
          }
          // Background artwork must not dismiss or move an open context menu.
          if(updated){
            if(state.menuOpen)state.posterRenderPending=true;
            else render();
          }
        }catch(error){
          // Network and provider errors are not permanent negative matches.
          console.debug('Automatic library poster lookup unavailable',job.title,error);
        }
        // Stay gentle on public metadata providers and keep the UI responsive.
        await new Promise(resolve=>setTimeout(resolve,220));
      }
    }finally{
      posterWorker=false;
      if(!autoPostersEnabled()||panel.hidden){posterQueue.length=0;posterQueued.clear();}
    }
  }

  const video=(name)=>VIDEO.test(name||'');
  function normalizeTitle(name){
    return String(name||'').replace(/\.[^.]+$/,'').replace(/[._]+/g,' ')
      .replace(/\b(?:2160p|1080p|720p|480p|UHD|BluRay|BDRip|WEB[- ]?DL|WEBRip|HDR10?|DVDRip|REMUX|x264|x265|HEVC|H264|H265)\b.*$/i,'')
      .replace(/\s*\[[^\]]*\]\s*/g,' ').replace(/\s+/g,' ').trim()||String(name||'');
  }
  function describe(name,path,libraryKind){
    const raw=normalizeTitle(name);
    const episode=raw.match(/\bS(\d{1,2})\s*E(\d{1,3})\b/i)||raw.match(/\b(\d{1,2})x(\d{1,3})\b/i);
    const show=episode?(raw.slice(0,episode.index).replace(/[\s(._-]+$/,'').trim()||
      path.split('/').filter(Boolean)[0]||'TV Series'):'';
    const episodeName=episode?raw.slice(episode.index+episode[0].length).replace(/^[-\s._]+/,'').trim():'';
    const y=raw.match(/\b(19\d{2}|20\d{2})\b/);
    const type=episode?'tv':libraryKind==='tv'?'tv':'movie';
    return {title:episode?(episodeName||'Episode '+Number(episode[2])):
      raw.replace(/\s*[\[(]?(?:19|20)\d{2}[\])]?\s*$/,'').trim()||raw,
      show:episode?show:(libraryKind==='tv'?path.split('/')[0]||raw:''),
      season:episode?Number(episode[1]):null,episode:episode?Number(episode[2]):null,
      year:y?Number(y[1]):null,type};
  }
  function notify(message){
    state.status=message||'';ui.status.textContent=state.status;
  }
  async function openStore(){
    if(typeof indexedDB==='undefined')return null;
    return new Promise(resolve=>{
      let request;
      try{request=indexedDB.open(DB,1);}catch{return resolve(null);}
      request.onupgradeneeded=()=>{
        if(!request.result.objectStoreNames.contains('libraries'))
          request.result.createObjectStore('libraries',{keyPath:'id'});
      };
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>resolve(null);
      request.onblocked=()=>resolve(null);
    });
  }
  function dbOperation(mode,method,payload){
    if(!state.db)return Promise.resolve(null);
    return new Promise((resolve,reject)=>{
      let settled=false,result=null;
      const finish=(error,value)=>{
        if(settled)return;
        settled=true;
        if(error)reject(error);
        else resolve(value);
      };
      try{
        const tx=state.db.transaction('libraries',mode);
        const request=tx.objectStore('libraries')[method](payload);
        request.onsuccess=()=>{result=request.result;};
        // A successful request is NOT a committed transaction. Wait until
        // transaction completion before saying a library has been saved;
        // premature resolution previously risked losing the new index on
        // immediate page reload or navigating into OnlyFrames.
        tx.oncomplete=()=>finish(null,result);
        request.onerror=()=>finish(request.error||new Error('Library database operation failed'));
        tx.onerror=()=>finish(tx.error||new Error('Library transaction failed'));
        tx.onabort=()=>finish(tx.error||new Error('Library transaction aborted'));
      }catch(error){finish(error);}
    });
  }
  async function persist(lib){
    if(!state.db)return;
    try{await dbOperation('readwrite','put',lib);}
    catch(error){
      // WebViews can disallow structured-cloning directory handles. Catalog
      // metadata survives, while folder access must be reauthorized.
      const plain={...lib,folders:lib.folders.map(f=>({...f,handle:null,playHandle:null}))};
      try{await dbOperation('readwrite','put',plain);
        notify('Library saved. This browser requires folder access again after reopening.');}
      catch{notify('Unable to save this library on this device. It remains available until this tab closes.');}
    }
  }
  async function erase(idToRemove){
    try{await dbOperation('readwrite','delete',idToRemove);}catch{notify('Could not remove saved library data.');}
  }
  function selectedLibrary(){return state.libraries.find(l=>l.id===state.selected)||null;}
  // Generic Minternet "Local Media Library" add-on API. Any granted site
  // can use this bridge; Marmalade is simply its first consumer. The older
  // MarmaladeNativeLibrary name is accepted for compatibility.
  function nativeLibraryApi(){
    const api=window.MinternetMediaLibrary||window.MarmaladeNativeLibrary;
    return api&&typeof api.getCatalog==='function'?api:null;
  }
  // A folder is "dead" when this page can no longer read it: a session
  // folder from a previous visit (its File objects are gone after reload),
  // or a handle folder whose handle did not survive IndexedDB storage.
  // Dead folders are why a saved library can sit at 0 videos forever:
  // nothing ever rescans them. They must be reconnected by re-picking.
  function folderIsDead(folder){
    if(!folder||folder.source==='extension'||folder.source==='native')return false;
    if(folder.source==='session')return !state.sessionFolderLoaded.has(folder.id);
    return !folder.handle;
  }
  function allItems(){return state.libraries.flatMap(l=>(l.items||[]).map(item=>({...item,libraryId:l.id,libraryName:l.name})));}
  function shelfItems(){const lib=selectedLibrary();return lib?
    (lib.items||[]).map(item=>({...item,libraryId:lib.id,libraryName:lib.name})):allItems();}
  function setSelected(next){
    state.selected=next;state.series=null;state.folder=null;state.folderMode=false;
    // Switching shelves must not inherit a hidden search/watch/collection
    // filter and appear empty after a successful folder scan.
    state.query='';state.kind='all';state.collection='all';
    ui.search.value='';ui.filter.value='all';ui.collections.value='all';
    state.page=0;setLocal('marmalade:media-library:selected',next);render();
  }
  function setVisibility(enabled){
    const value=!!enabled;
    panel.hidden=!value;
    row.classList.toggle('library-enabled',value);
    const control=$('mlVisibilityToggle');
    if(control)control.checked=value;
    setLocal(KEY,value?'true':'false');
    if(value)render();else{posterQueue.length=0;posterQueued.clear();}
  }
  function setPosterColumns(value,persist=true){
    const numeric=Number(value);
    const count=Number.isFinite(numeric)?
      Math.max(MIN_POSTER_COLUMNS,Math.min(MAX_POSTER_COLUMNS,Math.round(numeric))):4;
    state.posterColumns=count;
    if(persist)setLocal(POSTER_COLUMNS_KEY,count);
    // Changing column count changes the actual grid, not only a CSS zoom.
    // Artwork, text and overlaid controls use the same responsive size factor.
    ui.cards.style.setProperty('--ml-poster-columns',String(count));
    ui.cards.style.setProperty('--ml-poster-gap',Math.max(3,Math.round(8*Math.min(1,4/count)))+'px');
    ui.cards.style.setProperty('--ml-card-ui-scale',String(Math.max(.55,Math.min(1.45,4/count))));
    ui.posterSmaller.disabled=count>=MAX_POSTER_COLUMNS;
    ui.posterLarger.disabled=count<=MIN_POSTER_COLUMNS;
    ui.posterSmaller.title='Smaller posters · '+Math.min(MAX_POSTER_COLUMNS,count+1)+' per row';
    ui.posterLarger.title='Larger posters · '+Math.max(MIN_POSTER_COLUMNS,count-1)+' per row';
    ui.posterZoom.hidden=state.list;
    if(ui.posterColumnsSetting)ui.posterColumnsSetting.value=String(count);
  }
  function addSetting(){
    const stack=document.querySelector('#settingsPageVideo .settings-stack');
    if(stack&&!$('mlVisibilitySetting')){
      const label=create('label','settings-row settings-toggle-row ml-setting-row');
      label.id='mlVisibilitySetting';
      append(label,'span','','Media Library');
      const check=append(label,'input');
      check.type='checkbox';check.id='mlVisibilityToggle';
      check.setAttribute('aria-label','Show Media Library');
      check.checked=readLocal(KEY,'false')==='true';
      check.addEventListener('change',()=>setVisibility(check.checked));
      stack.append(label);
    }
    const setting=$('mlSettingsBtn'),settingsPanel=$('mlSettingsPanel');
    const close=()=>{
      settingsPanel.hidden=true;
      setting.setAttribute('aria-expanded','false');
    };
    setting.addEventListener('click',()=>{
      const opening=settingsPanel.hidden;
      settingsPanel.hidden=!opening;
      setting.setAttribute('aria-expanded',String(opening));
    });
    $('mlSettingsClose').addEventListener('click',close);
    const backupRow=append(settingsPanel,'div','ml-backup-actions');
    const exportButton=append(backupRow,'button','ml-primary','Export Catalog');exportButton.type='button';exportButton.id='mlExportCatalog';
    const importButton=append(backupRow,'button','ml-primary','Import Catalog');importButton.type='button';importButton.id='mlImportCatalog';
    const backupInput=append(backupRow,'input');backupInput.type='file';backupInput.accept='.json,application/json';backupInput.hidden=true;
    backupInput.id='mlCatalogBackupInput';
    exportButton.addEventListener('click',downloadLibraryBackup);
    importButton.addEventListener('click',()=>backupInput.click());
    backupInput.addEventListener('change',()=>{const file=backupInput.files?.[0];backupInput.value='';void importLibraryBackup(file);});
    append(settingsPanel,'p','','Portable backups preserve local catalog metadata. Reconnect media folders after importing.');
    const nextLabel=append(settingsPanel,'label','ml-setting-control');
    append(nextLabel,'span','','Automatically Play Next Episode (Solo)');
    const nextToggle=append(nextLabel,'input');nextToggle.type='checkbox';nextToggle.id='mlAutoNext';
    nextToggle.checked=readLocal(AUTO_NEXT_KEY,'false')==='true';
    nextToggle.addEventListener('change',()=>setLocal(AUTO_NEXT_KEY,nextToggle.checked?'true':'false'));
    addSmartEditor(settingsPanel);
    document.addEventListener('pointerdown',event=>{
      if(!settingsPanel.hidden&&!settingsPanel.contains(event.target)&&
         !setting.contains(event.target))close();
    },true);
    window.addEventListener('keydown',event=>{
      if(event.key==='Escape'&&!settingsPanel.hidden)close();
    });
    const posterToggle=$('mlAutomaticPostersToggle');
    posterToggle.checked=autoPostersEnabled();
    posterToggle.addEventListener('change',()=>{
      setLocal(AUTO_POSTERS_KEY,posterToggle.checked?'true':'false');
      posterSeen.clear();
      if(posterToggle.checked)render();
    });
    const columns=$('mlPosterColumnsInput');
    columns.setAttribute('aria-label','Number of posters per row (default four)');
    columns.addEventListener('change',()=>{setPosterColumns(columns.value);render();});
    ui.posterColumnsSetting=columns;
    setVisibility(readLocal(KEY,'false')==='true');
  }
  function permissions(folder,ask){
    if(!folder?.handle)return Promise.resolve(false);
    const h=folder.handle;
    return (async()=>{
      try{
        let result=typeof h.queryPermission==='function'?
          await h.queryPermission({mode:'read'}):'granted';
        if(result!=='granted'&&ask&&typeof h.requestPermission==='function')
          result=await h.requestPermission({mode:'read'});
        return result==='granted';
      }catch{return false;}
    })();
  }
  async function scanFolder(folder,kind,seq,ask){
    if(folder.source==='session'){
      const matches=[];
      for(const [key,file] of state.sessionFiles){
        if(!key.startsWith(folder.id+'|'))continue;
        const path=key.slice(folder.id.length+1);
        matches.push(makeItem(folder,path,file,kind));
      }
      return state.sessionFolderLoaded.has(folder.id)?matches:null;
    }
    if(!folder.handle)return null;
    if(!await permissions(folder,ask))return null;
    const items=[];
    let visited=0;
    async function walk(dir,prefix){
      for await(const [name,entry] of dir.entries()){
        if(seq!==state.scanSeq)throw Error('Scan cancelled');
        if(!name||name.startsWith('.')||IGNORE.has(name.toLowerCase()))continue;
        const path=prefix+name;
        if(entry.kind==='directory'){
          await walk(entry,path+'/');
        }else if(entry.kind==='file'&&video(name)){
          try{
            const file=await entry.getFile();
            items.push(makeItem(folder,path,file,kind));
          }catch(error){
            // The directory listing itself is authoritative for discovery.
            // Some browsers can enumerate a media file before getFile() becomes
            // available (large files, permissions, transient disk failures).
            // Keep its title visible and resolve the real file lazily on Play.
            const placeholder=makeItem(folder,path,
              {name,size:0,lastModified:0},kind);
            placeholder.metadataPending=true;
            items.push(placeholder);
            console.debug('Media file indexed by name; metadata access deferred:',path,error);
          }
        }
        if(++visited%80===0){
          ui.status.textContent='Scanning '+folder.name+' · '+countLabel(items.length);
          await new Promise(resolve=>setTimeout(resolve,0));
        }
      }
    }
    await walk(folder.handle,'');
    return items;
  }
  function makeItem(folder,path,file,kind){
    const info=describe(file.name||path.split('/').pop(),path,kind);
    return {id:folder.id+'|'+path,folderId:folder.id,path,name:file.name,
      size:file.size||0,lastModified:file.lastModified||0,addedAt:now(),...info};
  }
  // Preserve metadata when a unique unchanged file moves inside a scanned
  // folder. Never guess between equal-size/equal-mtime candidates.
  function reconcileFolder(previous,found,hiddenIds=[]){
    const oldById=new Map(previous.map(item=>[item.id,item]));
    const newIds=new Set(found.map(item=>item.id));
    const identity=item=>Number(item.size)>0&&Number(item.lastModified)>0?item.size+'|'+item.lastModified:null;
    const missing=new Map(),added=new Map(),renamed=new Map();
    const add=(map,key,item)=>{if(key){if(!map.has(key))map.set(key,[]);map.get(key).push(item);}};
    for(const item of previous)if(!newIds.has(item.id))add(missing,identity(item),item);
    for(const item of found)if(!oldById.has(item.id))add(added,identity(item),item);
    for(const item of found){
      let old=oldById.get(item.id);
      if(!old){
        const key=identity(item),from=missing.get(key),to=added.get(key);
        if(from?.length===1&&to?.length===1){old=from[0];renamed.set(old.id,item.id);}
      }
      if(!old)continue;
      // A replacement at the same path is not the previous movie.
      if(!item.metadataPending&&old.size>0&&item.size>0&&
          (old.size!==item.size&&old.lastModified!==item.lastModified))continue;
      const current={id:item.id,path:item.path,folderId:item.folderId,name:item.name,
        size:item.metadataPending?old.size:item.size,
        lastModified:item.metadataPending?old.lastModified:item.lastModified,
        metadataPending:!!item.metadataPending,addedAt:old.addedAt||item.addedAt};
      Object.assign(item,old,current);
    }
    return [...new Set(hiddenIds.map(id=>renamed.get(id)||id))];
  }
  function scanPreview(message){
    const el=$('mlScanPreview');
    if(el)el.textContent=message||'';
  }
  function indexPendingFolder(folder){
    const draft=state.pending;
    if(!draft)return;
    const promise=(async()=>{
      scanPreview('Indexing '+folder.name+'…');
      try{
        // Request access while the folder-selection gesture is still active.
        // Newly chosen handles often report "prompt", not "granted", and a
        // silent scan with ask=false previously produced an empty library.
        const found=await scanFolder(folder,draft.kind,state.scanSeq,true);
        if(draft!==state.pending)return;
        if(found===null){
          state.scanProblems.set(folder.id,'Folder access not granted');
          scanPreview('No access to '+folder.name+'. Click Reconnect next to the folder and allow access.');
          notify('Folder permission needed. Reconnect '+folder.name+' and allow read access.');
          drawFolders();
          return null;
        }
        state.scanProblems.delete(folder.id);
        draft.hiddenIds=reconcileFolder((draft.items||[]).filter(i=>i.folderId===folder.id),found,draft.hiddenIds||[]);
        draft.items=(draft.items||[]).filter(i=>i.folderId!==folder.id).concat(found);
        const deferred=found.filter(item=>item.metadataPending).length;
        const direct=state.autoAttachDraft===draft;
        scanPreview(found.length?(found.length+' video'+(found.length===1?'':'s')+
          ' found in '+folder.name+
          (deferred?' · '+deferred+' need file access when played.':'')+
          (direct?'. Adding to your library automatically…':'. Click Save Library — your movies will appear right away.')):
          '0 videos found in '+folder.name+
          '. Choose the folder that actually contains your video files, including its subfolders.');
        drawFolders();
        ui.save.textContent=(draft.items||[]).length?
          'Save Library · '+countLabel((draft.items||[]).length):'Save Library';
        return found.length;
      }catch(error){
        console.warn('Library folder indexing failed',error);
        state.scanProblems.set(folder.id,error?.message||'Folder read failed');
        scanPreview('Cannot scan '+folder.name+': '+(error?.message||'folder unavailable')+
          '. Click Reconnect next to the folder and try again.');
        drawFolders();
        return null;
      }
    })();
    state.pendingScans.add(promise);
    ui.save.disabled=true;
    const settled=promise.finally(()=>{
      state.pendingScans.delete(promise);
      if(!state.pendingScans.size)ui.save.disabled=false;
    });
    // Empty-library + Choose Folder and the toolbar + Folder are direct actions:
    // the selected folder must be indexed AND saved without a second Save click.
    // Keep the editor open on cancellation/permission failure/zero files.
    if(state.autoAttachDraft===draft)void settled.then(count=>{
      if(state.autoAttachDraft!==draft||state.pending!==draft)return;
      if(count===null||count===undefined||count<1){
        state.autoAttachDraft=null;
        notify(count===0?'No video files were found in that folder. Try another folder.':
          'Folder could not be indexed. Use Reconnect next to the folder and allow access.');
        return;
      }
      state.autoAttachDraft=null;
      void saveEditor();
    });
    return settled;
  }
  // Index each folder once instead of repeatedly scanning the entire catalog.
  function groupItemsByFolder(items){
    const groups=new Map();
    for(const item of items){
      let group=groups.get(item.folderId);
      if(!group){group=[];groups.set(item.folderId,group);}
      group.push(item);
    }
    return groups;
  }
  async function scanLibrary(lib,{ask=false}={}){
    if(!lib||state.scanning){notify('A library scan is already in progress.');return;}
    if(lib.id.startsWith('addon:')&&nativeLibraryApi()?.rescan){
      try{
        const catalog=await nativeLibraryApi().rescan();
        await syncFromNative(catalog);
        const current=state.libraries.find(l=>l.id===lib.id);
        notify(countLabel(current?.items?.length||0)+' indexed in '+lib.name+' by the Minternet extension.');
      }catch(error){notify('Native library scan failed: '+(error?.message||error));}
      return;
    }
    state.scanning=true;
    const seq=++state.scanSeq,oldItems=(lib.items||[]).slice();
    const oldGroups=groupItemsByFolder(oldItems),nextGroups=new Map(oldGroups);
    let accessIssues=0,folderIssues=0;
    let hiddenIds=(lib.hiddenIds||[]).slice();
    ui.rescan.disabled=true;notify('Scanning '+lib.name+'…');
    try{
      for(const folder of lib.folders){
        if(seq!==state.scanSeq)break;
        // Extension-held and Minternet add-on folders are rescanned by
        // their owners; the web app must never overwrite their catalogs.
        if(folder.source==='extension'||folder.source==='native')continue;
        let found=null;
        try{found=await scanFolder(folder,lib.kind,seq,ask);}
        catch(error){
          if(seq!==state.scanSeq)break;
          folderIssues++;console.warn('Library folder scan failed:',folder.name,error);
        }
        if(found!==null){
          hiddenIds=reconcileFolder(oldGroups.get(folder.id)||[],found,hiddenIds);
          const blocked=new Set(hiddenIds);
          nextGroups.set(folder.id,found.filter(item=>!blocked.has(item.id)));
          state.scanProblems.delete(folder.id);
        }else{
          accessIssues++;
          state.scanProblems.set(folder.id,'Permission needed. Use Edit Library → Reconnect.');
        }
      }
      if(seq!==state.scanSeq)return;
      const items=[...nextGroups.values()].flat();
      lib.items=items;lib.hiddenIds=hiddenIds;
      lib.lastScan=now();
      await persist(lib);
      if(folderIssues)notify('Some folders failed to scan. Edit Library to reconnect; previously indexed titles are kept.');
      else if(accessIssues)notify(accessIssues+' folder'+(accessIssues===1?' needs':'s need')+
        ' access. Click the pencil next to '+lib.name+' and reconnect. Indexed titles remain visible.');
      else if(!items.length&&lib.folders.length)
        notify('0 videos found in '+lib.name+
          '. Confirm the folder contains supported videos, or reconnect it using Other Picker.');
      else{
        const deferred=items.filter(item=>item.metadataPending).length;
        notify(countLabel(items.length)+' indexed in '+lib.name+
          (deferred?' · '+deferred+' file'+(deferred===1?'':'s')+
          ' may need access when played.':'.'));
      }
    }finally{
      if(seq===state.scanSeq){state.scanning=false;ui.rescan.disabled=false;render();}
    }
  }
  function cleanHash(text){
    let hash=0;
    for(const ch of String(text||''))hash=(hash*31+ch.charCodeAt(0))|0;
    return ['#865f65','#6b779a','#9a714b','#80618c','#5f8781','#96745f','#786f9b'][Math.abs(hash)%7];
  }
  function storedItem(item){
    const lib=state.libraries.find(l=>l.id===item.libraryId);
    return {lib,entry:lib?.items.find(i=>i.id===item.id)};
  }
  function nativeItemChanges(entry){
    const fields=['title','year','type','show','season','episode','poster',
      'overview','favorite','watched','watchlist','playlists','collections',
      'runtimeSec','metadataSource','customized','analyzedAt','posterCustomized'];
    return Object.fromEntries(fields.filter(key=>entry[key]!==undefined).map(key=>[key,entry[key]]));
  }
  async function persistNativeItem(lib,entry,extra={}){
    if(!lib?.id?.startsWith('addon:'))return;
    const api=nativeLibraryApi();
    if(typeof api?.updateItem!=='function')throw Error('Minternet extension cannot save media changes. Update Minternet and restart.');
    await api.updateItem({libraryId:lib.id.slice(6),itemId:entry.id,
      changes:{...nativeItemChanges(entry),...extra}});
  }
  async function mutateItems(items,fn,message){
    const changed=new Set();
    const edited=[];
    for(const item of items){
      const {lib,entry}=storedItem(item);
      if(!entry)continue;
      fn(entry,lib);changed.add(lib);edited.push({lib,entry});
    }
    try{
      for(const {lib,entry} of edited)await persistNativeItem(lib,entry);
      for(const lib of changed)await persist(lib);
      render();
      if(message)notify(message);
    }catch(error){
      notify('Media changes were not saved to the extension: '+(error?.message||error));
    }
  }
  function showItems(target){
    return (state.libraries.find(l=>l.id===target.libId)?.items||[])
      .filter(item=>item.show===target.show)
      .map(item=>({...item,libraryId:target.libId}));
  }
  function closeMenu(){
    ui.menu.hidden=true;
    ui.menu.replaceChildren();
    state.menuTarget=null;
    state.menuOpen=false;
    if(state.posterRenderPending){
      state.posterRenderPending=false;
      render();
    }
  }
  function closeItemDialog(){
    ui.itemDialog.hidden=true;
    state.itemEditing=null;
    ui.itemBody.replaceChildren();
  }
  function itemField(parent,label,value,id,type='text'){
    const row=append(parent,'label','ml-item-field');
    append(row,'span','',label);
    const input=append(row,type==='textarea'?'textarea':'input');
    input.id=id;
    if(type!=='textarea')input.type=type;
    input.value=value??'';
    if(type==='number'){input.min='0';input.max='2100';}
    return input;
  }
  function showDetails(item,mode='edit'){
    closeMenu();
    const {entry}=storedItem(item);
    if(!entry){notify('This entry no longer exists. Rescan its folder.');return;}
    state.itemEditing={id:entry.id,libId:item.libraryId,mode};
    ui.itemDialog.hidden=false;
    ui.itemBody.replaceChildren();
    const isEdit=mode==='edit';
    ui.itemTitle.textContent=isEdit?'Edit Movie or Episode':'Get Info';
    ui.itemSave.hidden=!isEdit;
    $('mlItemDialogCancel').textContent=isEdit?'Cancel':'Close';
    if(!isEdit){
      const lib=state.libraries.find(l=>l.id===item.libraryId);
      const folder=lib?.folders.find(f=>f.id===entry.folderId);
      const rows=[
        ['Title',entry.title],['File',entry.name],['Folder',folder?.name||'Unavailable'],
        ['Relative Path',entry.path],['Size',(entry.size/1048576).toFixed(2)+' MB'],
        ['Modified',entry.lastModified?new Date(entry.lastModified).toLocaleString():'Unknown'],
        ['Type',entry.type==='tv'?'TV Episode':'Movie'],['Library',lib?.name||''],
        ['Duration',entry.runtimeSec?Math.round(entry.runtimeSec)+' seconds':'Not Analyzed'],
        ['Watched',entry.watched?'Yes':'No'],
        ['Collections',(entry.collections||[]).join(', ')||'None'],
        ['Playlists',(entry.playlists||[]).join(', ')||'None']
      ];
      for(const [name,value] of rows){
        const line=append(ui.itemBody,'div','ml-info-line');
        append(line,'strong','',name);
        append(line,'span','',value||'Not Available');
      }
      const analyzeAgain=append(ui.itemBody,'button','ml-info-analyze','Re-analyze File');
      analyzeAgain.type='button';
      analyzeAgain.title='Read local media duration and technical information again';
      analyzeAgain.addEventListener('click',()=>{
        analyzeAgain.disabled=true;
        void analyze(item).finally(()=>{analyzeAgain.disabled=false;});
      });
      return;
    }
    itemField(ui.itemBody,'Display Title',entry.title,'mlEditTitle');
    itemField(ui.itemBody,'Year',entry.year||'','mlEditYear','number');
    const typeRow=append(ui.itemBody,'label','ml-item-field');
    append(typeRow,'span','','Content Type');
    const select=append(typeRow,'select');
    select.id='mlEditKind';
    for(const [value,label] of [['movie','Movie'],['tv','TV Episode']]){
      const option=create('option');option.value=value;option.textContent=label;select.append(option);
    }
    select.value=entry.type;
    itemField(ui.itemBody,'Series Name (TV)',entry.show||'','mlEditShow');
    itemField(ui.itemBody,'Season',entry.season??'','mlEditSeason','number');
    itemField(ui.itemBody,'Episode',entry.episode??'','mlEditEpisode','number');
    itemField(ui.itemBody,'Poster URL (HTTPS)',/^https:\/\//i.test(entry.poster||'')?entry.poster:'','mlEditPoster','url');
    const posterOptions=append(ui.itemBody,'div','ml-poster-editor');
    const posterButton=append(posterOptions,'button','ml-primary','Edit Poster');
    posterButton.type='button';
    posterButton.addEventListener('click',()=>choosePoster(item));
    if(/^data:image\//i.test(entry.poster||'')||/^http:\/\/127\.0\.0\.1:18761\/poster\//.test(entry.poster||''))
      append(posterOptions,'small','',
      'Custom poster stored locally. Use Edit Poster to replace it.');
    itemField(ui.itemBody,'Summary',entry.overview||'','mlEditOverview','textarea');
    const help=append(ui.itemBody,'p','ml-help',
      'These changes update only your local catalog, never your original media files. They survive a folder rescan.');
    help.id='mlEditHelp';
  }
  async function saveItemDetails(){
    const target=state.itemEditing;
    if(!target||target.mode!=='edit')return;
    const lib=state.libraries.find(l=>l.id===target.libId);
    const item=lib?.items.find(i=>i.id===target.id);
    if(!item)return;
    const title=$('mlEditTitle').value.trim();
    if(!title){$('mlEditTitle').reportValidity();notify('Enter a title.');return;}
    const poster=$('mlEditPoster').value.trim();
    if(poster&&!/^https:\/\//i.test(poster)){notify('Poster URLs must use HTTPS.');return;}
    const year=Number($('mlEditYear').value)||null;
    if(year&&(year<1880||year>2100)){notify('Enter a valid movie year.');return;}
    item.title=title.slice(0,180);item.year=year;
    item.type=$('mlEditKind').value;
    item.show=$('mlEditShow').value.trim().slice(0,180);
    item.season=$('mlEditSeason').value?Number($('mlEditSeason').value):null;
    item.episode=$('mlEditEpisode').value?Number($('mlEditEpisode').value):null;
    item.poster=poster||(
      /^(?:data:image\/|http:\/\/127\.0\.0\.1:18761\/poster\/)/i.test(item.poster||'')
        ?item.poster:'');
    if(poster)item.posterCustomized=true;
    item.overview=$('mlEditOverview').value.trim().slice(0,3000);
    item.customized=true;
    try{
      await persistNativeItem(lib,item);
      await persist(lib);closeItemDialog();render();
      notify('Updated '+item.title+' in '+lib.name+' and saved to the extension.');
    }catch(error){notify('Media edit not saved to Minternet: '+(error?.message||error));}
  }
  // Get Info incorporates on-demand file analysis; the user no longer has
  // to hunt for a separate Analyze action in the three-dot menu.
  function openInfo(item){
    showDetails(item,'info');
    const {entry}=storedItem(item);
    if(entry&&!entry.analyzedAt)void analyze(item);
  }
  // Store a small, aspect-correct, compressed image in the same native
  // extension catalog as the metadata. Never upload or modify the movie.
  async function encodePoster(file){
    if(!/^image\/(jpeg|png|webp|avif)$/.test(file.type||''))
      throw Error('Choose a JPEG, PNG, WebP, or AVIF image.');
    if(file.size>20*1024*1024)
      throw Error('Poster file is too large. Choose an image smaller than 20 MB.');
    const objectUrl=URL.createObjectURL(file);
    try{
      const image=new Image();
      image.src=objectUrl;
      if(typeof image.decode==='function')await image.decode();
      else await new Promise((resolve,reject)=>{
        image.onload=resolve;image.onerror=()=>reject(Error('Unable to decode poster image.'));
      });
      if(!image.naturalWidth||!image.naturalHeight)
        throw Error('The selected image could not be decoded.');
      const ratio=image.naturalWidth/image.naturalHeight;
      if(!Number.isFinite(ratio)||ratio<=0)throw Error('Invalid poster dimensions.');
      const widths=[420,360,300,240];
      for(const width of widths){
        const canvas=document.createElement('canvas');
        canvas.width=width;canvas.height=Math.round(width*1.5);
        const context=canvas.getContext('2d',{alpha:false});
        if(!context)throw Error('Poster image processing is unavailable in this browser.');
        context.fillStyle='#16121c';context.fillRect(0,0,canvas.width,canvas.height);
        // "Cover" crop, not stretch: retain correct 2:3 poster proportions.
        const scale=Math.max(canvas.width/image.naturalWidth,canvas.height/image.naturalHeight);
        const drawW=image.naturalWidth*scale,drawH=image.naturalHeight*scale;
        context.drawImage(image,(canvas.width-drawW)/2,(canvas.height-drawH)/2,drawW,drawH);
        for(const quality of [.82,.7,.55]){
          let data=canvas.toDataURL('image/webp',quality);
          if(!data.startsWith('data:image/webp;'))
            data=canvas.toDataURL('image/jpeg',quality);
          if(data.length<=240*1024)return data;
        }
      }
      throw Error('Poster could not be compressed sufficiently. Try another image.');
    }finally{URL.revokeObjectURL(objectUrl);}
  }
  function choosePoster(item){
    const {entry,lib}=storedItem(item);
    if(!entry||!lib){notify('This media item is unavailable.');return;}
    const input=document.createElement('input');
    input.type='file';input.accept='image/jpeg,image/png,image/webp,image/avif';
    // Some embedded Chromium/WebView2 builds suppress the OS picker for a
    // display:none/hidden file input. Keep it in the document and visually
    // offscreen instead, while invoking it directly in the trusted click.
    input.style.cssText='position:fixed;left:-10000px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
    input.tabIndex=-1;input.setAttribute('aria-label','Choose Poster Image');
    document.body.append(input);
    const cleanup=()=>{input.remove();};
    input.addEventListener('cancel',cleanup,{once:true});
    input.addEventListener('change',()=>{
      const file=input.files?.[0];cleanup();
      if(!file)return;
      void (async()=>{
        try{
          const poster=await encodePoster(file);
          const previousPoster=entry.poster,previousFlag=entry.posterCustomized;
          entry.poster=poster;entry.posterCustomized=true;
          try{
            await persistNativeItem(lib,entry);
            await persist(lib);
          }catch(error){
            entry.poster=previousPoster;entry.posterCustomized=previousFlag;
            throw error;
          }
          render();
          notify('Custom glossy poster saved for '+entry.title+'.');
          if(state.itemEditing?.id===entry.id)showDetails(item,state.itemEditing.mode);
        }catch(error){
          notify('Could not save poster: '+String(error?.message||error));
        }
      })();
    },{once:true});
    // Keep the OS picker tied to the actual user click.
    input.click();
  }
  async function analyze(item){
    const {entry,lib}=storedItem(item);
    if(!entry)return;
    notify('Analyzing '+entry.name+'…');
    let duration=null;
    try{
      let url,owned=false;
      if(lib?.id?.startsWith('addon:')){
        if(!entry.url)throw Error('Native media server has no stream URL for this video.');
        url=entry.url;
      }else{
        const {file}=await getPlayable(item);
        if(!file.type.startsWith('video/')&&!video(file.name))throw Error('Unsupported video');
        url=URL.createObjectURL(file);owned=true;
      }
      try{
        duration=await new Promise(resolve=>{
          const media=document.createElement('video');
          media.preload='metadata';media.muted=true;
          if(!owned)media.crossOrigin='anonymous';
          let done=false;
          const finish=value=>{
            if(done)return;done=true;
            clearTimeout(timeout);media.removeAttribute('src');media.load();
            resolve(value);
          };
          const timeout=setTimeout(()=>finish(null),7000);
          media.onloadedmetadata=()=>finish(
            Number.isFinite(media.duration)&&media.duration>0?media.duration:null);
          media.onerror=()=>finish(null);
          media.src=url;
        });
      }finally{if(owned)URL.revokeObjectURL(url);}
    }catch(error){notify('Media analysis failed: '+(error?.message||''));return;}
    entry.runtimeSec=duration;
    entry.analyzedAt=now();
    try{await persistNativeItem(lib,entry);await persist(lib);}
    catch(error){notify('Could not save analysis to extension: '+(error?.message||error));return;}
    if(state.itemEditing?.id===entry.id&&state.itemEditing?.mode==='info')
      showDetails(item,'info');
    notify(duration?'Duration analyzed: '+Math.round(duration)+' seconds.':
      'File analyzed. This browser cannot decode duration for this container.');
  }
  async function refreshMetadata(items,{fix=false}={}){
    const source=window.MarmaladePublicMovieInfo;
    if(typeof source?.lookup!=='function'){notify('Metadata sources are unavailable.');return;}
    if(readLocal('marmalade:media-library:art-consent','false')!=='true'){
      if(!window.confirm('Look up movie metadata using its title and year? Only title and year, not video files or local paths, will be sent to a public information source.'))return;
      setLocal('marmalade:media-library:art-consent','true');
    }
    let success=0;
    for(const target of items.slice(0,12)){
      const {lib,entry}=storedItem(target);
      if(!entry)continue;
      let query=entry.type==='tv'?(entry.show||entry.title):entry.title;
      let year=entry.year;
      if(fix){
        const newTitle=window.prompt('Search public metadata for title:',query);
        if(newTitle===null)return;
        query=newTitle.trim();if(!query)return;
      }
      try{
        const result=await source.lookup({title:query,year:year||null,
          kind:entry.type==='tv'?'tv':'movie',season:null,episode:null});
        const rec=result?.record;
        if(!rec?.title)continue;
        const normalize=t=>String(t||'').toLocaleLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
        if(!fix&&normalize(rec.title)!==normalize(query))continue;
        if(!fix&&year&&rec.year&&Number(rec.year)!==Number(year))continue;
        if(fix&&!window.confirm('Use metadata for "'+rec.title+'"'+
          (rec.year?' ('+rec.year+')':'')+'?'))continue;
        if(!entry.posterCustomized&&rec.poster&&/^https:\/\//i.test(rec.poster))entry.poster=rec.poster;
        if(rec.overview)entry.overview=String(rec.overview).slice(0,3000);
        if(rec.year)entry.year=Number(rec.year)||entry.year;
        if(fix){
          if(entry.type==='tv')entry.show=rec.title;
          else entry.title=rec.title;
        }
        entry.metadataSource=rec.source||'Public metadata';
        await persistNativeItem(lib,entry);
        await persist(lib);success++;
      }catch(error){console.debug('Library metadata lookup missed',query,error);}
    }
    render();
    notify(success?'Updated metadata for '+success+' title'+(success===1?'':'s')+'.':
      'No confirmed public metadata match. Use Edit Details to enter it manually.');
  }
  function addToTagGroup(item,field){
    const raw=window.prompt(field==='collections'?'Collection name:':'Playlist name:','');
    if(raw===null)return;
    const name=raw.trim().slice(0,100);
    if(!name)return;
    void mutateItems([item],entry=>{
      const list=entry[field]||[];
      entry[field]=[...new Set([...list,name])];
    },'Added to '+(field==='collections'?'collection ':'playlist ')+name+'.');
  }
  function removeFromCatalog(item){
    const {entry,lib}=storedItem(item);
    if(!entry)return;
    if(!window.confirm('Remove "'+entry.title+'" from this library catalog? The original video will NOT be deleted. You can restore hidden entries from the library options menu.'))return;
    lib.hiddenIds=[...new Set([...(lib.hiddenIds||[]),entry.id])];
    lib.items=lib.items.filter(x=>x.id!==entry.id);
    void (async()=>{
      try{
        await persistNativeItem(lib,entry,{hidden:true});
        await persist(lib);render();
        notify('Hidden in the library catalog and saved to the extension. Original video untouched.');
      }catch(error){notify('Could not save hidden video to extension: '+(error?.message||error));}
    })();
  }
  function openMenu(target,x,y,anchor=null){
    if(!target)return;
    closeMenu();
    state.menuTarget=target;state.menuOpen=true;state.menuReturnFocus=anchor||document.activeElement;
    const menu=ui.menu;
    const action=(label,fn,{danger=false,disabled=false}={})=>{
      const b=append(menu,'button','ml-menu-action'+(danger?' ml-menu-danger':''),label);
      b.type='button';b.setAttribute('role','menuitem');b.disabled=disabled;
      b.addEventListener('click',event=>{
        event.preventDefault();event.stopPropagation();closeMenu();fn();
      });
    };
    const sep=()=>append(menu,'div','ml-menu-separator');
    if(target.kind==='library'){
      const lib=state.libraries.find(l=>l.id===target.libId);
      if(!lib)return;
      action('✎  Edit Library',()=>{setSelected(lib.id);openEditor(lib);});
      action('＋  Add Media Folder',()=>{setSelected(lib.id);openEditor(lib);});
      action('↻  Scan Library Files',()=>void scanLibrary(lib,{ask:true}));
      action('▧  Refresh All Posters',()=>{setSelected(lib.id);void findArtwork();});
      action('▤  Browse Folders',()=>{setSelected(lib.id);state.folderMode=true;render();});
      if((lib.hiddenIds||[]).length)action('↶  Restore Hidden Videos',()=>void (async()=>{
        try{
          if(lib.id.startsWith('addon:')){
            const api=nativeLibraryApi();
            if(!api?.updateItem)throw Error('Minternet extension is unavailable');
            for(const itemId of lib.hiddenIds){
              await api.updateItem({libraryId:lib.id.slice(6),itemId,changes:{hidden:false}});
            }
            await syncFromNative();
          }else{
            lib.hiddenIds=[];await persist(lib);await scanLibrary(lib,{ask:true});
          }
          notify('Hidden videos restored.');
        }catch(error){notify('Could not restore hidden videos: '+(error?.message||error));}
      })());
      sep();
      action('✕  Remove Library',()=>{state.editing=lib.id;void removeLibrary();},{danger:true});
    }else if(target.kind==='item'){
      const {lib,entry}=storedItem(target.item);
      if(!entry)return;
      action('✓  Mark as '+(entry.watched?'Unwatched':'Watched'),
        ()=>void mutateItems([target.item],item=>{item.watched=!item.watched;},'Watch status saved.'));
      action('☷  '+(entry.watchlist?'Remove from Watchlist':'Add to Watchlist'),
        ()=>void mutateItems([target.item],item=>{item.watchlist=!item.watchlist;},'Watchlist updated.'));
      action('✎  Edit Details',()=>showDetails(target.item));
      action('▧  Edit Poster',()=>choosePoster(target.item));
      action('＋  Add to Playlist',()=>addToTagGroup(target.item,'playlists'));
      action('＋  Add to Collection',()=>addToTagGroup(target.item,'collections'));
      for(const key of ['playlists','collections']){
        for(const name of entry[key]||[])action('−  Remove from '+name,()=>void mutateItems([target.item],item=>{
          item[key]=(item[key]||[]).filter(n=>n!==name);
        },'Removed from '+name+'.'));
      }
      sep();
      action('⌕  Match',()=>void refreshMetadata([target.item],{fix:true}));
      if(entry.metadataSource||entry.poster||entry.overview)
        action('✕  Unmatch Metadata',()=>void mutateItems([target.item],item=>{
          if(!item.posterCustomized)item.poster='';
          item.overview='';item.metadataSource='';
        },'External metadata cleared. Manually edited title and original file are unchanged.'));
      action('ℹ  Get Info',()=>void openInfo(target.item));
      action('▣  Browse Containing Folder',()=>{
        setSelected(lib.id);state.folderMode=true;
        const parts=entry.path.split('/');
        const parent=parts.length>1?parts.slice(0,-1).join('/')+'/':'';
        state.folder={folderId:entry.folderId,path:parent,label:parent||'Folder'};
        render();
      });
      sep();
      action('✕  Remove from Library',()=>removeFromCatalog(target.item),{danger:true});
    }else if(target.kind==='show'){
      const entries=showItems(target);
      action('▤  Open Series',()=>{
        setSelected(target.libId);state.series={libId:target.libId,show:target.show};render();
      });
      action('✓  Mark All Episodes Watched',()=>void mutateItems(entries,
        item=>{item.watched=true;},'Series marked watched.'));
      action('✓  Mark All Episodes Unwatched',()=>void mutateItems(entries,
        item=>{item.watched=false;},'Series marked unwatched.'));
      action('☷  Add Series to Watchlist',()=>void mutateItems(entries,
        item=>{item.watchlist=true;},'Series added to watchlist.'));
      action('＋  Add Series to Collection',()=>{
        const name=window.prompt('Collection name:','');
        if(name?.trim())void mutateItems(entries,item=>{
          item.collections=[...new Set([...(item.collections||[]),name.trim().slice(0,100)])];
        },'Series added to collection.');
      });
      action('＋  Add Series to Playlist',()=>{
        const name=window.prompt('Playlist name:','');
        if(name?.trim())void mutateItems(entries,item=>{
          item.playlists=[...new Set([...(item.playlists||[]),name.trim().slice(0,100)])];
        },'Series added to playlist.');
      });
      action('✎  Rename Series',()=>{
        const name=window.prompt('Series Name',target.show);
        if(name?.trim())void mutateItems(entries,
          item=>{item.show=name.trim().slice(0,180);item.customized=true;},
          'Series renamed.');
      });
      action('⌕  Match',()=>void refreshMetadata(entries.slice(0,1),{fix:true}));
      action('ℹ  Get Info',()=>notify(entries.length+' episodes in '+target.show+'. Select an episode to view its analyzed media information.'));
    }else if(target.kind==='folder'){
      action('▤  Open Folder',()=>{
        setSelected(target.libId);state.folderMode=true;
        state.folder={folderId:target.folderId,path:target.path,label:target.path||'Folder'};
        render();
      });
      action('↻  Scan Library Files',()=>{
        const lib=state.libraries.find(l=>l.id===target.libId);
        if(lib)void scanLibrary(lib,{ask:true});
      });
      action('✎  Edit Library Folders',()=>{
        const lib=state.libraries.find(l=>l.id===target.libId);
        if(lib)openEditor(lib);
      });
    }
    menu.hidden=false;
    // Each new popup must start at its first action. Reusing a portal after
    // opening a tall menu can otherwise leave earlier actions scrolled away.
    menu.scrollTop=0;
    // Preserve a genuine browser-style popup even when cards are in
    // overflow-hidden poster containers; this menu is portaled to <body>.
    const width=menu.offsetWidth||220,height=menu.offsetHeight||200;
    const left=Math.max(7,Math.min(x,window.innerWidth-width-7));
    const top=Math.max(7,Math.min(y,window.innerHeight-height-7));
    menu.style.left=left+'px';menu.style.top=top+'px';
    const first=menu.querySelector('[role="menuitem"]');
    first?.focus({preventScroll:true});
    state.menuAnchor=anchor;
  }
  function card(data,action,dir=false,menuTarget=null){
    // Never nest the 3-dot button inside a <button>. Card keyboard handling
    // gives the card button semantics without invalid interactive markup.
    const surface=create('div','ml-card');
    surface.tabIndex=0;surface.setAttribute('role','button');
    surface.setAttribute('aria-label',String(data.title||data.name||'Video'));
    const art=append(surface,'span','ml-card-art');
    art.style.setProperty('--ml-glow',cleanHash(data.title||data.name));
    const picture=String(data.poster||'');
    if(/^https:\/\//i.test(picture)||
      /^data:image\/(?:webp|jpeg|png);base64,/i.test(picture)||
      /^http:\/\/127\.0\.0\.1:18761\/poster\/[a-f0-9]{64}\.(?:webp|jpg)\?key=[a-f0-9]{64}$/.test(picture)){
      const image=append(art,'img','ml-art-poster');
      if(picture.startsWith('http://127.0.0.1:18761/poster/'))
        image.crossOrigin='anonymous'; // The native server requires an approved Origin header.
      image.referrerPolicy='no-referrer';
      image.src=picture;image.loading='lazy';image.alt='';
      image.addEventListener('error',()=>image.remove(),{once:true});
    }
    if(data.progress){
      const progress=append(art,'span','ml-card-progress');
      progress.setAttribute('role','progressbar');progress.setAttribute('aria-label','Watch progress');
      const percent=Math.max(0,Math.min(100,100*data.progress.time/data.progress.duration));
      progress.setAttribute('aria-valuemin','0');progress.setAttribute('aria-valuemax','100');progress.setAttribute('aria-valuenow',String(Math.round(percent)));
      const fill=append(progress,'span','ml-card-progress-fill');fill.style.width=percent+'%';
    }
    // No letter monograms or folder glyphs above the poster artwork.
    append(art,'span','ml-play-symbol',dir?'›':'▶');
    const copy=append(surface,'span','ml-card-copy');
    const label=append(copy,'span','ml-card-label',posterDisplayTitle(data.title||data.name));
    if(data.watched)append(label,'span','ml-watched-mark','✓').title='Watched';
    const titleYear=String(data.title||data.name||'').match(/\(((?:18|19|20|21)\d{2})\)/);
    const sub=String(data.year||titleYear?.[1]||data.detail||'').trim();
    if(sub)append(copy,'span','ml-card-year',sub);
    if(data.metadataPending&&sub!=='File access needed'){
      const access=append(copy,'span','ml-card-year ml-card-access','File access needed');
      access.title='The file is indexed; its metadata will be verified when accessed.';
    }
    if(menuTarget?.kind==='item'||menuTarget?.kind==='show'){
      const star=append(surface,'button','ml-card-star',data.favorite?'★':'☆');
      star.type='button';
      star.setAttribute('aria-pressed',String(!!data.favorite));
      star.setAttribute('aria-label',(data.favorite?'Remove from':'Add to')+' Favorites: '+(data.title||data.name));
      star.title=data.favorite?'Remove from Favorites':'Add to Favorites';
      star.addEventListener('click',event=>{
        event.preventDefault();event.stopPropagation();
        if(menuTarget.kind==='show'){
          const episodes=showItems(menuTarget);
          const mark=!episodes.every(episode=>episode.favorite);
          void mutateItems(episodes,item=>{item.favorite=mark;},
            mark?'Series added to Favorites.':'Series removed from Favorites.');
        }else{
          void mutateItems([menuTarget.item],item=>{item.favorite=!item.favorite;},'Favorites updated.');
        }
      });
    }
    surface.title=String(data.title||data.name);
    surface.addEventListener('click',event=>{
      if(event.target.closest('.ml-card-more, .ml-card-star'))return;
      action();
    });
    surface.addEventListener('keydown',event=>{
      if(event.target!==surface)return;
      if(event.key==='Enter'||event.key===' '){
        event.preventDefault();action();
      }else if((event.key==='F10'&&event.shiftKey)||event.key==='ContextMenu'){
        event.preventDefault();
        const r=surface.getBoundingClientRect();
        openMenu(menuTarget,r.right-10,r.bottom-5,surface);
      }
    });
    if(menuTarget){
      const more=append(surface,'button','ml-card-more');
      more.innerHTML='<svg class="glass-icon" viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>';
      more.type='button';more.title='More options for '+(data.title||data.name);
      more.setAttribute('aria-label','More options for '+(data.title||data.name));
      more.addEventListener('click',event=>{
        event.preventDefault();event.stopPropagation();
        const r=more.getBoundingClientRect();
        openMenu(menuTarget,r.right,r.bottom,more);
      });
      surface.addEventListener('contextmenu',event=>{
        event.preventDefault();event.stopPropagation();
        openMenu(menuTarget,event.clientX,event.clientY,surface);
      });
    }
    if(menuTarget?.kind==='item')scheduleAutoPoster(menuTarget.item);
    else if(menuTarget?.kind==='show'){
      const episodes=showItems(menuTarget);
      const missing=episodes.find(i=>!i.poster&&!i.posterCustomized);
      if(missing)scheduleAutoPoster(missing);
    }
    return surface;
  }
  function empty(title,explanation,actionLabel,action){
    const box=append(ui.cards,'div','ml-empty');
    append(box,'span','ml-empty-icon','▤');
    append(box,'strong','',title);append(box,'p','',explanation);
    if(actionLabel){const b=append(box,'button','ml-primary',actionLabel);b.type='button';b.addEventListener('click',action);}
  }
  function breadcrumbs(){
    ui.crumbs.replaceChildren();
    const home=append(ui.crumbs,'button','','‹ All Videos');
    home.type='button';home.addEventListener('click',()=>{
      state.series=null;state.folder=null;state.folderMode=false;state.page=0;render();
    });
    if(state.series){
      append(ui.crumbs,'span','',' / ');
      append(ui.crumbs,'span','',state.series.show);
    }else if(state.folderMode){
      append(ui.crumbs,'span','',' / ');
      const toggle=append(ui.crumbs,'button','','Folders');
      toggle.addEventListener('click',()=>{state.folder=null;state.page=0;render();});
      if(state.folder){
        append(ui.crumbs,'span','',' / ');
        append(ui.crumbs,'span','',state.folder.label);
      }
    }else if(selectedLibrary()){
      append(ui.crumbs,'span','',' · ');
      const folders=append(ui.crumbs,'button','','Browse Folders');
      folders.addEventListener('click',()=>{state.folderMode=true;state.folder=null;state.page=0;render();});
    }
  }
  function renderShelves(){
    ui.shelves.replaceChildren();
    const total=state.libraries.reduce((n,l)=>n+(l.items||[]).length,0);
    const everything=append(ui.shelves,'div','ml-shelf-row');
    const all=append(everything,'button','ml-shelf');
    all.type='button';all.dataset.libraryId='all';
    all.setAttribute('aria-current',state.selected==='all'?'page':'false');
    append(all,'span','','All Videos');append(all,'small','',String(total));
    all.addEventListener('click',()=>setSelected('all'));
    for(const [kind,label] of [['movie','MOVIES'],['tv','TV SHOWS'],['mixed','OTHER VIDEOS']]){
      append(ui.shelves,'div','ml-shelf-category',label);
      const libraries=state.libraries.filter(lib=>lib.kind===kind);
      for(const lib of libraries){
        const row=append(ui.shelves,'div','ml-shelf-row');
        const button=append(row,'button','ml-shelf');
        button.type='button';button.dataset.libraryId=lib.id;
        button.setAttribute('aria-current',state.selected===lib.id?'page':'false');
        append(button,'span','',lib.name);
        append(button,'small','',String((lib.items||[]).length));
        button.addEventListener('click',()=>setSelected(lib.id));
        button.addEventListener('contextmenu',event=>{
          event.preventDefault();openMenu({kind:'library',libId:lib.id},event.clientX,event.clientY);
        });
        const edit=append(row,'button','ml-shelf-edit icon-btn');
        edit.type='button';edit.title='Edit '+lib.name+' library';
        edit.innerHTML='<svg class="glass-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m4 20 4-.9L20 7l-3-3L5 16.1zM14.5 6.5l3 3"/></svg>';
        edit.setAttribute('aria-label','Edit library '+lib.name);
        edit.addEventListener('click',()=>{setSelected(lib.id);openEditor(lib);});
      }
      if(!libraries.length)append(ui.shelves,'div','ml-shelf-none','No '+label.toLowerCase()+' libraries');
    }
    renderCollectionFilter();
  }
  function renderCollectionFilter(){
    const current=ui.collections.value||state.collection||'all';
    const tags=new Set();
    for(const item of shelfItems()){
      for(const name of item.collections||[])tags.add('collection:'+name);
      for(const name of item.playlists||[])tags.add('playlist:'+name);
    }
    ui.collections.replaceChildren();
    for(const [value,label] of [['all','All Collections'],
      ...[...builtInSmart,...smartCollections].map(r=>['smart:'+r.id,'Smart: '+r.name]),
      ...[...tags].sort().map(key=>[key,key.startsWith('playlist:')?
        'Playlist: '+key.slice(9):'Collection: '+key.slice(11)])]){
      const option=create('option');option.value=value;option.textContent=label;
      ui.collections.append(option);
    }
    state.collection=[...ui.collections.options].some(o=>o.value===current)?current:'all';
    ui.collections.value=state.collection;
  }
  // Watch progress is already stored by the player. Use exactly its keys,
  // not a fuzzy movie-title match which could resume a different release.
  function libraryProgress(){
    try{const data=JSON.parse(readLocal('marmalade:watch-progress:v1','{}'));return data&&typeof data==='object'&&!Array.isArray(data)?data:{};}catch{return {};}
  }
  function progressFor(item,records){
    const size=Number(item.size)||0,name=String(item.name||'');
    const candidates=[records['file:'+name.toLowerCase()+'|'+size],records['library:'+String(item.id||name)+'|'+size]];
    return candidates.filter(r=>r&&Number.isFinite(r.time)&&Number.isFinite(r.duration)&&Number.isFinite(r.updated)&&
      r.updated>Date.now()-365*86400000&&r.time>=5&&r.duration>0&&r.time<Math.max(r.duration-30,r.duration*.98))
      .sort((a,b)=>b.updated-a.updated)[0]||null;
  }
  function filteredItems(){
    let items=shelfItems();
    const search=state.query.trim().toLocaleLowerCase();
    if(state.kind==='movie'||state.kind==='tv')items=items.filter(i=>i.type===state.kind);
    else if(state.kind==='favorites')items=items.filter(i=>!!i.favorite);
    else if(state.kind==='watchlist')items=items.filter(i=>!!i.watchlist);
    else if(state.kind==='watched')items=items.filter(i=>!!i.watched);
    else if(state.kind==='unwatched')items=items.filter(i=>!i.watched);
    else if(state.kind==='continue'){
      const records=libraryProgress();
      items=items.map(item=>({...item,progress:progressFor(item,records)})).filter(item=>item.progress);
    }
    const smart=smartRule(state.collection);
    if(smart){const records=smart.status==='continue'?libraryProgress():{},at=now();items=items.filter(item=>smartMatches(item,smart,records,at));}
    else if(state.collection!=='all'){
      const key=state.collection.startsWith('playlist:')?'playlists':'collections';
      const name=state.collection.slice(state.collection.indexOf(':')+1);
      items=items.filter(i=>(i[key]||[]).includes(name));
    }
    if(search)items=items.filter(i=>
      [i.title,i.show,i.path,i.name,i.libraryName].some(value=>
        String(value||'').toLocaleLowerCase().includes(search)));
    items.sort((a,b)=>{
      if(state.kind==='continue')return b.progress.updated-a.progress.updated;
      if(state.sort==='recent')return (b.addedAt||0)-(a.addedAt||0)||(a.title||'').localeCompare(b.title||'');
      if(state.sort==='year')return (b.year||0)-(a.year||0)||(a.title||'').localeCompare(b.title||'');
      return (a.show||a.title||'').localeCompare(b.show||b.title||'')||
        (a.season||0)-(b.season||0)||(a.episode||0)-(b.episode||0);
    });
    return items;
  }
  function renderFolders(items){
    const lib=selectedLibrary();
    if(!lib){state.folderMode=false;render();return;}
    const roots=[];
    if(!state.folder){
      const counts=new Map();
      for(const item of items)counts.set(item.folderId,(counts.get(item.folderId)||0)+1);
      for(const folder of lib.folders){
        roots.push({name:folder.name,title:folder.name,type:'folder',
          detail:countLabel(counts.get(folder.id)||0),
          folderId:folder.id,path:''});
      }
    }else{
      const prefix=state.folder.path;
      const children=new Map();
      for(const item of items){
        if(item.folderId!==state.folder.folderId||!item.path.startsWith(prefix))continue;
        const rem=item.path.slice(prefix.length),slash=rem.indexOf('/');
        if(slash<0){
          const key='file:'+rem;
          children.set(key,{item});
        }else{
          const name=rem.slice(0,slash),key='folder:'+name;
          if(!children.has(key))children.set(key,{name,title:name,type:'folder',
            folderId:state.folder.folderId,path:prefix+name+'/'});
        }
      }
      roots.push(...children.values());
    }
    for(const value of pageItems(roots)){
      if(value.item)ui.cards.append(card({...value.item,detail:formatItemDetail(value.item)},
        ()=>void play(value.item),false,{kind:'item',item:value.item}));
      else ui.cards.append(card(value,()=>{
        state.folder={folderId:value.folderId,path:value.path,label:value.name};
        state.page=0;render();
      },true,{kind:'folder',libId:lib.id,folderId:value.folderId,path:value.path}));
    }
    if(!roots.length)empty('No Videos Here','This folder has no indexed videos. Try scanning again.','Rescan Library',
      ()=>void scanLibrary(lib,{ask:true}));
    else more(roots.length);
  }
  function formatItemDetail(item){
    if(item.metadataPending)return 'File access needed to verify · '+(item.libraryName||'Local');
    if(item.type==='tv'){
      if(item.season!==null&&item.episode!==null)
        return 'S'+String(item.season).padStart(2,'0')+' E'+String(item.episode).padStart(2,'0');
      return item.show||item.libraryName||'Episode';
    }
    return (item.year||'')+(item.year?' · ':'')+item.libraryName;
  }
  function pageItems(items){
    state.page=Math.max(0,Math.min(state.page,Math.ceil(items.length/PAGE_SIZE)-1));
    return items.slice(state.page*PAGE_SIZE,(state.page+1)*PAGE_SIZE);
  }
  function more(total){
    const pages=Math.ceil(total/PAGE_SIZE);
    if(pages<=1)return;
    const box=append(ui.cards,'nav','ml-more ml-page-nav');
    box.setAttribute('aria-label','Library pages');
    const move=(page)=>{
      state.page=Math.max(0,Math.min(pages-1,page));
      posterQueue.length=0;posterQueued.clear();
      renderCards();
      ui.cards.querySelector('.ml-card')?.focus({preventScroll:true});
      ui.cards.scrollIntoView({block:'nearest'});
    };
    const previous=append(box,'button','','‹ Previous');previous.type='button';
    previous.disabled=state.page===0;previous.addEventListener('click',()=>move(state.page-1));
    const label=append(box,'label','ml-page-label','Page ');
    const input=append(label,'input');input.type='number';input.min='1';input.max=String(pages);
    input.value=String(state.page+1);input.setAttribute('aria-label','Library page number');
    input.addEventListener('change',()=>{const n=Number(input.value);if(Number.isInteger(n))move(n-1);else input.value=String(state.page+1);});
    append(label,'span','',' / '+pages.toLocaleString());
    const next=append(box,'button','','Next ›');next.type='button';
    next.disabled=state.page>=pages-1;next.addEventListener('click',()=>move(state.page+1));
    const range=append(box,'small','ml-page-range',(state.page*PAGE_SIZE+1).toLocaleString()+'–'+Math.min(total,(state.page+1)*PAGE_SIZE).toLocaleString()+' of '+total.toLocaleString());
    range.setAttribute('aria-live','polite');
  }
  function renderCards(){
    ui.cards.replaceChildren();
    $('mlLibrarySections').replaceChildren();
    ui.cards.classList.toggle('ml-list',state.list);
    setPosterColumns(state.posterColumns,false);
    const lib=selectedLibrary();
    const items=filteredItems();
    ui.count.textContent=countLabel(items.length);
    ui.title.textContent=smartRule(state.collection)?.name||(state.kind==='continue'?'Continue Watching':lib?.name||'All Videos');
    ui.manage.disabled=!lib||state.scanning;
    ui.quickAdd.disabled=!lib||state.scanning;
    ui.art.disabled=state.scanning||state.artworkBusy||!items.length;
    ui.rescan.disabled=!state.libraries.length||state.scanning;
    breadcrumbs();
    if(state.kind==='continue'){
      for(const item of pageItems(items))ui.cards.append(card({...item,detail:formatItemDetail(item)},()=>void play(item),false,{kind:'item',item}));
      if(!items.length)empty('Nothing to Resume','Partially watched videos in this library will appear here.');
      more(items.length);return;
    }
    if(state.folderMode){renderFolders(items);return;}
    if(state.series){
      const episodes=items.filter(i=>i.libraryId===state.series.libId&&i.show===state.series.show);
      for(const item of pageItems(episodes))
        ui.cards.append(card({...item,detail:formatItemDetail(item)},()=>void play(item),false,
          {kind:'item',item}));
      if(!episodes.length)empty('No Episodes Found','Try changing the filters or rescanning this folder.');
      more(episodes.length);return;
    }
    const visible=[];
    const shows=new Map();
    for(const item of items){
      if(item.type==='tv'&&item.show){
        const key=item.libraryId+'|'+item.show.toLocaleLowerCase();
        if(!shows.has(key))shows.set(key,{kind:'show',show:item.show,libId:item.libraryId,items:[]});
        shows.get(key).items.push(item);
      }else visible.push({kind:'file',item});
    }
    visible.push(...shows.values());
    if(state.sort==='title')visible.sort((a,b)=>
      (a.kind==='show'?a.show:a.item.title).localeCompare(b.kind==='show'?b.show:b.item.title));
    if(state.sort==='recent'||state.sort==='year'){
      const field=state.sort==='recent'?'addedAt':'year';
      // Compute each series key once, not on every sort comparison.
      for(const entity of visible)entity.sortKey=(entity.items||[entity.item])
        .reduce((max,item)=>Math.max(max,Number(item[field])||0),0);
      visible.sort((a,b)=>b.sortKey-a.sortKey);
    }
    const renderEntity=entity=>{
      if(entity.kind==='show'){
        const entry={title:entity.show,type:'tv',detail:entity.items.length+' Episodes',
          year:entity.items.map(item=>Number(item.year)).find(year=>year>=1880&&year<=2100)||null,
          poster:entity.items.find(item=>item.poster)?.poster||'',
          favorite:entity.items.every(item=>item.favorite),
          watched:entity.items.every(item=>item.watched)};
        ui.cards.append(card(entry,()=>{
          state.series={libId:entity.libId,show:entity.show};state.page=0;render();
        },true,{kind:'show',libId:entity.libId,show:entity.show}));
      }else{
        ui.cards.append(card({...entity.item,detail:formatItemDetail(entity.item)},
          ()=>void play(entity.item),false,{kind:'item',item:entity.item}));
      }
    };
    const sections=$('mlLibrarySections');
    const movies=visible.filter(entity=>entity.kind==='file'&&entity.item.type!=='tv');
    const tvEntries=visible.filter(entity=>entity.kind==='show'||
      (entity.kind==='file'&&entity.item.type==='tv'));
    sections.replaceChildren();
    const totalMovies=items.filter(item=>item.type!=='tv').length;
    const totalShows=items.filter(item=>item.type==='tv').length;
    for(const [kind,label,num] of [['movie','Movies',totalMovies],['tv','TV Shows',totalShows]]){
      const b=append(sections,'button','ml-section-pill',label+' · '+num);
      b.type='button';b.setAttribute('aria-pressed',String(state.kind===kind));
      b.addEventListener('click',()=>{
        state.kind=state.kind===kind?'all':kind;
        ui.filter.value=state.kind;state.page=0;render();
      });
    }
    const grouped=state.kind==='all'&&state.collection==='all';
    if(grouped){
      const current=pageItems([...movies,...tvEntries]);
      for(const [name,entries,isMovie] of [['MOVIES',movies,true],['TV SHOWS',tvEntries,false]]){
        const pageEntries=current.filter(entity=>(entity.kind==='file'&&entity.item.type!=='tv')===isMovie);
        if(!pageEntries.length)continue;
        const heading=append(ui.cards,'div','ml-media-divider');
        append(heading,'strong','',name);
        append(heading,'small','',countLabel(entries.length));
        for(const entity of pageEntries)renderEntity(entity);
      }
    }else{
      for(const entity of pageItems(visible))renderEntity(entity);
    }
    if(!visible.length){
      if(state.query||smartRule(state.collection))empty('No Matches','Try changing the search or smart collection rules.');
      else if(!state.libraries.length)empty('Your Library Starts Here',
        'Create a library, select a folder, and your movies and series appear automatically.',
        '+ Create Your First Library',()=>openEditor(null));
      else if(!items.length&&lib&&lib.folders.length===0)
        empty('Add a Media Folder','Choose a folder to populate '+lib.name+'. Videos will be added automatically.',
          '+ Choose Folder',()=>chooseAndAttachFolder(lib));
      else if(lib)empty('No Videos Indexed',
        'The folders in '+lib.name+' returned no videos — they may be disconnected after a reload, or the scan found no supported files. Choose the folder again and its videos will appear here as cards.',
        '+ Choose Folder',()=>chooseAndAttachFolder(lib));
      else empty('No Videos Yet','Add folders to a library to build your collection.',
        '+ Add Library',()=>openEditor(null));
    }
    more(visible.length);
  }
  function portableCatalog(){
    return state.libraries.filter(lib=>
        !/^(addon:|extlib:)/.test(lib.id)).map(lib=>({
        id:lib.id,name:lib.name,kind:lib.kind,createdAt:lib.createdAt,
        lastScan:lib.lastScan,hiddenIds:lib.hiddenIds||[],
        folders:(lib.folders||[]).map(f=>({id:f.id,name:f.name,source:'session'})),
        items:(lib.items||[]).map(item=>({
          id:item.id,folderId:item.folderId,path:item.path,name:item.name,
          title:item.title,show:item.show,type:item.type,year:item.year,
          season:item.season,episode:item.episode,size:item.size,
          lastModified:item.lastModified,addedAt:item.addedAt,
          favorite:item.favorite===true,watched:item.watched===true,
          watchlist:item.watchlist===true,poster:item.poster||'',
          posterCustomized:item.posterCustomized===true,
          overview:item.overview||'',runtimeSec:item.runtimeSec||null,
          collections:item.collections||[],playlists:item.playlists||[],
          metadataSource:item.metadataSource||'',customized:item.customized===true,
          analyzedAt:item.analyzedAt||null
        }))
      }));
  }
  // Portable backup excludes file handles, media bytes, credentials and absolute
  // native paths. Existing libraries are never replaced by importing a backup.
  function validatePortableCatalog(data){
    if(data?.format!=='marmaladeum-library-backup'||data.version!==1||!Array.isArray(data.libraries)||data.libraries.length>500)throw Error('Unrecognized library backup');
    const string=(v,max)=>typeof v==='string'?v.slice(0,max):'';
    const number=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
    const names=v=>Array.isArray(v)?v.filter(x=>typeof x==='string').slice(0,100).map(x=>x.slice(0,180)):[];
    const safeId=v=>typeof v==='string'&&/^[a-zA-Z0-9._-]{1,100}$/.test(v);
    const relative=v=>typeof v==='string'&&v.length<=2048&&!/^(?:[\\/]|[a-z]:)/i.test(v)&&!v.includes('\\')&&!v.split('/').some(x=>x==='..'||x==='.'||!x||/[\x00-\x1f]/.test(x));
    let total=0;const seen=new Set();
    return data.libraries.map(lib=>{
      if(!safeId(lib?.id)||seen.has(lib.id)||!Array.isArray(lib.folders)||!Array.isArray(lib.items)||lib.folders.length>1000)throw Error('Invalid or duplicate library record');
      seen.add(lib.id);total+=lib.items.length;if(total>100000)throw Error('Backup exceeds 100,000 titles');
      const folderIds=new Set();
      const folders=lib.folders.map(f=>{
        if(!safeId(f?.id)||folderIds.has(f.id))throw Error('Invalid or duplicate folder');
        folderIds.add(f.id);return {id:f.id,name:string(f.name,240)||'Recovered Folder'};
      });
      const itemIds=new Set();
      const items=lib.items.map(item=>{
        if(!folderIds.has(item?.folderId)||!relative(item.path)||!VIDEO.test(item.path))throw Error('Invalid media path');
        const id=item.folderId+'|'+item.path;if(itemIds.has(id))throw Error('Duplicate media path');itemIds.add(id);
        const poster=string(item.poster,2500000);
        return {id,folderId:item.folderId,path:item.path,name:item.path.split('/').pop(),
          title:string(item.title,180)||item.path.split('/').pop(),show:string(item.show,180),
          type:item.type==='tv'?'tv':'movie',year:number(item.year),season:number(item.season),episode:number(item.episode),
          size:number(item.size),lastModified:number(item.lastModified),addedAt:number(item.addedAt),
          favorite:item.favorite===true,watched:item.watched===true,watchlist:item.watchlist===true,
          poster:/^https:\/\//i.test(poster)||/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(poster)?poster:'',
          posterCustomized:item.posterCustomized===true,overview:string(item.overview,3000),runtimeSec:number(item.runtimeSec),
          collections:names(item.collections),playlists:names(item.playlists),
          metadataSource:string(item.metadataSource,120),customized:item.customized===true,analyzedAt:number(item.analyzedAt)};
      });
      return {id:lib.id,name:string(lib.name,100)||'Recovered Library',kind:['movie','tv','mixed'].includes(lib.kind)?lib.kind:'movie',
        folders,items,hiddenIds:Array.isArray(lib.hiddenIds)?[...new Set(lib.hiddenIds.filter(x=>typeof x==='string'&&folderIds.has(x.split('|')[0])&&relative(x.slice(x.indexOf('|')+1))))]:[],createdAt:number(lib.createdAt),lastScan:number(lib.lastScan)};
    });
  }
  // Version 1 backups remain readable; smartCollections is an optional
  // additive field. Reject malformed rules instead of silently broadening them.
  function validateSmartBackup(data){
    if(data.smartCollections===undefined)return [];
    if(!Array.isArray(data.smartCollections)||data.smartCollections.length>100)
      throw Error('Invalid smart collection list');
    const seen=new Set(builtInSmart.map(r=>r.id));
    return data.smartCollections.map(raw=>{
      const rule=normalizeSmart(raw);
      if(!rule||seen.has(rule.id)||typeof raw.name!=='string'||raw.name.trim().length>80||
         !['all','movie','tv'].includes(raw.kind)||
         !['all','unwatched','watched','favorites','watchlist','continue'].includes(raw.status)||
         typeof raw.text!=='string'||raw.text.length>160||
         (rule.yearFrom!==null&&rule.yearTo!==null&&rule.yearFrom>rule.yearTo))
        throw Error('Invalid or duplicate smart collection');
      for(const key of ['yearFrom','yearTo','maxMinutes','recentDays']){
        if(raw[key]!==null&&(!Number.isInteger(raw[key])||raw[key]!==rule[key]))
          throw Error('Invalid smart collection numeric rule');
      }
      seen.add(rule.id);return rule;
    });
  }
  function downloadLibraryBackup(){
    const libraries=portableCatalog();
    const blob=new Blob([JSON.stringify({format:'marmaladeum-library-backup',version:1,createdAt:new Date().toISOString(),libraries,smartCollections})],{type:'application/json'});
    if(blob.size>64*1024*1024){notify('Catalog exceeds the 64 MiB portable backup limit. Use the library extension backup for this catalog.');return;}
    const url=URL.createObjectURL(blob),a=create('a');a.href=url;a.download='Marmaladeum-Library-Backup-'+new Date().toISOString().slice(0,10)+'.json';
    document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
    notify('Catalog backup exported. No media files or folder permissions are included.');
  }
  async function importLibraryBackup(file){
    if(!file)return;
    try{
      if(file.size>64*1024*1024)throw Error('Backup is larger than 64 MiB');
      const data=JSON.parse(await file.text());
      const records=validatePortableCatalog(data),rules=validateSmartBackup(data);
      const newRules=rules.filter(rule=>!smartCollections.some(existing=>existing.id===rule.id));
      if(smartCollections.length+newRules.length>100)throw Error('Import would exceed 100 smart collections');
      if(!state.ready||state.scanning)throw Error('Wait for the current library scan to finish');
      if(!state.db)throw Error('Persistent library storage is unavailable on this device');
      const result=await restoreSiteCatalog(records,{durable:true});
      const baseMessage=result.restored?result.items+' titles restored. Reconnect folders to play them. Existing libraries were kept.':'No new libraries to restore; existing libraries were kept.';
      if(newRules.length){
        if(!saveSmart([...smartCollections,...newRules])){
          notify(baseMessage+' Smart collection rules could not be saved; retry the import.');return;
        }
        refreshSmartEditor();render();
        notify(baseMessage+' '+newRules.length+' smart collections restored; existing rules were kept.');
      }else notify(baseMessage);
    }catch(e){notify('Backup not imported: '+(e.message||'Invalid backup'));}
  }
  let libraryBackupTimer=null;
  // The optional WebExtension retains only catalog metadata. Video bytes,
  // browser File objects and directory handles never cross the site origin.
  function queueLibraryBackup(){
    if(!state.backupReady)return;
    clearTimeout(libraryBackupTimer);
    libraryBackupTimer=setTimeout(()=>{
      const libraries=portableCatalog();
      window.postMessage({source:'marmalade-web',type:'backup-site-catalog',
        libraries,revision:Date.now()},location.origin);
    },200);
  }
  function render(){
    if(!state.ready)return;
    renderShelves();renderCards();
    if(state.status)ui.status.textContent=state.status;
    queueLibraryBackup();
    window.dispatchEvent(new Event('marmalade:media-library-updated'));
  }
  async function getPlayable(item,{ask=true}={}){
    const lib=state.libraries.find(l=>l.id===item.libraryId);
    const folder=lib?.folders.find(f=>f.id===item.folderId);
    if(!folder)throw Error('This source folder is no longer in your library.');
    const sessionFile=state.sessionFiles.get(item.id);
    if(sessionFile)return {file:sessionFile,handle:null};
    // A browser-extension catalog cannot transfer directory handles to the
    // website. A separately authorized same-origin handle can resolve it
    // without copying huge video files or creating a duplicate library.
    const root=folder.playHandle||folder.handle;
    if(!root)throw Error('Indexed titles are not playable until you select their local files. Use Choose Video Files in OnlyFrames.');
    if(!await permissions({handle:root},ask))
      throw Error('The browser blocked that directory. Use Choose Video Files to select individual videos.');
    const pieces=item.path.split('/').filter(Boolean);
    let directory=root;
    for(const part of pieces.slice(0,-1))directory=await directory.getDirectoryHandle(part);
    const handle=await directory.getFileHandle(pieces[pieces.length-1]);
    const file=await handle.getFile();
    return {file,handle};
  }
  async function play(item){
    const generation=++episodeGeneration;
    episodeSelection=null;
    const ownerLib=state.libraries.find(l=>l.id===item.libraryId);
    const ownerFolder=ownerLib?.folders.find(f=>f.id===item.folderId);
    // Minternet add-on items stream from the add-on's scoped asset serving.
    // Playback is local to this player (watch-together hosting still needs
    // a File picked through the ordinary Choose Video flow).
    if(ownerFolder?.source==='native'&&nativeLibraryApi()&&
       !ownerFolder.playHandle&&!ownerFolder.handle&&!state.sessionFiles.has(item.id)){
      const url=item.url;
      if(!url){
        notify('Native source has no playable URL. Use Add Video Files for local playback.');
        return;
      }
      const bridge=window.MarmaladeAddonBridge;
      if(typeof bridge?.chooseNativeStream!=='function'){
        notify('Native streaming is unavailable. Use Add Video Files for direct browser playback.');
        return;
      }
      try{
        const started=bridge.chooseNativeStream({
          url,name:item.name||item.title||'Library Video',size:item.size,id:item.id
        });
        if(started){rememberEpisode(item,bridge);notify('Opening '+(item.name||item.title)+' from the optional native source.');}
      }catch(error){notify('Unable to play native stream. Add Video Files for local playback.');}
      return;
    }
    if(ownerFolder?.source==='native'&&!nativeLibraryApi()&&
       !ownerFolder.playHandle&&!ownerFolder.handle&&!state.sessionFiles.has(item.id)){
      notify('This title is from a native-only catalog. Add Video Files to make a browser-independent local library.');
      return;
    }
    // Extension-held items play in the extension library page, which owns
    // the stored folder handles. The web page never receives handles/bytes.
    if(ownerFolder?.source==='extension'&&!state.sessionFiles.has(item.id)&&
       !ownerFolder?.playHandle&&!ownerFolder?.handle){
      notify('This title came from a metadata-only catalog. Use Add Video Files in the Media Library to create a playable, independent local library.');
      return;
    }
    const bridge=window.MarmaladeAddonBridge;
    if(typeof bridge?.chooseVideo!=='function'){
      notify('Player is not ready to open library videos.');return;
    }
    if(bridge.state?.role==='guest'&&bridge.state.guestConn?.open){
      if(!window.confirm('Opening a library video will leave the room you joined. Continue?'))return;
    }
    try{
      const {file,handle}=await getPlayable(item);
      if(generation!==episodeGeneration)return;
      if(!video(file.name))throw Error('This file is no longer a supported video container.');
      if(handle)bridge.state.lastOpenedHandle=handle;
      bridge.chooseVideo(file);
      rememberEpisode(item,bridge);
      notify('Playing '+file.name+' · Your video stays on this device.');
    }catch(error){notify(error?.message||'This video cannot be accessed. Reconnect the folder.');}
  }
  // Only an explicit library selection arms episode advancement. Raw file
  // selection, clearing media, and game-owned playback invalidate the token.
  function rememberEpisode(item,bridge){
    if(item.type!=='tv'||!item.show||!Number.isInteger(item.season)||!Number.isInteger(item.episode)||item.season<1||item.episode<1)return;
    const s=bridge.state;
    if(s.role!=='host'||s.gameFrameMode||!['file','native'].includes(s.source))return;
    episodeSelection={libraryId:item.libraryId,id:item.id,source:s.source,file:s.file,nativeKey:s.nativeMediaKey};
  }
  function soloEpisode(bridge,selection){
    const s=bridge?.state;
    return !!(selection&&s?.role==='host'&&!s.gameFrameMode&&!s.guestConn?.open&&
      ![...s.connections.values()].some(e=>e.conn?.open)&&s.source===selection.source&&
      (s.source==='file'?s.file===selection.file:s.nativeMediaKey===selection.nativeKey));
  }
  function nextEpisode(lib,current){
    if(!current||current.type!=='tv'||!current.show||!Number.isInteger(current.season)||
       !Number.isInteger(current.episode)||current.season<1||current.episode<1)return null;
    const entries=(lib.items||[]).filter(i=>i.type==='tv'&&i.show===current.show&&
      Number.isInteger(i.season)&&Number.isInteger(i.episode)&&i.season>0&&i.episode>0);
    // Do not silently skip a missing episode or choose between alternate editions.
    const same=entries.filter(i=>i.season===current.season&&i.episode===current.episode+1);
    if(same.length)return same.length===1?same[0]:null;
    if(entries.some(i=>i.season===current.season&&i.episode>current.episode))return null;
    const next=entries.filter(i=>i.season===current.season+1&&i.episode===1);
    return next.length===1?next[0]:null;
  }
  async function advanceEpisode(){
    if(readLocal(AUTO_NEXT_KEY,'false')!=='true')return;
    const bridge=window.MarmaladeAddonBridge,selection=episodeSelection;
    if(!soloEpisode(bridge,selection)||!bridge.media.ended)return;
    const {lib,entry}=storedItem(selection);
    if(!lib||!entry)return;
    const next=nextEpisode(lib,entry);
    // Consume the event once, including failures or the final episode.
    episodeSelection=null;
    const generation=++episodeGeneration;
    if(!next)return;
    const valid=()=>generation===episodeGeneration&&readLocal(AUTO_NEXT_KEY,'false')==='true'&&soloEpisode(bridge,selection)&&bridge.media.ended;
    const item={...next,libraryId:lib.id};
    const folder=lib.folders.find(f=>f.id===item.folderId);
    try{
      if(folder?.source==='native'&&nativeLibraryApi()&&!folder.playHandle&&!folder.handle&&!state.sessionFiles.has(item.id)){
        if(!valid()||!item.url)return;
        if(!bridge.chooseNativeStream({url:item.url,name:item.name||item.title,size:item.size,id:item.id}))return;
        rememberEpisode(item,bridge);
      }else{
        // No automatic browser permission prompts at the end of an episode.
        const {file,handle}=await getPlayable(item,{ask:false});
        if(!valid()||!video(file.name))return;
        if(handle)bridge.state.lastOpenedHandle=handle;
        bridge.chooseVideo(file);
        if(bridge.state.file!==file)return;
        rememberEpisode(item,bridge);
        try{await bridge.media.play();}catch{notify('Next episode is ready. Press Play to continue.');return;}
      }
      notify('Next Episode: '+(item.title||item.name));
    }catch{notify('Next episode is unavailable. Open it manually from the library.');}
  }
  // Library catalogs and file access are different. Browser extensions
  // cannot give a web page their FileSystemDirectoryHandles; the website
  // can acquire its own folder handle and remember it alongside the catalog.
  function gameFolder(lib,item){
    return (lib.folders||[]).find(folder=>folder.id===item.folderId)||
      (lib.id.startsWith('addon:')&&item.url?{source:'native'}:null);
  }
  function gameItemPlayable(folder,item){
    if(!folder)return false;
    // A localhost Minternet URL is not transferable to Chrome, Firefox or
    // Safari. Never report that metadata as playable without the native
    // add-on actually connected in this browser.
    const nativeAvailable=!!nativeLibraryApi()&&
      typeof window.MarmaladeAddonBridge?.chooseNativeStream==='function';
    return !!(folder.playHandle||folder.handle||state.sessionFiles.has(item.id)||
      (folder.source==='native'&&item.url&&nativeAvailable));
  }
  function getGameLibraries(){
    return state.libraries.map(lib=>{
      let playableCount=0,unlinkedCount=0;
      for(const item of lib.items||[]){
        if(gameItemPlayable(gameFolder(lib,item),item))playableCount++;
        else unlinkedCount++;
      }
      return {id:lib.id,name:lib.name,kind:lib.kind,
        count:(lib.items||[]).length,playableCount,unlinkedCount};
    });
  }
  function getGameVideos(libraryId){
    const lib=state.libraries.find(lib=>lib.id===libraryId);
    if(!lib)return [];
    return (lib.items||[]).filter(item=>
      gameItemPlayable(gameFolder(lib,item),item)).map(item=>({
      id:item.id,title:item.title||item.name,
      name:item.name||item.title||'Library Video',runtimeSec:Number(item.runtimeSec)||null,
      kind:item.type==='tv'||item.type==='movie'?item.type:(lib.kind==='tv'?'tv':'movie'),
      year:item.year||null,favorite:item.favorite===true,
      libraryId:lib.id,libraryName:lib.name
    }));
  }
  // Acquire a same-origin handle only after a user deliberately asks to
  // connect the folder. No silent permission bypass or file transfer.
  // Confirm an existing indexed relative path before storing the handle:
  // choosing an unrelated folder can never count as a successful repair.
  async function connectGameLibrary(libraryId,chooseFolder){
    const lib=state.libraries.find(lib=>lib.id===libraryId);
    if(!lib)throw Error('Library not found.');
    const folder=(lib.folders||[]).find(candidate=>
      !candidate.handle&&!candidate.playHandle&&
      (lib.items||[]).some(item=>item.folderId===candidate.id&&!state.sessionFiles.has(item.id)));
    if(!folder)return {connected:false,remaining:0};
    const entries=lib.items.filter(item=>item.folderId===folder.id);
    if(!entries.length)throw Error('The selected library folder contains no indexed video.');
    // This callback opens showDirectoryPicker directly in the user click.
    const handle=await chooseFolder(folder);
    if(!handle)return {connected:false,cancelled:true};
    if(handle.kind!=='directory'||!await permissions({handle},true))
      throw Error('The video folder was not authorized.');
    let matched=false;
    for(const entry of entries){
      try{
        const parts=String(entry.path||entry.name||'').split('/').filter(Boolean);
        if(!parts.length)continue;
        let dir=handle;
        for(const part of parts.slice(0,-1))dir=await dir.getDirectoryHandle(part);
        const fileHandle=await dir.getFileHandle(parts[parts.length-1]);
        if(fileHandle?.kind==='file'){matched=true;break;}
      }catch{/* Try another indexed file; the folder may have changed. */}
    }
    if(!matched)throw Error('The folder does not contain any of the indexed videos. Choose the original folder.');
    folder.playHandle=handle;
    await persist(lib);
    render();
    const stats=getGameLibraries().find(item=>item.id===libraryId);
    return {connected:true,folder:folder.name,playableCount:stats?.playableCount||0,
      remaining:stats?.unlinkedCount||0};
  }
  // Browser engines without persistent directory handles may provide only
  // a FileList. Use each selected File in place, keeping its catalog ID.
  function connectGameFiles(libraryId,files){
    const lib=state.libraries.find(lib=>lib.id===libraryId);
    if(!lib)return {connected:false,remaining:0};
    const available=new Map();
    for(const file of Array.from(files||[])){
      const parts=String(file.webkitRelativePath||file.name).split('/').filter(Boolean);
      const relative=parts.length>1?parts.slice(1).join('/'):file.name;
      available.set(relative,file);
    }
    const folder=(lib.folders||[]).find(candidate=>
      (lib.items||[]).some(item=>item.folderId===candidate.id&&
        !gameItemPlayable(candidate,item)&&available.has(item.path)));
    if(!folder)return {connected:false,remaining:(getGameLibraries().find(l=>l.id===libraryId)?.unlinkedCount||0)};
    for(const item of lib.items||[]){
      if(item.folderId!==folder.id)continue;
      const file=available.get(item.path);
      if(file)state.sessionFiles.set(item.id,file);
    }
    render();
    const stats=getGameLibraries().find(item=>item.id===libraryId);
    return {connected:true,folder:folder.name,playableCount:stats?.playableCount||0,
      remaining:stats?.unlinkedCount||0,sessionOnly:true};
  }

  // Cross-browser, extension-independent local library hydration.
  // File inputs return live File objects even when choosing a protected
  // directory via showDirectoryPicker() is forbidden. No copy, upload, or
  // full-file reading occurs: only metadata is saved in IndexedDB.
  // External extension catalogs are migrated into an independent browser
  // library so future gameplay never needs the extension or native bridge.
  async function importGameFiles(libraryId,fileList){
    const source=state.libraries.find(lib=>lib.id===libraryId)||null;
    const files=Array.from(fileList||[]).filter(file=>file&&
      typeof file.name==='string'&&video(file.name)&&typeof file.slice==='function');
    if(!files.length)return {connected:false,reason:'No supported video files were selected.'};
    const external=!!source&&/^(extlib:|addon:)/.test(source.id);
    let lib=external?
      state.libraries.find(existing=>existing.migratedFrom===source.id):
      source;
    let created=false;
    if(!lib){
      created=true;
      const desired=source?.name||'My Videos';
      let name=external?desired+' · Browser Library':desired;
      if(state.libraries.some(existing=>existing.name.toLowerCase()===name.toLowerCase())){
        let number=2;
        while(state.libraries.some(existing=>existing.name.toLowerCase()===
          (name+' '+number).toLowerCase()))number++;
        name+=' '+number;
      }
      lib={id:id(),name,kind:source?.kind||'mixed',folders:[],items:[],
        hiddenIds:[],migratedFrom:external?source.id:null,
        createdAt:now(),lastScan:now()};
    }
    // Prefer reconnecting the exact indexed item over adding a duplicate
    // folder. This covers Firefox/Safari FileList sessions across page reloads
    // as well as users selecting individual video files from a prior folder.
    const allPrevious=lib.items||[];
    const byName=new Map(),byPath=new Map();
    for(const item of allPrevious){
      const nameKey=String(item.name||'').toLocaleLowerCase();
      const pathKey=String(item.path||'').toLocaleLowerCase();
      if(!byName.has(nameKey))byName.set(nameKey,[]);
      if(!byPath.has(pathKey))byPath.set(pathKey,[]);
      byName.get(nameKey).push(item);
      byPath.get(pathKey).push(item);
    }
    const pendingFiles=[];
    let linkedCount=0;
    for(const file of files){
      const parts=String(file.webkitRelativePath||'').split('/').filter(Boolean);
      const relative=parts.length>=2?parts.slice(1).join('/'):file.name;
      const matches=byPath.get(relative.toLocaleLowerCase())||[];
      const named=byName.get(file.name.toLocaleLowerCase())||[];
      const exact=matches.length===1?matches[0]:named.length===1?named[0]:null;
      if(exact){
        state.sessionFiles.set(exact.id,file);
        state.sessionFolderLoaded.add(exact.folderId);
        linkedCount++;
      }else pendingFiles.push(file);
    }
    if(!pendingFiles.length){
      if(created)state.libraries.push(lib);
      await persist(lib);
      state.selected=lib.id;
      setLocal('marmalade:media-library:selected',lib.id);
      state.query='';state.kind='all';state.collection='all';
      ui.search.value='';ui.filter.value='all';ui.collections.value='all';
      render();
      notify(linkedCount+' existing videos reconnected in '+lib.name+
        '. Files are available locally in this browser session.');
      return {connected:true,libraryId:lib.id,imported:linkedCount,
        playableCount:getGameVideos(lib.id).length,name:lib.name,
        sessionOnly:true,independent:true};
    }
    const filesToAdd=pendingFiles;
    const paths=filesToAdd.map(file=>String(file.webkitRelativePath||'').split('/').filter(Boolean));
    const prefixes=paths.filter(parts=>parts.length>=2).map(parts=>parts[0]);
    const commonRoot=prefixes.length&&prefixes.every(first=>first===prefixes[0])?
      prefixes[0]:null;
    const folderName=commonRoot||'Selected Videos';
    // Re-selecting the same source after a reload replaces its stale entries
    // rather than creating duplicates or a second disconnected folder.
    const oldFolder=lib.folders.find(folder=>folder.source==='session'&&
      folder.name===folderName);
    const folder={id:oldFolder?.id||id(),name:folderName,source:'session',handle:null};
    const previous=new Map((lib.items||[]).filter(item=>item.folderId===folder.id)
      .map(item=>[item.path,item]));
    const sourceByPath=new Map((source?.items||[]).map(item=>
      [String(item.path||item.name||'').toLocaleLowerCase(),item]));
    const sourceByName=new Map((source?.items||[]).map(item=>
      [String(item.name||'').toLocaleLowerCase(),item]));
    const occupied=new Set();
    const entries=[];
    // Streaming object URLs are created by the established chooseVideo
    // player path. Keep the File objects intact, never eagerly load bytes.
    for(let index=0;index<filesToAdd.length;index++){
      const file=filesToAdd[index],parts=paths[index];
      let path=(parts.length>=2?parts.slice(1).join('/'):file.name)||file.name;
      const original=path;
      for(let suffix=2;occupied.has(path);suffix++){
        const dot=original.lastIndexOf('.'),slash=original.lastIndexOf('/');
        path=dot>slash?original.slice(0,dot)+' ('+suffix+')'+original.slice(dot):
          original+' ('+suffix+')';
      }
      occupied.add(path);
      const item=makeItem(folder,path,file,lib.kind);
      const previousItem=previous.get(path)||sourceByPath.get(path.toLocaleLowerCase())||
        sourceByName.get(file.name.toLocaleLowerCase());
      if(previousItem){
        Object.assign(item,{...previousItem,id:item.id,folderId:item.folderId,
          path:item.path,name:item.name,size:item.size,
          lastModified:item.lastModified,metadataPending:false});
      }
      entries.push(item);
      state.sessionFiles.set(item.id,file);
    }
    if(oldFolder){
      for(const old of (lib.items||[]).filter(item=>item.folderId===folder.id)){
        if(!occupied.has(old.path))state.sessionFiles.delete(old.id);
      }
      lib.items=lib.items.filter(item=>item.folderId!==folder.id);
      lib.folders=lib.folders.map(existing=>existing.id===folder.id?folder:existing);
    }else lib.folders.push(folder);
    lib.items.push(...entries);
    lib.lastScan=now();
    state.sessionFolderLoaded.add(folder.id);
    if(created)state.libraries.push(lib);
    // Save only the lightweight catalog; user-selected File objects stay
    // in memory for playback and cannot be silently reused after a restart.
    await persist(lib);
    state.selected=lib.id;
    setLocal('marmalade:media-library:selected',lib.id);
    state.query='';state.kind='all';state.collection='all';state.folder=null;
    state.folderMode=false;state.series=null;state.page=0;
    ui.search.value='';ui.filter.value='all';ui.collections.value='all';
    render();
    notify(countLabel(entries.length)+' ready in '+lib.name+
      '. Videos play directly in this browser; nothing was uploaded.');
    return {connected:true,libraryId:lib.id,imported:entries.length+linkedCount,
      playableCount:getGameVideos(lib.id).length,name:lib.name,
      sessionOnly:true,independent:true};
  }

  async function playGameVideo(libraryId,itemId){
    const lib=state.libraries.find(lib=>lib.id===libraryId);
    const item=lib?.items.find(item=>item.id===itemId);
    if(!lib||!item)throw Error('That video is no longer in this library. Rescan the library and try again.');
    const folder=gameFolder(lib,item);
    if(!folder||!gameItemPlayable(folder,item))
      throw Error('This video has only catalog metadata. Choose Video Files in OnlyFrames to play it locally.');
    const bridge=window.MarmaladeAddonBridge;
    if(bridge?.state?.role!=='host')
      throw Error('Only the host can select the game video. End your guest session before playing.');
    if(folder.source==='native'&&item.url&&nativeLibraryApi()&&
       !folder.playHandle&&!state.sessionFiles.has(item.id)){
      if(!bridge.chooseNativeStream?.({url:item.url,name:item.name||item.title,
        size:item.size,id:item.id}))
        throw Error('The Minternet library stream could not open. Rescan the source in Minternet.');
    }else{
      const {file,handle}=await getPlayable({...item,libraryId:lib.id});
      if(!video(file.name))throw Error('This is not a supported video file.');
      if(handle)bridge.state.lastOpenedHandle=handle;
      if(typeof bridge.chooseVideo!=='function')throw Error('Player is not ready.');
      bridge.chooseVideo(file);
    }
    return {id:item.id,title:item.title||item.name||'Library Video',
      libraryId:lib.id,libraryName:lib.name};
  }
  // Only titles are sent to the existing public metadata source, never a video
  // or local folder path. User consent is required before first lookup.
  async function findArtwork(){
    if(state.artworkBusy||state.scanning)return;
    const source=window.MarmaladePublicMovieInfo;
    if(typeof source?.lookup!=='function'){notify('Poster sources are not available.');return;}
    if(!autoPostersEnabled()&&readLocal('marmalade:media-library:art-consent','false')!=='true'){
      if(!window.confirm('Look up posters using movie and series titles? Only titles and years are sent, never video files or folder paths.'))return;
      setLocal('marmalade:media-library:art-consent','true');
    }
    const files=filteredItems().filter(item=>!item.poster);
    const groups=new Map();
    for(const item of files){
      const title=item.type==='tv'?(item.show||item.title):item.title;
      if(!title)continue;
      const key=item.type+'|'+title.toLowerCase()+'|'+(item.year||'');
      if(!groups.has(key))groups.set(key,{title,type:item.type,year:item.year,items:[]});
      groups.get(key).items.push(item);
    }
    const candidates=[...groups.values()].slice(0,40);
    if(!candidates.length){notify('All visible titles already have available cover artwork.');return;}
    state.artworkBusy=true;ui.art.disabled=true;
    let found=0,attempted=0;
    const affected=new Set();
    try{
      for(const group of candidates){
        attempted++;
        ui.status.textContent='Finding poster artwork · '+attempted+' / '+candidates.length;
        try{
          const output=await source.lookup({title:group.title,year:group.year,
            kind:group.type==='tv'?'tv':'movie',season:null,episode:null});
          const record=output?.record;
          if(!record?.poster||!/^https:\/\//i.test(record.poster))continue;
          const normalize=value=>String(value||'').toLocaleLowerCase()
            .replace(/[^a-z0-9]+/g,' ').trim();
          if(normalize(record.title)!==normalize(group.title))continue;
          if(group.year&&record.year&&Number(group.year)!==Number(record.year))continue;
          for(const item of group.items){
            const lib=state.libraries.find(l=>l.id===item.libraryId);
            const stored=lib?.items.find(i=>i.id===item.id);
            if(stored){stored.poster=record.poster;affected.add(lib);found++;}
          }
          if(found)render();
        }catch{/* A network miss is not an invented media match. */}
      }
      for(const lib of affected){
        if(lib.id.startsWith('addon:')){
          for(const item of lib.items.filter(item=>item.poster)){
            await persistNativeItem(lib,item);
          }
        }
        await persist(lib);
      }
      notify('Cover artwork added for '+found+' video'+(found===1?'':'s')+
        '. Missing public matches keep their original title cards.');
    }finally{state.artworkBusy=false;render();}
  }
  function currentPending(){return state.pending;}
  function drawFolders(){
    ui.folderList.replaceChildren();
    const pending=currentPending();if(!pending)return;
    if(!pending.folders.length)
      append(ui.folderList,'small','ml-help','No folders selected yet. You can save an empty library.');
    for(const folder of pending.folders){
      const wrap=append(ui.folderList,'div','ml-folder-entry');
      const found=(pending.items||[]).filter(i=>i.folderId===folder.id).length;
      const problem=state.scanProblems.get(folder.id);
      const label=problem?('▣ '+folder.name+' · Not scanned — '+problem):
        ('▣ '+folder.name+' · '+countLabel(found)+
          (folder.source==='handle'?(folder.handle?' · Remembered':' · Needs reconnect'):
           folder.source==='native'?' · Stored in Minternet extension':' · This session only'));
      const text=append(wrap,'span','',label);
      text.title=folder.name;
      const controls=append(wrap,'div');
      if(folder.source!=='native'){
        const reconnect=append(controls,'button','','Reconnect');
        reconnect.type='button';reconnect.title='Choose the location again';
        reconnect.addEventListener('click',()=>{state.relink=folder.id;pickFolder();});
      }
      const remove=append(controls,'button','','Remove');
      remove.type='button';remove.setAttribute('aria-label','Remove '+folder.name+' from this library');
      remove.addEventListener('click',()=>{
        pending.folders=pending.folders.filter(f=>f.id!==folder.id);
        drawFolders();
      });
    }
  }
  function openEditor(lib){
    if(state.scanning){notify('Wait for the current scan to finish before changing folders.');return;}
    state.editing=lib?.id||null;state.relink=null;state.autoAttachDraft=null;
    state.pending={
      id:lib?.id||id(),
      name:lib?.name||'',
      kind:lib?.kind||'movie',
      folders:(lib?.folders||[]).map(folder=>({...folder})),
      items:(lib?.items||[]).slice(),hiddenIds:(lib?.hiddenIds||[]).slice(),
      createdAt:lib?.createdAt||now(),lastScan:lib?.lastScan||0,
      importAttempted:false
    };
    ui.dialogTitle.textContent=lib?'Manage Library':'Create Library';
    ui.save.textContent=(lib?.items||[]).length?
      'Save Library · '+countLabel((lib.items||[]).length):'Save Library';
    ui.name.value=state.pending.name;
    ui.kind.value=state.pending.kind;
    ui.delete.hidden=!lib;
    drawFolders();
    scanPreview(lib?((lib.items||[]).length+' indexed videos'+
      ((lib.folders||[]).some(folderIsDead)?' · A folder is disconnected — press Reconnect next to it, or + Add Folder, and choose it again.':'')+
      ' · Edit the name, type or folders, then Save.'):
      'Choose a folder to preview its videos before saving.');
    ui.dialog.hidden=false;
    ui.name.focus();
  }
  function closeEditor(){
    ui.dialog.hidden=true;state.pending=null;state.editing=null;state.relink=null;
    state.autoAttachDraft=null;
    scanPreview('');
  }
  function chooseAndAttachFolder(lib){
    if(!lib)return;
    openEditor(lib);
    if(!state.pending)return;
    state.autoAttachDraft=state.pending;
    // Repopulate IN PLACE: if this EMPTY library has a dead folder (the
    // classic saved-at-0 library), the next pick replaces that folder
    // instead of piling a duplicate onto it. A library whose catalog
    // survived (items > 0) keeps its folders — this button ADDs a folder.
    const dead=(lib.items||[]).length===0?(lib.folders||[]).find(folderIsDead):null;
    if(dead)state.relink=dead.id;
    notify('Choose a folder. Its videos will be added to '+lib.name+' automatically.');
    // This must run in the original click handler, preserving browser file-picker
    // user activation. The editor is only a fallback if access fails.
    pickFolder();
  }
  function addFolder(folder){
    const pending=currentPending();
    if(!pending)return;
    if(state.relink){
      const i=pending.folders.findIndex(f=>f.id===state.relink);
      if(i>=0){folder.id=state.relink;pending.folders[i]=folder;}
      state.relink=null;
    }else pending.folders.push(folder);
    if(!ui.name.value.trim())ui.name.value=folder.name;
    drawFolders();
    indexPendingFolder(folder);
  }
  async function handleFolderSelection(handle){
    if(!handle||handle.kind!=='directory')return;
    // Ask for read access IMMEDIATELY, while the picker gesture is still
    // active. Deferring this to the later scan is why folders previously
    // appeared to be added but scanned as empty: by scan time the browser
    // no longer counted the request as user-activated and left the handle
    // in "prompt", so the walk silently returned nothing.
    try{
      if(typeof handle.queryPermission==='function'&&
        await handle.queryPermission({mode:'read'})!=='granted'&&
        typeof handle.requestPermission==='function')
        await handle.requestPermission({mode:'read'});
    }catch{/* The scan below reports a clear error if access is still denied. */}
    addFolder({id:id(),name:handle.name||'Video Folder',source:'handle',handle});
  }
  // One natural Add Folder flow, exactly like Plex: pick a folder once and
  // Marmalade remembers it. The File System Access picker is the DEFAULT
  // wherever it exists (Chrome/Edge desktop) because its handle can be
  // saved in IndexedDB, rescanned after a reload, and played later without
  // re-picking. The directory-input FileList is only the fallback for
  // Firefox/Safari/WebViews without that API; it indexes the same files
  // for the current session and its catalog still persists.
  function pickFolder(){
    if(state.pending)state.pending.importAttempted=true;
    if(!state.pending){
      notify('Choose or create a library before selecting a media folder.');
      return;
    }
    // Standard directory FileList is the primary cross-browser path: it
    // avoids Chromium's blocked-root/system-file directory-handle picker
    // and works without Minternet, native extensions or permission APIs.
    // No file bytes are sent to a server, and no copying is needed to play.
    scanPreview('Select your video folder. If the browser refuses the folder, use Add Videos to choose individual files.');
    ui.directoryInput.value='';
    ui.directoryInput.click(); // Must happen synchronously on click.
  }
  async function pickNativeFolder(){
    scanPreview('Select the media folder. Marmaladeum will scan it and remember it automatically.');
    try{
      const handle=await window.showDirectoryPicker({mode:'read'});
      if(!handle||handle.kind!=='directory'){
        notify('Please choose a folder, not a single file.');
        return;
      }
      await handleFolderSelection(handle);
    }catch(error){
      if(error?.name==='AbortError'){
        scanPreview('Folder selection was canceled or blocked by browser security. No files changed. Use Add Folder or Add Videos instead.');
        return;
      }
      // A blocked native picker must never dead-end or fake success:
      // fall back to the directory input so the user can still import.
      console.warn('Native directory picker unavailable, using fallback:',error);
      scanPreview('Select the media folder. Marmaladeum will import its videos automatically.');
      ui.directoryInput.value='';
      ui.directoryInput.click();
    }
  }
  // Kept as an alias: both dialog buttons now run the same one-click flow,
  // so there is no longer a "right" and "wrong" picker to choose between.
  async function pickPersistentFolder(){
    if(typeof window.showDirectoryPicker==='function'){
      await pickNativeFolder();
      return;
    }
    // The standard file picker remains supported in every browser.
    pickFolder();
  }
  async function pickAddonFolder(api){
    const pending=currentPending();if(!pending)return;
    const name=(ui.name.value||'').trim();
    if(!name){
      ui.name.setCustomValidity('Name this library before adding a folder.');
      ui.name.reportValidity();return;
    }
    ui.name.setCustomValidity('');
    const libraryId=pending.id.startsWith('addon:')?pending.id.slice(6):'';
    scanPreview('Choose your media folder. Minternet will index its files and permanently register it under '+name+'.');
    // MUST begin directly inside the click event; do not await a fetch before
    // opening Minternet's native picker, or the browser loses user activation.
    let catalog;
    try{
      catalog=await api.addFolder({libraryId,name,kind:ui.kind.value});
    }catch(error){
      scanPreview('Folder was not added: '+(error?.message||error)+'. Existing libraries are unchanged.');
      notify('No folder imported. Choose Add Folder again to retry.');
      state.autoAttachDraft=null;
      return;
    }
    const previousIds=new Set(state.libraries.filter(l=>l.id.startsWith('addon:')).map(l=>l.id));
    const result=await syncFromNative(catalog);
    state.autoAttachDraft=null;
    const imported=state.libraries.filter(l=>l.id.startsWith('addon:')&&
      (l.name===name||l.id===pending.id||!previousIds.has(l.id)));
    if(imported.length){
      closeEditor();
      setSelected(imported[0].id);
      const count=imported[0].items.length;
      notify(countLabel(count)+' indexed in '+name+' and saved in the Minternet extension.');
    }else{
      scanPreview('The folder picker closed, but no matching library was returned by Minternet. Check the extension connection and retry.');
    }
  }
  function fallbackFiles(files){
    const pending=currentPending();
    if(!pending||!files.length)return;
    // The folder name is the first path segment shared by the selection.
    // Deriving it from files[0] alone mislabels the folder whenever the
    // browser lists a nested file first, so vote on the first segment.
    const segments=new Map();
    for(const f of files){
      const seg=(f.webkitRelativePath||'').split('/')[0];
      if(seg)segments.set(seg,(segments.get(seg)||0)+1);
    }
    const root=[...segments.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]||'Selected Folder';
    const folder={id:id(),name:root,source:'session',handle:null};
    // Populate the session file map BEFORE initiating the same indexer used by
    // persistent directory handles. Previously fallback imports could look empty.
    if(state.relink){
      const prior=pending.folders.find(f=>f.id===state.relink);
      for(const key of state.sessionFiles.keys())if(key.startsWith(state.relink+'|'))
        state.sessionFiles.delete(key);
      if(prior)folder.id=prior.id;
    }
    for(const file of files){
      if(!video(file.name))continue;
      const rel=file.webkitRelativePath||'';
      const parts=rel.split('/').filter(Boolean);
      // Strip only the shared root segment; a file sitting directly in the
      // chosen folder keeps its bare filename, nested files keep their
      // subfolder path. Files with no relative path keep their filename.
      let path=(parts.length>1?parts.slice(1).join('/'):file.name)||file.name;
      // Pickers that return bare files (empty webkitRelativePath, e.g.
      // Android/WebView folder pickers) can deliver the SAME filename from
      // different subfolders — Season 1 and Season 2 copies of one episode
      // name are the classic case. Keying the session map by path alone
      // silently overwrote all but one of them, so real movies vanished
      // from the count. Keep every file by uniquifying its catalog path;
      // the displayed title still comes from the real filename.
      if(state.sessionFiles.has(folder.id+'|'+path)){
        const slash=path.lastIndexOf('/'),dot=path.lastIndexOf('.');
        let n=2,unique=path;
        while(state.sessionFiles.has(folder.id+'|'+unique)){
          unique=(dot>slash?path.slice(0,dot):path)+' ('+n+')'+(dot>slash?path.slice(dot):'');
          n++;
        }
        path=unique;
      }
      state.sessionFiles.set(folder.id+'|'+path,file);
    }
    state.sessionFolderLoaded.add(folder.id);
    const matching=files.filter(file=>video(file.name));
    if(!matching.length){
      state.scanProblems.set(folder.id,'No supported video files in selected directory');
      state.autoAttachDraft=null;
      scanPreview('0 videos found among '+files.length+' files in '+root+
        '. Choose the folder containing .mp4 files, including its subfolders.');
      notify('No supported video files found in '+root+'. Try another folder.');
      return;
    }
    addFolder(folder);
    notify(matching.length+' video'+(matching.length===1?'':'s')+
      ' detected in '+root+'. Adding the folder to the library…');
  }
  async function saveEditor(){
    const pending=currentPending();if(!pending)return;
    if(pending.importAttempted&&!(pending.items||[]).length){
      scanPreview('No video files have been added. Choose Add Folder or Add Videos and select playable files before saving.');
      notify('No videos imported. Your library was not overwritten with an empty catalog.');
      return;
    }
    delete pending.importAttempted;
    const name=ui.name.value.replace(/\s+/g,' ').trim();
    if(!name){ui.name.setCustomValidity('Give this library a name.');ui.name.reportValidity();return;}
    ui.name.setCustomValidity('');
    if(state.libraries.some(x=>x.id!==pending.id&&x.name.toLowerCase()===name.toLowerCase())){
      ui.name.setCustomValidity('A library with this name already exists.');
      ui.name.reportValidity();return;
    }
    const addon=nativeLibraryApi();
    if(addon&&typeof addon.saveLibrary==='function' &&
       String(state.editing||'').startsWith('addon:')){
      const nativeId=String(state.editing||'').startsWith('addon:')?
        String(state.editing).slice(6):undefined;
      const original=state.libraries.find(l=>l.id===state.editing);
      ui.save.disabled=true;
      try{
        const saved=await addon.saveLibrary({id:nativeId,name,kind:ui.kind.value});
        const id=saved.id||nativeId;
        if(original&&typeof addon.removeFolder==='function'){
          const still=new Set(pending.folders.map(f=>f.id));
          for(const folder of original.folders){
            if(!still.has(folder.id))await addon.removeFolder({libraryId:id,folderId:folder.id});
          }
        }
        await syncFromNative();
        closeEditor();setSelected('addon:'+id);
        notify('Library '+name+' saved in the Minternet extension. Media folders remain registered across restarts.');
      }catch(error){
        scanPreview('Minternet could not save this library: '+(error?.message||error));
        notify('Library was not saved in the extension. Please retry.');
      }finally{ui.save.disabled=false;}
      return;
    }
    // A user can click Save while a selected directory is still indexing.
    // Wait for its preview scan rather than committing an apparently blank catalog.
    if(state.pendingScans.size)await Promise.allSettled([...state.pendingScans]);
    if(state.pending!==pending)return;
    const failed=pending.folders.filter(folder=>state.scanProblems.has(folder.id));
    if(failed.length&&!(pending.items||[]).length){
      scanPreview('Videos were not indexed. Reconnect '+failed.map(f=>f.name).join(', ')+
        ', approve read access, then Save. Your library was not overwritten.');
      notify('Folder scan incomplete. Reconnect and approve access before saving.');
      return;
    }
    const priorKind=pending.kind;
    pending.name=name;pending.kind=ui.kind.value;
    pending.items=(pending.items||[]).filter(item=>pending.folders.some(f=>f.id===item.folderId));
    if(priorKind!==pending.kind){
      for(const item of pending.items){
        const parsed=describe(item.name,item.path,pending.kind);
        item.type=parsed.type;item.show=parsed.show;
        item.season=parsed.season;item.episode=parsed.episode;
      }
    }
    const replacing=state.libraries.findIndex(l=>l.id===pending.id);
    if(replacing>=0)state.libraries[replacing]=pending;
    else state.libraries.push(pending);
    state.selected=pending.id;setLocal('marmalade:media-library:selected',pending.id);
    state.folder=null;state.series=null;state.folderMode=false;
    state.query='';state.kind='all';state.collection='all';
    ui.search.value='';ui.filter.value='all';ui.collections.value='all';
    // Preview indexes are already available; no fresh permission request is
    // needed after the async database write. Wait for durable IndexedDB save
    // before reporting that the library can safely survive a browser reload.
    ui.save.disabled=true;
    ui.save.textContent='Save Library';
    closeEditor();render();
    await persist(pending);
    ui.save.disabled=false;
    // Do NOT rescan here. The folder was already scanned in the editor and
    // its catalog is what was just saved; an immediate silent rescan used
    // to overwrite the success message with a misleading "access needed"
    // notice whenever permission had lapsed back to "prompt", making a
    // successful add look like it had failed. Rescans happen only from
    // the Scan button or the stale-library check on load.
    if(pending.folders.length){
      if(pending.items.length)notify(countLabel(pending.items.length)+' saved in '+pending.name+'.');
      else notify('Library saved with no videos found. Add a folder that contains video files.');
    }else notify('Empty library saved. Open Edit Library to add a media folder.');
  }
  async function removeLibrary(){
    const lib=state.libraries.find(x=>x.id===state.editing);
    if(!lib)return;
    if(!window.confirm('Remove "'+lib.name+'" from Marmaladeum? The videos on your device will NOT be deleted.'))return;
    if(lib.id.startsWith('addon:')&&nativeLibraryApi()?.deleteLibrary){
      try{
        await nativeLibraryApi().deleteLibrary({id:lib.id.slice(6)});
        await syncFromNative();
        state.selected='all';setLocal('marmalade:media-library:selected','all');
        closeEditor();render();notify('Library removed from the Minternet extension. Original video files were not deleted.');
      }catch(error){notify('Could not remove library from extension: '+(error?.message||error));}
      return;
    }
    await erase(lib.id);
    for(const f of lib.folders)for(const k of state.sessionFiles.keys())
      if(k.startsWith(f.id+'|'))state.sessionFiles.delete(k);
    state.libraries=state.libraries.filter(l=>l.id!==lib.id);
    state.selected='all';setLocal('marmalade:media-library:selected','all');
    closeEditor();notify('Removed '+lib.name+' from your library. Original videos were not touched.');render();
  }
  function connectUI(){
    // Like Plex, both the in-card overflow and the right-click menu share the
    // same actions. Dismiss on outside click, scroll, Escape or new selection.
    document.body.append(ui.menu);
    document.addEventListener('pointerdown',event=>{
      if(!ui.menu.hidden&&!ui.menu.contains(event.target)&&
        !event.target.closest('.ml-card-more'))closeMenu();
    },true);
    // The popover is fixed and portaled to body. Programmatic scrolling
    // (including browser scrollIntoView for an action) must never detach its
    // buttons during activation. Close on actual outside wheel/touch input
    // instead; internal menu scrolling remains fully usable.
    window.addEventListener('wheel',event=>{
      if(!ui.menu.hidden&&!ui.menu.contains(event.target))closeMenu();
    },{passive:true,capture:true});
    window.addEventListener('touchmove',event=>{
      if(!ui.menu.hidden&&!ui.menu.contains(event.target))closeMenu();
    },{passive:true,capture:true});
    window.addEventListener('resize',closeMenu);
    window.addEventListener('keydown',event=>{
      if(!ui.menu.hidden&&['ArrowDown','ArrowUp','Home','End'].includes(event.key)&&ui.menu.contains(document.activeElement)){
        const items=[...ui.menu.querySelectorAll('[role="menuitem"]:not(:disabled)')];
        if(items.length){
          event.preventDefault();const index=items.indexOf(document.activeElement);
          const next=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;
          items[next].focus();
        }
        return;
      }
      if(event.key==='Escape'&&!ui.menu.hidden){event.preventDefault();const target=state.menuReturnFocus;closeMenu();if(target?.isConnected)target.focus({preventScroll:true});return;}
      if(event.key==='Escape'&&!ui.itemDialog.hidden){event.preventDefault();closeItemDialog();}
    },true);
    $('mlItemDialogClose').addEventListener('click',closeItemDialog);
    $('mlItemDialogCancel').addEventListener('click',closeItemDialog);
    ui.itemSave.addEventListener('click',()=>void saveItemDetails());
    $('mlNewLibrary').addEventListener('click',()=>openEditor(null));
    $('mlSidebarNew').addEventListener('click',()=>openEditor(null));
    $('mlDialogClose').addEventListener('click',closeEditor);
    $('mlDialogCancel').addEventListener('click',closeEditor);
    ui.pick.addEventListener('click',pickFolder);
    $('mlChooseVideos').addEventListener('click',()=>{
      if(!currentPending())return;
      state.pending.importAttempted=true;
      scanPreview('Select one or more videos from any folder. No folder permission is needed.');
      ui.videoInput.value='';
      ui.videoInput.click();
    });
    const rememberFolder=$('mlCompatibilityFolder');
    rememberFolder.hidden=typeof window.showDirectoryPicker!=='function';
    rememberFolder.setAttribute('aria-hidden',String(rememberFolder.hidden));
    rememberFolder.tabIndex=rememberFolder.hidden?-1:0;
    rememberFolder.addEventListener('click',()=>void pickPersistentFolder());
    ui.save.addEventListener('click',()=>void saveEditor());
    ui.delete.addEventListener('click',()=>void removeLibrary());
    ui.directoryInput.addEventListener('change',event=>{
      const chosen=[...event.target.files||[]];
      event.target.value='';
      if(!chosen.length){
        // Honest failure for system webviews (Minternet without its add-on,
        // app WebViews): the picker can appear to work yet return nothing
        // to the page. Say so plainly instead of silently indexing 0.
        scanPreview('The browser returned no files, so nothing was changed. Use Add Videos to select movie files directly if the folder is protected.');
        state.autoAttachDraft=null;
        return;
      }
      fallbackFiles(chosen);
    });
    ui.videoInput.addEventListener('change',event=>{
      const chosen=Array.from(event.target.files||[]);
      event.target.value='';
      if(chosen.length)fallbackFiles(chosen);
      else scanPreview('No video files selected. Existing library and videos were not changed.');
    });
    ui.directoryInput.addEventListener('cancel',()=>{
      // Browsers may emit 'cancel' while switching between a programmatically
      // opened directory picker and the FileList change event. Never disarm
      // an existing one-click import here: the next successful change must
      // still attach and save its files. Close Editor resets the intent.
      scanPreview('No folder change received yet. Choose Folder to select your videos.');
    });
    ui.name.addEventListener('input',()=>ui.name.setCustomValidity(''));
    ui.rescan.addEventListener('click',()=>{
      const lib=selectedLibrary();
      if(lib&&String(lib.id).startsWith('addon:')){
        const api=nativeLibraryApi();
        if(api&&typeof api.rescan==='function'){
          void (async()=>{
            try{await api.rescan();}catch{/* sync below reports state */}
            const result=await syncFromNative();
            notify(result.count?countLabel(result.count)+' available from Minternet after rescan.':
              'Minternet\u2019s add-on returned no videos on rescan.');
          })();
          return;
        }
      }
      if(lib){void scanLibrary(lib,{ask:true});return;}
      void (async()=>{
        for(const shelf of state.libraries)await scanLibrary(shelf,{ask:true});
        notify('All libraries have finished scanning.');
      })();
    });
    ui.quickAdd.addEventListener('click',()=>{
      const lib=selectedLibrary();
      if(lib)chooseAndAttachFolder(lib);
      else openEditor(null);
    });
    // Independent, one-click video import from any selected library or the
    // All Videos shelf. Direct file selection sidesteps blocked system
    // directories and works with ordinary browsers, even without extensions.
    const quickFiles=$('mlQuickFiles'),quickButton=$('mlQuickAddVideos');
    quickButton.addEventListener('click',()=>{
      quickFiles.value='';
      quickFiles.click();
    });
    quickFiles.addEventListener('change',event=>{
      const files=Array.from(event.target.files||[]);
      event.target.value='';
      if(!files.length)return;
      void (async()=>{
        const result=await importGameFiles(
          state.selected==='all'?null:state.selected,files);
        if(result.connected){
          notify(countLabel(result.imported)+' added locally. Click a video poster to play.');
        }else notify(result.reason||'No supported video files were selected.');
      })().catch(error=>notify('Unable to add videos: '+(error?.message||error)));
    });
    ui.art.addEventListener('click',()=>void findArtwork());
    ui.manage.addEventListener('click',()=>openEditor(selectedLibrary()));
    let searchTimer;
    ui.search.addEventListener('input',()=>{
      clearTimeout(searchTimer);
      searchTimer=setTimeout(()=>{state.query=ui.search.value;state.page=0;render();},110);
    });
    ui.filter.addEventListener('change',()=>{state.kind=ui.filter.value;state.page=0;render();});
    let progressRefresh=0;
    const refreshProgress=()=>{
      const tracking=()=>state.kind==='continue'||smartRule(state.collection)?.status==='continue';
      if(!tracking()||!state.ready||panel.hidden)return;
      clearTimeout(progressRefresh);progressRefresh=setTimeout(()=>{if(tracking()&&!panel.hidden)renderCards();},250);
    };
    window.addEventListener('marmalade:watch-progress',refreshProgress);
    window.addEventListener('storage',event=>{if(event.key==='marmalade:watch-progress:v1')refreshProgress();});
    ui.collections.addEventListener('change',()=>{state.collection=ui.collections.value;state.page=0;renderCards();});
    ui.sort.addEventListener('change',()=>{state.sort=ui.sort.value;state.page=0;render();});
    ui.view.addEventListener('click',()=>{
      state.list=!state.list;ui.view.setAttribute('aria-pressed',String(state.list));
      setLocal('marmalade:media-library:list',String(state.list));
      setPosterColumns(state.posterColumns,false);render();
    });
    // Minus reduces the actual card size; plus increases it.
    ui.posterSmaller.addEventListener('click',()=>{
      if(state.list)return;
      setPosterColumns(state.posterColumns+1);renderCards();
    });
    ui.posterLarger.addEventListener('click',()=>{
      if(state.list)return;
      setPosterColumns(state.posterColumns-1);renderCards();
    });
    panel.addEventListener('dragover',event=>{
      if(!state.ready)return;
      if([...event.dataTransfer?.types||[]].includes('Files'))event.preventDefault();
    });
    panel.addEventListener('drop',event=>{
      if(!state.ready)return;
      event.preventDefault();event.stopPropagation();
      const entry=[...event.dataTransfer?.items||[]].find(i=>i.kind==='file');
      if(!entry?.getAsFileSystemHandle){notify('Use + Library to choose a media folder.');return;}
      // getAsFileSystemHandle must be invoked synchronously in this drop event.
      const request=entry.getAsFileSystemHandle();
      void request.then(handle=>{
        if(!handle||handle.kind!=='directory'){notify('Drop a folder, not a single video.');return;}
        if(!state.pending)openEditor(selectedLibrary());
        handleFolderSelection(handle);
      }).catch(()=>notify('The folder cannot be read. Use Choose Folder.'));
    });
    panel.addEventListener('keydown',event=>{
      if(event.key==='Escape'&&!ui.dialog.hidden){
        event.stopPropagation();closeEditor();
      }
    });
    window.addEventListener('marmalade:media-cleared',()=>{episodeSelection=null;episodeGeneration++;});
    window.MarmaladeAddonBridge?.media?.addEventListener('ended',()=>{void advanceEpisode();});
    window.addEventListener('marmalade:video-selected',event=>{
      const file=event.detail?.file;
      if(!file)return;
      const matches=allItems().filter(i=>i.name===file.name&&i.size===file.size);
      if(matches.length===1){
        state.selected=matches[0].libraryId;
        if(!panel.hidden)render();
      }
    });
    document.addEventListener('visibilitychange',()=>{
      if(document.visibilityState!=='visible'||state.scanning||!state.ready)return;
      const lib=selectedLibrary();
      if(lib&&lib.folders.some(f=>f.handle)&&now()-(lib.lastScan||0)>20*60*1000)
        void scanLibrary(lib);
    });
  }
  const ready=(async()=>{
    addSetting();connectUI();
    state.db=await openStore();
    state.storageAvailable=!!state.db;
    if(state.db){
      try{state.libraries=await dbOperation('readonly','getAll');}
      catch{state.libraries=[];notify('Saved libraries cannot be accessed in this browser.');}
    }else notify('Private or restricted browser storage: libraries may disappear when this session ends.');
    state.selected=readLocal('marmalade:media-library:selected','all');
    if(state.selected!=='all'&&!state.libraries.some(x=>x.id===state.selected))
      state.selected='all';
    state.list=readLocal('marmalade:media-library:list','false')==='true';
    ui.view.setAttribute('aria-pressed',String(state.list));
    setPosterColumns(readLocal(POSTER_COLUMNS_KEY,'4'),false);
    state.ready=true;render();
    // A saved library whose folders all died with the last session (the
    // reported "refreshed, looks exactly the same, 0 indexed videos" state)
    // must say what to do instead of sitting silently at zero.
    const deadLib=state.libraries.find(l=>(l.items||[]).length===0&&
      (l.folders||[]).some(folderIsDead));
    if(deadLib)notify(deadLib.name+' has 0 indexed videos because its folder is disconnected. Open it and press + Choose Folder — choosing the folder once repopulates it.');
    // Recover first; only then begin backing up this site's current catalog.
    // Do not route media retention through Minternet or its native module.
    void syncFromExtension({silent:true}).catch(error=>
      console.warn('Extension restore unavailable:',error));
    const chosen=selectedLibrary();
    if(chosen&&chosen.folders.some(f=>f.handle)&&
      now()-(chosen.lastScan||0)>20*60*1000)void scanLibrary(chosen);
    return true;
  })();
  // ---- Marmalade Library Extension bridge --------------------------------
  // The extension (extension/ in this repo) holds its catalog in extension
  // storage, independent of this origin. This client imports that catalog
  // (metadata only) as libraries whose folders have source:'extension'.
  // Playback is handed back to the extension page via the play() branch
  // above. In Minternet, the same catalog shape arrives from the native
  // module instead (window.MarmaladeNativeLibrary) — see extension/minternet/.
  let extensionCatalogResolve=null;
  window.addEventListener('message',event=>{
    if(event.source!==window)return;
    const data=event.data;
    if(!data||data.source!=='marmalade-extension')return;
    if(data.type==='catalog'&&extensionCatalogResolve){
      const resolve=extensionCatalogResolve;extensionCatalogResolve=null;
      resolve({libraries:Array.isArray(data.libraries)?data.libraries:[],
        siteLibraries:Array.isArray(data.siteLibraries)?data.siteLibraries:[]});
    }
  });
  function requestExtensionCatalog(timeoutMs=1500){
    return new Promise(resolve=>{
      let done=false;
      const finish=value=>{if(done)return;done=true;extensionCatalogResolve=null;resolve(value);};
      extensionCatalogResolve=finish;
      window.postMessage({source:'marmalade-web',type:'get-catalog'},location.origin);
      setTimeout(()=>finish(null),timeoutMs);
    });
  }
  async function importExtensionCatalog(libraries){
    let imported=0;
    for(const extLib of libraries||[]){
      if(!extLib?.id||!Array.isArray(extLib.items))continue;
      const libId='extlib:'+extLib.id;
      const existing=state.libraries.find(l=>l.id===libId);
      // Keep the user's website-authorized folder handles when a new
      // extension metadata snapshot arrives. Otherwise every resync breaks
      // a previously playable game library.
      const oldFolders=new Map((existing?.folders||[]).map(f=>[f.id,f]));
      const folders=(extLib.folders||[]).map(f=>({
        id:f.id,name:f.name,source:'extension',handle:null,
        playHandle:oldFolders.get(f.id)?.playHandle||null
      }));
      const items=extLib.items.map(item=>{const copy={...item};delete copy.libraryId;return copy;});
      const record={id:libId,name:extLib.name||'Extension Library',kind:extLib.kind||'movie',
        folders,items,hiddenIds:extLib.hiddenIds||existing?.hiddenIds||[],
        createdAt:existing?.createdAt||now(),lastScan:extLib.lastScan||now()};
      if(existing)state.libraries[state.libraries.indexOf(existing)]=record;
      else state.libraries.push(record);
      await persist(record);
      imported+=items.length;
    }
    if(imported)render();
    return imported;
  }
  // ---- Generic Local Media Library add-on (Minternet first) ------------
  // The add-on (window.MinternetMediaLibrary) is a general Minternet
  // add-on: it stores folder PATHS in its own add-on data, rescans them
  // natively on startup, and serves files through scoped asset URLs.
  // Per-origin grants are the add-on's own store; Marmalade only reads the
  // catalog it is granted. Items arrive with an asset `url` for playback.
  async function importAddonCatalog(libraries){
    let imported=0,firstLibId=null;
    const active=new Set((libraries||[]).filter(l=>l?.id).map(l=>'addon:'+l.id));
    for(const stale of state.libraries.filter(l=>l.id.startsWith('addon:')&&!active.has(l.id))){
      state.libraries=state.libraries.filter(l=>l!==stale);
      await erase(stale.id);
    }
    for(const extLib of libraries||[]){
      if(!extLib?.id||!Array.isArray(extLib.items))continue;
      const libId='addon:'+extLib.id;
      const existing=state.libraries.find(l=>l.id===libId);
      const oldFolders=new Map((existing?.folders||[]).map(f=>[f.id,f]));
      const folders=(extLib.folders||[]).map(f=>({
        id:f.id,name:f.name,source:'native',handle:null,
        playHandle:oldFolders.get(f.id)?.playHandle||null
      }));
      const items=extLib.items.map(item=>{
        const copy={...item};delete copy.libraryId;
        if(!copy.type||copy.title===undefined){
          const parsed=describe(copy.name||'',copy.path||'',extLib.kind||'movie');
          if(!copy.type){copy.type=parsed.type;copy.show=parsed.show;
            copy.season=parsed.season;copy.episode=parsed.episode;}
          if(copy.title===undefined)copy.title=parsed.title;
          if(copy.year===undefined)copy.year=parsed.year;
        }
        return copy;
      });
      const record={id:libId,name:extLib.name||'Minternet Library',kind:extLib.kind||'movie',
        folders,items,hiddenIds:existing?.hiddenIds||[],createdAt:existing?.createdAt||now(),
        lastScan:extLib.lastScan||now()};
      if(existing)state.libraries[state.libraries.indexOf(existing)]=record;
      else state.libraries.push(record);
      await persist(record);
      imported+=items.length;
      if(!firstLibId)firstLibId=libId;
    }
    render();
    return {count:imported,libId:firstLibId};
  }
  async function syncFromNative(preloaded){
    const api=nativeLibraryApi();
    if(!api&&preloaded===undefined)return {count:0,libId:null};
    let catalog=preloaded;
    if(catalog===undefined){
      try{catalog=await api.getCatalog();}catch{return {count:0,libId:null};}
    }
    const libraries=Array.isArray(catalog)?catalog:(catalog?.libraries||[]);
    return importAddonCatalog(libraries);
  }
  async function restoreSiteCatalog(libraries,{durable=false}={}){
    let restored=0,items=0;const staged=[];
    for(const backup of (Array.isArray(libraries)?libraries:[])){
      if(!backup?.id||/^(addon:|extlib:)/.test(backup.id)||
         !Array.isArray(backup.items))continue;
      if(state.libraries.some(lib=>lib.id===backup.id))continue;
      const folders=(Array.isArray(backup.folders)?backup.folders:[])
        .map(folder=>({id:folder.id,name:folder.name,
          source:'session',handle:null,playHandle:null}));
      const sourceIds=new Set(folders.map(f=>f.id));
      const entries=backup.items.filter(item=>sourceIds.has(item.folderId))
        .map(item=>({...item}));
      const record={id:backup.id,name:backup.name||'Recovered Library',
        kind:backup.kind||'movie',folders,items:entries,
        hiddenIds:backup.hiddenIds||[],createdAt:backup.createdAt||now(),
        lastScan:backup.lastScan||0};
      if(durable)staged.push(record);
      else{state.libraries.push(record);await persist(record);}
      restored++;items+=entries.length;
    }
    if(durable&&staged.length){
      // A portable restore must commit all new records before showing success.
      await new Promise((resolve,reject)=>{
        const tx=state.db.transaction('libraries','readwrite');
        tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||Error('Catalog restore failed'));
        tx.onabort=()=>reject(tx.error||Error('Catalog restore aborted'));
        const store=tx.objectStore('libraries');for(const record of staged)store.add(record);
      });
      state.libraries.push(...staged);
    }
    if(restored)render();
    return {restored,items};
  }
  async function syncFromExtension({silent=false}={}){
    const snapshot=await requestExtensionCatalog();
    if(!snapshot){
      if(!silent)notify('Library extension is not installed. Standard local file selection still works.');
      return 0;
    }
    const recovery=await restoreSiteCatalog(snapshot.siteLibraries);
    const imported=await importExtensionCatalog(snapshot.libraries);
    // Never overwrite the extension's last-known catalog unless a real
    // extension responded and restoration succeeded. A missing or delayed
    // content bridge must not turn a temporary connection failure into
    // permanent loss of the independent backup.
    state.backupReady=true;
    queueLibraryBackup();
    if(!silent){
      notify(recovery.restored?recovery.items+' titles recovered from the extension. Reselect files if access needs renewal.':
        imported?imported+' extension catalog titles available. Choose Video Files to play them in Marmaladeum.':
        'Library extension backup connected.');
    }
    return imported+recovery.items;
  }
  window.MarmaladeMediaLibrary={
    ready,show:setVisibility,select:setSelected,syncFromExtension,syncFromNative,
    importGameFiles,
    hasNativeLibrary:()=>!!nativeLibraryApi(),
    getLibraries:()=>state.libraries.map(l=>({id:l.id,name:l.name,kind:l.kind,
      folders:l.folders.map(f=>({id:f.id,name:f.name,source:f.source})),
      count:l.items.length})),
    getGameLibraries,getGameVideos,playGameVideo,connectGameLibrary,connectGameFiles,
    isVisible:()=>!panel.hidden,refresh:()=>{const l=selectedLibrary();return l?scanLibrary(l,{ask:true}):Promise.resolve();}
  };
})();
