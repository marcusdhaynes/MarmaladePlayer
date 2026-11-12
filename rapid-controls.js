/* Marmalade · one-touch recent video, room codes, VPN TURN diagnostics and native invitations. */
(()=>{
 'use strict';
 const bridge=window.MarmaladeAddonBridge,layout=window.MarmaladeSettingsLayout;
 if(!bridge||!layout)return;
 const {state,el}=bridge,$=id=>document.getElementById(id);
 const party=$('settingsPageParty'),stack=party?.querySelector('.settings-stack');
 if(!stack)return;
 const card=document.createElement('section');
 card.className='rapid-room-card';card.id='rapidRoomCard';card.setAttribute('aria-label','Watch party');
 card.innerHTML='<div class="rapid-room-head"><strong>Watch Party</strong><span class="rapid-room-status" id="rapidRoomStatus">Ready</span></div>'+
  '<div class="rapid-role-switch" aria-label="My role"><button id="rapidRoleHost" type="button" aria-pressed="true">Host</button><button id="rapidRoleGuest" type="button" aria-pressed="false">Guest</button></div>'+
  '<div id="rapidHostCode"><div class="rapid-room-code"><output id="rapidCode" aria-label="Your host room code">Not generated</output><button id="rapidCopyCode" type="button" title="Copy room code">Copy</button></div>'+
  '<button id="rapidCreateRoom" type="button" class="rapid-create-room" hidden>Generate Room Code</button>'+
  '<p class="rapid-room-hint">Send the code or share your invitation link. Your room is active while the host remains connected.</p></div>'+
  '<div id="rapidGuestCode" hidden><div class="rapid-join-row"><input id="rapidJoinCode" aria-label="Enter host code or link" maxlength="2048" autocomplete="off" spellcheck="false" placeholder="Room code or invitation link"><button id="rapidJoinNow" type="button">Join</button></div>'+
  '<p class="rapid-room-hint">Paste a room code or invitation. Joining works like the shared link.</p></div>';
 party.insertBefore(card,stack);
 const roleHost=$('rapidRoleHost'),roleGuest=$('rapidRoleGuest');
 const joinEntry=$('rapidJoinCode'),copy=$('rapidCopyCode'),codeOutput=$('rapidCode'),create=$('rapidCreateRoom'),join=$('rapidJoinNow');
 function update(){
   const host=state.role==='host';
   roleHost.setAttribute('aria-pressed',String(host));
   roleGuest.setAttribute('aria-pressed',String(!host));
   $('rapidHostCode').hidden=!host;$('rapidGuestCode').hidden=host;
   const connected=host?!!state.peer?.open&&!state.peer.disconnected&&!state.peer.destroyed:!!state.guestConn?.open;
   card.dataset.ready=String(connected);
   $('rapidRoomStatus').textContent=connected?(host?'Online':'Connected'):state.connecting?'Connecting…':'Not connected';
   codeOutput.textContent=state.code||'Not generated';
   codeOutput.title=state.code||'Create a room code to invite guests';
   copy.disabled=!state.code||!connected;
   create.hidden=!!state.code||state.connecting;
   join.disabled=state.connecting;
 }
 roleHost.addEventListener('click',()=>{
   if(state.role==='host')return;
   el.hostTab.click();requestAnimationFrame(()=>{
     if(el.settingsPanel.hidden)el.settingsBtn.click();
     layout.activate('party');update();
   });
 });
 roleGuest.addEventListener('click',()=>{
   if(state.role==='guest')return;
   el.joinTab.click();requestAnimationFrame(()=>{
     if(el.settingsPanel.hidden)el.settingsBtn.click();
     layout.activate('party');update();joinEntry.focus();
   });
 });
 create.addEventListener('click',()=>{el.createRoom.click();update();});
 copy.addEventListener('click',async()=>{
   if(!state.code)return;
   try{await navigator.clipboard.writeText(state.code);copy.textContent='Copied';}
   catch{copy.textContent='Select';const selection=window.getSelection();selection?.removeAllRanges();
     const range=document.createRange();range.selectNodeContents(codeOutput);selection?.addRange(range);}
   setTimeout(()=>{copy.textContent='Copy';},1400);
 });
 function submitJoin(){
   const raw=joinEntry.value.trim();
   if(!raw){joinEntry.focus();return;}
   // Convert to the existing join path, which handles full links and both
   // legacy 8-symbol and new 12-symbol codes.
   el.joinInput.value=raw;
   if(state.role!=='guest')el.joinTab.click();
   el.joinRoom.click();
   update();
 }
 join.addEventListener('click',submitJoin);
 joinEntry.addEventListener('keydown',event=>{
   if(event.key==='Enter'){event.preventDefault();submitJoin();}
 });
 joinEntry.addEventListener('input',()=>{if(state.role==='guest')el.joinInput.value=joinEntry.value;});
 const turn=document.createElement('details');
 turn.className='rapid-turn';turn.id='rapidTurn';turn.innerHTML=
   '<summary>VPN / Restricted Network Relay</summary>'+
   '<p class="rapid-turn-tip">Some VPNs block direct peer connections. A working TURN relay is required on those networks. Configure it on each device before joining.</p>'+
   '<div class="rapid-turn-fields">'+
   '<label>TURN address<input id="rapidTurnUrl" type="text" maxlength="250" placeholder="turns:relay.example.com:5349"></label>'+
   '<label>Username<input id="rapidTurnUser" type="text" maxlength="200" autocomplete="off" placeholder="Username"></label>'+
   '<label>Password<input id="rapidTurnPassword" type="password" maxlength="300" autocomplete="off" placeholder="Credential"></label>'+
   '<label class="rapid-turn-force"><input id="rapidTurnForce" type="checkbox"> Force relay (VPN only)</label>'+
   '<button id="rapidTurnSave" class="rapid-turn-save" type="button">Apply To Next Connection</button>'+
   '<p class="rapid-turn-tip" style="grid-column:1/-1" id="rapidTurnStatus" aria-live="polite">Public STUN servers are available. TURN requires real credentials.</p></div>';
 party.querySelector('#settingsAdvanced')?.appendChild(turn);
 const getSession=k=>{try{return sessionStorage.getItem('marmalade:'+k)||'';}catch{return '';}};
 const putSession=(k,value)=>{try{if(value)sessionStorage.setItem('marmalade:'+k,value);
    else sessionStorage.removeItem('marmalade:'+k);}catch{}};
 $('rapidTurnUrl').value=getSession('turn-relay-url');
 $('rapidTurnUser').value=getSession('turn-relay-user');
 $('rapidTurnPassword').value=getSession('turn-relay-password');
 $('rapidTurnForce').checked=getSession('turn-force-relay')==='true';
 $('rapidTurnSave').addEventListener('click',()=>{
   const url=$('rapidTurnUrl').value.trim(),user=$('rapidTurnUser').value.trim();
   const pass=$('rapidTurnPassword').value;
   if(url&&!/^(?:turn|turns):[A-Za-z0-9.:[\]-]+(?::\d{1,5})?(?:\?transport=(?:tcp|udp))?$/.test(url)){
     $('rapidTurnStatus').textContent='Enter a valid turn: or turns: address with no spaces.';return;
   }
   if(url&&(!user||!pass)){
     $('rapidTurnStatus').textContent='This relay requires both a username and password.';return;
   }
   for(const [key,value] of [
     ['turn-relay-url',url],['turn-relay-user',url?user:''],
     ['turn-relay-password',url?pass:''],
     ['turn-force-relay',url&&$('rapidTurnForce').checked?'true':'']
   ])putSession(key,value);
   window.MarmaladeConfigureIce?.();
   $('rapidTurnStatus').textContent=url?
     'Relay configured for the next room/guest connection. Reconnect if already online.':
     'Custom relay cleared. Public STUN only; restrictive VPNs may still block streaming.';
 });
 const quickJoin=document.createElement('button');
 quickJoin.id='rapidQuickJoin';quickJoin.type='button';quickJoin.className='rapid-join-entry';
 quickJoin.textContent='Have a code? Join a room';quickJoin.setAttribute('data-no-video-toggle','true');
 quickJoin.addEventListener('click',event=>{
   event.stopPropagation();event.preventDefault();
   if(state.role!=='guest')el.joinTab.click();
   if(el.settingsPanel.hidden)el.settingsBtn.click();
   layout.activate('party');update();requestAnimationFrame(()=>joinEntry.focus());
 });
 $('stageEmpty')?.appendChild(quickJoin);
 const recentButton=document.createElement('button');
 recentButton.id='rapidResumeLast';recentButton.type='button';recentButton.className='rapid-resume';
 recentButton.setAttribute('data-no-video-toggle','true');recentButton.hidden=true;
 recentButton.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.7-6M4 4v5h5"/><path d="m10 8 6 4-6 4V8Z"/></svg><span>Resume Last Video</span>';
 const missing=document.createElement('small');
 missing.id='rapidLastMissing';missing.hidden=true;missing.className='rapid-last-missing';
 $('stageSubtitle')?.after(recentButton,missing);
 const LAST_DB='marmalade-recent-video';
 let last=null,choosingLast=false;
 const database=()=>new Promise((resolve,reject)=>{
   const request=indexedDB.open(LAST_DB,1);
   request.onupgradeneeded=()=>request.result.createObjectStore('recents');
   request.onsuccess=()=>resolve(request.result);
   request.onerror=()=>reject(request.error);
 });
 async function store(mode,value){
   const db=await database();
   try{return await new Promise((resolve,reject)=>{
      const tx=db.transaction('recents',mode==='read'?'readonly':'readwrite');
      const req=mode==='read'?tx.objectStore('recents').get('latest'):
         tx.objectStore('recents').put(value,'latest');
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error);
   });}finally{db.close();}
 }
 function reflectRecent(){
   recentButton.hidden=!last||state.role!=='host';
   if(!last)return;
   recentButton.querySelector('span').textContent='Resume '+last.name.slice(0,37)+(last.name.length>37?'…':'');
   recentButton.title=last.handle?'Reopen and resume the last video':'Re-select the last video to resume';
 }
 window.addEventListener('marmalade:video-selected',async event=>{
   const file=event.detail?.file;
   if(!file||state.role!=='host')return;
   last={name:file.name,size:file.size,lastModified:file.lastModified||0,
     handle:event.detail.handle||null,updated:Date.now()};
   reflectRecent();
   try{await store('write',last);}
   catch{
     // Some native WebViews cannot clone FileSystemFileHandle; preserve metadata.
     last.handle=null;
     try{await store('write',last);}catch{}
   }
   missing.hidden=true;
 });
 async function verifyAndOpen(file,handle=null){
   if(!last||!file)return;
   if(file.name!==last.name||file.size!==last.size){
     missing.textContent='That is not the last video ('+last.name+'). Choose the matching file.';
     missing.hidden=false;bridge.notify('Last video mismatch. Select the original file.');
     return;
   }
   missing.hidden=true;
   state.lastOpenedHandle=handle||null;
   bridge.chooseVideo(file);
 }
 recentButton.addEventListener('click',async event=>{
   event.stopPropagation();event.preventDefault();
   if(!last||state.role!=='host')return;
   if(last.handle){
     try{
       let perm=await last.handle.queryPermission({mode:'read'});
       if(perm!=='granted')perm=await last.handle.requestPermission({mode:'read'});
       if(perm!=='granted')throw Error('File permission is not granted');
       await verifyAndOpen(await last.handle.getFile(),last.handle);
       return;
     }catch(error){
       last.handle=null;
       missing.textContent='Last video is no longer accessible. Re-select '+last.name+'.';
       missing.hidden=false;
       try{await store('write',last);}catch{}
     }
   }
   choosingLast=true;
   if(typeof window.showOpenFilePicker==='function'){
     try{
       const [handle]=await window.showOpenFilePicker({multiple:false});
       if(handle)await verifyAndOpen(await handle.getFile(),handle);
       choosingLast=false;return;
     }catch(error){if(error?.name==='AbortError'){choosingLast=false;return;}}
   }
   el.fileInput.click();
 });
 el.fileInput.addEventListener('change',event=>{
   if(!choosingLast)return;
   choosingLast=false;
   const file=event.target.files?.[0];
   if(!file)return;
   if(!last||file.name!==last.name||file.size!==last.size){
     event.stopImmediatePropagation();
     missing.textContent='Incorrect file. The previous video was '+(last?.name||'unknown')+'.';
     missing.hidden=false;
     bridge.notify('Please select the matching previous movie file.');
     event.target.value='';
   }else missing.hidden=true;
 },true);
 void store('read').then(record=>{if(record?.name&&Number.isFinite(record?.size)){last=record;reflectRecent();}}).catch(()=>{});
 // Nonintrusive web-to-app fallback. Verified Android App Links can launch
 // automatically; the explicit link works for unverified/debug builds too.
 const query=new URLSearchParams(location.search).get('room')||'';
 if(/Android/i.test(navigator.userAgent)&&!window.Capacitor?.isNativePlatform?.()&&
   /^(?:[A-Z2-9]{8}|[A-Z2-9]{12})$/i.test(query)){
   const appOpen=document.createElement('button');
   appOpen.id='rapidOpenNative';appOpen.type='button';appOpen.className='rapid-join-entry';
   appOpen.textContent='Open Invitation in MarmaladePlayer App';
   appOpen.addEventListener('click',event=>{
     event.stopPropagation();location.href='marmaladeplayer://join/'+encodeURIComponent(query.toUpperCase());
   });
   $('stageEmpty')?.append(appOpen);
 }
 // Keep these views in sync with existing private host/guest state changes.
 setInterval(()=>{if(!el.settingsPanel.hidden)update();
   if(el.stage.classList.contains('has-video'))return;
   reflectRecent();
 },750);
 update();reflectRecent();
 window.MarmaladeRapidControls={updateRoom:update,reflectRecent};
})();
