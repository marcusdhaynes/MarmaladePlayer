/* Standalone video-only system PiP. No Document PiP window or application chrome.
 * The source player owns sound, timing, seek and room synchronization. */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const media=$('player'),monitor=$('hostMonitor'),subtitles=$('subtitleOverlay');
if(!media)return;
const canvas=document.createElement('canvas');
const ctx=canvas.getContext('2d',{alpha:false});
const captionCanvas=document.createElement('canvas');
const captionCtx=captionCanvas.getContext('2d',{alpha:true});
if(!ctx||!canvas.captureStream)return;
const pip=document.createElement('video');
pip.id='marmaladeStandalonePipVideo';
pip.muted=true;pip.autoplay=true;pip.playsInline=true;
pip.setAttribute('aria-hidden','true');
// Keep the stream video on-screen for browser frame scheduling, but imperceptible.
pip.style.cssText='position:fixed;left:0;top:0;width:2px;height:2px;opacity:.01;pointer-events:none;z-index:-1';
document.body.appendChild(pip);
let stream=null,loop=0,prewarmTimer=0,active=false,starting=false;
let frameSource=null,frameCallback=null,lastFrameAt=0,lastMediaTime=NaN,manualCapture=false;
let captionKey='',captionVisible=false,lastCaptionRefresh=0;
const segmenter=typeof Intl.Segmenter==='function'?new Intl.Segmenter(undefined,{granularity:'word'}):null;
const piPControls=['play','pause','previoustrack','nexttrack','seekbackward','seekforward','seekto'];
let width=0,height=0,frame=0,notified=false;
const source=()=>document.querySelector('.stage.host-monitor-active') &&
  monitor?.readyState>=2 && monitor.videoWidth>0?monitor:media;
const gamma=()=>window.MarmaladeAdaptiveBrightness?.getLevel?.()?
  Math.max(.43,Math.min(1,Number(window.MarmaladeAdaptiveBrightness?.getGamma?.())||1)):1;
function ensureDimensions(){
 const video=source();
 const w=video?.videoWidth||640,h=video?.videoHeight||360;
 const scale=Math.min(1,960/w,540/h);
 const nextW=Math.max(2,Math.round(w*scale/2)*2);
 const nextH=Math.max(2,Math.round(h*scale/2)*2);
 if(width!==nextW||height!==nextH){width=nextW;height=nextH;canvas.width=width;canvas.height=height;captionCanvas.width=width;captionCanvas.height=height;captionKey='';}
}
function videoFilter(){
 const g=gamma();
 if(g>=.999)return 'none';
 // Canvas filter lets the browser composite the gamma effect without
 // synchronously copying every video pixel to JavaScript and back.
 const svg='url(#adaptiveBrightnessGamma)';
 if('filter' in ctx){
   ctx.filter=svg;
   if(ctx.filter!=='none')return svg;
   return 'brightness('+Math.pow(.5,g-1).toFixed(3)+')';
 }
 return 'none';
}
function paintSubtitles(){
 if(!captionCtx||!subtitles)return;
 const now=performance.now();
 if(now-lastCaptionRefresh>=65){lastCaptionRefresh=now;window.MarmaladeSubtitleRefresh?.();}
 const text=subtitles.hidden?'':subtitles.textContent||'';
 // Only reflow and rasterize on actual cue/style/size changes.
 const key=width+'x'+height+'|'+text+'|'+subtitles.style.cssText;
 if(key===captionKey)return;
 captionKey=key;
 captionCtx.clearRect(0,0,width,height);
 captionVisible=!!text.trim();
 if(!captionVisible)return;
 const style=getComputedStyle(subtitles),lines=text.split('\n');
 const userSize=Math.max(12,Math.min(64,Number(window.MarmaladeSubtitleFontSize?.())||24));
 // 10% of picture height at the normal 24px setting: ~20px on a
 // 200px-tall mini-player. Keep relative proportions as the OS resizes it.
 const px=Math.max(18,Math.min(height*.19,height*.105*(userSize/24)));
 const maxWidth=width*.92,c=captionCtx;
 const fontAt=n=>`${style.fontWeight||'500'} ${n}px ${style.fontFamily||'sans-serif'}`;
 c.save();
 try{
   c.font=fontAt(px);c.textAlign='center';c.textBaseline='bottom';
   if('fontKerning' in c)c.fontKerning='normal';
   if('letterSpacing' in c)c.letterSpacing='0px';
   if('wordSpacing' in c)c.wordSpacing='0px';
   const output=[];
   for(const line of lines){
     const segments=segmenter?[...segmenter.segment(line)].map(x=>x.segment):line.match(/\S+|\s+/gu)||[];
     let piece='';
     for(const token of segments){
       const test=piece+token;
       if(piece.trim()&&token.trim()&&c.measureText(test.trimEnd()).width>maxWidth){
         output.push(piece.trimEnd());piece=token.trimStart();
       }else piece=test;
     }
     output.push(piece.trimEnd());
   }
   const size=Math.min(px,height*.78/Math.max(1,output.length*1.35));
   const lineHeight=size*1.35,bottom=Math.max(4,height*.07);
   output.forEach((line,i,arr)=>{
     if(!line)return;
     const y=height-bottom-(arr.length-1-i)*lineHeight;
     const first=[...line].find(ch=>/\p{L}/u.test(ch))||'';
     c.direction=/[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}]/u.test(first)?'rtl':'ltr';
     c.font=fontAt(size);
     const measured=c.measureText(line).width;
     const fit=measured>maxWidth?size*maxWidth/measured:size;
     c.font=fontAt(fit);
     c.lineJoin='round';c.lineWidth=Math.max(1,fit*.11);
     c.strokeStyle='rgba(0,0,0,.9)';c.strokeText(line,width/2,y);
     c.fillStyle=style.color||'#fff';c.fillText(line,width/2,y);
   });
 }finally{c.restore();}
}

