/* Personal subtitle window: file import, multi-source discovery and appearance.
   No quality, encoding, transport, capture or WebRTC changes. */
(() => {
  'use strict';
  const bridge=window.MarmaladeAddonBridge;
  if(!bridge||!document.querySelector('#subtitlePositionGrid'))return;
  const {state,el}=bridge, panel=el.subtitlePanel;
  const appearance=panel.querySelector('.subtitle-style');
  const actions=el.loadSubtitle.closest('.popover-actions');
  panel.classList.add('subtitle-studio');
  panel.querySelector('.popover-heading strong').textContent='My subtitles';
  el.loadSubtitle.textContent='Load .srt / .vtt';
  el.hideSubtitle.textContent='Off';
  const css=document.createElement('style');
  css.textContent=[
    '.subtitle-studio{position:fixed!important;z-index:1210!important;top:12px;left:12px;right:auto!important;bottom:auto!important;width:min(352px,calc(100vw - 24px))!important;max-height:calc(100dvh - 24px)!important;overflow-y:auto;overscroll-behavior:contain;box-shadow:0 22px 56px #000b;background:#19191fee}',
    '.subtitle-studio[hidden]{display:none!important}',
    '.subtitle-studio .sub-tabs{display:grid;grid-template-columns:1fr 1fr;gap:5px}',
    '.subtitle-studio .sub-tabs button[aria-selected=true]{border-color:#ffad69;background:#51372c;color:#fff}',
    '.subtitle-studio .sub-view[hidden]{display:none!important}',
    '.subtitle-studio .sub-search{display:flex;flex-direction:column;gap:7px}',
    '.subtitle-studio .sub-search label{display:flex;flex-direction:column;align-items:stretch;gap:3px;font-size:10px}',
    '.subtitle-studio .sub-input{width:100%;min-width:0;background:#252229;border:1px solid #62525b;border-radius:6px;color:#f5e8de;font:inherit;padding:7px}',
    '.subtitle-studio .sub-pair{display:grid;grid-template-columns:1fr 1fr;gap:7px}',
    '.subtitle-studio .sub-actions{display:grid;grid-template-columns:1fr auto;gap:6px}',
    '.subtitle-studio .sub-search details{border-top:1px solid #ffffff22;padding-top:6px}',
    '.subtitle-studio .sub-search summary{font-size:10px;color:#ffd1a2;cursor:pointer}',
    '.subtitle-studio .sub-search details[open]>summary{margin-bottom:7px}',
    '.subtitle-studio .sub-links{display:flex;flex-wrap:wrap;gap:5px}',
    '.subtitle-studio .sub-links a{color:#ffd2a3;border:1px solid #604e49;padding:4px 6px;text-decoration:none;border-radius:5px;font-size:10px}',
    '.subtitle-studio .sub-results{display:flex;flex-direction:column;gap:5px;max-height:220px;overflow-y:auto}',
    '.subtitle-studio .sub-result{display:flex;align-items:center;gap:7px;justify-content:space-between;padding:7px;background:#ffffff0a;border:1px solid #ffffff1a;border-radius:6px}',
    '.subtitle-studio .sub-result div:first-child{flex:1;min-width:0;overflow-wrap:anywhere}',
    '.subtitle-studio .sub-result strong{display:block;font-size:10px}',
    '.subtitle-studio .sub-result small,.subtitle-studio .sub-note{font-size:9px;color:#bfb1b9;line-height:1.4}',
    '.subtitle-studio .sub-result a,.subtitle-studio .sub-result button{font-size:10px;padding:5px 7px;text-decoration:none;border:1px solid #6a5548;border-radius:5px;background:#352c2b;color:#ffdaaa}',
    '.subtitle-studio .subtitle-style{border:0;padding:0;gap:8px}',
    '.subtitle-studio .sub-setting-value{display:inline-block;min-width:32px;text-align:right;font-size:9px;color:#ffd8ac;font-variant-numeric:tabular-nums}',
    '.subtitle-studio .subtitle-style-row{grid-template-columns:minmax(68px,1fr) auto auto auto}',
    '.subtitle-studio input[type=checkbox]{accent-color:#ffa869}',
    '@media(max-width:450px){.subtitle-studio .sub-results{max-height:165px}}'
  ].join('\n');
  document.head.append(css);
  const tabs=document.createElement('div');
  tabs.className='sub-tabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Subtitle tools');
  tabs.innerHTML='<button id="subFindTab" type="button" role="tab" aria-selected="true" aria-controls="subFindView">Find subtitles</button>'+
    '<button id="subStyleTab" type="button" role="tab" aria-selected="false" aria-controls="subStyleView">Appearance</button>';
  actions.insertAdjacentElement('afterend',tabs);
  const find=document.createElement('section'),style=document.createElement('section');
  find.id='subFindView';find.className='sub-view';find.setAttribute('role','tabpanel');
  style.id='subStyleView';style.className='sub-view';style.setAttribute('role','tabpanel');style.hidden=true;
  tabs.insertAdjacentElement('afterend',find);find.insertAdjacentElement('afterend',style);style.append(appearance);
  // Show actual values next to every size/transparency control. Transparency
  // is 0% (solid) to 100% (invisible), consistent with the labels.
  for(const input of appearance.querySelectorAll('input[type=range][data-sub-key]')){
    const out=document.createElement('output');
    out.className='sub-setting-value';
    input.insertAdjacentElement('afterend',out);
    const update=()=>{out.textContent=input.value+
      (input.dataset.subKey==='timing'?'s':input.dataset.subKey.endsWith('Alpha')?'%':'px');};
    input.addEventListener('input',update);
    update();
  }

  function place(){
    if(panel.hidden)return;
    const parent=document.fullscreenElement===el.stage?el.stage:document.body;
    if(panel.parentElement!==parent)parent.append(panel);
    const trigger=el.subtitleBtn.getBoundingClientRect(),rect=panel.getBoundingClientRect(),pad=12;
    panel.style.left=Math.round(Math.max(pad,Math.min(innerWidth-rect.width-pad,trigger.right-rect.width)))+'px';
    panel.style.top=Math.round(Math.max(pad,Math.min(innerHeight-rect.height-pad,trigger.top-rect.height-10)))+'px';
  }
  function tab(which){
    find.hidden=which!=='find';style.hidden=which!=='style';
    tabs.querySelector('#subFindTab').setAttribute('aria-selected',String(which==='find'));
    tabs.querySelector('#subStyleTab').setAttribute('aria-selected',String(which==='style'));
    place();
  }
  tabs.querySelector('#subFindTab').addEventListener('click',()=>tab('find'));
  tabs.querySelector('#subStyleTab').addEventListener('click',()=>tab('style'));
  addEventListener('resize',place,{passive:true});
  addEventListener('scroll',place,{passive:true});
  document.addEventListener('fullscreenchange',place);
  el.subtitleBtn.setAttribute('aria-controls','subtitlePanel');
  el.subtitleBtn.addEventListener('click',()=>{if(!panel.hidden){defaultFromFile();place();}});

  const form=document.createElement('form');
  form.className='sub-search';form.id='subSearchForm';
  form.innerHTML=
    '<label>Movie / series name<input class="sub-input" type="search" id="subSearchTitle" maxlength="160" required placeholder="Auto-filled from the video" autocomplete="off"></label>'+
    '<div class="sub-pair"><label>Year<input class="sub-input" type="number" min="1890" max="2100" id="subSearchYear" placeholder="Any"></label>'+
    '<label>Language<select class="sub-input" id="subSearchLanguage">'+
    [['en','English'],['ar','Arabic'],['id','Indonesian'],['es','Spanish'],['fr','French'],['de','German'],['pt','Portuguese'],['it','Italian'],['ru','Russian'],['tr','Turkish'],['fa','Persian'],['hi','Hindi'],['ja','Japanese'],['ko','Korean'],['zh','Chinese'],['','All languages']]
    .map(([v,n])=>'<option value="'+v+'">'+n+'</option>').join('')+'</select></label></div>'+
    '<div class="sub-pair"><label>Quality<select class="sub-input" id="subSearchQuality">'+
    [['','Any'],['480p','480p'],['720p','720p'],['1080p','1080p'],['2160p','4K / 2160p'],['BluRay','BluRay'],['WEB','WEB / WEB-DL']]
    .map(([v,n])=>'<option value="'+v+'">'+n+'</option>').join('')+'</select></label>'+
    '<label>Type<select class="sub-input" id="subSearchType"><option value="movie">Movie</option><option value="tv">TV series</option></select></label></div>'+
    '<details id="subSearchAdvanced"><summary>Episode filters</summary><div class="sub-pair">'+
    '<label>Season<input class="sub-input" type="number" id="subSearchSeason" min="1" max="999" placeholder="Any"></label>'+
    '<label>Episode<input class="sub-input" type="number" id="subSearchEpisode" min="1" max="9999" placeholder="Any"></label></div></details>'+
    '<div class="sub-actions"><button id="subSearchSubmit" type="submit">Search SubDL</button>'+
    '<button id="subSearchReset" type="button">↺ File</button></div>'+
    '<div class="sub-note" id="subSearchStatus" role="status" aria-live="polite">Based on your video filename.</div>'+
    '<div id="subSearchResults" class="sub-results" aria-label="Subtitle results"></div>'+
    '<div id="subSearchCatalogs" class="sub-links" aria-label="SubDL website"></div>'+
    '<div class="sub-note">Powered by SubDL · No API key needed</div>';
  find.append(form);
  const $=id=>form.querySelector('#'+id);
  const title=$('subSearchTitle'),year=$('subSearchYear'),lang=$('subSearchLanguage'),
    quality=$('subSearchQuality'),kind=$('subSearchType'),
    season=$('subSearchSeason'),episode=$('subSearchEpisode'),
    progress=$('subSearchStatus'),results=$('subSearchResults'),
    catalogs=$('subSearchCatalogs'),submit=$('subSearchSubmit'),
    proxyUrl='https://marmalade-subdl-proxy-somnielsynchreaua-4637.vercel.app/api/subtitles';
  function videoFilename(){
    if(state.role==='host'&&state.file?.name)return state.file.name;
    if(state.role==='guest'&&state.remoteFileName)return state.remoteFileName;
    const v=String(el.fileName.textContent||'');
    return /^(Nothing selected|Hosted stream|Shared player window)$/i.test(v)?'':v;
  }
  function parseFilename(raw){
    const name=String(raw||'').replace(/\.(mkv|mp4|webm|avi|m4v|mov|flv|ts|wmv)$/i,'').replace(/[._]/g,' ')
      .replace(/\[[^\]]*\]/g,' ').replace(/\s+/g,' ').trim();
    const episodeMatch=name.match(/\bS(\d{1,3})E(\d{1,4})\b/i)||name.match(/\b(\d{1,3})x(\d{1,4})\b/i);
    const yearMatch=name.match(/\b(19\d{2}|20\d{2})\b/);
    const release=name.match(/\b(480p|720p|1080p|2160p|4k|BluRay|WEB[- ]?DL|WEBRip|BDRip|x26[45]|HEVC|REMUX)\b/i);
    const cutoff=Math.min(name.length,...[episodeMatch,yearMatch,release].filter(Boolean).map(v=>v.index));
    const q=release?.[1]||'';
    return {title:name.slice(0,cutoff).replace(/[\s(-]+$/,'')||name,year:yearMatch?.[1]||'',
      season:episodeMatch?.[1]||'',episode:episodeMatch?.[2]||'',kind:episodeMatch?'tv':'movie',
      quality:/^(4k|2160p)$/i.test(q)?'2160p':/^web/i.test(q)?'WEB':q};
  }
  let priorName='',edited=false,sequence=0,controller=null;
  function defaultFromFile(force=false){
    const current=videoFilename();
    if(!force&&(edited||current===priorName))return;
    priorName=current;
    const info=parseFilename(current);
    title.value=info.title;year.value=info.year;kind.value=info.kind;
    season.value=info.season;episode.value=info.episode;
    quality.value=[...quality.options].some(x=>x.value===info.quality)?info.quality:'';
    edited=false;catalogLinks();
  }
  for(const input of [title,year,lang,quality,kind,season,episode])
    input.addEventListener('input',()=>{edited=true;catalogLinks();});
  $('subSearchReset').addEventListener('click',()=>defaultFromFile(true));
  const a=(label,url)=>{
    const element=document.createElement('a');element.href=url;element.target='_blank';
    element.rel='noopener noreferrer';element.textContent=label;return element;
  };
  function catalogLinks(){
    catalogs.replaceChildren();
    if(!title.value.trim())return;
    catalogs.append(a('Browse SubDL ↗','https://subdl.com/'));
  }
  function matchQuality(name){
    const q=quality.value;if(!q)return true;
    if(q==='WEB')return /\bWEB[- .]?DL\b|\bWEBRip\b/i.test(name);
    if(q==='BluRay')return /\bBluRay\b|\bBDRip\b/i.test(name);
    return new RegExp('(?:^|\\D)'+q+'(?:\\D|$)','i').test(String(name));
  }
  function dlUrl(path){
    try{
      const url=new URL(path,'https://dl.subdl.com');
      return url.protocol==='https:'&&url.hostname==='dl.subdl.com'&&url.pathname.startsWith('/subtitle/')?url.href:'';
    }catch{return '';}
  }
  function subdlResults(raw){
    const found=[];
    for(const s of Array.isArray(raw?.subtitles)?raw.subtitles:[]){
      const files=s.unpack_files?.length?s.unpack_files:[s];
      for(const file of files){
        const release=String(file.release_name||s.release_name||file.name||s.name||'Subtitle');
        const filename=String(file.name||s.name||'');
        const language=String(file.language||s.language||'').toLowerCase();
        if(!matchQuality(release+' '+filename)||(lang.value&&language&&lang.value!==language))continue;
        found.push({source:'SubDL',name:release,lang:language,filename,
          url:dlUrl(file.url||s.url),site:'https://subdl.com/',
          direct:file!==s&&/^(srt|vtt)$/i.test(file.format||'')||/\.(srt|vtt)$/i.test(filename)&&file!==s});
      }
    }
    return found;
  }
  function row(item){
    const root=document.createElement('div');root.className='sub-result';
    const info=document.createElement('div'),name=document.createElement('strong'),detail=document.createElement('small');
    name.textContent=item.name.slice(0,140);
    detail.textContent=[item.source,item.lang.toUpperCase(),item.filename&&item.filename!==item.name?item.filename.slice(0,75):''].filter(Boolean).join(' · ');
    info.append(name,detail);
    const buttons=document.createElement('div');
    if(item.direct&&item.url){
      const use=document.createElement('button');use.type='button';use.textContent='Use';
      use.addEventListener('click',async()=>{
        use.disabled=true;use.textContent='Loading…';
        try{
          const response=await fetch(item.url,{mode:'cors',credentials:'omit'});
          if(!response.ok||Number(response.headers.get('content-length')||0)>5*1024*1024)throw Error('Download failed');
          const text=await response.text();
          if(text.length>5*1024*1024||!text.includes('-->')||/^\s*<(!doctype|html)/i.test(text))
            throw Error('Not a supported SRT/VTT file');
          const fileName=/\.(srt|vtt)$/i.test(item.filename)?item.filename:'downloaded.srt';
          const data=new DataTransfer();
          data.items.add(new File([text],fileName,{type:'text/plain'}));
          el.subtitleFile.files=data.files;
          el.subtitleFile.dispatchEvent(new Event('change',{bubbles:true}));
          use.textContent='Loaded ✓';
        }catch(error){
          use.textContent='Use';progress.textContent='Direct download unavailable. Use Download ↗ and load the .srt / .vtt manually.';
        }finally{use.disabled=false;}
      });
      buttons.append(use);
    }
    buttons.append(a(item.url?'Download ↗':'SubDL ↗',item.url||item.site));
    root.append(info,buttons);return root;
  }
  async function get(url,options,signal){
    const r=await fetch(url,{...options,signal});
    if(!r.ok)throw Error(r.status===401||r.status===403?'API key rejected':'HTTP '+r.status);
    return r.json();
  }
  form.addEventListener('submit',async ev=>{
    ev.preventDefault();
    if(!title.value.trim())return;
    controller?.abort();controller=new AbortController();
    const seq=++sequence,signal=controller.signal,failures=[],tasks=[];
    results.replaceChildren();progress.textContent='Searching sources…';
    submit.disabled=true;
    const p=new URLSearchParams({film_name:title.value.trim(),type:kind.value,unpack:'1',subs_per_page:'30'});
    if(year.value)p.set('year',year.value);
    if(lang.value)p.set('languages',lang.value);
    if(kind.value==='tv'&&season.value)p.set('season',season.value);
    if(kind.value==='tv'&&episode.value)p.set('episode',episode.value);
    const detectedFilename=videoFilename();
    if(detectedFilename&&!edited&&title.value.trim()===parseFilename(detectedFilename).title){
      p.delete('film_name');p.set('file_name',detectedFilename);
    }
    const requestSubdl=()=>get(proxyUrl+'?'+p,{headers:{Accept:'application/json'}},signal);
    tasks.push(requestSubdl().then(async data=>{
      if(data?.status===false)throw Error(String(data.error||'Search rejected'));
      if(p.has('file_name')&&(!Array.isArray(data?.subtitles)||!data.subtitles.length)){
        p.delete('file_name');p.set('film_name',title.value.trim());
        data=await requestSubdl();
        if(data?.status===false)throw Error(String(data.error||'Search rejected'));
      }
      return subdlResults(data);
    }).catch(e=>{
      if(e.name!=='AbortError')failures.push(
        e.name==='TypeError'?'Subtitle server unreachable':String(e.message||'Search failed').slice(0,100));
      return [];
    }));
    const settled=await Promise.all(tasks);
    if(seq!==sequence)return;
    const list=settled.flat().slice(0,20);
    results.replaceChildren(...list.map(row));
    progress.textContent=(list.length?list.length+' SubDL subtitle matches': 'No SubDL matches')+
      (failures.length?' · '+failures.join(' · '):'');
    submit.disabled=false;
  });
  defaultFromFile();
  window.setInterval(()=>{if(!panel.hidden){defaultFromFile();place();}},1200);
  window.MarmaladeSubtitleFinder={parseFilename,subdlResults,defaultFromFile};
})();
