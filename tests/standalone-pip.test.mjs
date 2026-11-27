/* Regression smoke test for MarmaladePlayer's video-only system PiP.
   Run: node tests/standalone-pip.test.mjs — no browser or camera required. */
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
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
let timerId=0,external=false,captionDraws=0,frameCallback=null,filteredDraws=0,readbacks=0;
const media={
 readyState:4,videoWidth:640,videoHeight:360,paused:false,currentTime:12,
 duration:120,playbackRate:1,addEventListener:(name,fn)=>events.set('media:'+name,fn),
 requestVideoFrameCallback(fn){frameCallback=fn;return 1},cancelVideoFrameCallback(){frameCallback=null}
};
const context={
 filter:'none',save(){},restore(){},clearRect(){},
 drawImage(){traces.push('draw');if(this.filter!=='none')filteredDraws++},
 getImageData(){readbacks++;throw Error('GPU readback forbidden')},
 putImageData(){readbacks++;throw Error('CPU upload forbidden')},
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
const windowEvents=new Map();
const pipWindow={width:320,height:180,addEventListener(name,fn){windowEvents.set(name,fn)},removeEventListener(name){windowEvents.delete(name)}};
const pip={
 paused:true,readyState:0,style:{},setAttribute(){},
 addEventListener(name,fn){events.set('pip:'+name,fn)},
 set srcObject(value){this._srcObject=value;traces.push('attachStream')},
 get srcObject(){return this._srcObject},
 play(){this.paused=false;this.readyState=2;return Promise.resolve()},
 pause(){this.paused=true},
 requestPictureInPicture(){traces.push('requestPiP');document.pictureInPictureElement=this;return Promise.resolve(pipWindow)}
};
const button=(name,act)=>({
 disabled:false,value:'0',
 click(){clicks[name]=(clicks[name]||0)+1;act?.()},
 dispatchEvent(){clicks.seek=(clicks.seek||0)+1}
});
const subtitleOverlay={hidden:false,textContent:'مرحبا\nHello',dir:'rtl',style:{cssText:''}};
const elements={
 player:media,hostMonitor:{readyState:0,addEventListener(){}},subtitleOverlay,
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
const getComputedStyle=()=>({fontSize:'24px',fontWeight:'500',fontFamily:'sans-serif',direction:'rtl',color:'#fff'});
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
check('05: Video rendering uses browser filter without CPU pixel copies',filteredDraws>0&&readbacks===0);
check('06: Frame delivery is driven by decoded video frames',typeof frameCallback==='function'&&traces.includes('requestFrame'));
check('07: Existing subtitles composited into video',captionDraws>=2);
check('08: Native controls installed before PiP opens',
 traces.indexOf('action:play')>=0&&traces.indexOf('action:play')<traces.indexOf('requestPiP'));
check('09: Play/Pause and skip controls registered',
 ['play','pause','previoustrack','nexttrack','seekbackward','seekforward'].every(name=>typeof handlers[name]==='function'));
check('10: Native position seeking registered',typeof handlers.seekto==='function');
check('11: Original progress used for PiP position',mediaSession.position?.duration===120);
check('12: Adaptive brightness continues in PiP',external===true);
const previousCaptionDraws=captionDraws;frameCallback();
check('12a: Unchanged subtitles rasterize only once',captionDraws===previousCaptionDraws);
media.videoWidth=800;media.videoHeight=600;frameCallback();
const dims=window.MarmaladeStandalonePiP.getDiagnostics();
check('12b: Non-16:9 source ratio preserved',Math.abs(dims.canvasWidth/dims.canvasHeight-4/3)<.01);
check('12c: Subtitle canvas rerenders when source dimensions change',captionDraws>previousCaptionDraws);
pipWindow.width=320;pipWindow.height=180;windowEvents.get('resize')();
const padded=window.MarmaladeStandalonePiP.getDiagnostics();
check('12d: OS-constrained PiP canvas matches its viewport',Math.abs(padded.canvasWidth/padded.canvasHeight-16/9)<.02);
check('12e: Picture retains 4:3 inside 16:9 viewport',Math.abs(padded.pictureWidth/padded.pictureHeight-4/3)<.02);
check('12f: Hidden playback element geometry is not square',pip.style.aspectRatio===padded.canvasWidth+' / '+padded.canvasHeight);
check('12g: Worker reads decoded media frames via transferable streams',source.includes('new MediaStreamTrackProcessor')&&source.includes('new MediaStreamTrackGenerator')&&source.includes('m.readable.pipeThrough')&&source.includes('pipeTo(m.writable)'));
check('12h: Worker path does not start page frame timers',source.includes('if(worker){draw();return;}'));
check('12i: Worker closes decoded frames after processing',source.includes('finally{frame.close();}'));
handlers.pause();handlers.previoustrack();handlers.nexttrack();handlers.seekto({seekTime:60});
check('13: Native controls act on authoritative player',
 clicks.play===1&&clicks.back===1&&clicks.forward===1&&clicks.seek===1);
check('14: No Document PiP or WebView overlay used',
 !source.includes('documentPictureInPicture')&&!source.includes('getUserMedia')&&
 !source.includes('getDisplayMedia'));
events.get('pip:leavepictureinpicture')();
check('15: PiP exit clears temporary handlers',Object.values(handlers).every(value=>value===null));
check('16: PiP exit ends external sampling',external===false&&frameCallback===null);
check('17: Web app imports the module',html.includes('standalone-pip.js?v='));
check('18: Mobile packages the module',mobile.includes("'standalone-pip.js'"));
check('19: Desktop packages the module',desktop.includes("'standalone-pip.js'"));
const cacheScope='https://example.test/MarmaladePlayer/';
const pipAsset=html.match(/<script\b[^>]*\bsrc=["']([^"']*standalone-pip\.js\?v=[^"']+)["']/i)?.[1];
const offlineAssets=runInNewContext(serviceWorker+'\n;discover(html)',{self:{registration:{scope:cacheScope},addEventListener(){}},URL,html});
check('20: Offline app caches the exact versioned module',Boolean(pipAsset)&&offlineAssets.includes(new URL(pipAsset,cacheScope).href));
console.log('PASS: '+tests.length+' MarmaladePlayer standalone PiP regression checks');
