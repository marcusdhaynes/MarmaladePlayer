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
 cueTitle.htmlFor='subTimingCue';cueTitle.textContent='Align a spoken line';
 const cueSelect=document.createElement('select');
 cueSelect.id='subTimingCue';
 const button=document.createElement('button');
 button.id='subTimingAlign';button.type='button';
 button.className='sub-timing-action';button.textContent='Sync Selected Line To This Moment';
 button.disabled=true;
 const tip=document.createElement('p');
 tip.textContent='When the chosen line is spoken on-screen, click Sync. For releases with different edits or intros, use the matching subtitle release.';
 timing.append(cueTitle,cueSelect,button,tip);
 function playbackTime(){
  if(state.role!=='guest'||state.localVerified||state.bufferedMode||state.source==='hosted-guest')
   return Number(media.currentTime)||0;
  const current=Number(state.sharedTime)||0;
  const elapsed=state.hostPlaying?Math.max(0,(performance.now()-(state.sharedAt||performance.now()))/1000):0;
  return Math.max(0,current+elapsed);
 }
 function currentBaseTime(){
  const projected=playbackTime();
  const clock=window.MarmaladeSubtitleClock?.(projected)??projected;
  return clock-(Number(state.subtitleOffsetSeconds)||0);
 }
 function showTiming(){
  currentTime.textContent='Video '+formatTime(playbackTime())+' · Offset '+(Number(state.subtitleOffsetSeconds)||0).toFixed(1)+' s';
 }
 function formatTime(value){
  const n=Math.max(0,Number(value)||0),min=Math.floor(n/60),sec=Math.floor(n%60);
  return min+':'+String(sec).padStart(2,'0');
 }
 function refreshCueOptions(){
  cueSelect.replaceChildren();
  const cues=state.subtitles||[];
  if(!cues.length){
   const option=document.createElement('option');option.textContent='Load subtitles first';
   option.value='';cueSelect.appendChild(option);button.disabled=true;showTiming();return;
  }
  const target=currentBaseTime(),closest=cues.reduce((best,c,i)=>
   Math.abs(c.start-target)<Math.abs(cues[best].start-target)?i:best,0);
  const start=Math.max(0,Math.min(cues.length-16,closest-7));
  for(let i=start;i<Math.min(cues.length,start+16);i++){
   const cue=cues[i],option=document.createElement('option');
   option.value=String(i);
   option.textContent=formatTime(cue.start)+' · '+String(cue.text||'').replace(/\s+/g,' ').slice(0,57);
   if(i===closest)option.selected=true;
   cueSelect.appendChild(option);
  }
  button.disabled=false;showTiming();
 }
 button.addEventListener('click',()=>{
  const cue=state.subtitles?.[Number(cueSelect.value)];
  if(!cue)return;
  const shift=cue.start-currentBaseTime();
  const field=$('subtitleTiming');
  // Timing has 0.1-second resolution, in the original saved offset system.
  field.value=(Number(state.subtitleOffsetSeconds||0)+shift).toFixed(1);
  field.dispatchEvent(new Event('change',{bubbles:true}));
  showTiming();window.MarmaladeSubtitleRefresh?.();
  button.textContent='Line Synced ✓';
  setTimeout(()=>{button.textContent='Sync Selected Line To This Moment';},1600);
 });
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
 },refreshCues:refreshCueOptions};
})();
