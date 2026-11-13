/* A unified, condensed three-part subtitle studio: Find / Style / Sync.
   Reparent existing controls only. Decoder, search, offsets, persistence and
   the source-release selectors retain their original listeners and IDs. */
(()=>{
 'use strict';
 const bridge=window.MarmaladeAddonBridge;
 if(!bridge||!window.MarmaladeSubtitleFinder||!window.MarmaladeSubtitleTiming)return;
 const {state,el,media}=bridge,panel=el.subtitlePanel;
 const $=id=>document.getElementById(id);
 const find=$('subFindView'),style=$('subStyleView'),tabs=panel.querySelector('.sub-tabs');
 if(!find||!style||!tabs||panel.classList.contains('sub-compact'))return;
 panel.classList.add('sub-compact');
 const heading=panel.querySelector('.popover-heading strong');
 if(heading)heading.textContent='Subtitles';
 const close=$('closeSubtitlePanel');
 if(close)close.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg>';
 const icons={
  find:'<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 5 5"/>',
  style:'<path d="m4 18 10-10m-3-3 8 8M4 18l1-5 5 5-6 1Z"/>',
  sync:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2M4 12h2m12 0h2"/>'
 };
 const findTab=$('subFindTab'),styleTab=$('subStyleTab');
 for(const [tab,key,label] of [[findTab,'find','Find'],[styleTab,'style','Style']]){
  tab.textContent='';
  tab.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">'+icons[key]+'</svg><span>'+label+'</span>';
 }
 const syncTab=document.createElement('button');
 syncTab.type='button';syncTab.id='subSyncTab';syncTab.setAttribute('role','tab');
 syncTab.setAttribute('aria-controls','subSyncView');syncTab.setAttribute('aria-selected','false');
 syncTab.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">'+icons.sync+'</svg><span>Sync</span>';
 tabs.appendChild(syncTab);
 const timing=document.createElement('section');
 timing.id='subSyncView';timing.className='sub-view sub-timing-pane';
 timing.setAttribute('role','tabpanel');timing.setAttribute('aria-labelledby','subSyncTab');
 timing.hidden=true;style.after(timing);
 const actions=panel.querySelector('.popover-actions');
 const subtitleName=$('subtitleName');
 if(subtitleName){subtitleName.classList.add('sub-caption-status');find.prepend(subtitleName);}
 if(actions){
  actions.classList.add('sub-file-actions');
  el.loadSubtitle.textContent='Load File / ZIP';
  el.loadSubtitle.title='Load subtitles or extract text subtitles from a ZIP archive';
  find.insertBefore(actions,find.querySelector('#subSearchForm'));
 }
 // Day-to-day search = title, year, language. Advanced release/episode filters
 // remain one tap away with original select IDs and listeners intact.
 const form=$('subSearchForm');
 const quality=$('subSearchQuality')?.closest('.sub-pair');
 const episode=$('subSearchAdvanced');
 if(form&&quality){
  const more=document.createElement('details');
  more.className='sub-more-filters';more.id='subMoreFilters';
  more.innerHTML='<summary>Release &amp; Episode Filters</summary>';
  form.insertBefore(more,quality);
  more.append(quality);
  if(episode){const children=[...episode.children].filter(x=>x.tagName!=='SUMMARY');more.append(...children);episode.remove();}
 }
 const studio=style.querySelector('.subtitle-style');
 if(studio){
  const headings=[...studio.querySelectorAll('h3')];
  for(const h of headings)h.remove();
  const rows=[...studio.querySelectorAll('.subtitle-style-row')];
  const timingRow=studio.querySelector('.subtitle-timing-row');
  if(timingRow)timing.prepend(timingRow);
  const notes=[...studio.querySelectorAll('.subtitle-settings-note')];
  if(notes[0])timingRow?.after(notes[0]);
  if(notes[1])notes[1].textContent='Your font, colors and position are saved locally.';
  const advanced=document.createElement('details');
  advanced.className='sub-advanced-style';advanced.id='subStyleAdvanced';
  advanced.innerHTML='<summary>Colors &amp; Effects</summary>';
  // Typography (font, size) and position remain always visible. The detailed
  // color/transparency/effect matrix lives in a quiet expandable area.
  for(const row of rows){
   if(row===timingRow)continue;
   if(!row.querySelector('[data-sub-key="textSize"]'))advanced.appendChild(row);
  }
  // Font color must remain reachable without opening the advanced section.
  studio.appendChild(advanced);
  const position=studio.querySelector('#subtitlePositionGrid');
  if(position){
    const posLabel=document.createElement('div');
    posLabel.className='sub-note';posLabel.textContent='Position · Tap a point on the 3 × 3 grid';
    position.before(posLabel);
  }
 }
 const instruction=document.createElement('p');
 instruction.textContent='Correct release first, then shift captions to match the spoken line. Changes apply immediately and stay with this video and subtitle file.';
 timing.insertBefore(instruction,timing.querySelector('.subtitle-timing-row'));
 const currentTime=document.createElement('output');
 currentTime.className='sub-timing-readout';currentTime.id='subTimingNow';
 timing.appendChild(currentTime);
 const reset=document.createElement('button');
 reset.type='button';reset.className='sub-timing-action';reset.id='subTimingReset';
 reset.textContent='Reset Timing To 0.0 s';
 reset.addEventListener('click',()=>{
  const field=$('subtitleTiming');field.value='0.0';
  field.dispatchEvent(new Event('change',{bubbles:true}));
  showTiming();window.MarmaladeSubtitleRefresh?.();
 });
 timing.appendChild(reset);
 const cueTitle=document.createElement('label');
 cueTitle.htmlFor='subTimingCueSearch';
 cueTitle.textContent='Line Alignment';
 const cueSearchBar=document.createElement('div');cueSearchBar.className='sub-cue-search-row';
 const cueSearch=document.createElement('input');
 cueSearch.id='subTimingCueSearch';cueSearch.type='search';
 cueSearch.autocomplete='off';cueSearch.spellcheck=false;
 cueSearch.placeholder='Search by words in any line…';
 cueSearch.setAttribute('aria-label','Search subtitle lines by keywords');
 cueSearch.setAttribute('aria-autocomplete','list');
 cueSearch.setAttribute('aria-controls','subTimingCue');
 cueSearch.setAttribute('aria-expanded','false');
 const expand=document.createElement('button');
 expand.type='button';expand.className='sub-cue-expand';expand.id='subCueExpand';
 expand.textContent='⌄';expand.setAttribute('aria-label','Browse complete subtitle lines');
 cueSearchBar.append(cueSearch,expand);
 const selectedDisplay=document.createElement('div');
 selectedDisplay.className='sub-cue-selected';selectedDisplay.id='subSelectedLine';
 selectedDisplay.setAttribute('aria-live','polite');
 selectedDisplay.textContent='Load a subtitle file to align its lines.';
 const cueList=document.createElement('div');
 cueList.id='subTimingCue';cueList.className='sub-cue-list';
 cueList.setAttribute('role','listbox');cueList.setAttribute('aria-label','Subtitle lines: time and full text');
 cueList.hidden=true;
 const count=document.createElement('small');count.className='sub-cue-count';count.id='subCueCount';
 const more=document.createElement('button');
 more.id='subCueMore';more.className='sub-cue-more';more.type='button';
 more.textContent='Show More Lines';more.hidden=true;
 const button=document.createElement('button');
 button.id='subTimingAlign';button.type='button';button.className='sub-timing-action';
 button.textContent='Align Selected Line To Now';button.disabled=true;
 const message=document.createElement('p');
 message.className='sub-cue-help';
 message.textContent='When the line begins in the video, click Align. + makes captions earlier; − makes them later. Each change is saved with this subtitle.';
 timing.append(cueTitle,cueSearchBar,selectedDisplay,cueList,more,count,button,message);
 let selectedCue=-1,matches=[],rendered=0,knownCues=null,filterFrame=0;
 const normalize=value=>String(value??'').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,' ').trim();
 function formatTime(value){
  const n=Math.max(0,Number(value)||0),h=Math.floor(n/3600),m=Math.floor(n%3600/60),s=(n%60).toFixed(1).padStart(4,'0');
  return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+s;
 }
 const cueText=cue=>String(cue?.text||'').replace(/\r/g,'').trim();
 const cueLabel=cue=>formatTime(cue.start)+' | '+cueText(cue);
 function playbackTime(){
  if(state.role!=='guest'||state.localVerified||state.bufferedMode||state.source==='hosted-guest')
   return Number(media.currentTime)||0;
  const current=Number(state.sharedTime)||0;
  const elapsed=state.hostPlaying?Math.max(0,(performance.now()-(state.sharedAt||performance.now()))/1000):0;
  return Math.max(0,current+elapsed);
 }
 function currentBaseTime(){
  const projected=playbackTime();
  return window.MarmaladeSubtitleClockBase?.(projected)??projected;
 }
 function showTiming(){
  const video=playbackTime(),clock=currentBaseTime()+(Number(state.subtitleOffsetSeconds)||0);
  currentTime.textContent='Video '+formatTime(video)+' · Captions '+formatTime(clock)+
    ' · Offset '+(Number(state.subtitleOffsetSeconds)||0).toFixed(1)+'s';
 }
 function selectedLine(){
  const cue=state.subtitles?.[selectedCue];
  selectedDisplay.textContent=cue?cueLabel(cue):'No subtitle line selected.';
  button.disabled=!cue;
 }
 function closeList(){
  cueList.hidden=true;more.hidden=true;cueSearch.setAttribute('aria-expanded','false');
  expand.setAttribute('aria-expanded','false');
 }
 function openList(){
  cueList.hidden=false;cueSearch.setAttribute('aria-expanded','true');
  expand.setAttribute('aria-expanded','true');
  renderMore();
 }
 function renderMore(){
  const cues=state.subtitles||[];
  if(cueList.hidden)return;
  const end=Math.min(matches.length,rendered+120);
  const fragment=document.createDocumentFragment();
  for(let n=rendered;n<end;n++){
   const i=matches[n],cue=cues[i];
   if(!cue)continue;
   const option=document.createElement('button');
   option.type='button';option.className='sub-cue-option';option.setAttribute('role','option');
   option.dataset.index=String(i);
   option.id='subCueOption'+i;
   option.setAttribute('aria-selected',String(i===selectedCue));
   // Never truncate, html-inject or replace the subtitle text.
   option.textContent=cueLabel(cue);
   option.addEventListener('click',()=>chooseCue(i));
   fragment.append(option);
  }
  cueList.append(fragment);rendered=end;
  more.hidden=end>=matches.length;
  count.textContent=matches.length?
    'Showing '+rendered+' of '+matches.length+' lines':'No lines match these keywords.';
 }
 function filterCues(){
  const cues=state.subtitles||[];
  const terms=normalize(cueSearch.value).split(' ').filter(Boolean);
  matches=[];
  for(let i=0;i<cues.length;i++){
   if(!terms.length||terms.every(word=>normalize(cueText(cues[i])).includes(word)))
    matches.push(i);
  }
  cueList.replaceChildren();rendered=0;
  count.textContent=matches.length+' matching line'+(matches.length===1?'':'s');
  if(!cueList.hidden)renderMore();
 }
 function chooseCue(index){
  if(!state.subtitles?.[index])return;
  selectedCue=index;selectedLine();
  cueList.querySelectorAll('[aria-selected="true"]').forEach(e=>e.setAttribute('aria-selected','false'));
  cueList.querySelector('[data-index="'+index+'"]')?.setAttribute('aria-selected','true');
  closeList();showTiming();
 }
 function refreshCueOptions({force=false}={}){
  const cues=state.subtitles||[];
  if(!force&&knownCues===cues)return;
  knownCues=cues;
  if(!cues.length){
   selectedCue=-1;cueSearch.value='';matches=[];cueList.replaceChildren();
   count.textContent='Load a subtitle file to choose a line.';
   closeList();selectedLine();showTiming();return;
  }
  const base=currentBaseTime()+(Number(state.subtitleOffsetSeconds)||0);
  let closest=0,lo=0,hi=cues.length;
  while(lo<hi){const mid=(lo+hi)>>1;if(cues[mid].start<base)lo=mid+1;else hi=mid;}
  closest=Math.min(cues.length-1,lo);
  if(closest>0&&Math.abs(cues[closest-1].start-base)<Math.abs(cues[closest].start-base))closest--;
  selectedCue=closest;cueSearch.value='';filterCues();
  selectedLine();closeList();showTiming();
 }
 cueSearch.addEventListener('focus',()=>{refreshCueOptions();openList();});
 cueSearch.addEventListener('input',()=>{
  cancelAnimationFrame(filterFrame);
  filterFrame=requestAnimationFrame(()=>{filterCues();openList();});
 });
 cueSearch.addEventListener('keydown',event=>{
  if(event.key==='Escape'){closeList();event.stopPropagation();return;}
  if(event.key==='ArrowDown'||event.key==='Enter'){
   if(cueList.hidden){openList();event.preventDefault();return;}
   const first=cueList.querySelector('.sub-cue-option');
   if(first){event.preventDefault();first.focus();}
  }
 });
 cueList.addEventListener('keydown',event=>{
  if(event.key==='Escape'){closeList();cueSearch.focus();event.stopPropagation();return;}
  const options=[...cueList.querySelectorAll('.sub-cue-option')];
  const index=options.indexOf(document.activeElement);
  if(event.key==='ArrowDown'&&index>=0){
   event.preventDefault();
   if(index===options.length-1&&rendered<matches.length)renderMore();
   (cueList.querySelectorAll('.sub-cue-option')[index+1]||options[index])?.focus();
  }else if(event.key==='ArrowUp'&&index>0){event.preventDefault();options[index-1].focus();}
 });
 more.addEventListener('click',renderMore);
 cueList.addEventListener('scroll',()=>{
  if(!cueList.hidden&&cueList.scrollTop+cueList.clientHeight>=cueList.scrollHeight-65)
   renderMore();
 },{passive:true});
 expand.addEventListener('click',()=>cueList.hidden?openList():closeList());
 panel.addEventListener('pointerdown',event=>{
  if(!event.target.closest('.sub-cue-search-row,.sub-cue-list,#subCueMore')&&!cueList.hidden)
   closeList();
 });
 button.addEventListener('click',()=>{
  const cue=state.subtitles?.[selectedCue];if(!cue)return;
  // Align directly to the exact underlying renderer clock, never calculate
  // a correction from a possibly-clamped already-shifted subtitle time.
  const desired=cue.start-currentBaseTime();
  const changed=window.MarmaladeSubtitleTiming?.set?.(desired);
  if(!changed)return;
  showTiming();window.MarmaladeSubtitleRefresh?.();
  button.textContent='Aligned & Saved ✓';
  setTimeout(()=>{button.textContent='Align Selected Line To Now';},1600);
 });
 window.addEventListener('marmalade:subtitles-loaded',()=>refreshCueOptions({force:true}));
 window.addEventListener('marmalade:media-cleared',()=>{
  knownCues=null;selectedCue=-1;cueSearch.value='';refreshCueOptions({force:true});
 });
 window.addEventListener('marmalade:subtitle-timing-changed',showTiming);
 window.addEventListener('marmalade:subtitle-hold-setting',()=>{
  const hint=$('subtitleTimingHoldHint');
  if(hint)hint.textContent='Tap for 0.1s · Hold once for 1.0s after '+
   (window.MarmaladeSubtitleTiming?.holdMilliseconds?.()||250)/1000+
   's. + Earlier · − Later.';
 });
 window.dispatchEvent(new Event('marmalade:subtitle-hold-setting'));
 const activeName=()=>!find.hidden?'find':!style.hidden?'style':'sync';
 function settle(which){
  timing.hidden=which!=='sync';
  if(which==='sync'){find.hidden=true;style.hidden=true;refreshCueOptions();}
  for(const [tab,key] of [[findTab,'find'],[styleTab,'style'],[syncTab,'sync']]){
   tab.setAttribute('aria-selected',String(which===key));tab.tabIndex=which===key?0:-1;
  }
  panel.scrollTop=0;
  window.dispatchEvent(new Event('resize'));
  window.MarmaladeSubtitleRefresh?.();
 }
 findTab.addEventListener('click',()=>settle('find'));
 styleTab.addEventListener('click',()=>settle('style'));
 syncTab.addEventListener('click',()=>settle('sync'));
 window.addEventListener('keydown',event=>{
  if(!event.target?.closest?.('#subtitlePanel .sub-tabs button')||
     !['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  event.preventDefault();event.stopImmediatePropagation();
  const keys=['find','style','sync'];
  const current=keys.indexOf(activeName());
  const next=event.key==='Home'?'find':event.key==='End'?'sync':
    keys[(current+(event.key==='ArrowRight'?1:-1)+keys.length)%keys.length];
  if(next==='find')findTab.click();
  else if(next==='style')styleTab.click();
  else syncTab.click();
  $(next==='find'?'subFindTab':next==='style'?'subStyleTab':'subSyncTab')?.focus();
 },true);
 const selected=()=>{if(!panel.hidden&&!timing.hidden)showTiming();};
 media.addEventListener('timeupdate',selected,{passive:true});
 media.addEventListener('seeked',selected,{passive:true});
 $('subtitleTiming')?.addEventListener('change',selected);
 panel.addEventListener('click',event=>{
  if(event.target.closest('#subFindTab,#subStyleTab,#subSyncTab'))return;
  if(!timing.hidden&&event.target.closest('#subTimingCue'))showTiming();
 });
 settle('find');
 window.MarmaladeSubtitleCompact={select:which=>{
  if(which==='find')findTab.click();
  else if(which==='style')styleTab.click();
  else if(which==='sync')syncTab.click();
 },refreshCues:()=>refreshCueOptions({force:true})};
})();
