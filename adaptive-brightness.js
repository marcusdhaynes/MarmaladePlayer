/* Adaptive local brightness: a live luminance-guided gamma tone curve.
   No white overlays, capture permissions, remote uploads, or video replacement.
   The authoritative video element stays in place for playback and streaming. */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const video=$('player'),button=$('brightnessBtn'),slider=$('brightnessSlider');
const panel=$('brightnessPopover'),value=$('brightnessValue');
const funcs=['adaptiveGammaR','adaptiveGammaG','adaptiveGammaB'].map($);
if(!video||!button||!slider||!panel||funcs.some(x=>!x))return;
const KEY='marmalade:adaptive-video-brightness:v1';
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const canvas=document.createElement('canvas');
canvas.width=64;canvas.height=36;
const ctx=canvas.getContext('2d',{willReadFrequently:true,alpha:false});
let level=0,smoothed=1,lastSample=0,sampleTimer=0,unavailableSource=null;
let activeSource='', lastGamma=1,visible=true;
function sourceId(){return video.currentSrc||video.src||'';}
function computeGamma(pixels,percent){
  if(percent<=0)return 1;
  // Histogram of perceived luminance (Rec.709) avoids raising already bright
  // scenes. Ignore near-black letterbox bars and protect white highlights.
  const bins=new Uint32Array(64);
  let count=0,black=0;
  for(let i=0;i<pixels.length;i+=16){
    const a=pixels[i+3];if(a<128)continue;
    const y=(.2126*pixels[i]+.7152*pixels[i+1]+.0722*pixels[i+2])/255;
    if(y<.025){black++;continue;}
    bins[Math.min(63,Math.floor(y*64))]++;count++;
  }
  if(count<35)return 1;
  const percentile=q=>{
    const target=Math.ceil(count*q);
    let total=0;
    for(let i=0;i<64;i++){total+=bins[i];if(total>=target)return (i+.5)/64;}
    return 1;
  };
  const p50=percentile(.5),p90=percentile(.9),p99=percentile(.99);
  // Dark scenes get a stronger shadow-lifting gamma curve. Bright scenes
  // receive only a subtle adjustment. Never add an RGB offset (white haze).
  const darkness=clamp((.57-p50)/.46,0,1);
  const highlightGuard=1-.48*clamp((p99-.82)/.18,0,1);
  const contrastGuard=.7+.3*clamp((p90-p50)/.35,0,1);
  return clamp(1-(percent/100)*.62*darkness*highlightGuard*contrastGuard,.43,1);
}
function apply(exponent){
  const next=clamp(exponent,.43,1);
  if(level===0){
    video.style.removeProperty('filter');
    lastGamma=1;return;
  }
  for(const node of funcs)node.setAttribute('exponent',next.toFixed(4));
  video.style.filter='url("#adaptiveBrightnessGamma")';
  lastGamma=next;
}
function resetSampling(){
  clearTimeout(sampleTimer);sampleTimer=0;lastSample=0;smoothed=1;
  activeSource=sourceId();
  unavailableSource=null;
  apply(level===0?1:1-.24*level/100);
}
function sample(){
  if(!level||!visible||video.readyState<2||video.videoWidth<1||video.videoHeight<1)return;
  const source=sourceId();
  if(source!==activeSource)resetSampling();
  if(!ctx||unavailableSource===source)return;
  try{
    ctx.drawImage(video,0,0,canvas.width,canvas.height);
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    const target=computeGamma(pixels,level);
    // Ease brightness changes to prevent visible flicker during scene cuts.
    smoothed=smoothed*.73+target*.27;
    apply(smoothed);
  }catch{
    // A cross-origin or DRM video can refuse canvas reads. Remain in a
    // safe, bounded gamma mode without interfering with playback.
    unavailableSource=source;
    apply(1-(level/100)*.22);
  }
}
function schedule(){
  clearTimeout(sampleTimer);sampleTimer=0;
  if(!level||!visible)return;
  const now=performance.now();
  if(now-lastSample>=350){
    lastSample=now;sample();
  }
  if(!video.paused && !video.ended)sampleTimer=setTimeout(schedule,350);
}
function setLevel(next){
  level=clamp(Number(next)||0,0,100);
  slider.value=String(level);value.textContent=level+'%';
  button.setAttribute('aria-pressed',String(level>0));
  button.title='Adaptive Brightness · '+level+'%';
  if(level===0){
    clearTimeout(sampleTimer);sampleTimer=0;apply(1);
  }else{
    if(lastGamma===1)apply(1-(level/100)*.24);
    schedule();
  }
  try{localStorage.setItem(KEY,String(level));}catch{}
}
function open(next){
  panel.hidden=!next;
  button.setAttribute('aria-expanded',String(next));
  if(next)slider.focus({preventScroll:true});
}
button.addEventListener('click',event=>{
  event.stopPropagation();open(panel.hidden);
});
slider.addEventListener('input',()=>setLevel(slider.value));
slider.addEventListener('change',()=>schedule());
panel.addEventListener('pointerdown',event=>event.stopPropagation());
panel.addEventListener('click',event=>event.stopPropagation());
document.addEventListener('pointerdown',event=>{
  if(!panel.hidden&&!event.composedPath().includes(button)&&
     !event.composedPath().includes(panel))open(false);
},true);
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&!panel.hidden){open(false);event.stopPropagation();}
},true);
video.addEventListener('loadedmetadata',()=>{resetSampling();schedule();});
video.addEventListener('emptied',resetSampling);
video.addEventListener('seeked',()=>{lastSample=0;schedule();});
video.addEventListener('play',schedule);
video.addEventListener('pause',()=>{clearTimeout(sampleTimer);sampleTimer=0;sample();});
document.addEventListener('visibilitychange',()=>{
  visible=!document.hidden;
  if(visible)schedule();
  else{clearTimeout(sampleTimer);sampleTimer=0;}
});
try{setLevel(Number(localStorage.getItem(KEY))||0);}
catch{setLevel(0);}
window.MarmaladeAdaptiveBrightness={setLevel,getLevel:()=>level,getGamma:()=>lastGamma,
  getSampleState:()=>({source:activeSource,unavailableSource}),computeGamma};
})();
