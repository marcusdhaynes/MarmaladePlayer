/* Standalone video-only system PiP. No Document PiP window or application chrome.
 * The source player owns sound, timing, seek and room synchronization. */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const media=$('player'),monitor=$('hostMonitor'),subtitles=$('subtitleOverlay');
if(!media)return;
const canvas=document.createElement('canvas');
const ctx=canvas.getContext('2d',{alpha:false,willReadFrequently:true});
if(!ctx||!canvas.captureStream)return;
const pip=document.createElement('video');
pip.id='marmaladeStandalonePipVideo';
pip.muted=true;pip.autoplay=true;pip.playsInline=true;
pip.setAttribute('aria-hidden','true');
// Keep the stream video on-screen for browser frame scheduling, but imperceptible.
pip.style.cssText='position:fixed;left:0;top:0;width:2px;height:2px;opacity:.01;pointer-events:none;z-index:-1';
document.body.appendChild(pip);
let stream=null,loop=0,prewarmTimer=0,active=false,starting=false,lastGamma=NaN,lut=new Uint8Array(256);
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
 if(width!==nextW||height!==nextH){width=nextW;height=nextH;canvas.width=width;canvas.height=height;lastGamma=NaN;}
}
function applyGamma(){
 const g=gamma();
 if(g>=.999)return;
 if(!Number.isFinite(lastGamma)||Math.abs(g-lastGamma)>.002){
   for(let i=0;i<256;i++)lut[i]=Math.min(255,Math.round(255*Math.pow(i/255,g)));
   lastGamma=g;
 }
 try{
   const image=ctx.getImageData(0,0,width,height),data=image.data;
   for(let i=0;i<data.length;i+=4){data[i]=lut[data[i]];data[i+1]=lut[data[i+1]];data[i+2]=lut[data[i+2]];}
   ctx.putImageData(image,0,0);
 }catch(error){
   if(!notified){console.debug('PiP brightness compositing unavailable',error);notified=true;}
 }
}
function paintSubtitles(){
 window.MarmaladeSubtitleRefresh?.();
 if(!subtitles||subtitles.hidden||!subtitles.textContent?.trim())return;
 const style=getComputedStyle(subtitles),lines=subtitles.textContent.split('\n');
 const size=Math.max(14,Math.min(32,parseFloat(style.fontSize)||24))*width/960;
 const px=Math.max(12,size);
 ctx.font=`${style.fontWeight||'650'} ${px}px ${style.fontFamily||'sans-serif'}`;
 ctx.textAlign='center';ctx.textBaseline='bottom';
 ctx.direction=style.direction==='rtl'||subtitles.dir==='rtl'?'rtl':'inherit';
 const maxWidth=width*.86;
 const output=[];
 for(const line of lines){
   let piece='';
   for(const word of line.split(/\s+/u)){
     const test=piece?piece+' '+word:word;
     if(piece&&ctx.measureText(test).width>maxWidth){output.push(piece);piece=word;}
     else piece=test;
   }
   output.push(piece);
 }
 const lineHeight=px*1.24;
 const bottom=Math.max(18,height*.11);
 output.slice(-5).forEach((line,i,arr)=>{
   const y=height-bottom-(arr.length-1-i)*lineHeight;
   ctx.lineJoin='round';ctx.lineWidth=Math.max(3,px*.22);
   ctx.strokeStyle='#000';ctx.strokeText(line,width/2,y,maxWidth);
   ctx.fillStyle='#fff';ctx.fillText(line,width/2,y,maxWidth);
 });
}
function draw(){
 const video=source();
 if(!video||video.readyState<2||!video.videoWidth)return false;
 ensureDimensions();
 try{ctx.drawImage(video,0,0,width,height);applyGamma();paintSubtitles();frame++;return true;}
 catch(error){if(!notified){console.debug('PiP frame compositor unavailable',error);notified=true;}return false;}
}
function startLoop(){
 if(loop)return;
 draw();
 loop=setInterval(()=>{if(active&&!media.paused)draw();},42);
}
function stopLoop(){if(loop){clearInterval(loop);loop=0;}}
// Canvas capture must start BEFORE painting the first frame. The previous
// implementation captured an untouched canvas and waited for PiP to be active
// before drawing again, which left its source with no decodable first frame.
function prepare(){
 const video=source();
 if(!video||video.readyState<2||!video.videoWidth)return false;
 if(!stream){
   ensureDimensions();
   stream=canvas.captureStream(24);
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
 try{
   draw(); // Movie, subtitles and adaptive gamma composited BEFORE native PiP.
   await pip.requestPictureInPicture();
   active=true;window.MarmaladeAdaptiveBrightness?.setExternalPlayback?.(true);
   installControls();
   startLoop();
   return true;
 }finally{starting=false;}
}
window.MarmaladeStandalonePiP={enter,isActive:()=>active,draw,getFrames:()=>frame,
  hasVideoOnlySurface:()=>!!pip.srcObject,stop:clean,
  getDiagnostics:()=>({frames:frame,sourceReady:source()?.readyState||0,
    pipReady:pip.readyState,canvasWidth:width,canvasHeight:height,active})};
})();