/* Marmalade Settings · compact, accessible three-part palette.
   Existing control nodes are MOVED, not recreated: every listener survives. */
(() => {
 'use strict';
 const panel=document.getElementById('settingsPanel');
 if(!panel||panel.querySelector('.settings-tabs'))return;
 const $=id=>document.getElementById(id);
 const heading=panel.querySelector('.popover-heading');
 const title=heading?.querySelector('strong');
 if(title)title.textContent='Settings';
 heading?.classList.add('settings-heading');
 const titleIcon=document.createElement('span');
 titleIcon.className='settings-title-icon';titleIcon.setAttribute('aria-hidden','true');
 titleIcon.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 7h10m4 0h3M3.5 17h3m4 0h10"/><circle cx="15.5" cy="7" r="2"/><circle cx="8.5" cy="17" r="2"/></svg>';
 if(title)title.before(titleIcon);
 const close=$('closeSettingsPanel');
 if(close){
   close.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
 }
 const icons={
  video:'<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="m10 9 5 3-5 3V9Z"/>',
  controls:'<path d="M4 7h16M4 12h16M4 17h16"/><circle cx="9" cy="7" r="2" fill="currentColor" stroke="none"/><circle cx="16" cy="17" r="2" fill="currentColor" stroke="none"/>',
  party:'<circle cx="8" cy="9" r="3"/><circle cx="17" cy="10" r="2.5"/><path d="M2.5 20v-2c0-3 2.3-5 5.5-5s5.5 2 5.5 5v2M14.5 15c2.5-.5 6.5 1 6.5 4v1"/>'
 };
 const nav=document.createElement('div');
 nav.className='settings-tabs';nav.setAttribute('role','tablist');
 nav.setAttribute('aria-label','Settings categories');
 const pages=new Map(),buttons=new Map(),tabs=['video','controls','party'];
 for(const [key,label] of [['video','Video'],['controls','Controls'],['party','Party']]){
   const button=document.createElement('button');
   button.type='button';button.className='settings-tab';
   button.id='settingsTab'+key[0].toUpperCase()+key.slice(1);
   button.dataset.settingsTab=key;button.setAttribute('role','tab');
   const pageId='settingsPage'+key[0].toUpperCase()+key.slice(1);
   button.setAttribute('aria-controls',pageId);
   button.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+icons[key]+'</svg><span>'+label+'</span>';
   nav.appendChild(button);buttons.set(key,button);
   const section=document.createElement('section');
   section.id=pageId;section.className='settings-page';
   section.dataset.settingsPage=key;section.setAttribute('role','tabpanel');
   section.setAttribute('aria-labelledby',button.id);
   const stack=document.createElement('div');stack.className='settings-stack';
   section.appendChild(stack);pages.set(key,section);
 }
 heading?.after(nav);
 nav.after(...pages.values());
 function into(id,page,variant=''){
   const element=$(id);
   if(!element)return null;
   let row=element;
   if(element.matches('select'))row=element.closest('label');
   if(element.matches('input[type=checkbox]'))row=element.closest('label');
   if(element.id==='backgroundTheme')row=element.closest('.backgrounds-setting');
   if(!row)return null;
   row.classList.add('settings-row');
   if(variant)row.classList.add(variant);
   pages.get(page).querySelector('.settings-stack').appendChild(row);
   return row;
 }
 into('qualitySelect','video','settings-quality-row');
 // Mobile only: keep the stage 16:9 by default, or follow the actual video's
 // intrinsic aspect ratio when the user opts in. Fullscreen and PiP are never
 // changed by this setting, and desktop remains completely unaffected.
 const aspectRow=document.createElement('label');
 aspectRow.id='mobileAspectSetting';
 aspectRow.className='settings-row settings-toggle-row';
 aspectRow.innerHTML='<span>Match Video Aspect Ratio <small>Mobile · 16:9 by default</small></span>'+
   '<input type="checkbox" id="mobileMatchVideoAspect" aria-label="Match video aspect ratio on mobile">';
 pages.get('video').querySelector('.settings-stack').append(aspectRow);
 const aspectToggle=$('mobileMatchVideoAspect'),stage=$('dropZone');
 const localVideo=$('player'),hostVideo=$('hostMonitor');
 const aspectKey='marmalade:mobile:match-video-aspect';
 try{aspectToggle.checked=localStorage.getItem(aspectKey)==='true';}catch{}
 function syncMobileAspect(){
   if(!stage)return;
   // Match the video actually visible on screen: guests can watch through
   // hostMonitor instead of the normal local player element.
   const visible=stage.classList.contains('host-monitor-active')?hostVideo:localVideo;
   const width=Number(visible?.videoWidth)||0,height=Number(visible?.videoHeight)||0;
   const valid=aspectToggle.checked&&width>0&&height>0;
   stage.style.setProperty('--mobile-stage-aspect',
     valid?String(width)+' / '+String(height):'16 / 9');
 }
 aspectToggle.addEventListener('change',()=>{
   try{localStorage.setItem(aspectKey,String(aspectToggle.checked));}catch{}
   syncMobileAspect();
 });
 for(const video of [localVideo,hostVideo]){
   for(const event of ['loadedmetadata','resize','emptied','loadstart'])
     video?.addEventListener(event,syncMobileAspect);
 }
 if(stage&&typeof MutationObserver==='function')
   new MutationObserver(syncMobileAspect).observe(stage,
     {attributes:true,attributeFilter:['class']});
 syncMobileAspect();
 const qualityHint=$('qualityHint');
 if(qualityHint){
   qualityHint.classList.add('settings-hint');
   pages.get('video').querySelector('.settings-stack').appendChild(qualityHint);
 }
 const background=into('backgroundTheme','video','settings-background-row');
 background?.querySelector('.backgrounds-heading')?.remove();
 const theme=$('backgroundTheme');
 if(theme){
   const dot=document.createElement('span');dot.className='settings-theme-swatch';
   dot.setAttribute('aria-hidden','true');theme.before(dot);
   const reflect=()=>{panel.dataset.settingsTheme=theme.value;};
   theme.addEventListener('change',reflect);reflect();
 }
 into('windowTheme','video','settings-window-theme-row');
 const subtitleLanguageRow=document.createElement('label');
 subtitleLanguageRow.className='settings-row';
 subtitleLanguageRow.innerHTML='<span>Preferred Subtitle Language <small>Default language for subtitle searches</small></span><select id="preferredSubtitleLanguage" aria-label="Preferred Subtitle Language"></select>';
 const subtitleLanguage=subtitleLanguageRow.querySelector('select');
 const subtitleLanguages=[['en','English'],['ar','Arabic'],['id','Indonesian'],['es','Spanish'],['fr','French'],['de','German'],['pt','Portuguese'],['it','Italian'],['ru','Russian'],['tr','Turkish'],['fa','Persian'],['hi','Hindi'],['ja','Japanese'],['ko','Korean'],['zh','Chinese'],['','All languages']];
 for(const [value,label] of subtitleLanguages)subtitleLanguage.add(new Option(label,value));
 try{const saved=localStorage.getItem('marmalade:preferred-subtitle-language');if(saved!==null&&subtitleLanguages.some(([value])=>value===saved))subtitleLanguage.value=saved;}catch{}
 subtitleLanguage.addEventListener('change',()=>{
   try{localStorage.setItem('marmalade:preferred-subtitle-language',subtitleLanguage.value);}catch{}
   const searchLanguage=$('subSearchLanguage');if(searchLanguage)searchLanguage.value=subtitleLanguage.value;
 });
 pages.get('video').querySelector('.settings-stack').append(subtitleLanguageRow);
 const subtitleLink=document.createElement('button');
 subtitleLink.type='button';subtitleLink.id='settingsSubtitleShortcut';
 subtitleLink.className='settings-action-row';
 subtitleLink.innerHTML='<span>Subtitles</span><span>Find &amp; Style <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg></span>';
 subtitleLink.addEventListener('click',()=>$('subtitlesBtn')?.click());
 pages.get('video').querySelector('.settings-stack').appendChild(subtitleLink);
 into('skipInterval','controls');
 pages.get('controls').querySelector('.settings-stack').append($('timelineBookmarks'),$('timelineChapters'));
 into('volumeIncrement','controls');
 into('volumeSnap','controls','settings-toggle-row');
 into('volumeMaximum','controls');
 into('audioProtection','controls','settings-toggle-row');
 into('audioNightMode','controls','settings-toggle-row');
 into('audioDialogue','controls');
 into('audioNormalize','controls','settings-toggle-row');
 into('audioDelay','controls');
 into('audioLanguage','controls');
 into('audioTrack','controls');
 into('audioOutput','controls');
 into('audioOutputChoose','controls');
 into('audioEqPreset','controls');
 pages.get('controls').querySelector('.settings-stack').appendChild($('audioEqEditor'));
 const tapRow=into('tapVideoPlayback','controls','settings-toggle-row');
 if(tapRow){const input=tapRow.querySelector('input');if(input)tapRow.append(input);}
 into('miniPlayerFadeDelay','controls');
 const fadeRow=into('controlFadeDelay','controls');
 if(fadeRow?.firstChild?.nodeType===Node.TEXT_NODE)
   fadeRow.firstChild.textContent='Fade Controls ';
 const keyboard=document.createElement('div');
 keyboard.className='settings-shortcuts';
 keyboard.innerHTML='<span>Keyboard</span><span><kbd>Space</kbd> Play / Pause <em>·</em> <kbd>←</kbd> <kbd>→</kbd> Skip</span>';
 pages.get('controls').appendChild(keyboard);
 into('stabilityMode','party');
 for(const id of ['strictSync','allowOriginalBuffer','peerAssist','hostMatchRow']){
   const row=into(id,'party','settings-toggle-row');
   // Native labels began with their checkbox. Put the title on the left,
   // the compact toggle on the far right without replacing the input.
   const input=row?.querySelector('input[type="checkbox"]');
   if(input)row.appendChild(input);
 }
 const hostStatus=$('hostMatchStatus');
 if(hostStatus){
   hostStatus.classList.add('settings-hint');
   pages.get('party').querySelector('.settings-stack').appendChild(hostStatus);
 }
 const advanced=document.createElement('details');
 advanced.id='settingsAdvanced';advanced.className='settings-advanced';
 const summary=document.createElement('summary');
 summary.innerHTML='Advanced <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
 advanced.appendChild(summary);
 // Detailed host A/V alignment belongs in Advanced, not the everyday Party view.
 const hostSync=$('hostSyncSettings');
 if(hostSync){hostSync.classList.add('settings-monitor');advanced.appendChild(hostSync);}
 const tools=panel.querySelector('.settings-tools')||document.createElement('div');
 tools.classList.add('settings-tools');
 const diagnostics=$('diagnosticsToggle'),info=$('stabilityInfo');
 if(diagnostics)tools.prepend(diagnostics);
 if(info)diagnostics?.after(info);
 advanced.append(tools);
 pages.get('party').appendChild(advanced);
 const footer=document.createElement('div');
 footer.className='settings-footer';
 footer.innerHTML='<span class="settings-saved-dot" aria-hidden="true"></span>Saved on this device';
 // Display only a build identity returned by the deployed static artifact.
 const build=document.createElement('small');build.className='settings-hint';build.textContent='Build: local or unverified';
 footer.appendChild(build);
 fetch(new URL('build-info.json',document.baseURI),{cache:'no-store'}).then(r=>r.ok?r.json():null).then(info=>{
   if(!/^[a-f0-9]{40}$/i.test(info?.commit||''))return;
   build.textContent='Build: '+info.commit.slice(0,12);build.title=info.commit;
 }).catch(()=>{});
 // Portable preferences only: never export room invitations, credentials,
 // file handles, viewing history, or cached movie/subtitle content.
 const privacy=document.createElement('label');privacy.className='settings-row settings-toggle-row';
 privacy.innerHTML='<span>Remember Last Room <small>Keep the last successful invitation on this device.</small></span><input type="checkbox" id="rememberLastRoom" aria-label="Remember Last Room">';
 const roomRemember=privacy.querySelector('input');
 try{roomRemember.checked=localStorage.getItem('marmalade:remember-last-room')!=='false';}catch{roomRemember.checked=true;}
 roomRemember.addEventListener('change',()=>{
   try{
    localStorage.setItem('marmalade:remember-last-room',String(roomRemember.checked));
    if(!roomRemember.checked)localStorage.removeItem('marmalade:last-joined-room-code');
   }catch{}
   window.dispatchEvent(new Event('marmalade:room-privacy-changed'));
 });
 pages.get('party').querySelector('.settings-stack').append(privacy);
 const clearRoom=document.createElement('button');clearRoom.type='button';clearRoom.id='forgetLastRoom';clearRoom.className='settings-action-row';clearRoom.textContent='Forget Last Room';
 clearRoom.addEventListener('click',()=>{
  try{localStorage.removeItem('marmalade:last-joined-room-code');window.dispatchEvent(new Event('marmalade:room-privacy-changed'));window.MarmaladeAddonBridge?.notify('Saved invitation cleared.');}catch{window.MarmaladeAddonBridge?.notify('Could not clear saved invitation.');}
 });
 pages.get('party').querySelector('.settings-stack').append(clearRoom);
 const updatePreference=document.createElement('label');updatePreference.className='settings-row settings-toggle-row';
 updatePreference.innerHTML='<span>Automatic Update Checks <small>Check for a different deployed build when opening the app.</small></span><input type="checkbox" id="automaticUpdateChecks" aria-label="Automatic Update Checks">';
 const autoUpdate=updatePreference.querySelector('input');
 try{autoUpdate.checked=localStorage.getItem('marmalade:auto-update-checks')!=='false';}catch{autoUpdate.checked=true;}
 autoUpdate.addEventListener('change',()=>{
  try{localStorage.setItem('marmalade:auto-update-checks',String(autoUpdate.checked));}catch{}
  window.dispatchEvent(new Event('marmalade:update-preference-changed'));
 });
 panel.appendChild(updatePreference);
 const backup=document.createElement('details');backup.id='settingsBackup';backup.className='settings-advanced';
 backup.innerHTML='<summary>Settings Backup &amp; Reset</summary><div class="settings-stack"><p class="settings-hint">Personal preferences only. Import or reset takes effect after reloading. Movie files and library data are not changed.</p><button type="button" id="settingsExport">Export Settings</button><button type="button" id="settingsImport">Import Settings</button><input type="file" accept=".json,application/json" id="settingsImportFile" hidden><label>Reset Category <select id="settingsResetCategory"><option value="video">Video</option><option value="audio">Audio</option><option value="subtitles">Subtitles</option><option value="party">Party</option><option value="buffering">Buffering</option><option value="library">Library</option><option value="games">Games</option><option value="controls">Controls</option><option value="miniPlayer">Mini-Player</option><option value="appearance">Appearance</option><option value="privacy">Privacy</option><option value="performance">Performance</option><option value="updates">Updates</option></select></label><button type="button" id="settingsReset">Reset Selected Category</button><button type="button" id="settingsApplyBackup" hidden>Apply &amp; Reload</button><p id="settingsBackupStatus" class="settings-hint" role="status"></p></div>';
 panel.appendChild(backup);
 const backupStatus=$('settingsBackupStatus'),applyBackup=$('settingsApplyBackup');
 const bool=v=>v==='true'||v==='false';
 const choices=(...values)=>v=>values.includes(v);
 const numeric=(min,max)=>v=>v.trim()!==''&&Number.isFinite(Number(v))&&Number(v)>=min&&Number(v)<=max;
 const schema={
  appearance:{'background-theme':choices('cosmic01','cosmic02','none'),'cosmic-background':bool,'window-theme':choices('classic','glass')},
  video:{
   'mobile:match-video-aspect':bool,'fullscreen-orientation':choices('portrait','landscape'),
   'guest-quality':choices('144','240','360','480','540','720','1080'),
   'adaptive-video-brightness:v1':numeric(0,200)
  },
  controls:{
   'skip-interval-seconds':choices('5','10','15','20','30','60'),'control-fade-seconds':choices('2','3','5','8','10','15'),'tap-video-playback':bool
  },
  audio:{
   'volume-increment':choices('1','5','10','25','50'),'volume-maximum':choices('100','200','300','400','500','600'),
   'volume-snap':bool,'volume-level':numeric(0,600),'audio-peak-protection':bool,'audio-night-mode':bool,
   'audio-dialogue':choices('off','mild','strong'),'audio-normalize':bool,
   'personal-audio-delay':choices('0','25','50','75','100','150','200','250','300','400','500'),
   'preferred-audio-language':choices('','en','ar','id','es','fr','de','it','pt','ja','ko','zh','hi','ru','tr'),
   'audio-eq-preset':choices('flat','cinema','speech','music','soft','custom'),
   'audio-eq-bands':v=>{try{const a=JSON.parse(v);return Array.isArray(a)&&a.length===7&&a.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=12);}catch{return false;}}
  },
  subtitles:{'preferred-subtitle-language':choices(...subtitleLanguages.map(([value])=>value))},
  party:{'stability-mode':choices('fast','balanced','smooth'),'strict-sync':bool},
  buffering:{'original-file-buffer':bool,'peer-assist':bool},
  library:{'media-library:visible':bool,'media-library:auto-next':bool,'media-library:auto-posters':bool,'media-library:poster-columns':numeric(1,20)},
  games:{'games:visible:v1':bool},
  miniPlayer:{'mini-player-fade':choices('follow','2','3','5','8','10','15')},
  performance:{'playback-diagnostics':bool},
  privacy:{'remember-last-room':bool},
  updates:{'auto-update-checks':bool}
 };
 const validators=new Map(Object.values(schema).flatMap(group=>Object.entries(group)).map(([key,validate])=>['marmalade:'+key,validate]));
 let pending=null,backupRevision=0;
 function exportPreferences(){
  const preferences=Object.create(null);
  for(const [key,validate] of validators){
   const value=localStorage.getItem(key);
   if(value!==null&&value.length<=2048&&validate(value))preferences[key]=value;
  }
  return {format:'marmaladeum-settings',version:1,preferences};
 }
 function validateImport(data){
  if(data?.format!=='marmaladeum-settings'||data.version!==1||!data.preferences||typeof data.preferences!=='object'||Array.isArray(data.preferences))throw Error('Unsupported settings backup format.');
  const changes=new Map();
  for(const [key,value] of Object.entries(data.preferences)){
   if(!validators.has(key)||typeof value!=='string'||value.length>2048||!validators.get(key)(value))throw Error('Unknown or invalid preference: '+key.slice(0,100));
   changes.set(key,value);
  }
  return changes;
 }
 function stageChanges(changes,message){
  pending=changes;applyBackup.hidden=!changes.size;
  backupStatus.textContent=changes.size?message+' '+changes.size+' preference(s). Apply & Reload to confirm.':'No preferences to change.';
 }
 $('settingsExport').addEventListener('click',()=>{
  try{
   const blob=new Blob([JSON.stringify(exportPreferences(),null,2)],{type:'application/json'});
   const url=URL.createObjectURL(blob),a=document.createElement('a');
   a.href=url;a.download='Marmaladeum-Settings.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
   backupStatus.textContent='Settings backup created.';
  }catch{backupStatus.textContent='Settings backup unavailable.';}
 });
 $('settingsImport').addEventListener('click',()=>$('settingsImportFile').click());
 $('settingsImportFile').addEventListener('change',async event=>{
  const file=event.target.files?.[0];event.target.value='';
  const revision=++backupRevision;
  pending=null;applyBackup.hidden=true;
  if(!file)return;
  try{
   if(file.size>65536)throw Error('Settings backup exceeds 64 KiB.');
   const text=await file.text();
   if(revision!==backupRevision)return;
   stageChanges(validateImport(JSON.parse(text)),'Validated import:');
  }catch(error){if(revision===backupRevision)backupStatus.textContent=String(error.message||error);}
 });
 $('settingsReset').addEventListener('click',()=>{
  ++backupRevision;pending=null;applyBackup.hidden=true;
  try{
   const group=schema[$('settingsResetCategory').value];
   if(!group)return;
   const changes=new Map(Object.keys(group).map(key=>'marmalade:'+key).filter(key=>localStorage.getItem(key)!==null).map(key=>[key,null]));
   stageChanges(changes,'Reset selected preferences to defaults:');
  }catch{backupStatus.textContent='Settings storage unavailable.';}
 });
 applyBackup.addEventListener('click',()=>{
  if(!pending)return;
  const state=window.MarmaladeAddonBridge?.state;
  if(state?.broadcasting||state?.guestConn?.open||state?.connections?.size||!localVideo?.paused){
   backupStatus.textContent='Leave the room and pause playback before applying settings.';return;
  }
  const before=new Map();
  try{
   for(const key of pending.keys())before.set(key,localStorage.getItem(key));
   for(const [key,value] of pending){if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value);}
   if(localStorage.getItem('marmalade:remember-last-room')==='false')localStorage.removeItem('marmalade:last-joined-room-code');
  }catch{
   for(const [key,value] of before)try{if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value);}catch{}
   backupStatus.textContent='Settings could not be saved. Previous values restored where possible.';return;
  }
  ++backupRevision;pending=null;location.reload();
 });
 panel.appendChild(footer);
 const save=key=>{try{localStorage.setItem('marmalade:settings-category',key);}catch{}};
 const restore=()=>{try{return localStorage.getItem('marmalade:settings-category')||'video';}catch{return 'video';}};
 let active='video';
 const reposition=()=>{
   if(!panel.hidden)requestAnimationFrame(()=>window.MarmaladeSettingsReposition?.());
 };
 function activate(key,{focus=false,persist=true}={}){
   if(!tabs.includes(key))key='video';
   active=key;
   for(const choice of tabs){
     const selected=choice===key,button=buttons.get(choice),page=pages.get(choice);
     button.setAttribute('aria-selected',String(selected));
     button.tabIndex=selected?0:-1;
     page.hidden=!selected;
   }
   if(persist)save(key);
   if(focus)buttons.get(key)?.focus();
   panel.scrollTop=0;
   reposition();
 }
 for(const [key,button] of buttons)button.addEventListener('click',()=>activate(key));
 // Arrow navigation must preempt document-level left/right media shortcuts.
 window.addEventListener('keydown',event=>{
   if(!event.target?.closest?.('#settingsPanel .settings-tab')||
      !['ArrowRight','ArrowLeft','Home','End'].includes(event.key))return;
   event.preventDefault();event.stopImmediatePropagation();
   const index=tabs.indexOf(active);
   const next=event.key==='Home'?tabs[0]:event.key==='End'?tabs[tabs.length-1]:
     tabs[(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length];
   activate(next,{focus:true});
 },true);
 advanced.addEventListener('toggle',reposition);
 if(typeof ResizeObserver==='function')new ResizeObserver(reposition).observe(panel);
 // Search across every category, including dynamically inserted settings.
 const search=document.createElement('input');search.type='search';search.id='settingsSearch';
 search.className='settings-search';search.placeholder='Search Settings';search.setAttribute('aria-label','Search Settings');
 const results=document.createElement('div');results.className='settings-search-results';results.hidden=true;results.id='settingsSearchResults';
 results.setAttribute('role','region');results.setAttribute('aria-label','Matching settings');
 const status=document.createElement('div');status.className='settings-hint';status.setAttribute('role','status');
 nav.before(search,results);
 function clearSearch(){search.value='';results.hidden=true;results.replaceChildren();reposition();}
 function searchSettings(){
   const query=search.value.trim().toLocaleLowerCase();
   results.replaceChildren();results.hidden=!query;
   if(!query){reposition();return;}
   const terms=query.split(/\s+/),matches=[];
   for(const [key,page] of pages){
     const candidates=page.querySelectorAll('.settings-row,.settings-action-row,.settings-tools button,.settings-monitor label');
     for(const row of candidates){
       if(row.hidden)continue;
       let ancestor=row.parentElement,hidden=false;
       while(ancestor&&ancestor!==page){if(ancestor.hidden){hidden=true;break;}ancestor=ancestor.parentElement;}
       if(hidden)continue;
       const label=row.cloneNode(true);
       label.querySelectorAll('select,input,svg').forEach(node=>node.remove());
       const title=label.textContent.replace(/\s+/g,' ').trim();
       const control=row.querySelector('input,select,button')||row;
       const haystack=(title+' '+(control.getAttribute('aria-label')||'')+' '+key).toLocaleLowerCase();
       if(title&&terms.every(term=>haystack.includes(term)))matches.push({key,row,control,title});
     }
   }
   status.textContent=matches.length?matches.length+' matching settings':'No matching settings';
   results.append(status);
   for(const match of matches.slice(0,12)){
     const button=document.createElement('button');button.type='button';
     button.className='settings-search-result';
     const title=document.createElement('span');title.textContent=match.title;
     const category=document.createElement('small');category.textContent=buttons.get(match.key).textContent;
     button.append(title,category);
     button.addEventListener('click',()=>{
       clearSearch();activate(match.key);
       const details=match.row.closest('details');if(details)details.open=true;
       if(match.row.isConnected){
         match.row.scrollIntoView({block:'nearest',inline:'nearest'});
         match.control.focus({preventScroll:true});
       }
     });
     results.append(button);
   }
   results.scrollTop=0;
   panel.scrollTop=0;
   reposition();
 }
 search.addEventListener('input',searchSettings);
 search.addEventListener('keydown',event=>{
   if(event.key==='Escape'&&search.value){event.preventDefault();event.stopPropagation();clearSearch();}
   if(event.key==='Enter'){event.preventDefault();results.querySelector('button')?.click();}
 });
 for(const button of buttons.values())button.addEventListener('click',clearSearch);
 close?.addEventListener('click',clearSearch);
 activate(restore(),{persist:false});
 window.MarmaladeSettingsLayout={activate,active:()=>active,panes:tabs.slice()};
})();
