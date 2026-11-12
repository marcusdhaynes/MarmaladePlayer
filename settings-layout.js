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
 const subtitleLink=document.createElement('button');
 subtitleLink.type='button';subtitleLink.id='settingsSubtitleShortcut';
 subtitleLink.className='settings-action-row';
 subtitleLink.innerHTML='<span>Subtitles</span><span>Find &amp; Style <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg></span>';
 subtitleLink.addEventListener('click',()=>$('subtitlesBtn')?.click());
 pages.get('video').querySelector('.settings-stack').appendChild(subtitleLink);
 into('skipInterval','controls');
 into('controlFadeDelay','controls');
 const keyboard=document.createElement('div');
 keyboard.className='settings-shortcuts';
 keyboard.innerHTML='<span>Keyboard</span><span><kbd>Space</kbd> Play / Pause <em>·</em> <kbd>←</kbd> <kbd>→</kbd> Skip</span>';
 pages.get('controls').appendChild(keyboard);
 into('stabilityMode','party');
 for(const id of ['strictSync','peerAssist','hostMatchRow']){
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
 const hostSync=$('hostSyncSettings');
 if(hostSync){hostSync.classList.add('settings-monitor');pages.get('party').appendChild(hostSync);}
 const advanced=document.createElement('details');
 advanced.id='settingsAdvanced';advanced.className='settings-advanced';
 const summary=document.createElement('summary');
 summary.innerHTML='Advanced <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
 advanced.appendChild(summary);
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
 activate(restore(),{persist:false});
 window.MarmaladeSettingsLayout={activate,active:()=>active,panes:tabs.slice()};
})();
