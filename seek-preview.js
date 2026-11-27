/* Marmalade timeline thumbnails. Never seeks or pauses the real player.
   Warm the decoder early, cache nearby frames, and prioritize the latest
   hovered timestamp without moving or playing the real movie. */
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
 preview.preload='auto';preview.controls=false;
 preview.setAttribute('aria-hidden','true');
 preview.tabIndex=-1;
 preview.style.cssText='position:absolute;left:-10000px;top:-10000px;width:1px;height:1px;visibility:hidden;pointer-events:none';
 // Keep the decoder independent of stage and main media to preserve all
 // playback, transport, host capture and audio state.
 document.body.appendChild(preview);
 let decoderUrl='',decoderEpoch=0,decoderLoading=null,hoverEpoch=0,debounce=0,
     active=false,requestSerial=0,latestRemote=0,lastGuestAt=0,
     remoteOutstanding=0,remoteWanted=null,remoteTimeout=0,captureBusy=false,remoteAttempts=0;
 const cache=new Map(),hostThrottle=new WeakMap(),hostPending=new WeakSet(),captureQueue=[];
 const MAX_CACHED=96,MAX_QUEUED=12,MAX_REMOTE_ATTEMPTS=3,BUCKET_SECONDS=.125;
 const limit=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
 const duration=()=>state.role==='guest'?Number(state.sharedDuration)||0:
   (Number(window.MarmaladeStableDuration?.() ?? media.duration)||0);
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
  latestRemote=0;remoteOutstanding=0;remoteWanted=null;remoteAttempts=0;
  delete card.dataset.time;delete card.dataset.source;
  for(let i=captureQueue.length-1;i>=0;i--){
   if(captureQueue[i].interactive)captureQueue.splice(i,1)[0].reject(Error('Superseded'));
  }
  clearTimeout(remoteTimeout);remoteTimeout=0;
 }
 function clearDecoder(){
  decoderEpoch++;decoderUrl='';decoderLoading=null;cache.clear();
  while(captureQueue.length)captureQueue.shift().reject(Error('Movie changed'));
  preview.pause();preview.removeAttribute('src');preview.load();
 }
 function onMediaChange(){
  clearCard();clearDecoder();
  // Load metadata before the first hover to avoid the cold-decoder delay.
  const url=availableUrl();
  if(url)void prepare(url).catch(()=>{});
 }
 window.addEventListener('marmalade:video-selected',onMediaChange);
 window.addEventListener('marmalade:media-cleared',onMediaChange);
 window.addEventListener('pagehide',()=>{clearCard();clearDecoder();});
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
  if(url===decoderUrl){
   if(preview.readyState>=1)return decoderEpoch;
   if(decoderLoading)return decoderLoading;
  }
  clearDecoder();
  decoderUrl=url;
  const epoch=decoderEpoch;
  if(!url.startsWith('blob:'))preview.crossOrigin='anonymous';
  else preview.removeAttribute('crossorigin');
  const loading=waitFor(preview,'loadedmetadata',4000);
  preview.src=url;preview.load();
  const pending=(async()=>{
   await loading;
   if(epoch!==decoderEpoch)throw Error('Movie changed');
   if(!Number.isFinite(preview.duration)||preview.duration<=0)
    throw Error('Preview requires seekable media');
   return epoch;
  })();
  decoderLoading=pending;
  try{return await pending;}
  finally{if(decoderLoading===pending)decoderLoading=null;}
 }
 async function actualCapture(time){
  const url=availableUrl();
  if(!url)throw Error('Seekable file unavailable');
  const epoch=await prepare(url);
  if(epoch!==decoderEpoch)throw Error('Movie changed');
  const point=limit(time,0,Math.max(0,preview.duration-.06));
  if(Math.abs(preview.currentTime-point)>.045){
   const seeking=waitFor(preview,'seeked',2800);
   preview.currentTime=point;
   await seeking;
  }
  if(epoch!==decoderEpoch)throw Error('Movie changed');
  if(preview.readyState<2)await waitFor(preview,'loadeddata',3000);
  // seeked + HAVE_CURRENT_DATA already indicate a drawable frame. Do not
  // add a 140ms artificial stall on every seek while this video is paused.
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
 // At most one seek at a time, with the newest interactive hover ahead of
 // old remote requests. Replaced pending hovers are explicitly rejected.
 async function drainCaptureQueue(){
  if(captureBusy)return;
  captureBusy=true;
  try{
   while(captureQueue.length){
    const job=captureQueue.shift();
    if(job.source!==sourceSignature()){job.reject(Error('Movie changed'));continue;}
    if(cache.has(job.key)){job.resolve(cache.get(job.key));continue;}
    try{
     const frame=await actualCapture(job.time);
     if(job.source!==sourceSignature())throw Error('Movie changed');
     cache.set(job.key,frame);
     if(cache.size>MAX_CACHED)cache.delete(cache.keys().next().value);
     job.resolve(frame);
    }catch(error){job.reject(error);}
   }
  }finally{captureBusy=false;}
 }
 function getFrame(time,interactive=false){
  const point=Math.round(time/BUCKET_SECONDS)*BUCKET_SECONDS;
  const source=sourceSignature(),key=source+':'+point.toFixed(3);
  if(cache.has(key)){
   const frame=cache.get(key);
   cache.delete(key);cache.set(key,frame); // LRU preserves recently hovered frames.
   return Promise.resolve(frame);
  }
  return new Promise((resolve,reject)=>{
   if(interactive){
    for(let i=captureQueue.length-1;i>=0;i--){
     if(captureQueue[i].interactive)
      captureQueue.splice(i,1)[0].reject(Error('Superseded'));
    }
   }
   if(captureQueue.length>=MAX_QUEUED){
    if(!interactive){reject(Error('Preview queue busy'));return;}
    captureQueue.pop().reject(Error('Superseded'));
   }
   const job={time:point,source,key,interactive,resolve,reject};
   if(interactive)captureQueue.unshift(job);else captureQueue.push(job);
   void drainCaptureQueue();
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
  try{displayImage(await getFrame(time,true),time,epoch);}
  catch(error){
   if(epoch!==hoverEpoch||!active||/Superseded|Movie changed/i.test(String(error)))return;
   setStatus(/cors|cross-origin/i.test(String(error))?
     'Preview blocked by video source':'Preview unavailable for this video');
  }
 }
 // Only one in-flight guest request. Hover movement replaces the desired
 // timestamp; the next request is issued as soon as the host responds.
 function sendGuestRequest(){
  if(!active||remoteOutstanding||!remoteWanted||!state.guestConn?.open)return;
  const remaining=80-(performance.now()-lastGuestAt);
  if(remaining>0){
   clearTimeout(debounce);debounce=setTimeout(sendGuestRequest,remaining);return;
  }
  const wanted=remoteWanted;remoteWanted=null;
  if(wanted.epoch!==hoverEpoch)return;
  const id=++requestSerial;
  remoteOutstanding=id;latestRemote=id;lastGuestAt=performance.now();remoteAttempts++;
  try{state.guestConn.send({type:'seek-thumbnail-request',id,time:wanted.time});}
  catch{remoteOutstanding=0;setStatus('Preview unavailable');return;}
  clearTimeout(remoteTimeout);
  remoteTimeout=setTimeout(()=>{
   if(remoteOutstanding!==id)return;
   remoteOutstanding=0;
   if(active&&!card.hidden){
    if(remoteAttempts>=MAX_REMOTE_ATTEMPTS){remoteWanted=null;setStatus('Host preview timed out');return;}
    remoteWanted={time:Number(card.dataset.time),epoch:hoverEpoch};
    sendGuestRequest();
   }
  },1250);
 }
 function guestPreview(time,epoch){
  remoteAttempts=0;remoteWanted={time,epoch};
  sendGuestRequest();
 }
 function schedule(time){
  const epoch=++hoverEpoch;
  setStatus('Loading scene…');
  clearTimeout(debounce);
  if(canRequestRemote()){guestPreview(time,epoch);return;}
  if(!availableUrl()){setStatus('Preview unavailable for this stream');return;}
  // No hardcoded 100ms hover delay; the queue discards superseded seeks.
  void displayLocal(time,epoch);
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
  if(last&&now-last<80)return;
  hostThrottle.set(conn,now);
  if(!availableUrl()||hostPending.has(conn))return;
  hostPending.add(conn);
  const original=sourceSignature();
  try{
   const frame=await getFrame(time);
   if(conn.open&&state.role==='host'&&sourceSignature()===original&&frame.length<68000)
    send(conn,{type:'seek-thumbnail-response',id:data.id,time,frame});
  }catch{
   if(conn.open&&state.role==='host'&&sourceSignature()===original)send(conn,{type:'seek-thumbnail-response',id:data.id,time,unavailable:true});
  }finally{hostPending.delete(conn);}
 }
 function handleResponse(data){
  if(!data||data.type!=='seek-thumbnail-response'||data.id!==remoteOutstanding)return;
  clearTimeout(remoteTimeout);remoteTimeout=0;remoteOutstanding=0;
  if(!active||card.hidden||state.role!=='guest')return;
  const desired=Number(card.dataset.time);
  const match=Number.isFinite(desired)&&
    Math.abs(Number(data.time)-desired)<=BUCKET_SECONDS;
  if(match){
   if(data.unavailable)setStatus('Host preview unavailable');
   else if(typeof data.frame==='string'&&data.frame.length<68000)
    displayImage(data.frame,data.time,hoverEpoch);
  }else if(!remoteWanted)remoteWanted={time:desired,epoch:hoverEpoch};
  if(remoteWanted)sendGuestRequest();
 }
 // On-demand local scene navigation shares the bounded thumbnail decoder.
 // Never scan an active movie, a remote stream, or a game frame.
 const scenePanel=document.createElement('details');
 scenePanel.id='timelineScenes';scenePanel.className='settings-advanced';
 scenePanel.innerHTML='<summary>Scene Navigation</summary><div class="bookmark-editor"><p id="sceneStatus" role="status">Pause a local video to find a nearby scene change.</p><div class="chapter-actions"><button type="button" id="scenePrevious" disabled>Previous Scene</button><button type="button" id="sceneNext" disabled>Next Scene</button><button type="button" id="sceneCancel" hidden>Cancel</button></div></div>';
 document.querySelector('#timelineChapters')?.after(scenePanel);
 const sceneStatus=scenePanel.querySelector('#sceneStatus'),scenePrevious=scenePanel.querySelector('#scenePrevious'),sceneNext=scenePanel.querySelector('#sceneNext'),sceneCancel=scenePanel.querySelector('#sceneCancel');
 let sceneGeneration=0,sceneBusy=false;
 const sceneCanvas=document.createElement('canvas');sceneCanvas.width=32;sceneCanvas.height=18;
 const sceneContext=sceneCanvas.getContext('2d',{willReadFrequently:true,alpha:false});
 const sceneEligible=()=>state.role==='host'&&state.source==='file'&&state.fileReady&&!state.gameFrameMode&&!state.broadcasting&&media.paused&&!media.seeking&&duration()>.25&&!!availableUrl();
 function sceneControls(){
  const eligible=sceneEligible();
  scenePrevious.disabled=sceneNext.disabled=!eligible||sceneBusy;
  sceneCancel.hidden=!sceneBusy;
  if(typeof frameControls==='function'&&document.querySelector('#timelineFrames'))frameControls();
 }
 function cancelScene(message='Scene search cancelled.'){
  if(!sceneBusy){sceneControls();return;}
  sceneGeneration++;sceneBusy=false;sceneStatus.textContent=message;sceneControls();
 }
 async function scenePixels(time){
  const frame=await getFrame(time);
  const image=new Image();image.src=frame;await image.decode();
  sceneContext.drawImage(image,0,0,32,18);
  return sceneContext.getImageData(0,0,32,18).data;
 }
 function sceneDifference(a,b){
  let total=0,changed=0;
  for(let i=0;i<a.length;i+=4){
   const d=(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]))/3;
   total+=d;if(d>35)changed++;
  }
  return total/(a.length/4)>=25&&changed/(a.length/4)>=.35;
 }
 async function scanScene(direction){
  if(!sceneEligible()||sceneBusy)return;
  const generation=++sceneGeneration,source=sourceSignature(),origin=media.currentTime,started=performance.now();
  sceneBusy=true;sceneControls();sceneStatus.textContent='Finding scene change…';
  const valid=()=>generation===sceneGeneration&&source===sourceSignature()&&sceneEligible()&&Math.abs(media.currentTime-origin)<.05;
  const check=()=>{if(!valid())throw Error('Cancelled');if(performance.now()-started>15000)throw Error('Search time limit reached.');};
  const max=Math.max(0,Math.floor((duration()-.125)*8)/8);
  const round=t=>limit(Math.round(t*8)/8,0,max);
  try{
   let last=round(origin+direction*.25);check();
   let lastPixels=await scenePixels(last);
   for(let n=1;n<=60;n++){
    check();
    const point=round(last+direction*.5);
    if(point===last)break;
    const pixels=await scenePixels(point);check();
    if(sceneDifference(lastPixels,pixels)){
     let low=Math.min(last,point),high=Math.max(last,point);
     let lowPixels=direction>0?lastPixels:pixels;
     // Refine the sampled visual cut to the preview cache resolution.
     while(high-low>.125){
      check();const middle=round((low+high)/2);
      if(middle<=low||middle>=high)break;
      const midPixels=await scenePixels(middle);check();
      if(sceneDifference(lowPixels,midPixels))high=middle;
      else{low=middle;lowPixels=midPixels;}
     }
     check();sceneBusy=false;sceneControls();
     sceneStatus.textContent='Scene change near '+format(high)+' (estimated).';
     bridge.seekToTime(high);return;
    }
    last=point;lastPixels=pixels;
    if(Math.abs(point-origin)>=30)break;
   }
   if(valid())sceneStatus.textContent='No clear scene change found within 30 seconds.';
  }catch(error){
   if(generation===sceneGeneration)sceneStatus.textContent=String(error.message||error)==='Cancelled'?'Scene search cancelled.':String(error.message||'Scene search unavailable.');
  }finally{if(generation===sceneGeneration){sceneBusy=false;sceneControls();}}
 }
 scenePrevious.addEventListener('click',()=>void scanScene(-1));
 sceneNext.addEventListener('click',()=>void scanScene(1));
 sceneCancel.addEventListener('click',()=>cancelScene());
 for(const event of ['play','seeking','emptied','loadstart'])media.addEventListener(event,()=>cancelScene());
 for(const event of ['pause','seeked','loadedmetadata','durationchange'])media.addEventListener(event,sceneControls);
 for(const event of ['marmalade:video-selected','marmalade:media-cleared'])window.addEventListener(event,()=>{cancelScene();sceneStatus.textContent='Pause a local video to find a nearby scene change.';sceneControls();});
 scenePanel.addEventListener('toggle',()=>{if(!scenePanel.open)cancelScene();else sceneControls();});
 new MutationObserver(()=>{if(el.settingsPanel.hidden)cancelScene();else sceneControls();}).observe(el.settingsPanel,{attributes:true,attributeFilter:['hidden']});
 // Paused frame stepping is intentionally separate from scrubber debounce.
 // Auto uses consecutive presented-frame PTS samples; no guessed default FPS.
 const framePanel=document.createElement('details');
 framePanel.id='timelineFrames';framePanel.className='settings-advanced';
 framePanel.innerHTML='<summary>Frame Navigation</summary><div class="bookmark-editor"><p id="frameStepStatus" role="status">Play briefly to measure frame cadence, or select a known constant frame rate.</p><label>Frame Rate <select id="frameStepRate" aria-label="Frame rate for stepping"><option value="auto">Auto (Measured)</option><option value="23.976">23.976</option><option value="24">24</option><option value="25">25</option><option value="29.97">29.97</option><option value="30">30</option><option value="48">48</option><option value="50">50</option><option value="59.94">59.94</option><option value="60">60</option><option value="120">120</option></select></label><div class="chapter-actions"><button type="button" id="framePrevious" disabled>Previous Frame</button><button type="button" id="frameNext" disabled>Next Frame</button></div></div>';
 scenePanel.after(framePanel);
 const frameRate=framePanel.querySelector('#frameStepRate'),frameStatus=framePanel.querySelector('#frameStepStatus'),framePrevious=framePanel.querySelector('#framePrevious'),frameNext=framePanel.querySelector('#frameNext');
 let cadenceSamples=[],cadencePrevious=null,cadence=null,frameSource='',frameHandle=0;
 function resetCadence(){
  cadenceSamples=[];cadencePrevious=null;cadence=null;frameSource=sourceSignature();
  frameRate.value='auto';frameControls();
 }
 function selectedCadence(){
  if(frameRate.value==='auto')return cadence;
  const fps=Number(frameRate.value);
  const exact={'23.976':24000/1001,'29.97':30000/1001,'59.94':60000/1001}[frameRate.value]||fps;
  return exact>0?{step:1/exact,anchor:0}:null;
 }
 function frameControls(){
  const rate=selectedCadence();
  const eligible=sceneEligible()&&!sceneBusy&&!!rate;
  framePrevious.disabled=!eligible||media.currentTime<.0001;
  frameNext.disabled=!eligible||media.currentTime+rate.step>=duration();
  frameStatus.textContent=rate?(frameRate.value==='auto'?'Measured '+(1/rate.step).toFixed(2)+' FPS':'Selected '+frameRate.value+' FPS')+' · Estimated frame positions; variable-rate media may differ.':'Play briefly to measure frame cadence, or select a known constant frame rate.';
 }
 function observeCadence(_now,meta){
  frameHandle=0;
  if(frameSource!==sourceSignature())resetCadence();
  if(!media.paused&&!media.seeking&&state.role==='host'&&state.source==='file'&&!state.gameFrameMode&&Number.isFinite(meta?.mediaTime)&&Number.isFinite(meta?.presentedFrames)){
   const old=cadencePrevious;
   cadencePrevious={time:meta.mediaTime,count:meta.presentedFrames};
   if(old&&meta.presentedFrames-old.count===1){
    const dt=meta.mediaTime-old.time;
    if(dt>=1/240&&dt<=.2){
     cadenceSamples.push(dt);if(cadenceSamples.length>12)cadenceSamples.shift();
     if(cadenceSamples.length>=6){
      const sorted=[...cadenceSamples].sort((a,b)=>a-b),median=sorted[Math.floor(sorted.length/2)];
      cadence=sorted.every(x=>Math.abs(x-median)<=Math.max(.0006,median*.03))?{step:median,anchor:meta.mediaTime}:null;
     }
    }else{cadenceSamples=[];cadence=null;}
   }
  }else cadencePrevious=null;
  if(framePanel.open&&!el.settingsPanel.hidden)frameControls();
  if(!media.paused&&framePanel.open&&!el.settingsPanel.hidden)startCadence();
 }
 function startCadence(){
  if(!frameHandle&&typeof media.requestVideoFrameCallback==='function'&&!media.paused&&framePanel.open&&!el.settingsPanel.hidden)frameHandle=media.requestVideoFrameCallback(observeCadence);
 }
 function stopCadence(){
  if(frameHandle)media.cancelVideoFrameCallback?.(frameHandle);
  frameHandle=0;cadencePrevious=null;
 }
 function stepFrame(direction){
  const rate=selectedCadence();
  if(!sceneEligible()||sceneBusy||!rate)return;
  const position=(media.currentTime-rate.anchor)/rate.step;
  const nearest=Math.round(position);
  const aligned=Math.abs(position-nearest)<.04;
  const index=aligned?nearest+direction:direction>0?Math.ceil(position):Math.floor(position);
  const target=limit(rate.anchor+index*rate.step,0,Math.max(0,duration()-rate.step));
  if(Math.abs(target-media.currentTime)>.0001)bridge.seekToTime(target);
  frameControls();
 }
 framePrevious.addEventListener('click',()=>stepFrame(-1));
 frameNext.addEventListener('click',()=>stepFrame(1));
 frameRate.addEventListener('change',frameControls);
 framePanel.addEventListener('toggle',()=>{frameControls();if(framePanel.open)startCadence();else stopCadence();});
 for(const event of ['play','playing'])media.addEventListener(event,()=>{frameControls();startCadence();});
 for(const event of ['pause','seeking','seeked','durationchange'])media.addEventListener(event,()=>{if(media.paused||media.seeking)stopCadence();else startCadence();frameControls();});
 for(const event of ['marmalade:video-selected','marmalade:media-cleared'])window.addEventListener(event,()=>{stopCadence();resetCadence();});
 new MutationObserver(()=>{if(el.settingsPanel.hidden)stopCadence();else{frameControls();startCadence();}}).observe(el.settingsPanel,{attributes:true,attributeFilter:['hidden']});
 frameControls();
 window.MarmaladeSeekPreview={
  handleRequest,handleResponse,refresh:()=>{if(active&&!card.hidden)position(seek.getBoundingClientRect().left+
    Number(card.dataset.time||0)/Math.max(1,duration())*seek.getBoundingClientRect().width);},
  hide:clearCard
 };
})();
