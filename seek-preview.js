/* Marmalade timeline thumbnails. Never seeks or pauses the real player.
   On-demand, low-resolution previews; no pre-encoding, uploading or autoplay. */
(()=>{
 'use strict';
 const bridge=window.MarmaladeAddonBridge;
 if(!bridge)return;
 const {state,media,el}=bridge,seek=el.seek;
 const stack=seek?.parentElement;
 if(!stack)return;
 const card=document.createElement('div');
 card.id='seekPreview';card.className='seek-preview';card.hidden=true;
 card.setAttribute('aria-hidden','true');
 const canvas=document.createElement('canvas');
 canvas.id='seekPreviewCanvas';canvas.width=192;canvas.height=108;canvas.hidden=true;
 const stamp=document.createElement('output');
 stamp.className='seek-preview-time';stamp.id='seekPreviewTime';
 const status=document.createElement('small');
 status.className='seek-preview-status';status.id='seekPreviewStatus';
 status.textContent='Loading scene…';
 card.append(canvas,stamp,status);stack.append(card);
 const context=canvas.getContext('2d',{alpha:false});
 const scratch=document.createElement('canvas');
 scratch.width=192;scratch.height=108;
 const scratchContext=scratch.getContext('2d',{alpha:false,willReadFrequently:false});
 const preview=document.createElement('video');
 preview.id='seekPreviewDecoder';preview.muted=true;preview.playsInline=true;
 preview.preload='metadata';preview.controls=false;
 preview.setAttribute('aria-hidden','true');
 preview.tabIndex=-1;
 preview.style.cssText='position:absolute;left:-10000px;top:-10000px;width:1px;height:1px;visibility:hidden;pointer-events:none';
 // Keep the decoder independent of stage and main media to preserve all
 // playback, transport, host capture and audio state.
 document.body.appendChild(preview);
 let decoderUrl='',decoderEpoch=0,hoverEpoch=0,debounce=0,active=false,
     captured=Promise.resolve(),requestSerial=0,latestRemote=0,lastGuestAt=0;
 const cache=new Map(),hostThrottle=new WeakMap();
 const MAX_CACHED=20;
 const limit=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
 const duration=()=>state.role==='guest'?Number(state.sharedDuration)||0:Number(media.duration)||0;
 const format=seconds=>{
  const t=Math.max(0,Math.floor(Number(seconds)||0)),h=Math.floor(t/3600),
    m=Math.floor(t%3600/60),s=t%60;
  return (h?String(h).padStart(2,'0')+':':'')+
    String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
 };
 const availableUrl=()=>{
  if(state.role==='host'&&state.source==='file'&&state.fileUrl)return state.fileUrl;
  if(state.role==='guest'&&state.localVerified&&state.localFileUrl)return state.localFileUrl;
  if((state.source==='hosted'||state.source==='hosted-guest')&&state.hostedUrl)
    return state.hostedUrl;
  return '';
 };
 const sourceSignature=()=>availableUrl()||(
   state.role==='guest'&&state.guestConn?.open?
     'remote:'+state.code+':'+(state.remoteFingerprint||state.remoteFileName||''): '');
 const canRequestRemote=()=>state.role==='guest'&&state.guestConn?.open&&
   !state.localVerified&&!state.bufferedMode&&state.source==='remote';
 function setStatus(message){
  status.textContent=message;status.hidden=!message;
  canvas.hidden=!!message;
 }
 function clearCard(){
  active=false;card.hidden=true;canvas.hidden=true;
  clearTimeout(debounce);debounce=0;hoverEpoch++;
  latestRemote=0;
 }
 function clearDecoder(){
  decoderEpoch++;decoderUrl='';cache.clear();
  preview.pause();preview.removeAttribute('src');preview.load();
 }
 function onMediaChange(){
  clearCard();clearDecoder();
 }
 window.addEventListener('marmalade:video-selected',onMediaChange);
 window.addEventListener('marmalade:media-cleared',onMediaChange);
 window.addEventListener('pagehide',onMediaChange);
 const waitFor=(target,event,ms)=>new Promise((resolve,reject)=>{
  let timer=0;
  const ok=()=>{cleanup();resolve();};
  const bad=()=>{cleanup();reject(Error('Preview frame unavailable'));};
  const cleanup=()=>{clearTimeout(timer);target.removeEventListener(event,ok);
   target.removeEventListener('error',bad);};
  target.addEventListener(event,ok,{once:true});
  target.addEventListener('error',bad,{once:true});
  timer=setTimeout(bad,ms);
 });
 async function prepare(url){
  if(url===decoderUrl&&preview.readyState>=1)return decoderEpoch;
  clearDecoder();
  decoderUrl=url;
  const epoch=decoderEpoch;
  if(!url.startsWith('blob:'))preview.crossOrigin='anonymous';
  else preview.removeAttribute('crossorigin');
  const loading=waitFor(preview,'loadedmetadata',4000);
  preview.src=url;preview.load();
  await loading;
  if(epoch!==decoderEpoch)throw Error('Movie changed');
  if(!Number.isFinite(preview.duration)||preview.duration<=0)
   throw Error('Preview requires seekable media');
  return epoch;
 }
 async function actualCapture(time){
  const url=availableUrl();
  if(!url)throw Error('Seekable file unavailable');
  const epoch=await prepare(url);
  if(epoch!==decoderEpoch)throw Error('Movie changed');
  const point=limit(time,0,Math.max(0,preview.duration-.06));
  if(Math.abs(preview.currentTime-point)>.045){
   const seeking=waitFor(preview,'seeked',4400);
   preview.currentTime=point;
   await seeking;
  }
  if(epoch!==decoderEpoch)throw Error('Movie changed');
  if(preview.readyState<2)await waitFor(preview,'loadeddata',3000);
  if(preview.requestVideoFrameCallback){
   // seeked may fire just before the newly decoded frame can be drawn.
   await Promise.race([
    new Promise(resolve=>preview.requestVideoFrameCallback(()=>resolve())),
    new Promise(resolve=>setTimeout(resolve,140))
   ]);
  }
  if(epoch!==decoderEpoch)throw Error('Movie changed');
  if(preview.videoWidth<1||preview.videoHeight<1)throw Error('No decoded frame');
  const w=preview.videoWidth,h=preview.videoHeight,ratio=Math.min(192/w,108/h);
  const width=Math.max(1,Math.round(w*ratio)),height=Math.max(1,Math.round(h*ratio));
  scratchContext.fillStyle='#05050a';scratchContext.fillRect(0,0,192,108);
  scratchContext.drawImage(preview,(192-width)/2,(108-height)/2,width,height);
  // Canvas exports are blocked for media without cross-origin canvas permission;
  // never show a thumbnail from a different timestamp in that case.
  const frame=scratch.toDataURL('image/jpeg',.62);
  if(!frame.startsWith('data:image/jpeg;base64,')||frame.length>68000)
   throw Error('Frame too large');
  return frame;
 }
 function getFrame(time){
  const key=sourceSignature()+':'+time.toFixed(3);
  if(cache.has(key))return Promise.resolve(cache.get(key));
  // Serialize isolated decoder seeks; concurrent seeks would race and
  // return a frame from the wrong video time.
  const next=captured.catch(()=>{}).then(()=>actualCapture(time));
  captured=next.catch(()=>{});
  return next.then(frame=>{
   cache.set(key,frame);
   if(cache.size>MAX_CACHED)cache.delete(cache.keys().next().value);
   return frame;
  });
 }
 function displayImage(frame,at,epoch){
  if(!active||card.hidden||epoch!==hoverEpoch)return;
  if(typeof frame!=='string'||!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(frame))return;
  const image=new Image();
  image.onload=()=>{
   if(!active||epoch!==hoverEpoch||card.hidden)return;
   context.clearRect(0,0,192,108);context.drawImage(image,0,0,192,108);
   status.hidden=true;canvas.hidden=false;
  };
  image.onerror=()=>{if(epoch===hoverEpoch)setStatus('Preview unavailable');};
  image.src=frame;
 }
 async function displayLocal(time,epoch){
  try{displayImage(await getFrame(time),time,epoch);}
  catch(error){
   if(epoch!==hoverEpoch||!active)return;
   setStatus(/cors|cross-origin/i.test(String(error))?
     'Preview blocked by video source':'Preview unavailable for this video');
  }
 }
 function guestPreview(time,epoch){
  const now=performance.now();
  const sendRequest=()=>{
   if(!active||epoch!==hoverEpoch||!state.guestConn?.open)return;
   const id=++requestSerial;latestRemote=id;
   try{state.guestConn.send({type:'seek-thumbnail-request',id,time});}
   catch{if(epoch===hoverEpoch)setStatus('Preview unavailable');}
  };
  if(now-lastGuestAt<280){
   debounce=setTimeout(()=>{lastGuestAt=performance.now();sendRequest();},280-(now-lastGuestAt));
  }else{lastGuestAt=now;sendRequest();}
 }
 function schedule(time){
  const epoch=++hoverEpoch;
  setStatus('Loading scene…');
  clearTimeout(debounce);
  if(canRequestRemote()){debounce=setTimeout(()=>guestPreview(time,epoch),100);return;}
  if(!availableUrl()){setStatus('Preview unavailable for this stream');return;}
  debounce=setTimeout(()=>displayLocal(time,epoch),100);
 }
 function position(clientX){
  const d=duration();
  if(seek.disabled||!Number.isFinite(d)||d<=0||!el.stage.classList.contains('has-video')){
   clearCard();return;
  }
  const rect=seek.getBoundingClientRect();
  if(!rect.width)return;
  const x=limit(clientX-rect.left,0,rect.width),ratio=x/rect.width;
  const time=limit(ratio*d,0,d);
  const bubbleWidth=card.offsetWidth||156;
  card.style.left=limit(x,bubbleWidth/2,Math.max(bubbleWidth/2,rect.width-bubbleWidth/2))+'px';
  card.hidden=false;active=true;
  stamp.textContent=format(time);
  const previous=Number(card.dataset.time);
  if(Number.isFinite(previous)&&Math.abs(previous-time)<.04&&card.dataset.source===sourceSignature())
    return;
  card.dataset.time=String(time);card.dataset.source=sourceSignature();
  schedule(time);
 }
 seek.addEventListener('pointerenter',event=>{
  if(event.pointerType==='touch')return;
  position(event.clientX);
 });
 seek.addEventListener('pointermove',event=>{
  if(event.pointerType==='touch'&&!event.buttons)return;
  position(event.clientX);
 });
 seek.addEventListener('pointerdown',event=>{
  if(event.button===0)position(event.clientX);
 });
 seek.addEventListener('pointerleave',clearCard);
 seek.addEventListener('pointercancel',clearCard);
 seek.addEventListener('pointerup',event=>{
  if(event.pointerType==='touch')setTimeout(clearCard,550);
 });
 seek.addEventListener('blur',clearCard);
 // Guests who are receiving a nonseekable WebRTC MediaStream can request
 // a bounded thumbnail on the existing encrypted PeerJS data connection.
 async function handleRequest(conn,data,send){
  if(state.role!=='host'||!conn?.open||!data||data.type!=='seek-thumbnail-request')return;
  if(!Number.isSafeInteger(data.id)||data.id<1||data.id>2147483647)return;
  const time=Number(data.time),d=duration();
  if(!Number.isFinite(time)||time<0||!(d>0)||time>d)return;
  const now=performance.now(),last=hostThrottle.get(conn)||0;
  if(last&&now-last<280)return;
  hostThrottle.set(conn,now);
  if(!availableUrl())return;
  try{
   const frame=await getFrame(time);
   if(conn.open&&state.role==='host'&&frame.length<68000)
    send(conn,{type:'seek-thumbnail-response',id:data.id,time,frame});
  }catch{
   if(conn.open)send(conn,{type:'seek-thumbnail-response',id:data.id,time,unavailable:true});
  }
 }
 function handleResponse(data){
  if(!active||card.hidden||state.role!=='guest'||!data||
      data.type!=='seek-thumbnail-response'||data.id!==latestRemote)return;
  if(data.unavailable){setStatus('Host preview unavailable');return;}
  if(typeof data.frame!=='string'||data.frame.length>=68000)return;
  displayImage(data.frame,data.time,hoverEpoch);
 }
 window.MarmaladeSeekPreview={
  handleRequest,handleResponse,refresh:()=>{if(active&&!card.hidden)position(seek.getBoundingClientRect().left+
    Number(card.dataset.time||0)/Math.max(1,duration())*seek.getBoundingClientRect().width);},
  hide:clearCard
 };
})();
