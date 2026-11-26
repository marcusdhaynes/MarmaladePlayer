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
   '<p class="rapid-turn-tip">Direct connections are tried automatically. Managed TURN is used when configured by the deployment. Restricted VPNs may need authenticated TURN over TLS/TCP 443. Manual routes are optional.</p>'+
   '<div class="rapid-turn-fields">'+
   '<label>TURN addresses<input id="rapidTurnUrl" type="text" maxlength="1200" placeholder="turns:relay.example.com:443?transport=tcp"></label>'+
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
   if(url&&!url.split(/[\s,;]+/).filter(Boolean).every(item=>/^(?:turn|turns):[A-Za-z0-9.:[\]-]+(?::\d{1,5})?(?:\?transport=(?:tcp|udp))?$/.test(item))){
     $('rapidTurnStatus').textContent='Enter valid turn: or turns: addresses separated by commas or spaces.';return;
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
     'Custom relay cleared. Managed TURN is used if configured; otherwise direct STUN routes only.';
 });
 const LAST_ROOM_KEY='marmalade:last-joined-room-code';
 const lastJoinedRoom=()=>{
   try{
     const code=localStorage.getItem(LAST_ROOM_KEY)||'';
     return /^(?:[A-Z2-9]{8}|[A-Z2-9]{12})$/.test(code)?code:'';
   }catch{return '';}
 };
 const quickJoin=document.createElement('button');
 quickJoin.id='rapidQuickJoin';quickJoin.type='button';quickJoin.className='rapid-join-entry';
 quickJoin.textContent='Rejoin Last Room';quickJoin.setAttribute('data-no-video-toggle','true');
 quickJoin.title='Rejoin the most recently connected room';
 quickJoin.addEventListener('click',event=>{
   event.stopPropagation();event.preventDefault();
   const code=lastJoinedRoom();
   if(!code){bridge.notify('No previous joined room was found.');return;}
   if(state.role==='guest'&&state.guestConn?.open){
     bridge.notify('Already connected to room '+state.code+'.');return;
   }
   if(state.connecting){bridge.notify('A room connection is already in progress.');return;}
   if(state.role!=='guest')el.joinTab.click();
   el.joinInput.value=code;joinEntry.value=code;
   el.joinRoom.click();
   bridge.notify('Rejoining last room '+code+'…');
 });
 window.addEventListener('marmalade:room-joined',event=>{
   if(event.detail?.code)quickJoin.title='Rejoin room '+event.detail.code;
 });
 window.addEventListener('marmalade:room-join-unavailable',event=>{
   if(event.detail?.code!==lastJoinedRoom())return;
   quickJoin.title='Last room is not currently available';
   bridge.notify('The last room is not available right now.');
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
 let last=null,choosingLast=false,positionWriteAt=0;
 const media=bridge.media, webview=window.chrome?.webview;
 // The browser will only remember an opaque File or FileSystemFileHandle
 // explicitly selected by the user. JavaScript never supplies a disk path.
 const rememberNative=(file,handle)=>{
   if(typeof webview?.postMessageWithAdditionalObjects!=='function')return;
   try{webview.postMessageWithAdditionalObjects(
     {minternetMarmalade:'remember'},[file]);}
   catch(error){console.debug('Native media bookmarking unavailable',error);}
 };
 const reopenNative=handle=>{
   if(typeof webview?.postMessage!=='function'||!webview.addEventListener)
     return Promise.resolve(null);
   return new Promise(resolve=>{
     let complete=false,timeout;
     const finish=value=>{
       if(complete)return;
       complete=true;clearTimeout(timeout);
       webview.removeEventListener('message',listener);resolve(value);
     };
     const listener=event=>{
       if(event.data?.minternetMarmalade==='resume-result')
         finish({status:event.data.status,handle:event.additionalObjects?.[0]||null});
     };
     webview.addEventListener('message',listener);
     timeout=setTimeout(()=>finish(null),3500);
     try{
       if(handle&&typeof webview.postMessageWithAdditionalObjects==='function'){
         try{webview.postMessageWithAdditionalObjects({minternetMarmalade:'recover'},[handle]);}
         catch{
           // WebView2 accepts File additionalObjects on older runtimes, but
           // not always FileSystemFileHandle. Fall back to the native saved path.
           webview.postMessage({minternetMarmalade:'resume'});
         }
       }else webview.postMessage({minternetMarmalade:'resume'});
     }catch{finish(null);}
   });
 };
 const savePosition=()=>{
   if(!last||state.role!=='host')return;
   if(state.source==='native'){
     if(last.source!=='native'||last.nativeKey!==state.nativeMediaKey)return;
   }else if(state.source!=='file'||last.source==='native')return;
   const time=Number(media.currentTime);
   if(!Number.isFinite(time)||time<0)return;
   last.positionSeconds=time;
   if(Date.now()-positionWriteAt>4000){
     positionWriteAt=Date.now();void store('write',last).catch(()=>{});
   }
 };
 media.addEventListener('timeupdate',savePosition,{passive:true});
 media.addEventListener('pause',()=>{
   savePosition();if(last)void store('write',last).catch(()=>{});
 });
 window.addEventListener('pagehide',()=>{
   savePosition();if(last)void store('write',last).catch(()=>{});
 });
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
   recentButton.title=last.source==='native'?
     'Reopen this video directly from its saved Minternet Media Library folder':
     last.handle?'Reopen the saved video without file selection':
     'Previous browser selection did not preserve the original path';
 }
 window.addEventListener('marmalade:video-selected',async event=>{
   const file=event.detail?.file;
   if(!file||state.role!=='host')return;
   const previous=last;
   last={name:file.name,size:file.size,lastModified:file.lastModified||0,
     handle:event.detail.handle||null,updated:Date.now(),
     positionSeconds:previous?.name===file.name&&previous?.size===file.size?
       Math.max(0,Number(previous.positionSeconds)||0):0};
   rememberNative(file,event.detail.handle||null);
   reflectRecent();
   try{await store('write',last);}
   catch{
     // Some native WebViews cannot clone FileSystemFileHandle; preserve metadata.
     last.handle=null;
     try{await store('write',last);}catch{}
   }
   missing.hidden=true;
 });
 window.addEventListener('marmalade:library-video-selected',event=>{
   const {name,size,itemId,key}=event.detail||{};
   if(!name||!itemId||!key||state.role!=='host')return;
   const previous=last;
   last={source:'native',name:String(name),size:Number(size)||0,
     nativeItemId:String(itemId),nativeKey:String(key),updated:Date.now(),
     positionSeconds:previous?.source==='native'&&previous?.nativeItemId===itemId?
       Math.max(0,Number(previous.positionSeconds)||0):0};
   reflectRecent();
   void store('write',last).catch(error=>console.debug('Native resume record unavailable',error));
   missing.hidden=true;
 });
 async function resumeNativeMedia(){
   const api=window.MinternetMediaLibrary;
   if(typeof api?.getCatalog!=='function'||typeof bridge.chooseNativeStream!=='function'){
     missing.textContent='Minternet Media Server extension is not active. Update Minternet or enable the extension.';
     missing.hidden=false;bridge.notify(missing.textContent);return false;
   }
   const catalog=await api.getCatalog();
   const item=(catalog?.libraries||[]).flatMap(l=>l.items||[])
     .find(i=>i.id===last.nativeItemId);
   if(!item?.url){
     missing.textContent='That video is not available in the saved media library. Reconnect its drive or rescan.';
     missing.hidden=false;bridge.notify(missing.textContent);return false;
   }
   const resumeAt=Math.max(0,Number(last.positionSeconds)||0);
   media.addEventListener('loadedmetadata',()=>{
     if(resumeAt>.2&&Number.isFinite(media.duration)&&media.duration>0){
       try{media.currentTime=Math.min(resumeAt,Math.max(0,media.duration-.25));}catch{}
     }
     void media.play().catch(()=>bridge.notify('Video loaded. Press Play to resume.'));
   },{once:true});
   const ready=bridge.chooseNativeStream({url:item.url,name:item.name||last.name,
     size:item.size,id:item.id});
   if(!ready)throw Error('Could not open saved library video.');
   missing.hidden=true;return true;
 }
 async function verifyAndOpen(file,handle=null){
   if(!last||!file)return false;
   if(file.name!==last.name||file.size!==last.size){
     missing.textContent='The file at the saved location differs from '+last.name+'.';
     missing.hidden=false;bridge.notify('Saved video mismatch; original file required.');
     return false;
   }
   missing.hidden=true;
   locateButton.hidden=true;
   const resumeAt=Math.max(0,Number(last.positionSeconds)||0);
   state.lastOpenedHandle=handle||null;
   media.addEventListener('loadedmetadata',()=>{
     if(resumeAt>.2&&Number.isFinite(media.duration)&&media.duration>0){
       try{media.currentTime=Math.min(resumeAt,Math.max(0,media.duration-.25));}
       catch(error){console.debug('Saved position unavailable',error);}
     }
     // Resume is an explicit request to play; broadcast toggling is not.
     void media.play().catch(()=>bridge.notify('Video loaded. Press Play to resume.'));
   },{once:true});
   bridge.chooseVideo(file);return true;
 }
 const locateButton=document.createElement('button');
 locateButton.id='rapidLocateMissing';locateButton.type='button';
 locateButton.className='rapid-join-entry';locateButton.textContent='Locate Missing Video';
 locateButton.hidden=true;locateButton.setAttribute('data-no-video-toggle','true');
 missing.after(locateButton);
 async function locateMissingFile(){
   choosingLast=true;
   if(typeof window.showOpenFilePicker==='function'){
     try{
       const [handle]=await window.showOpenFilePicker({multiple:false});
       if(handle)await verifyAndOpen(await handle.getFile(),handle);
     }catch(error){
       if(error?.name!=='AbortError'){
         // The picker may require a fresh user gesture after async missing-file
         // verification. Keep an explicit Locate button visible for retry.
         locateButton.hidden=false;
       }
     }finally{choosingLast=false;}
   }else{
     // Keep choosingLast until the legacy input actually fires a change event.
     el.fileInput.click();
   }
 }
 locateButton.addEventListener('click',event=>{
   event.stopPropagation();event.preventDefault();
   void locateMissingFile();
 });
 recentButton.addEventListener('click',async event=>{
   event.stopPropagation();event.preventDefault();
   if(!last||state.role!=='host'||recentButton.disabled)return;
   recentButton.disabled=true;locateButton.hidden=true;missing.hidden=true;
   try{
     if(last.source==='native'){
       await resumeNativeMedia();
       return;
     }
     // Reauthorize a retained file handle while the Resume click is active.
     // Browsers cannot bypass permission revocation.
     if(last.handle){
       try{
         let permission=await last.handle.queryPermission?.({mode:'read'});
         if(permission==='prompt'&&last.handle.requestPermission)permission=await last.handle.requestPermission({mode:'read'});
         if(permission==='granted'&&await verifyAndOpen(await last.handle.getFile(),last.handle))return;
       }catch(error){console.debug('Saved file access unavailable',error);}
     }
     // Native hosts may reopen a previously verified, persistent file path.
     const native=await reopenNative(last.handle||null);
     if(native?.status==='ok'&&native.handle){
       try{
         if(await verifyAndOpen(await native.handle.getFile(),native.handle))return;
       }catch(error){console.debug('Native file access fallback',error);}
     }
     if(native?.status==='missing'){
       missing.textContent='The saved video is missing from its previous location: '+last.name+'.';
       missing.hidden=false;locateButton.hidden=false;
       bridge.notify('Last video was not found. Locate it to continue.');
       await locateMissingFile();return;
     }
     // Other browsers may require reauthorization after a restart.
     if(!last.handle){
       missing.textContent='This browser did not preserve the local file grant. Restore access to the saved video to resume.';
       missing.hidden=false;locateButton.hidden=false;locateButton.textContent='Restore File Access';return;
     }
     let file;
     try{file=await last.handle.getFile();}
     catch(error){
       if(error?.name==='NotFoundError'){
         missing.textContent='Saved video not found: '+last.name+'.';
         missing.hidden=false;locateButton.hidden=false;
         await locateMissingFile();return;
       }
       if(error?.name==='NotAllowedError'||error?.name==='SecurityError'){
         const granted=await last.handle.requestPermission?.({mode:'read'});
         if(granted!=='granted'){
           missing.textContent='This browser revoked saved-file access; the movie was not reported missing. Restore access to resume.';
           missing.hidden=false;locateButton.hidden=false;locateButton.textContent='Restore File Access';return;
         }
         file=await last.handle.getFile();
       }else throw error;
     }
     await verifyAndOpen(file,last.handle);
   }catch(error){
     missing.textContent='Unable to resume saved video: '+
       String(error?.message||'access unavailable')+'.';
     missing.hidden=false;
   }finally{recentButton.disabled=false;choosingLast=false;}
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