function draw(){
 const video=source();
 if(!video||video.readyState<2||!video.videoWidth)return false;
 ensureDimensions();
 try{
   if('filter' in ctx)ctx.filter=videoFilter();
   ctx.drawImage(video,0,0,width,height);
   if('filter' in ctx)ctx.filter='none';
   paintSubtitles();
   if(captionVisible)ctx.drawImage(captionCanvas,0,0);
   if(manualCapture)stream?.getVideoTracks()[0]?.requestFrame?.();
   lastFrameAt=performance.now();lastMediaTime=video.currentTime;frame++;return true;
 }
 catch(error){if(!notified){console.debug('PiP frame compositor unavailable',error);notified=true;}return false;}
}
function cancelFrameCallback(){
 if(frameSource&&frameCallback!==null)frameSource.cancelVideoFrameCallback?.(frameCallback);
 frameSource=null;frameCallback=null;
}
function scheduleFrame(){
 const video=source();
 if(frameSource!==video)cancelFrameCallback();
 if(!active||frameCallback!==null||typeof video?.requestVideoFrameCallback!=='function')return;
 frameSource=video;
 frameCallback=video.requestVideoFrameCallback(()=>{
   frameCallback=null;
   if(!active)return;
   if(source()===video)draw();
   scheduleFrame();
 });
}
function startLoop(){
 if(loop)return;
 draw();scheduleFrame();
 // Old engines, hidden tabs and paused seeks may stop frame callbacks.
 // A lightweight watchdog only paints if the source clock has advanced
 // and decoded-frame callbacks have stalled, never on every idle tick.
 loop=setInterval(()=>{
   if(!active)return;
   scheduleFrame();
   const video=source();
   if(video&&!video.paused&&performance.now()-lastFrameAt>48&&video.currentTime!==lastMediaTime)draw();
 },16);
}
function stopLoop(){if(loop){clearInterval(loop);loop=0;}cancelFrameCallback();}
// Canvas capture must start BEFORE painting the first frame. The previous
// implementation captured an untouched canvas and waited for PiP to be active
// before drawing again, which left its source with no decodable first frame.
function prepare(){
 const video=source();
 if(!video||video.readyState<2||!video.videoWidth)return false;
 if(!stream){
   ensureDimensions();
   stream=canvas.captureStream(0);
   manualCapture=typeof stream.getVideoTracks()[0]?.requestFrame==='function';
   if(!manualCapture){stream.getTracks().forEach(track=>track.stop());stream=canvas.captureStream(60);}
   pip.srcObject=stream;
 }
 const painted=draw();
 if(painted){
   try{stream.getVideoTracks()[0]?.requestFrame?.();}catch{}
 }
 if(pip.paused)void pip.play().catch(error=>console.debug('PiP video prewarm',error));
 if(pip.readyState<2 && !prewarmTimer){
   prewarmTimer=setInterval(()=>{
     if(pip.readyState>=2){clearInterval(prewarmTimer);prewarmTimer=0;return;}
     if(draw())try{stream?.getVideoTracks()[0]?.requestFrame?.();}catch{}
   },120);
 }
 return painted;
}
function press(id){
 const control=$(id);
 if(control && !control.disabled)control.click();
}
function seekTo(time){
 const seek=$('seek');
 if(!seek||seek.disabled||!Number.isFinite(media.duration)||media.duration<=0)return;
 seek.value=String(Math.max(0,Math.min(1000,1000*time/media.duration)));
 seek.dispatchEvent(new Event('change',{bubbles:true}));
}
function positionState(){
 if(!active || !navigator.mediaSession)return;
 const session=navigator.mediaSession;
 session.playbackState=media.paused?'paused':'playing';
 if(Number.isFinite(media.duration)&&media.duration>0){
   try{session.setPositionState?.({
     duration:media.duration,playbackRate:media.playbackRate||1,
     position:Math.min(media.duration,Math.max(0,media.currentTime||0))
   });}catch{}
 }
}
function installControls(){
 const session=navigator.mediaSession;
 if(!session?.setActionHandler)return;
 const controls={
   play:()=>{if(media.paused)press('playPause');},
   pause:()=>{if(!media.paused)press('playPause');},
   previoustrack:()=>press('skipBack'),
   nexttrack:()=>press('skipForward'),
   seekbackward:()=>press('skipBack'),
   seekforward:()=>press('skipForward'),
   seekto:details=>{if(Number.isFinite(details.seekTime))seekTo(details.seekTime);}
 };
 for(const action of piPControls){
   try{session.setActionHandler(action,controls[action]);}catch{}
 }
 positionState();
}
function clean(){
 active=false;starting=false;stopLoop();
 if(prewarmTimer){clearInterval(prewarmTimer);prewarmTimer=0;}
 if(navigator.mediaSession?.setActionHandler){
   for(const action of piPControls){
     try{navigator.mediaSession.setActionHandler(action,null);}catch{}
   }
 }
 window.MarmaladeAdaptiveBrightness?.setExternalPlayback?.(false);
}
pip.addEventListener('leavepictureinpicture',clean);
// Native PiP buttons must use the same transport events as the main player,
// so host and guest playback stay synchronized.
pip.addEventListener('pause',()=>{
 if(active&&document.pictureInPictureElement===pip&&!media.paused)press('playPause');
});
pip.addEventListener('play',()=>{
 if(active&&document.pictureInPictureElement===pip&&media.paused)press('playPause');
});
media.addEventListener('loadeddata',prepare);
media.addEventListener('canplay',prepare);
for(const video of [media,monitor].filter(Boolean))video.addEventListener('resize',()=>{if(active){draw();scheduleFrame();}});
// Font loading can change glyph metrics without changing the caption text.
document.fonts?.addEventListener?.('loadingdone',()=>{captionKey='';if(active)draw();});
media.addEventListener('playing',()=>{
 prepare();
 if(active){
   if(pip.paused)void pip.play().catch(()=>{});
   draw();positionState();
 }
});
media.addEventListener('seeked',()=>{if(active){draw();positionState();}});
media.addEventListener('timeupdate',positionState,{passive:true});
media.addEventListener('ratechange',positionState,{passive:true});
media.addEventListener('pause',()=>{
 if(active){
   draw();
   if(!pip.paused)pip.pause();
   positionState();
 }
});
window.addEventListener('pagehide',clean);
async function enter(){
 if(starting)return false;
 if(document.pictureInPictureElement===pip){await document.exitPictureInPicture();return true;}
 if(!document.pictureInPictureEnabled||!pip.requestPictureInPicture)
   throw new Error('This browser does not support standalone system Picture-in-Picture.');
 if(media.readyState<2)throw new Error('Load a movie first.');
 if(!prepare()||!stream)throw new Error('The video could not be rendered for the mini-player.');
 if(pip.readyState<2)throw new Error('Preparing the video feed. Press Pop-Out again if it does not open.');
 starting=true;
 // Register before opening PiP so Chromium knows which native controls to show.
 installControls();
 try{
   draw(); // Movie, subtitles and adaptive gamma composited BEFORE native PiP.
   await pip.requestPictureInPicture();
   active=true;window.MarmaladeAdaptiveBrightness?.setExternalPlayback?.(true);
   positionState();
   startLoop();
   return true;
 }catch(error){clean();throw error;}
 finally{starting=false;}
}
window.MarmaladeStandalonePiP={enter,isActive:()=>active,draw,getFrames:()=>frame,
  hasVideoOnlySurface:()=>!!pip.srcObject,stop:clean,
  getDiagnostics:()=>({frames:frame,sourceReady:source()?.readyState||0,
    pipReady:pip.readyState,canvasWidth:width,canvasHeight:height,active})};
})();