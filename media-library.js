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
    rescan:$('mlRescan'),manage:$('mlManage'),quickAdd:$('mlQuickAdd'),
    art:$('mlFindArt'),crumbs:$('mlCrumbs'),
    dialog:$('mlDialog'),dialogTitle:$('mlDialogTitle'),name:$('mlLibraryName'),
    kind:$('mlLibraryKind'),folderList:$('mlFolderList'),
    delete:$('mlDeleteLibrary'),pick:$('mlPickFolder'),
    directoryInput:$('mlDirectoryInput'),save:$('mlDialogSave'),
    menu:$('mlContextMenu'),itemDialog:$('mlItemDialog'),itemBody:$('mlItemDialogBody'),
    itemTitle:$('mlItemDialogTitle'),itemSave:$('mlItemDialogSave')
  };
  const KEY='marmalade:media-library:visible';
  const DB='marmalade:local-library:v1';
  const VIDEO=/\.(3g2|3gp|amv|asf|avi|divx|drc|f4v|flv|gifv|m1v|m2p|m2t|m2ts|m2v|m4v|mjpeg|mjpg|mk3d|mkv|mov|mp4|mpe|mpeg|mpg|mpv|mts|mxf|nsv|ogv|qt|rm|rmvb|roq|rv|ts|vob|webm|wmv|xvid|y4m|yuv)$/i;
  const IGNORE=new Set(['.git','node_modules','$recycle.bin','system volume information','__macosx']);
  const state={
    db:null,libraries:[],selected:'all',query:'',kind:'all',collection:'all',sort:'title',
    list:false,folderMode:false,folder:null,series:null,showCount:120,
    editing:null,pending:null,relink:null,scanning:false,scanSeq:0,
    sessionFiles:new Map(),sessionFolderLoaded:new Set(),status:'',ready:false,
    pendingScans:new Set(),scanProblems:new Map(),artworkBusy:false,storageAvailable:true,
    menuTarget:null,itemEditing:null,menuOpen:false,playingId:null
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
      let tx;
      try{
        tx=state.db.transaction('libraries',mode);
        const req=tx.objectStore('libraries')[method](payload);
        req.onsuccess=()=>resolve(req.result);
        req.onerror=()=>reject(req.error);
      }catch(error){reject(error);}
    });
  }
  async function persist(lib){
    if(!state.db)return;
    try{await dbOperation('readwrite','put',lib);}
    catch(error){
      // WebViews can disallow structured-cloning directory handles. Catalog
      // metadata survives, while folder access must be reauthorized.
      const plain={...lib,folders:lib.folders.map(f=>({...f,handle:null}))};
      try{await dbOperation('readwrite','put',plain);
        notify('Library saved. This browser requires folder access again after reopening.');}
      catch{notify('Unable to save this library on this device. It remains available until this tab closes.');}
    }
  }
  async function erase(idToRemove){
    try{await dbOperation('readwrite','delete',idToRemove);}catch{notify('Could not remove saved library data.');}
  }
  function selectedLibrary(){return state.libraries.find(l=>l.id===state.selected)||null;}
  function allItems(){return state.libraries.flatMap(l=>(l.items||[]).map(item=>({...item,libraryId:l.id,libraryName:l.name})));}
  function shelfItems(){const lib=selectedLibrary();return lib?
    (lib.items||[]).map(item=>({...item,libraryId:lib.id,libraryName:lib.name})):allItems();}
  function setSelected(next){
    state.selected=next;state.series=null;state.folder=null;state.folderMode=false;
    // Switching shelves must not inherit a hidden search/watch/collection
    // filter and appear empty after a successful folder scan.
    state.query='';state.kind='all';state.collection='all';
    ui.search.value='';ui.filter.value='all';ui.collections.value='all';
    state.showCount=120;setLocal('marmalade:media-library:selected',next);render();
  }
  function setVisibility(enabled){
    const value=!!enabled;
    panel.hidden=!value;
    row.classList.toggle('library-enabled',value);
    const control=$('mlVisibilityToggle');
    if(control)control.checked=value;
    setLocal(KEY,value?'true':'false');
    if(value)render();
  }
  function addSetting(){
    const stack=document.querySelector('#settingsPageVideo .settings-stack');
    if(!stack)return;
    const label=create('label','settings-row settings-toggle-row ml-setting-row');
    label.id='mlVisibilitySetting';
    append(label,'span','','Media Library');
    const check=append(label,'input');
    check.type='checkbox';check.id='mlVisibilityToggle';
    check.setAttribute('aria-label','Show media library beside movie and series information');
    check.checked=readLocal(KEY,'false')==='true';
    check.addEventListener('change',()=>setVisibility(check.checked));
    stack.append(label);
    const hint=append(stack,'p','settings-hint',
      'Show your named, on-device movie and TV libraries beside Movie & Series Information.');
    hint.id='mlSettingHint';
    setVisibility(check.checked);
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
          }catch{/* A disappeared or inaccessible file cannot be indexed. */}
        }
        if(items.length>0&&items.length%80===0){
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
        const found=await scanFolder(folder,draft.kind,state.scanSeq,false);
        if(draft!==state.pending)return;
        if(found===null){
          scanPreview('Folder access is not available. Use Reconnect or Other Picker to index its videos.');
          return;
        }
        const previous=new Map((draft.items||[]).map(i=>[i.id,i]));
        for(const item of found){
          const old=previous.get(item.id);
          if(old)Object.assign(item,{...old,id:item.id,path:item.path,folderId:item.folderId,
            name:item.name,size:item.size,lastModified:item.lastModified});
        }
        draft.items=(draft.items||[]).filter(i=>i.folderId!==folder.id).concat(found);
        scanPreview(found.length+' video'+(found.length===1?'':'s')+
          ' found in '+folder.name+'. Save Library to display them.');
      }catch(error){
        console.warn('Library folder indexing failed',error);
        scanPreview('Cannot scan '+folder.name+': '+(error?.message||'folder unavailable')+
          '. Try Other Picker to import its videos.');
      }
    })();
    state.pendingScans.add(promise);
    ui.save.disabled=true;
    promise.finally(()=>{
      state.pendingScans.delete(promise);
      if(!state.pendingScans.size)ui.save.disabled=false;
    });
  }
  async function scanLibrary(lib,{ask=false}={}){
    if(!lib||state.scanning){notify('A library scan is already in progress.');return;}
    state.scanning=true;
    const seq=++state.scanSeq,oldItems=(lib.items||[]).slice();
    const prior=new Map(oldItems.map(item=>[item.id,item]));
    let items=oldItems.slice(),accessIssues=0,folderIssues=0;
    ui.rescan.disabled=true;notify('Scanning '+lib.name+'…');
    try{
      for(const folder of lib.folders){
        if(seq!==state.scanSeq)break;
        let found=null;
        try{found=await scanFolder(folder,lib.kind,seq,ask);}
        catch(error){
          if(seq!==state.scanSeq)break;
          folderIssues++;console.warn('Library folder scan failed:',folder.name,error);
        }
        if(found!==null){
          items=items.filter(item=>item.folderId!==folder.id);
          for(const item of found){
            const previous=prior.get(item.id);
            if(previous){
              Object.assign(item,{...previous,id:item.id,path:item.path,folderId:item.folderId,
                name:item.name,size:item.size,lastModified:item.lastModified,
                addedAt:previous.addedAt||item.addedAt});
            }
          }
          const blocked=new Set(lib.hiddenIds||[]);
          items.push(...found.filter(item=>!blocked.has(item.id)));
          state.scanProblems.delete(folder.id);
        }else{
          accessIssues++;
          state.scanProblems.set(folder.id,'Permission needed. Use Edit Library → Reconnect.');
        }
      }
      if(seq!==state.scanSeq)return;
      lib.items=items;
      lib.lastScan=now();
      await persist(lib);
      if(folderIssues)notify('Some folders failed to scan. Edit Library to reconnect; previously indexed titles are kept.');
      else if(accessIssues)notify(accessIssues+' folder'+(accessIssues===1?' needs':'s need')+
        ' access. Click the pencil next to '+lib.name+' and reconnect. Indexed titles remain visible.');
      else notify(countLabel(items.length)+' indexed in '+lib.name+'.');
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
  async function mutateItems(items,fn,message){
    const changed=new Set();
    for(const item of items){
      const {lib,entry}=storedItem(item);
      if(!entry)continue;
      fn(entry,lib);changed.add(lib);
    }
    for(const lib of changed)await persist(lib);
    render();
    if(message)notify(message);
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
    ui.itemTitle.textContent=isEdit?'Edit Movie or Episode':mode==='info'?'Media File Info':'Video Analysis';
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
    itemField(ui.itemBody,'Poster URL (HTTPS)',entry.poster||'','mlEditPoster','url');
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
    item.poster=poster;
    item.overview=$('mlEditOverview').value.trim().slice(0,3000);
    item.customized=true;
    await persist(lib);closeItemDialog();render();
    notify('Updated '+item.title+' in '+lib.name+'.');
  }
  async function analyze(item){
    const {entry,lib}=storedItem(item);
    if(!entry)return;
    notify('Analyzing '+entry.name+'…');
    let duration=null;
    try{
      const {file}=await getPlayable(item);
      if(file.type.startsWith('video/')||video(file.name)){
        const url=URL.createObjectURL(file);
        try{
          duration=await new Promise(resolve=>{
            const media=document.createElement('video');
            media.preload='metadata';media.muted=true;
            let done=false;
            const finish=value=>{
              if(done)return;done=true;
              clearTimeout(timeout);media.removeAttribute('src');media.load();
              resolve(value);
            };
            const timeout=setTimeout(()=>finish(null),6000);
            media.onloadedmetadata=()=>finish(
              Number.isFinite(media.duration)&&media.duration>0?media.duration:null);
            media.onerror=()=>finish(null);
            media.src=url;
          });
        }finally{URL.revokeObjectURL(url);}
      }
    }catch(error){notify('File access needed for analysis: '+(error?.message||''));return;}
    entry.runtimeSec=duration;
    entry.analyzedAt=now();
    await persist(lib);
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
        if(rec.poster&&/^https:\/\//i.test(rec.poster))entry.poster=rec.poster;
        if(rec.overview)entry.overview=String(rec.overview).slice(0,3000);
        if(rec.year)entry.year=Number(rec.year)||entry.year;
        if(fix){
          if(entry.type==='tv')entry.show=rec.title;
          else entry.title=rec.title;
        }
        entry.metadataSource=rec.source||'Public metadata';
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
    void persist(lib);render();notify('Removed from the catalog; original video was not deleted.');
  }
  function openMenu(target,x,y,anchor=null){
    if(!target)return;
    closeMenu();
    state.menuTarget=target;state.menuOpen=true;
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
      if((lib.hiddenIds||[]).length)action('↶  Restore Hidden Videos',()=>{
        lib.hiddenIds=[];void persist(lib);void scanLibrary(lib,{ask:true});
      });
      sep();
      action('✕  Remove Library',()=>{state.editing=lib.id;void removeLibrary();},{danger:true});
    }else if(target.kind==='item'){
      const {lib,entry}=storedItem(target.item);
      if(!entry)return;
      action('▶  Play',()=>void play(target.item));
      action('✓  Mark as '+(entry.watched?'Unwatched':'Watched'),
        ()=>void mutateItems([target.item],item=>{item.watched=!item.watched;},'Watch status saved.'));
      action('★  '+(entry.favorite?'Remove Favorite':'Add to Favorites'),
        ()=>void mutateItems([target.item],item=>{item.favorite=!item.favorite;},'Favorites updated.'));
      action('✎  Edit Details',()=>showDetails(target.item));
      action('＋  Add to Playlist',()=>addToTagGroup(target.item,'playlists'));
      action('＋  Add to Collection',()=>addToTagGroup(target.item,'collections'));
      for(const key of ['playlists','collections']){
        for(const name of entry[key]||[])action('−  Remove from '+name,()=>void mutateItems([target.item],item=>{
          item[key]=(item[key]||[]).filter(n=>n!==name);
        },'Removed from '+name+'.'));
      }
      sep();
      action('⌕  Match / Fix Match',()=>void refreshMetadata([target.item],{fix:true}));
      action('↻  Refresh Metadata',()=>void refreshMetadata([target.item]));
      action('▤  Analyze',()=>void analyze(target.item));
      action('ℹ  Get Info',()=>showDetails(target.item,'info'));
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
      action('★  Favorite Series',()=>void mutateItems(entries,
        item=>{item.favorite=true;},'Series added to favorites.'));
      action('✎  Rename Series',()=>{
        const name=window.prompt('Series Name',target.show);
        if(name?.trim())void mutateItems(entries,
          item=>{item.show=name.trim().slice(0,180);item.customized=true;},
          'Series renamed.');
      });
      action('↻  Refresh Series Metadata',()=>void refreshMetadata(entries.slice(0,1)));
      action('ℹ  Series Info',()=>notify(entries.length+' episodes in '+target.show+'.'));
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
    if(/^https:\/\//i.test(data.poster||'')){
      const image=append(art,'img','ml-art-poster');
      image.src=data.poster;image.loading='lazy';image.alt='';
      image.referrerPolicy='no-referrer';
      image.addEventListener('error',()=>image.remove(),{once:true});
    }
    append(art,'span','ml-art-type',dir?(data.type==='tv'?'SERIES':'FOLDER'):data.type==='tv'?'EPISODE':'MOVIE');
    const mark=String(data.title||data.name||'?').trim().split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase();
    append(art,'span','ml-art-mark',dir?'▤':mark);
    append(art,'span','ml-play-symbol',dir?'›':'▶');
    const label=append(surface,'span','ml-card-label',data.title||data.name);
    if(data.watched){append(label,'span','ml-watched-mark','✓').title='Watched';}
    if(data.favorite){append(label,'span','ml-favorite-mark','★').title='Favorite';}
    append(surface,'span','ml-card-detail',data.detail||'');
    surface.title=String(data.title||data.name);
    surface.addEventListener('click',event=>{
      if(event.target.closest('.ml-card-more'))return;
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
      state.series=null;state.folder=null;state.folderMode=false;render();
    });
    if(state.series){
      append(ui.crumbs,'span','',' / ');
      append(ui.crumbs,'span','',state.series.show);
    }else if(state.folderMode){
      append(ui.crumbs,'span','',' / ');
      const toggle=append(ui.crumbs,'button','','Folders');
      toggle.addEventListener('click',()=>{state.folder=null;render();});
      if(state.folder){
        append(ui.crumbs,'span','',' / ');
        append(ui.crumbs,'span','',state.folder.label);
      }
    }else if(selectedLibrary()){
      append(ui.crumbs,'span','',' · ');
      const folders=append(ui.crumbs,'button','','Browse Folders');
      folders.addEventListener('click',()=>{state.folderMode=true;state.folder=null;render();});
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
      ...[...tags].sort().map(key=>[key,key.startsWith('playlist:')?
        'Playlist: '+key.slice(9):'Collection: '+key.slice(11)])]){
      const option=create('option');option.value=value;option.textContent=label;
      ui.collections.append(option);
    }
    state.collection=[...ui.collections.options].some(o=>o.value===current)?current:'all';
    ui.collections.value=state.collection;
  }
  function filteredItems(){
    let items=shelfItems();
    const search=state.query.trim().toLocaleLowerCase();
    if(state.kind==='movie'||state.kind==='tv')items=items.filter(i=>i.type===state.kind);
    else if(state.kind==='favorites')items=items.filter(i=>!!i.favorite);
    else if(state.kind==='watched')items=items.filter(i=>!!i.watched);
    else if(state.kind==='unwatched')items=items.filter(i=>!i.watched);
    if(state.collection!=='all'){
      const key=state.collection.startsWith('playlist:')?'playlists':'collections';
      const name=state.collection.slice(state.collection.indexOf(':')+1);
      items=items.filter(i=>(i[key]||[]).includes(name));
    }
    if(search)items=items.filter(i=>
      [i.title,i.show,i.path,i.name,i.libraryName].some(value=>
        String(value||'').toLocaleLowerCase().includes(search)));
    items.sort((a,b)=>{
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
      for(const folder of lib.folders){
        roots.push({name:folder.name,title:folder.name,type:'folder',
          detail:countLabel(items.filter(item=>item.folderId===folder.id).length),
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
    for(const value of roots.slice(0,state.showCount)){
      if(value.item)ui.cards.append(card({...value.item,detail:formatItemDetail(value.item)},
        ()=>void play(value.item),false,{kind:'item',item:value.item}));
      else ui.cards.append(card(value,()=>{
        state.folder={folderId:value.folderId,path:value.path,label:value.name};
        state.showCount=120;render();
      },true,{kind:'folder',libId:lib.id,folderId:value.folderId,path:value.path}));
    }
    if(!roots.length)empty('No Videos Here','This folder has no indexed videos. Try scanning again.','Rescan Library',
      ()=>void scanLibrary(lib,{ask:true}));
    else more(roots.length);
  }
  function formatItemDetail(item){
    if(item.type==='tv'){
      if(item.season!==null&&item.episode!==null)
        return 'S'+String(item.season).padStart(2,'0')+' E'+String(item.episode).padStart(2,'0');
      return item.show||item.libraryName||'Episode';
    }
    return (item.year||'')+(item.year?' · ':'')+item.libraryName;
  }
  function more(total){
    if(total<=state.showCount)return;
    const box=append(ui.cards,'div','ml-more');
    const button=append(box,'button','','Show More ('+(total-state.showCount).toLocaleString()+')');
    button.addEventListener('click',()=>{state.showCount+=120;render();});
  }
  function renderCards(){
    ui.cards.replaceChildren();
    $('mlLibrarySections').replaceChildren();
    ui.cards.classList.toggle('ml-list',state.list);
    const lib=selectedLibrary();
    const items=filteredItems();
    ui.count.textContent=countLabel(items.length);
    ui.title.textContent=lib?.name||'All Videos';
    ui.manage.disabled=!lib||state.scanning;
    ui.quickAdd.disabled=!lib||state.scanning;
    ui.art.disabled=state.scanning||state.artworkBusy||!items.length;
    ui.rescan.disabled=!state.libraries.length||state.scanning;
    breadcrumbs();
    if(state.folderMode){renderFolders(items);return;}
    if(state.series){
      const episodes=items.filter(i=>i.libraryId===state.series.libId&&i.show===state.series.show);
      for(const item of episodes.slice(0,state.showCount))
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
    if(state.sort==='recent')visible.sort((a,b)=>
      (b.items||[b.item]).reduce((m,i)=>Math.max(m,i.addedAt||0),0)-
      (a.items||[a.item]).reduce((m,i)=>Math.max(m,i.addedAt||0),0));
    if(state.sort==='year')visible.sort((a,b)=>
      (b.items||[b.item]).reduce((m,i)=>Math.max(m,i.year||0),0)-
      (a.items||[a.item]).reduce((m,i)=>Math.max(m,i.year||0),0));
    const renderEntity=entity=>{
      if(entity.kind==='show'){
        const entry={title:entity.show,type:'tv',detail:entity.items.length+' Episodes',
          poster:entity.items.find(item=>item.poster)?.poster||'',
          favorite:entity.items.some(item=>item.favorite),
          watched:entity.items.every(item=>item.watched)};
        ui.cards.append(card(entry,()=>{
          state.series={libId:entity.libId,show:entity.show};state.showCount=120;render();
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
        ui.filter.value=state.kind;state.showCount=120;render();
      });
    }
    const grouped=state.kind==='all'&&!state.collection.startsWith('playlist:')&&
      !state.collection.startsWith('collection:');
    if(grouped){
      for(const [name,entries] of [['MOVIES',movies],['TV SHOWS',tvEntries]]){
        const heading=append(ui.cards,'div','ml-media-divider');
        append(heading,'strong','',name);
        append(heading,'small','',countLabel(entries.length));
        for(const entity of entries.slice(0,state.showCount))renderEntity(entity);
      }
    }else{
      for(const entity of visible.slice(0,state.showCount))renderEntity(entity);
    }
    if(!visible.length){
      if(state.query)empty('No Matches','Try another title, show, or folder name.');
      else if(!state.libraries.length)empty('Your Library Starts Here',
        'Create a library, select a folder, and your movies and series appear automatically.',
        '+ Create Your First Library',()=>openEditor(null));
      else if(!items.length&&lib&&lib.folders.length===0)
        empty('Add a Media Folder','Choose one or more folders to populate '+lib.name+'.',
          '+ Choose Folder',()=>openEditor(lib));
      else if(lib)empty('No Videos Indexed','Rescan your media folders or reconnect folder access.',
        'Manage Library',()=>openEditor(lib));
      else empty('No Videos Yet','Add folders to a library to build your collection.',
        '+ Add Library',()=>openEditor(null));
    }
    more(visible.length);
  }
  function render(){
    if(!state.ready)return;
    renderShelves();renderCards();
    if(state.status)ui.status.textContent=state.status;
  }
  async function getPlayable(item){
    const lib=state.libraries.find(l=>l.id===item.libraryId);
    const folder=lib?.folders.find(f=>f.id===item.folderId);
    if(!folder)throw Error('This source folder is no longer in your library.');
    if(folder.source==='session'){
      const file=state.sessionFiles.get(item.id);
      if(file)return {file,handle:null};
      throw Error('Folder access expired. Choose Manage Library and reconnect the folder.');
    }
    if(!folder.handle)throw Error('Folder access expired. Choose Manage Library and reconnect it.');
    if(!await permissions(folder,true))throw Error('Folder access was not granted. Reconnect the folder.');
    const pieces=item.path.split('/').filter(Boolean);
    let directory=folder.handle;
    for(const part of pieces.slice(0,-1))directory=await directory.getDirectoryHandle(part);
    const handle=await directory.getFileHandle(pieces[pieces.length-1]);
    const file=await handle.getFile();
    return {file,handle};
  }
  async function play(item){
    const bridge=window.MarmaladeAddonBridge;
    if(typeof bridge?.chooseVideo!=='function'){
      notify('Player is not ready to open library videos.');return;
    }
    if(bridge.state?.role==='guest'&&bridge.state.guestConn?.open){
      if(!window.confirm('Opening a library video will leave the room you joined. Continue?'))return;
    }
    try{
      const {file,handle}=await getPlayable(item);
      if(!video(file.name))throw Error('This file is no longer a supported video container.');
      if(handle)bridge.state.lastOpenedHandle=handle;
      bridge.chooseVideo(file);
      notify('Playing '+file.name+' · Your video stays on this device.');
    }catch(error){notify(error?.message||'This video cannot be accessed. Reconnect the folder.');}
  }
  // Only titles are sent to the existing public metadata source, never a video
  // or local folder path. User consent is required before first lookup.
  async function findArtwork(){
    if(state.artworkBusy||state.scanning)return;
    const source=window.MarmaladePublicMovieInfo;
    if(typeof source?.lookup!=='function'){notify('Poster sources are not available.');return;}
    if(readLocal('marmalade:media-library:art-consent','false')!=='true'){
      if(!window.confirm('Look up posters using movie and series titles? Titles (but not video files or folder paths) will be sent to public movie-information services.'))return;
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
      for(const lib of affected)await persist(lib);
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
      const text=append(wrap,'span','','▣ '+folder.name);
      text.title=folder.name;
      const controls=append(wrap,'div');
      const reconnect=append(controls,'button','','Reconnect');
      reconnect.type='button';reconnect.title='Choose the location again';
      reconnect.addEventListener('click',()=>{state.relink=folder.id;void pickFolder();});
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
    state.editing=lib?.id||null;state.relink=null;
    state.pending={
      id:lib?.id||id(),
      name:lib?.name||'',
      kind:lib?.kind||'movie',
      folders:(lib?.folders||[]).map(folder=>({...folder})),
      items:(lib?.items||[]).slice(),hiddenIds:(lib?.hiddenIds||[]).slice(),
      createdAt:lib?.createdAt||now(),lastScan:lib?.lastScan||0
    };
    ui.dialogTitle.textContent=lib?'Manage Library':'Create Library';
    ui.name.value=state.pending.name;
    ui.kind.value=state.pending.kind;
    ui.delete.hidden=!lib;
    drawFolders();
    scanPreview(lib?(lib.items||[]).length+' indexed videos · Edit the name, type or folders, then Save.':
      'Choose a folder to preview its videos before saving.');
    ui.dialog.hidden=false;
    ui.name.focus();
  }
  function closeEditor(){
    ui.dialog.hidden=true;state.pending=null;state.editing=null;state.relink=null;
    scanPreview('');
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
  function handleFolderSelection(handle){
    if(!handle||handle.kind!=='directory')return;
    addFolder({id:id(),name:handle.name||'Video Folder',source:'handle',handle});
  }
  async function pickFolder(){
    if(typeof window.showDirectoryPicker==='function'){
      try{
        const handle=await window.showDirectoryPicker({mode:'read'});
        handleFolderSelection(handle);
        return;
      }catch(error){
        if(error?.name==='AbortError')return;
        console.warn('Native directory picker unavailable:',error);
        scanPreview('Persistent folder picker unavailable. Click Other Picker to import videos.');
        notify('Use Other Picker to select a directory in this browser.');
        return;
      }
    }
    ui.directoryInput.value='';
    ui.directoryInput.click();
  }
  function fallbackFiles(files){
    const pending=currentPending();
    if(!pending||!files.length)return;
    const first=files[0];
    const root=(first.webkitRelativePath||first.name).split('/')[0]||'Video Folder';
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
      const path=(file.webkitRelativePath||file.name).split('/').slice(1).join('/')||file.name;
      if(video(file.name))state.sessionFiles.set(folder.id+'|'+path,file);
    }
    state.sessionFolderLoaded.add(folder.id);
    addFolder(folder);
    scanPreview('Importing '+files.length+' selected files; only videos will appear.');
    notify('Folder selected. Browser file access may need to be renewed after reopening.');
  }
  async function saveEditor(){
    const pending=currentPending();if(!pending)return;
    const name=ui.name.value.replace(/\s+/g,' ').trim();
    if(!name){ui.name.setCustomValidity('Give this library a name.');ui.name.reportValidity();return;}
    ui.name.setCustomValidity('');
    if(state.libraries.some(x=>x.id!==pending.id&&x.name.toLowerCase()===name.toLowerCase())){
      ui.name.setCustomValidity('A library with this name already exists.');
      ui.name.reportValidity();return;
    }
    // A user can click Save while a selected directory is still indexing.
    // Wait for its preview scan rather than committing an apparently blank catalog.
    if(state.pendingScans.size)await Promise.allSettled([...state.pendingScans]);
    if(state.pending!==pending)return;
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
    closeEditor();render();
    // Persist and publish the preview immediately. Requiring permissions after
    // await persist() lost user activation and previously left libraries empty.
    void persist(pending);
    if(pending.folders.length){
      if(pending.items.length)notify(countLabel(pending.items.length)+' added to '+pending.name+'.');
      void scanLibrary(pending,{ask:false});
    }else notify('Empty library created. Open Edit Library to add a media folder.');
  }
  async function removeLibrary(){
    const lib=state.libraries.find(x=>x.id===state.editing);
    if(!lib)return;
    if(!window.confirm('Remove "'+lib.name+'" from Marmaladeum? The videos on your device will NOT be deleted.'))return;
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
    window.addEventListener('scroll',()=>{
      if(!ui.menu.hidden)closeMenu();
    },true);
    window.addEventListener('resize',closeMenu);
    window.addEventListener('keydown',event=>{
      if(event.key==='Escape'&&!ui.menu.hidden){event.preventDefault();closeMenu();return;}
      if(event.key==='Escape'&&!ui.itemDialog.hidden){event.preventDefault();closeItemDialog();}
    },true);
    $('mlItemDialogClose').addEventListener('click',closeItemDialog);
    $('mlItemDialogCancel').addEventListener('click',closeItemDialog);
    ui.itemSave.addEventListener('click',()=>void saveItemDetails());
    $('mlNewLibrary').addEventListener('click',()=>openEditor(null));
    $('mlSidebarNew').addEventListener('click',()=>openEditor(null));
    $('mlDialogClose').addEventListener('click',closeEditor);
    $('mlDialogCancel').addEventListener('click',closeEditor);
    ui.pick.addEventListener('click',()=>void pickFolder());
    $('mlCompatibilityFolder').addEventListener('click',()=>{
      ui.directoryInput.value='';
      ui.directoryInput.click();
    });
    ui.save.addEventListener('click',()=>void saveEditor());
    ui.delete.addEventListener('click',()=>void removeLibrary());
    ui.directoryInput.addEventListener('change',event=>{
      fallbackFiles([...event.target.files||[]]);event.target.value='';
    });
    ui.name.addEventListener('input',()=>ui.name.setCustomValidity(''));
    ui.rescan.addEventListener('click',()=>{
      const lib=selectedLibrary();
      if(lib){void scanLibrary(lib,{ask:true});return;}
      void (async()=>{
        for(const shelf of state.libraries)await scanLibrary(shelf,{ask:true});
        notify('All libraries have finished scanning.');
      })();
    });
    ui.quickAdd.addEventListener('click',()=>{
      const lib=selectedLibrary();
      if(!lib)return;
      openEditor(lib);
      void pickFolder();
    });
    ui.art.addEventListener('click',()=>void findArtwork());
    ui.manage.addEventListener('click',()=>openEditor(selectedLibrary()));
    let searchTimer;
    ui.search.addEventListener('input',()=>{
      clearTimeout(searchTimer);
      searchTimer=setTimeout(()=>{state.query=ui.search.value;state.showCount=120;render();},110);
    });
    ui.filter.addEventListener('change',()=>{state.kind=ui.filter.value;state.showCount=120;render();});
    ui.collections.addEventListener('change',()=>{state.collection=ui.collections.value;state.showCount=120;renderCards();});
    ui.sort.addEventListener('change',()=>{state.sort=ui.sort.value;render();});
    ui.view.addEventListener('click',()=>{
      state.list=!state.list;ui.view.setAttribute('aria-pressed',String(state.list));
      setLocal('marmalade:media-library:list',String(state.list));render();
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
    state.ready=true;render();
    const chosen=selectedLibrary();
    if(chosen&&chosen.folders.some(f=>f.handle)&&
      now()-(chosen.lastScan||0)>20*60*1000)void scanLibrary(chosen);
    return true;
  })();
  window.MarmaladeMediaLibrary={
    ready,show:setVisibility,select:setSelected,
    getLibraries:()=>state.libraries.map(l=>({id:l.id,name:l.name,kind:l.kind,
      folders:l.folders.map(f=>({id:f.id,name:f.name,source:f.source})),
      count:l.items.length})),
    isVisible:()=>!panel.hidden,refresh:()=>{const l=selectedLibrary();return l?scanLibrary(l,{ask:true}):Promise.resolve();}
  };
})();
