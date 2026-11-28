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
  el.loadSubtitle.title='Load text subtitles, PGS .sup bitmap subtitles, or extract text subtitles from a ZIP archive';
  find.insertBefore(actions,find.querySelector('#subSearchForm'));
 }
 // A per-import choice, not a global setting: primary and secondary files
 // can use different legacy encodings. Cached decoded text is always UTF-8.
 function encodingRow(id){
  const details=document.createElement('details');details.className='sub-more-filters';
  const summary=document.createElement('summary');summary.textContent='File Encoding';details.append(summary);
  const select=document.createElement('select');select.id=id;select.setAttribute('aria-label','Subtitle file encoding');
  for(const [value,label] of window.MarmaladeSubtitleCodec?.encodings||[['auto','Automatic']]){
   const option=document.createElement('option');option.value=value;option.textContent=label;select.append(option);
  }
  details.append(select);
  const note=document.createElement('p');note.className='sub-note';note.textContent='Applies to the next file / ZIP load. If text is garbled, choose its encoding and reload the file.';details.append(note);
  return details;
 }
 if(actions){
  actions.after(encodingRow('primarySubtitleEncoding'));
  const bitmapNote=document.createElement('p');bitmapNote.className='sub-note';
  bitmapNote.textContent='PGS .sup files preserve authored bitmap position and colors. Timing works, but text search, font styling and native video-only PiP cannot display bitmap captions.';
  actions.after(bitmapNote);
 }
 const playerTracks=document.createElement('details');playerTracks.className='sub-more-filters';playerTracks.id='subPlayerTracks';
 playerTracks.innerHTML='<summary>Player Text Tracks</summary><label for="subPlayerTrackSelect">Available subtitles / captions</label><div class="sub-file-actions"><select id="subPlayerTrackSelect" aria-label="Player subtitle track"></select><button type="button" id="subPlayerTrackLoad">Load Track</button></div><p class="sub-note" id="subPlayerTrackStatus" aria-live="polite"></p><p class="sub-note">Imports currently available text cues. If a stream loads captions gradually, load again to refresh. Image tracks and tracks hidden by the container decoder are not supported here.</p>';
 if(actions)actions.after(playerTracks);else find.prepend(playerTracks);
 const playerTrackSelect=$('subPlayerTrackSelect'),playerTrackLoad=$('subPlayerTrackLoad'),playerTrackStatus=$('subPlayerTrackStatus');
 function refreshPlayerTracks(){
  const tracks=window.MarmaladePlayerTextTracks?.list()||[],previous=playerTrackSelect.value;
  playerTrackSelect.replaceChildren();
  for(const track of tracks){
   const option=document.createElement('option');option.value=String(track.index);option.textContent=track.label+(track.language?' · '+track.language:'');playerTrackSelect.append(option);
  }
  if(tracks.some(t=>String(t.index)===previous))playerTrackSelect.value=previous;
  playerTrackLoad.disabled=!tracks.length;
  if(!tracks.length)playerTrackStatus.textContent='No exposed text tracks available.';
  else playerTrackStatus.textContent=tracks.length+' text track'+(tracks.length===1?'':'s')+' available.';
 }
 playerTrackLoad.addEventListener('click',async()=>{
  if(playerTrackLoad.disabled)return;
  playerTrackLoad.disabled=true;
  try{await window.MarmaladePlayerTextTracks.load(Number(playerTrackSelect.value));playerTrackStatus.textContent='Track loaded into the subtitle studio.';}
  catch(error){playerTrackStatus.textContent=String(error.message||error);}
  finally{playerTrackLoad.disabled=!(window.MarmaladePlayerTextTracks?.list().length);}
 });
 playerTracks.addEventListener('toggle',()=>{if(playerTracks.open)refreshPlayerTracks();});
 for(const event of ['addtrack','removetrack'])media.textTracks?.addEventListener?.(event,refreshPlayerTracks);
 media.addEventListener('loadedmetadata',refreshPlayerTracks);
 window.addEventListener('marmalade:media-cleared',refreshPlayerTracks);
 refreshPlayerTracks();
 const embedded=document.createElement('details');embedded.className='sub-more-filters';
 embedded.innerHTML='<summary>Embedded MKV / WebM Subtitles</summary><div class="sub-file-actions"><button type="button" id="subMkvScan">Find Tracks</button><button type="button" id="subMkvCancel" disabled>Cancel</button></div><div class="sub-file-actions"><select id="subMkvTrack" aria-label="Embedded subtitle track"></select><button type="button" id="subMkvLoad" disabled>Load Track</button></div><p class="sub-note" id="subMkvStatus" aria-live="polite">Select a local or Minternet library MKV/WebM video.</p><p class="sub-note">Text, PGS and standard DVD VobSub bitmap tracks are extracted locally. ASS/SSA dialogue uses your chosen subtitle style. Dynamic DVD effects, encrypted and laced tracks are not supported.</p>';
 playerTracks.after(embedded);
 const mkvSelect=$('subMkvTrack'),mkvStatus=$('subMkvStatus'),mkvScan=$('subMkvScan'),mkvLoad=$('subMkvLoad'),mkvCancel=$('subMkvCancel');
 let mkvOperation=0,mkvTracks=[];
 function mkvBusy(busy){
  mkvScan.disabled=busy;mkvCancel.disabled=!busy;
  mkvLoad.disabled=busy||!mkvTracks.some(t=>t.supported&&String(t.number)===mkvSelect.value);
 }
 function mkvReset(){
  ++mkvOperation;window.MarmaladeEmbeddedSubtitles.cancel();mkvTracks=[];mkvSelect.replaceChildren();
  mkvStatus.textContent='Find tracks in the selected local or Minternet library MKV/WebM video.';mkvBusy(false);
 }
 mkvScan.addEventListener('click',async()=>{
  const operation=++mkvOperation;mkvTracks=[];mkvSelect.replaceChildren();mkvBusy(true);mkvStatus.textContent='Reading track metadata…';
  try{
   const tracks=await window.MarmaladeEmbeddedSubtitles.scan();if(operation!==mkvOperation)return;
   mkvTracks=tracks;
   for(const track of tracks){
    const option=document.createElement('option');option.value=String(track.number);
    option.textContent=(track.name||'Track '+track.number)+' · '+track.language+' · '+track.codec+(track.supported?'':' (unsupported)');
    option.disabled=!track.supported;mkvSelect.append(option);
   }
   const first=tracks.find(t=>t.supported);if(first)mkvSelect.value=String(first.number);
   mkvStatus.textContent=tracks.length?tracks.filter(t=>t.supported).length+' supported subtitle tracks of '+tracks.length+' total.':'No embedded subtitle tracks found.';
  }catch(error){if(operation===mkvOperation)mkvStatus.textContent=String(error.message||error);}
  finally{if(operation===mkvOperation)mkvBusy(false);}
 });
 mkvSelect.addEventListener('change',()=>mkvBusy(false));
 mkvLoad.addEventListener('click',async()=>{
  const operation=++mkvOperation;mkvBusy(true);mkvStatus.textContent='Extracting embedded subtitles…';
  try{
   const result=await window.MarmaladeEmbeddedSubtitles.load(Number(mkvSelect.value),percent=>{
    if(operation===mkvOperation)mkvStatus.textContent='Extracting embedded subtitles · '+Math.floor(percent)+'%';
   });
   if(operation===mkvOperation)mkvStatus.textContent='Embedded subtitles loaded.'+(result.inferred?' '+result.inferred+' cue durations estimated.':'');
  }catch(error){if(operation===mkvOperation)mkvStatus.textContent=String(error.message||error);}
  finally{if(operation===mkvOperation)mkvBusy(false);}
 });
 mkvCancel.addEventListener('click',()=>{++mkvOperation;window.MarmaladeEmbeddedSubtitles.cancel();mkvStatus.textContent='Extraction cancelled.';mkvBusy(false);});
 for(const event of ['marmalade:media-cleared','marmalade:video-selected','marmalade:library-video-selected'])window.addEventListener(event,mkvReset);
 mkvReset();
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
  if(notes[0])notes[0].remove();
  if(notes[1])notes[1].remove();
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
    posLabel.className='sub-note';posLabel.textContent='Position';
    position.before(posLabel);
  }
 }
 const timingRow=timing.querySelector('.subtitle-timing-row');
 const timingLabel=timingRow.querySelector('label');
 const timingCaption=document.createElement('div');timingCaption.className='sub-timing-label';
 const instruction=document.createElement('small');instruction.textContent='− Earlier · + Later';
 timingLabel.before(timingCaption);timingCaption.append(timingLabel,instruction);
 const reset=document.createElement('button');
 reset.type='button';reset.className='sub-timing-action';reset.id='subTimingReset';
 reset.textContent='Reset';reset.title='Reset subtitle timing to 0.0s';
 reset.addEventListener('click',()=>{window.MarmaladeSubtitleTiming?.reset?.();$('subtitleTiming').value='0.0';});
 // Center the Reset button itself in the space between the label and timing controls.
 timingRow.insertBefore(reset,timingRow.querySelector('.subtitle-timing-control'));
 // Secondary track controls live with timing so both languages can be aligned.
 const secondary=document.createElement('details');
 secondary.className='sub-more-filters';secondary.id='secondarySubtitleSettings';
 secondary.innerHTML='<summary>Secondary subtitles</summary><p class="sub-note" id="secondarySubtitleStatus" aria-live="polite">No secondary captions loaded</p>'+
   '<div class="sub-file-actions"><button type="button" id="loadSecondarySubtitle">Load File / ZIP</button><button type="button" id="clearSecondarySubtitle">Remove</button></div>'+
   '<input type="file" id="secondarySubtitleFile" accept=".srt,.vtt,.sub,.ass,.ssa,.sbv,.zip" hidden>'+
   '<label for="secondarySubtitleOffset">Secondary delay (seconds)</label><div class="sub-file-actions"><input id="secondarySubtitleOffset" type="number" min="-3600" max="3600" step="0.1" value="0.0" inputmode="decimal"><button type="button" id="secondarySubtitleReset">Reset</button></div>'+
   '<p class="sub-note">Secondary captions and their delay are saved on this device for this video.</p>';
 timing.append(secondary);
 $('secondarySubtitleFile').after(encodingRow('secondarySubtitleEncoding'));
 const secondaryStatus=$('secondarySubtitleStatus'),secondaryInput=$('secondarySubtitleFile'),secondaryOffset=$('secondarySubtitleOffset');
 const refreshSecondary=()=>{
   secondaryStatus.textContent=state.secondarySubtitleName||'No secondary captions loaded';
   secondaryOffset.value=Number(state.secondarySubtitleOffset||0).toFixed(1);
   $('clearSecondarySubtitle').disabled=!state.secondarySubtitles?.length;
 };
 $('loadSecondarySubtitle').addEventListener('click',()=>secondaryInput.click());
 secondaryInput.addEventListener('change',async()=>{
   const file=secondaryInput.files?.[0];secondaryInput.value='';
   if(!file)return;
   try{await window.MarmaladeSecondarySubtitle.load(file,{encoding:$('secondarySubtitleEncoding').value});}
   catch(error){secondaryStatus.textContent=String(error?.message||error);}
 });
 $('clearSecondarySubtitle').addEventListener('click',()=>window.MarmaladeSecondarySubtitle.clear());
 secondaryOffset.addEventListener('change',()=>{
   if(secondaryOffset.value.trim()!=='')window.MarmaladeSecondarySubtitle.setOffset(secondaryOffset.value);
   refreshSecondary();
 });
 $('secondarySubtitleReset').addEventListener('click',()=>window.MarmaladeSecondarySubtitle.setOffset(0));
 window.addEventListener('marmalade:secondary-subtitle-changed',refreshSecondary);refreshSecondary();
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
 expand.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
 expand.setAttribute('aria-label','Browse complete subtitle lines');
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
 const message=document.createElement('p');
 message.className='sub-cue-help';
 message.textContent='Tap the word just spoken. Word timing is estimated if the subtitle contains only line timestamps.';
 timing.append(cueTitle,cueSearchBar,selectedDisplay,cueList,more,count,message);
 let selectedCue=-1,matches=[],rendered=0,knownCues=null,filterFrame=0;
 let alignmentAnchor=null;
 const drift=document.createElement('details');drift.className='sub-more-filters';
 drift.innerHTML='<summary>Edition / Drift Alignment</summary><p class="sub-note">Pause on the start of a spoken line, select that line above, then capture the first point. Repeat at least 30 seconds later for the second point.</p><div class="sub-file-actions"><button type="button" id="subAnchorFirst">Set First Point</button><button type="button" id="subAnchorSecond">Set Second Point</button></div><p class="sub-note" id="subAnchorStatus" aria-live="polite"></p>';
 timing.append(drift);
 const reference=document.createElement('details');reference.className='sub-more-filters';
 reference.innerHTML='<summary>Align From Reference Subtitles</summary><p class="sub-note">Choose a same-language subtitle file already synchronized to this video. Review the suggested correction before applying.</p><div class="sub-file-actions"><button type="button" id="subReferenceChoose">Choose Reference</button><button type="button" id="subReferenceApply" disabled>Apply Correction</button></div><input type="file" id="subReferenceFile" accept=".srt,.vtt,.sub,.ass,.ssa,.sbv" hidden><p class="sub-note" id="subReferenceStatus" aria-live="polite"></p>';
 timing.append(reference);
 let referenceFit=null,referenceSequence=0;
 const referenceStatus=$('subReferenceStatus'),referenceApply=$('subReferenceApply');
 function clearReference(){referenceFit=null;++referenceSequence;referenceApply.disabled=true;referenceStatus.textContent='';}
 $('subReferenceChoose').addEventListener('click',()=>$('subReferenceFile').click());
 $('subReferenceFile').addEventListener('change',async()=>{
  const file=$('subReferenceFile').files?.[0];$('subReferenceFile').value='';
  clearReference();if(!file)return;
  const sequence=referenceSequence,cues=state.subtitles;
  if(!cues?.length){referenceStatus.textContent='Load primary subtitles first.';return;}
  try{
   if(file.size>5*1024*1024)throw Error('Reference file exceeds 5 MB.');
   const codec=window.MarmaladeSubtitleCodec;
   const decoded=codec.decode(codec.decodeBytes(await file.arrayBuffer()),file.name);
   if(!decoded.cues.length)throw Error(decoded.error||'No readable reference captions.');
   if(sequence!==referenceSequence||state.subtitles!==cues)return;
   const fit=codec.referenceAlignment(cues,decoded.cues);
   if(!fit){referenceStatus.textContent='Not enough consistent dialogue. Try another reference or two-point alignment.';return;}
   referenceFit={...fit,cues};referenceApply.disabled=false;
   referenceStatus.textContent=fit.matched+' of '+fit.total+' matching lines agree over '+Math.round(fit.span)+' seconds. Delay '+fit.seconds.toFixed(1)+' s · Duration '+(fit.scale*100).toFixed(3)+'%. Review before applying.';
  }catch(error){if(sequence===referenceSequence)referenceStatus.textContent=String(error.message||error);}
 });
 referenceApply.addEventListener('click',()=>{
  if(!referenceFit||referenceFit.cues!==state.subtitles)return clearReference();
  if(window.MarmaladeSubtitleTiming.set(referenceFit.seconds,referenceFit.scale)){
   referenceFit=null;referenceApply.disabled=true;referenceStatus.textContent='Correction applied. Check movie dialogue; Reset restores original timing.';
  }
 });
 const anchorStatus=$('subAnchorStatus');
 function refreshAnchor(){
  const scale=window.MarmaladeSubtitleTiming?.getScale?.()||1;
  anchorStatus.textContent=(alignmentAnchor?'First point: '+formatTime(alignmentAnchor.cue)+' → '+formatTime(alignmentAnchor.movie)+' · ':'')+'Subtitle duration: '+(scale*100).toFixed(3)+'%';
  $('subAnchorSecond').disabled=!alignmentAnchor;
 }
 function selectedAnchor(){
  const cue=state.subtitles?.[selectedCue],movie=currentBaseTime();
  return cue&&Number.isFinite(movie)&&movie>=0?{cue:cue.start,movie}:null;
 }
 $('subAnchorFirst').addEventListener('click',()=>{
  const point=selectedAnchor();if(!point){anchorStatus.textContent='Choose a subtitle line first.';return;}
  alignmentAnchor=point;refreshAnchor();
 });
 $('subAnchorSecond').addEventListener('click',()=>{
  const second=selectedAnchor();
  if(!alignmentAnchor||!second||!window.MarmaladeSubtitleTiming.align(alignmentAnchor,second)){
   anchorStatus.textContent='Choose a later line at least 30 seconds after the first; correction must be within 80–125%.';return;
  }
  alignmentAnchor=null;refreshAnchor();
 });
 refreshAnchor();
 
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
  // Timing is reflected by the editable delay field; no duplicate clock readout.
 }
 // Segment words in logical (spoken) order, never reverse the source text.
 const rtlLanguage=/^(ar|ara|fa|fas|per|he|heb|ur|urd|ps|pus|yi|yid|sd|snd|dv|uig|ug)(?:-|$)/i;
 const aliases={ara:'ar',fas:'fa',per:'fa',heb:'he',urd:'ur',eng:'en',zho:'zh',chi:'zh',jpn:'ja',kor:'ko',tha:'th',ind:'id',rus:'ru',hin:'hi',ben:'bn',spa:'es',fra:'fr',fre:'fr'};
 function wordParts(text,language){
  let locale=String(language||'').toLowerCase().replace(/_/g,'-');locale=aliases[locale]||locale;
  let parts;
  try{parts=[...new Intl.Segmenter(locale||undefined,{granularity:'word'}).segment(text)].filter(part=>part.isWordLike).map(part=>({text:part.segment,index:part.index}));}
  catch{parts=[...text.matchAll(/\S+/gu)].map(part=>({text:part[0],index:part.index}));}
  return parts.length?parts:[{text,index:0}];
 }
 function cueDirection(text,language){
  // Explicit active subtitle language wins over an opening foreign name.
  const lang=String(language||'').trim().replace(/_/g,'-');
  if(rtlLanguage.test(lang))return 'rtl';
  if(/^(?:en|eng|fr|fra|fre|es|spa|de|deu|ger|it|ita|pt|por|ru|rus|id|ind|ms|msa|tr|tur|ja|jpn|ko|kor|zh|zho|chi|th|tha|hi|hin|bn|ben|ta|tam|vi|vie)(?:-|$)/i.test(lang))return 'ltr';
  const first=[...text].find(ch=>/\p{L}/u.test(ch));
  return first&&/[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Adlam}]/u.test(first)?'rtl':'ltr';
 }
 function exactWordTime(cue,parts,index){
  const part=parts[index];
  if(!part)return null;
  const word=cue.words?.[index];
  if(Number.isFinite(word?.start)&&word.text===part.text)return word.start;
  const marker=cue.markers?.find(m=>m.index===part.index);
  return Number.isFinite(marker?.start)?marker.start:null;
 }
 function estimateWordTime(cue,parts,index){
  // SRT and most other sources timestamp whole cues. Distribute word
  // starts by grapheme-weighted spoken length, not UTF-16 code units.
  let segmenter;try{segmenter=new Intl.Segmenter(undefined,{granularity:'grapheme'});}catch{}
  const weights=parts.map(p=>Math.max(1,segmenter?[...segmenter.segment(p.text)].length:[...p.text].length));
  const total=weights.reduce((a,b)=>a+b,0)||1;
  const elapsed=weights.slice(0,index).reduce((a,b)=>a+b,0);
  const exact=exactWordTime(cue,parts,index);
  if(Number.isFinite(exact))return exact;
  // Interpolate between adjacent explicit boundaries when present, rather
  // than estimating against the entire cue and ignoring known timings.
  const boundaries=[{index:0,start:cue.start},...(cue.markers||[]),{index:cue.text.length,start:cue.end}];
  const position=parts[index].index;
  let left=boundaries[0],right=boundaries.at(-1);
  for(const boundary of boundaries){if(boundary.index<=position)left=boundary;else{right=boundary;break;}}
  if(cue.markers?.length&&right.index>left.index){
   return left.start+(right.start-left.start)*(position-left.index)/(right.index-left.index);
  }
  return cue.start+(cue.end-cue.start)*elapsed/total;
 }
 function alignAt(cueTime){
  const desired=currentBaseTime()-cueTime*(window.MarmaladeSubtitleTiming?.getScale?.()||1);
  if(window.MarmaladeSubtitleTiming?.set?.(desired)){
   window.MarmaladeSubtitleRefresh?.();
   return true;
  }
  return false;
 }
 function selectedLine(){
  const cue=state.subtitles?.[selectedCue];
  selectedDisplay.replaceChildren();
  if(!cue){selectedDisplay.textContent='No subtitle line selected.';return;}
  const text=cueText(cue),language=state.subtitleLanguage||'';
  selectedDisplay.dir=cueDirection(text,language);
  const parts=wordParts(text,language);
  parts.forEach((part,index)=>{
   const word=document.createElement('button');word.type='button';word.className='sub-word';
   word.textContent=part.text;word.dir='auto';word.setAttribute('aria-pressed','false');
   const exact=exactWordTime(cue,parts,index);
   word.title=Number.isFinite(exact)?'Align using subtitle timestamp':'Align using estimated word timing';
   word.addEventListener('click',()=>{
    if(state.subtitles?.[selectedCue]!==cue)return;
    if(alignAt(estimateWordTime(cue,parts,index))){
     selectedDisplay.querySelectorAll('.sub-word').forEach(b=>b.setAttribute('aria-pressed',String(b===word)));
    }
   });
   selectedDisplay.append(word);
  });
 }
 window.MarmaladeSubtitleWordAlignment={wordParts,cueDirection,estimateWordTime,exactWordTime};
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
  matches=window.MarmaladeSubtitleCodec.searchDialogue(cues,cueSearch.value);
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
  knownCues=cues;alignmentAnchor=null;refreshAnchor();clearReference();
  if(!cues.length){
   selectedCue=-1;cueSearch.value='';matches=[];cueList.replaceChildren();
   count.textContent='Load a subtitle file to choose a line.';
   closeList();selectedLine();showTiming();return;
  }
  const base=(currentBaseTime()-(Number(state.subtitleOffsetSeconds)||0))/(window.MarmaladeSubtitleTiming?.getScale?.()||1);
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
 window.addEventListener('marmalade:subtitles-loaded',()=>refreshCueOptions({force:true}));
 window.addEventListener('marmalade:media-cleared',()=>{
  knownCues=null;selectedCue=-1;cueSearch.value='';refreshCueOptions({force:true});
 });
 window.addEventListener('marmalade:subtitle-timing-changed',()=>{showTiming();refreshAnchor();});
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
