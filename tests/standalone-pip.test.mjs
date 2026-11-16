/* Regression smoke test for MarmaladePlayer's video-only system PiP.
   Run: node tests/standalone-pip.test.mjs — no browser or camera required. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const source=readFileSync(resolve(root,'standalone-pip.js'),'utf8');
const html=readFileSync(resolve(root,'index.html'),'utf8');
const mobile=readFileSync(resolve(root,'mobile/scripts/prepare-web.mjs'),'utf8');
const desktop=readFileSync(resolve(root,'desktop/scripts/prepare-web.mjs'),'utf8');
const serviceWorker=readFileSync(resolve(root,'sw.js'),'utf8');
const tests=[];
const check=(name,test)=>{assert.ok(test,name);tests.push(name);};
const traces=[],events=new Map(),handlers={},clicks={},timers=new Map();
let timerId=0,outputPixels=null,external=false,captionDraws=0;
const media={
 readyState:4,videoWidth:640,videoHeight:360,paused:false,currentTime:12,
 duration:120,playbackRate:1,addEventListener:(name,fn)=>events.set('media:'+name,fn)
};
const context={
 drawImage(){traces.push('draw')},
 getImageData(){return {data:new Uint8ClampedArray([30,60,90,255])}},
 putImageData(image){outputPixels=[...image.data]},
 measureText(line){return {width:line.length*8}},
 strokeText(){},
 fillText(){captionDraws++}
};
const track={readyState:'live',requestFrame(){traces.push('requestFrame')}};
const stream={getVideoTracks(){return [track]}};
const canvas={
 width:0,height:0,getContext(){return context},
 captureStream(){traces.push('captureStream');return stream}
};
const pip={
 paused:true,readyState:0,style:{},setAttribute(){},
 addEventListener(name,fn){events.set('pip:'+name,fn)},
 set srcObject(value){this._srcObject=value;traces.push('attachStream')},
 get srcObject(){return this._srcObject},
 play(){this.paused=false;this.readyState=2;return Promise.resolve()},
 pause(){this.paused=true},
 requestPictureInPicture(){traces.push('requestPiP');document.pictureInPictureElement=this;return Promise.resolve()}
};
const button=(name,act)=>({
 disabled:false,value:'0',
 click(){clicks[name]=(clicks[name]||0)+1;act?.()},
 dispatchEvent(){clicks.seek=(clicks.seek||0)+1}
});
const subtitleOverlay={hidden:false,textContent:'مرحبا\nHello',dir:'rtl'};
const elements={
 player:media,hostMonitor:{readyState:0},subtitleOverlay,
 playPause:button('play',()=>{media.paused=!media.paused}),
 skipBack:button('back'),skipForward:button('forward'),seek:button('seek')
};
const document={
 pictureInPictureEnabled:true,pictureInPictureElement:null,
 createElement:tag=>tag==='canvas'?canvas:pip,
 getElementById:id=>elements[id],
 querySelector(){return null},
 body:{appendChild(){}},
 exitPictureInPicture(){return Promise.resolve()}
};
const mediaSession={
 setActionHandler(action,fn){handlers[action]=fn;traces.push('action:'+action)},
 setPositionState(value){this.position=value},
 playbackState:'none'
};
const navigator={mediaSession};
const window={
 MarmaladeSubtitleRefresh(){},
 MarmaladeAdaptiveBrightness:{
  getLevel(){return 75},getGamma(){return .72},
  setExternalPlayback(value){external=value}
 },
 addEventListener(){}
};
const getComputedStyle=()=>({fontSize:'24px',fontWeight:'650',fontFamily:'sans-serif',direction:'rtl'});
const startup=new Function('document','window','navigator','setInterval',
 'clearInterval','console','Event','getComputedStyle',source);
startup(document,window,navigator,
 fn=>{timers.set(++timerId,fn);return timerId;},
 id=>{timers.delete(id)},
 {debug(){}},class Event{constructor(type){this.type=type}},getComputedStyle);
check('01: Mini-player module available',typeof window.MarmaladeStandalonePiP?.enter==='function');
check('02: Prewarming captures before drawing',traces.length===0);
const entered=await window.MarmaladeStandalonePiP.enter();
check('03: Standalone PiP opens',entered===true&&document.pictureInPictureElement===pip);
check('04: Canvas track created before frame painting',
 traces.indexOf('captureStream')>=0&&traces.indexOf('captureStream')<traces.indexOf('draw'));
check('05: Captured brightness pixels are not black',
 outputPixels?.slice(0,3).every(value=>value>0));
check('06: Adaptive gamma lifts shadows',outputPixels?.[0]>30);
check('07: Existing subtitles composited into video',captionDraws>=2);
check('08: Native controls installed before PiP opens',
 traces.indexOf('action:play')>=0&&traces.indexOf('action:play')<traces.indexOf('requestPiP'));
check('09: Play/Pause and skip controls registered',
 ['play','pause','previoustrack','nexttrack','seekbackward','seekforward'].every(name=>typeof handlers[name]==='function'));
check('10: Native position seeking registered',typeof handlers.seekto==='function');
check('11: Original progress used for PiP position',mediaSession.position?.duration===120);
check('12: Adaptive brightness continues in PiP',external===true);
handlers.pause();handlers.previoustrack();handlers.nexttrack();handlers.seekto({seekTime:60});
check('13: Native controls act on authoritative player',
 clicks.play===1&&clicks.back===1&&clicks.forward===1&&clicks.seek===1);
check('14: No Document PiP or WebView overlay used',
 !source.includes('documentPictureInPicture')&&!source.includes('getUserMedia')&&
 !source.includes('getDisplayMedia'));
events.get('pip:leavepictureinpicture')();
check('15: PiP exit clears temporary handlers',Object.values(handlers).every(value=>value===null));
check('16: PiP exit ends external sampling',external===false);
check('17: Web app imports the module',html.includes('standalone-pip.js?v='));
check('18: Mobile packages the module',mobile.includes("'standalone-pip.js'"));
check('19: Desktop packages the module',desktop.includes("'standalone-pip.js'"));
check('20: Offline app caches the module',serviceWorker.includes("'./standalone-pip.js'"));
console.log('PASS: '+tests.length+' MarmaladePlayer standalone PiP regression checks');
