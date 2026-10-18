import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { chromium } from 'playwright';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const infoJs = readFileSync(new URL('../movie-info.js', import.meta.url), 'utf8');
const parserStart = infoJs.indexOf('function parseFilename(name) {');
assert(parserStart >= 0, 'The filename parser must remain available');
const parserEnd = infoJs.indexOf('\n  }', parserStart);
const parserBody = infoJs.slice(parserStart, parserEnd + 4);
assert(parserBody, 'The filename parser must remain available');
const parseMovieFilename = new Function('name', 'return ('+parserBody+')(name)');
assert.deepEqual(parseMovieFilename('The.Matrix.1999.1080p.BluRay.x264.mkv'),
  {title:'The Matrix',year:1999,kind:'movie',season:null,episode:null});
assert.deepEqual(parseMovieFilename('Interstellar (2014) [1080p].mp4'),
  {title:'Interstellar',year:2014,kind:'movie',season:null,episode:null});
assert.deepEqual(parseMovieFilename('Oz.S02E02.WEBRip.mkv'),
  {title:'Oz',year:null,kind:'tv',season:2,episode:2});
assert.deepEqual(parseMovieFilename('The.Last.of.Us.1x03.720p.mp4'),
  {title:'The Last of Us',year:null,kind:'tv',season:1,episode:3});
const port = 38817;
const server = createServer((req,res) => {
  if (req.url?.startsWith('/manifest.webmanifest')) {
    res.writeHead(200, {'content-type':'application/manifest+json'});
    res.end('{"name":"Marmalade","start_url":"./"}');
  } else if (req.url?.startsWith('/favicon.svg')) {
    res.writeHead(200, {'content-type':'image/svg+xml'}); res.end('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  } else if (req.url?.startsWith('/movie-info.js')) {
    res.writeHead(200, {'content-type':'application/javascript'});
    res.end(readFileSync(new URL('../movie-info.js', import.meta.url), 'utf8'));
  } else if (req.url?.startsWith('/movie-info.css')) {
    res.writeHead(200, {'content-type':'text/css'});
    res.end(readFileSync(new URL('../movie-info.css', import.meta.url), 'utf8'));
  } else if (req.url?.startsWith('/sw.js')) {
    res.writeHead(200, {'content-type':'application/javascript'}); res.end('');
  } else {
    res.writeHead(200, {'content-type':'text/html;charset=utf-8'});res.end(html);
  }
});
await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
const browser = await chromium.launch({headless:true,args:['--no-sandbox']});
try {
  for(const viewport of [{width:1366,height:900},{width:390,height:844}]) {
    const page = await browser.newPage({viewport});
    const errors=[];
    page.on('pageerror', error => errors.push(error.stack || String(error)));
    await page.route('**/npm/peerjs@*/**', route=>route.fulfill({status:200,contentType:'application/javascript',body:'window.Peer = function(){};'}));
    await page.route('**/mediainfo.js@*', route=>route.fulfill({status:200,contentType:'application/javascript',body:'window.MediaInfo = async () => ({analyzeData:async()=>({media:{track:[]}})});'}));
    await page.goto('http://127.0.0.1:'+port+'/',{waitUntil:'domcontentloaded'});
    await page.waitForTimeout(400);
    assert.equal(await page.locator('#player').count(),1);
    assert.equal(await page.locator('#overlayPlay').count(),0,'Floating center play icon removed');
    assert.equal(await page.locator('.transport').count(),0,'Old Now Playing panel must be gone');
    assert.equal(await page.locator('#theaterControls').count(),1);
    assert.equal(await page.locator('#volume').getAttribute('max'),'200');
    assert.equal(await page.locator('#subtitlesBtn').count(),1);
    assert.equal(await page.locator('#popoutBtn').count(),1);
    assert.equal(await page.locator('#settingsBtn').count(),1);
    for (const id of ['skipBack','playPause','skipForward','muteBtn','subtitlesBtn',
        'mediaInfoToggle','popoutBtn','fullscreenBtn','settingsBtn']) {
      assert.equal(await page.locator('#'+id+' svg.glass-icon').count(),1,
        'Crisp vector artwork must replace Unicode glyphs for '+id);
      assert.equal(await page.locator('#'+id+' svg').getAttribute('stroke-width'),'1.5');
    }
    assert.equal(await page.locator('#bufferedFill').count(),1);
    assert.equal(await page.locator('.buffer-line').count(),0,'Remove old buffer strip');
    assert.equal(await page.locator('#networkLabel').isVisible(),false,'No WebRTC Active label');
    assert.equal(await page.locator('#subtitlesBtn .captions-icon').count(),1,'Caption icon replaces CC letters');
    assert.equal((await page.locator('#subtitlesBtn').textContent()).trim(),'','No CC text');
    assert.equal(await page.locator('#bufferToggle').getAttribute('aria-pressed'),'false');
    assert.equal(await page.locator('#bufferReadout').isVisible(),false,'Buffer readout is off initially');
    assert.equal(await page.locator('#joinSection').isVisible(),true,'Join field must be visible initially');
    assert.equal(await page.locator('.compact-cdn').isVisible(),true,'CDN option must remain');
    assert.equal(await page.locator('#hostTab').isVisible(),false,'No manual Host/Join tabs');
    assert.equal(await page.locator('#chooseFile').isVisible(),false,'File picker belongs in the video');
    assert.equal(await page.locator('.panel-intro').count(),0,'Remove decorative sidebar intro');
    const openedFilePicker = await page.locator('#dropZone').evaluate(stage => {
      let clicks=0;
      const f=document.getElementById('fileInput');
      f.addEventListener('click', e=>{clicks++; e.preventDefault();},{once:true});
      stage.click();
      return clicks;
    });
    assert.equal(openedFilePicker,1,'Clicking empty video must open file picker');
    const order = await page.locator('.theater-bottom button').evaluateAll(buttons=>buttons.map(b=>b.id));
    assert.deepEqual(order,['skipBack','playPause','skipForward','muteBtn','subtitlesBtn','mediaInfoToggle','popoutBtn','fullscreenBtn','settingsBtn']);
    assert.equal(await page.locator('#mediaInfoPanel').isVisible(),false,'Info drawer starts closed');
    await page.waitForFunction(() => typeof window.MarmaladeInfoShare === 'function');
    await page.locator('#mediaInfoToggle').evaluate(button => button.click()); // Theater controls are intentionally hover-hidden until media loads.
    assert.equal(await page.locator('#mediaInfoPanel').isVisible(),true,'Info button opens drawer');
    assert.equal(await page.locator('#miSources').count(),1,'API sources exist');
    await page.locator('#miClose').click();
    assert.equal(await page.locator('#mediaInfoPanel').isVisible(),false,'Close button hides drawer');
    // No dependence on browser autoplay or a remote network for UI tests.
    await page.locator('#dropZone').evaluate(el=>el.classList.add('has-video'));
    await page.locator('#settingsBtn').click({force:true});
    assert.equal(await page.locator('#settingsPanel').isVisible(),true);
    const palette=await page.locator('#settingsPanel').evaluate(panel=>{
      const r=panel.getBoundingClientRect();
      return {detached:panel.parentElement===document.body,
        clipped: r.top < -1 || r.left < -1 || r.right > innerWidth+1 || r.bottom > innerHeight+1,
        stageContains: document.querySelector('#dropZone').contains(panel),
        stageBottom:document.querySelector('#dropZone').getBoundingClientRect().bottom,
        paletteTop:r.top};
    });
    assert.equal(palette.detached,true,'Settings palette must be outside clipped video');
    assert.equal(palette.stageContains,false,'Stage may not clip Settings');
    assert.equal(palette.clipped,false,'Settings must remain fully visible within viewport');
    await page.locator('#joinTab').evaluate(el=>el.click()); // hidden compatibility action, not user-facing
    await page.locator('#dropZone').evaluate(el=>el.classList.add('has-video'));
    const options=await page.locator('#qualitySelect option').allTextContents();
    assert(options.some(x=>x.includes('480')));
    assert(options.some(x=>x.includes('720')));
    await page.locator('#settingsBtn').click({force:true});
    await page.locator('#closeSettingsPanel').click({force:true});
    await page.evaluate(()=>{const el=document.querySelector('#volume');el.value='0';el.dispatchEvent(new Event('input',{bubbles:true}));});
    assert.equal(await page.locator('#player').evaluate(el=>el.muted),true,'0% must hard-mute video element');
    assert.equal(await page.locator('#muteBtn svg.glass-icon').count(),1,
      'Mute must retain thin SVG artwork when muted');
    assert.equal(await page.locator('#volumeMark').textContent(),'0%');
    await page.evaluate(()=>{const el=document.querySelector('#volume');el.value='200';el.dispatchEvent(new Event('input',{bubbles:true}));});
    assert.equal(await page.locator('#volumeMark').textContent(),'100%','100% volume detent');
    await page.evaluate(()=>{const el=document.querySelector('#volume');el.value='200';el.dispatchEvent(new Event('input',{bubbles:true}));});
    assert.equal(await page.locator('#volumeMark').textContent(),'200%');
    await page.locator('#bufferToggle').click({force:true});
    assert.equal(await page.locator('#bufferToggle').getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('#bufferReadout').isVisible(),true);
    assert.match((await page.locator('#bufferReadout').textContent()).trim(),/^(?:—|\d+\.\d)s$/,'Only forward seconds appear');
    await page.locator('#bufferToggle').click({force:true});
    assert.equal(await page.locator('#bufferReadout').isVisible(),false);
    await page.locator('#fpsToggle').click({force:true});
    assert.equal(await page.locator('#fpsToggle').getAttribute('aria-pressed'),'true');
    await page.locator('#statusToggle').click({force:true});
    assert.equal(await page.locator('#statusToggle').getAttribute('aria-pressed'),'false');
    await page.locator('#subtitlesBtn').click({force:true});
    assert.equal(await page.locator('#subtitlePanel').isVisible(),true);
    await page.locator('#subtitleFile').setInputFiles({name:'test.vtt',mimeType:'text/vtt',buffer:Buffer.from('WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHello from subtitles!\n')});
    await page.waitForFunction(()=>document.querySelector('#subtitleName')?.textContent?.includes('1 cues'),{timeout:3000});
    const overflow = await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2);
    assert.equal(overflow,false,'Theater must fit mobile viewport');
    assert.deepEqual(errors,[], 'Browser runtime errors');
    await page.close();
    console.log('PASS',viewport.width,'x',viewport.height,'theater UI / volume / subtitles / FPS');
  }

  // Simulated signaling: verify that the entry point determines Host or Guest.
  const fakePeer = `
    window.__peerTrace=[];
    window.__connections=[];
    window.__peers=[];
    window.Peer = class MockPeer {
      constructor(id) {this.id=typeof id==='string'?id:'guest-test';this.open=true;this.handlers={};window.__peers.push(this);window.__peerTrace.push(['constructed',this.id]);}
      on(name,callback) {
        this.handlers[name]=callback;window.__peerTrace.push(['peer-on',name]);
        if(name==='open') setTimeout(()=>{window.__peerTrace.push(['peer-open',this.id]);callback(this.id)},0);
      }
      connect(id) {
        window.__peerTrace.push(['connect',id]);
        const conn={
          peer:id,open:false,callbacks:{},sent:[],
          on(name,callback){this.callbacks[name]=callback;window.__peerTrace.push(['connection-on',name]);
            if(name==='open' && !window.__deferConnOpen)
              setTimeout(()=>{this.open=true;window.__peerTrace.push(['connection-open']);callback();},0);},
          send(message){this.sent.push(message);},close(){this.open=false;}
        };
        window.__connections.push(conn);
        return conn;
      }
      destroy(){}
      reconnect(){}
    };
  `;
  async function launchRoomPage(path='/',opts={}) {
    const page=await browser.newPage({viewport:{width:1280,height:800}});
    if(opts.deferConnectionOpen)await page.addInitScript(()=>{window.__deferConnOpen=true;});
    if(opts.hungAudio)await page.addInitScript(()=>{
      const Original=window.AudioContext || window.webkitAudioContext;
      window.__audioContextsCreated=0;
      class SuspendedAudioContext extends Original {
        constructor(...args){ super(...args); window.__audioContextsCreated++; }
        resume(){return new Promise(()=>{});}
      }
      window.AudioContext=SuspendedAudioContext;
      window.webkitAudioContext=SuspendedAudioContext;
    });
    const errors=[];
    page.on('pageerror',e=>errors.push(e.stack||String(e)));
    await page.route('**/npm/peerjs@*/**',route=>route.fulfill({
      status:200,contentType:'application/javascript',body:fakePeer}));
    await page.route('**/mediainfo.js@*', route=>route.fulfill({status:200,contentType:'application/javascript',body:'window.MediaInfo = async () => ({analyzeData:async()=>({media:{track:[]}})});'}));
    await page.goto('http://127.0.0.1:'+port+path,{waitUntil:'load'});
    return {page,errors};
  }
  {
    const {page,errors}=await launchRoomPage();
    await page.locator('#fileInput').setInputFiles({
      name:'movie.mp4',mimeType:'video/mp4',buffer:Buffer.from('not a real mp4')
    });
    await page.waitForFunction(()=>!document.querySelector('#hostActive').hidden);
    assert((await page.locator('#inviteLink').inputValue()).includes('?room='));
    await page.evaluate(()=>{
      const video=document.querySelector('#player');
      Object.defineProperty(video,'buffered',{configurable:true,value:{length:1,start:()=>0,end:()=>18}});
      Object.defineProperty(video,'currentTime',{configurable:true,value:10});
      Object.defineProperty(video,'duration',{configurable:true,value:100});
    });
    await page.locator('#bufferToggle').click({force:true});
    await page.waitForFunction(()=>document.querySelector('#bufferReadout')?.textContent === '8.0s',null,{timeout:3000});
    await page.locator('#bufferToggle').click({force:true});
    assert.equal(await page.locator('#joinSection').isVisible(),false);
    assert.deepEqual(errors,[],'Hosting must not produce runtime errors');
    await page.close();
    console.log('PASS choose-file automatically creates host room');
  }
  {
    const {page,errors}=await launchRoomPage();
    await page.locator('#roomInput').fill('ABCDEFGH');
    await page.waitForTimeout(800);
    console.log('AUTOJOIN TRACE', JSON.stringify(await page.evaluate(()=>({
      role:document.querySelector('#hostTab')?.getAttribute('aria-selected'),
      code:document.querySelector('#roomInput')?.value,
      connected:!document.querySelector('#joinActive')?.hidden,
      label:document.querySelector('#connectionText')?.textContent,
      peerType:typeof window.Peer,
      joinSectionHidden:document.querySelector('#joinSection')?.hidden,
      trace:window.__peerTrace
    }))),errors.join(' | '));
    await page.waitForFunction(()=>!document.querySelector('#joinActive').hidden,null,{timeout:5500});
    assert.equal(await page.locator('#joinedCode').textContent(),'ABCDEFGH');
    assert.equal(await page.locator('#joinSection').isVisible(),false);
    assert.deepEqual(errors,[],'Pasted room must join cleanly');
    await page.close();
    console.log('PASS pasted code automatically joins guest room');
  }



  // Regression: the media call can arrive before its data channel opens.
  // The later room-open event must not cover a playing guest video.
  {
    const {page,errors}=await launchRoomPage('/?room=ABCDEFGH',{deferConnectionOpen:true});
    await page.waitForFunction(()=>window.__connections?.length===1);
    await page.evaluate(()=>{
      const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;
      const ctx=canvas.getContext('2d');
      ctx.fillStyle='red';ctx.fillRect(0,0,160,90);
      window.__earlyCanvas=canvas;
      window.__earlyFrameTimer=setInterval(()=>ctx.fillRect(0,0,160,90),40);
      const stream=canvas.captureStream(24);
      const handlers={};
      window.__earlyCall={
        peer:'marmalade-ABCDEFGH',metadata:{mediaId:11},
        on(name,cb){handlers[name]=cb;},
        answer(){setTimeout(()=>handlers.stream(stream),10);},
        close(){handlers.close?.();}
      };
      window.__peers[0].handlers.call(window.__earlyCall);
    });
    await page.waitForFunction(()=>document.querySelector('#player').srcObject &&
      document.querySelector('#dropZone').classList.contains('has-video'),null,{timeout:6000});
    await page.evaluate(()=>{
      const conn=window.__connections[0];conn.open=true;conn.callbacks.open();
    });
    await page.waitForTimeout(120);
    assert.equal(await page.locator('#dropZone').evaluate(el=>el.classList.contains('has-video')),true,
      'Late room-open event must never cover video already received');
    const confirmations=await page.evaluate(()=>window.__connections[0].sent
      .filter(x=>x.type==='media-received'));
    assert(confirmations.some(x=>x.id===11),'Guest acknowledges early media after room opens');
    assert.deepEqual(errors,[]);
    await page.evaluate(()=>clearInterval(window.__earlyFrameTimer));
    await page.close();
    console.log('PASS early media offer persists across late data-channel open');
  }

  // Android browser regression: AudioContext.resume() can remain pending
  // until another tap. That must never block receiving or showing video.
  {
    const {page,errors}=await launchRoomPage('/?room=ABCDEFGH',{hungAudio:true});
    await page.waitForFunction(()=>!document.querySelector('#joinActive').hidden);
    await page.evaluate(()=>{
      window.__connections[0].callbacks.data({
        type:'state',playing:true,live:true,time:0,duration:30,revision:1,
        mediaKind:'file',name:'movie.webm',sourceWidth:160,sourceHeight:90,fingerprint:''
      });
      const cv=document.createElement('canvas');cv.width=160;cv.height=90;
      const context=cv.getContext('2d');context.fillStyle='red';
      context.fillRect(0,0,160,90);
      window.__videoFrames=setInterval(()=>context.fillRect(0,0,160,90),40);
      const stream=cv.captureStream(24);
      const handlers={};
      const call={
        peer:'marmalade-ABCDEFGH',metadata:{mediaId:8},
        on(name,cb){handlers[name]=cb;},
        answer(){setTimeout(()=>handlers.stream(stream),30);},
        close(){handlers.close?.();}
      };
      window.__peers[0].handlers.call(call);
    });
    await page.waitForFunction(()=>{
      const video=document.querySelector('#player');
      return !video.paused && video.videoWidth>0 && video.readyState>=2;
    },null,{timeout:9000});
    const proof=await page.evaluate(()=>{
      const v=document.querySelector('#player');
      const c=document.createElement('canvas');c.width=32;c.height=20;
      const cx=c.getContext('2d');cx.drawImage(v,0,0,32,20);
      return {rgb:Array.from(cx.getImageData(16,10,1,1).data),
        contextsCreated:window.__audioContextsCreated,
        status:document.querySelector('#connectionText').textContent};
    });
    assert(proof.rgb[0]>130 && proof.rgb[0]>proof.rgb[1]*2,
      'Guest picture must play while Web Audio would remain suspended');
    assert.equal(proof.contextsCreated,0,
      'Joining and receiving a movie must not create a suspended AudioContext');
    await page.evaluate(()=>clearInterval(window.__videoFrames));
    assert.deepEqual(errors,[]);
    await page.close();
    console.log('PASS Android suspended AudioContext does not block receiving video frames',JSON.stringify(proof));
  }
  // Autoplay restrictions must never leave a joined guest with only a black
  // player because the old center play control no longer exists.
  {
    const {page,errors}=await launchRoomPage('/?room=ABCDEFGH');
    await page.waitForFunction(()=>!document.querySelector('#joinActive').hidden,null,{timeout:6000});
    await page.evaluate(()=>{
      window.__connections[0].callbacks.data({
        type:'state',playing:true,live:true,time:0,duration:20,revision:1,
        mediaKind:'file',name:'red-test.webm',sourceWidth:160,sourceHeight:90,
        fingerprint:''
      });
      const canvas=document.createElement('canvas');
      canvas.width=160;canvas.height=90;
      const ctx=canvas.getContext('2d');
      ctx.fillStyle='red';ctx.fillRect(0,0,160,90);
      const interval=setInterval(()=>ctx.fillRect(0,0,160,90),42);
      window.__autoplayInterval=interval;
      const output=canvas.captureStream(24);
      const player=document.querySelector('#player');
      const actualPlay=player.play.bind(player);
      window.__blockedAutoplay=0;
      player.play=function(){
        if(!this.muted && window.__blockedAutoplay++===0)
          return Promise.reject(new DOMException('Autoplay policy prevents sound','NotAllowedError'));
        return actualPlay();
      };
      const callHandlers={};
      const incoming={
        peer:'marmalade-ABCDEFGH',handlers:callHandlers,
        on(name,cb){callHandlers[name]=cb;},
        answer(){setTimeout(()=>callHandlers.stream(output),30);},
        close(){if(callHandlers.close)callHandlers.close();}
      };
      window.__peers[0].handlers.call(incoming);
    });
    await page.waitForFunction(()=>{
      const p=document.querySelector('#player');
      return !p.paused && p.muted && document.querySelector('#dropZone').classList.contains('needs-gesture');
    },null,{timeout:8000});
    assert.equal(await page.locator('#dropZone').evaluate(el=>el.classList.contains('has-video')),true);
    await page.waitForFunction(()=>parseFloat(getComputedStyle(document.querySelector('#theaterControls')).opacity)>0.95,null,{timeout:2000});
    assert.equal(await page.locator('#playPause').isDisabled(),false,'Guest Play must remain operable');
    await page.locator('#playPause').evaluate(el=>el.click());
    await page.waitForFunction(()=>{
      const player=document.querySelector('#player');
      return !player.muted && !document.querySelector('#dropZone').classList.contains('needs-gesture');
    },null,{timeout:8000});
    await page.evaluate(()=>clearInterval(window.__autoplayInterval));
    assert.deepEqual(errors,[],'Autoplay fallback should not throw');
    await page.close();
    console.log('PASS blocked audible autoplay falls back to visible muted video, then unmute via Play');
  }
  // Real moving-video regression: ensure the host's outgoing canvas track
  // contains picture data and the receiving WebRTC decoder doesn't get black.
  {
    const dir=mkdtempSync(join(tmpdir(),'marmalade-video-'));
    let bytes;
    try {
      const path=join(dir,'red-test.webm');
      execFileSync('ffmpeg',['-hide_banner','-loglevel','error',
        '-f','lavfi','-i','color=c=red:s=320x180:r=24','-t','9',
        '-an','-c:v','libvpx','-pix_fmt','yuv420p',
        '-deadline','realtime','-cpu-used','5','-crf','24','-b:v','0','-y',path],
        {timeout:25000});
      bytes=readFileSync(path);
    } finally {rmSync(dir,{recursive:true,force:true});}
    const {page,errors}=await launchRoomPage();
    await page.addInitScript(()=>{});
    await page.evaluate(()=>{
      const original=HTMLCanvasElement.prototype.captureStream;
      HTMLCanvasElement.prototype.captureStream=function(...args) {
        const output=original.apply(this,args);
        window.__hostCanvasCapture={canvas:this,stream:output};
        return output;
      };
    });
    await page.locator('#fileInput').setInputFiles({name:'red-test.webm',mimeType:'video/webm',buffer:bytes});
    await page.waitForFunction(()=>!document.querySelector('#hostActive').hidden);
    await page.waitForFunction(()=>document.querySelector('#playPause').disabled===false,{timeout:5000});
    await page.locator('#playPause').evaluate(el=>el.click());
    await page.waitForFunction(()=>window.__hostCanvasCapture?.stream.getVideoTracks()[0]?.readyState==='live',null,{timeout:6000});
    await page.waitForTimeout(1400);
    const samples=await page.evaluate(async ()=>{
      const video=document.querySelector('#player');
      const cap=window.__hostCanvasCapture;
      const read=(source,w,h)=>{
        const c=document.createElement('canvas');c.width=w;c.height=h;
        const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(source,0,0,w,h);
        const data=ctx.getImageData(w/2|0,h/2|0,1,1).data;
        return Array.from(data);
      };
      const host=read(video,64,36);
      const canvas=read(cap.canvas,64,36);
      const receiver=document.createElement('video');
      receiver.muted=true;receiver.autoplay=true;receiver.playsInline=true;
      receiver.srcObject=cap.stream;
      document.body.appendChild(receiver);
      await receiver.play();
      await new Promise(resolve=>setTimeout(resolve,600));
      const captured=receiver.videoWidth?read(receiver,64,36):null;
      receiver.remove();
      return {host,canvas,captured,hostTime:video.currentTime,captureReady:cap.stream.getVideoTracks()[0].readyState};
    });
    console.log('OUTBOUND VIDEO DIAGNOSTIC',JSON.stringify(samples),errors);
    assert(samples.host[0]>130 && samples.host[0]>samples.host[1]*2,'Host sample must be red');
    assert(samples.canvas[0]>130 && samples.canvas[0]>samples.canvas[1]*2,'Canvas broadcast sample must not be black');
    assert(samples.captured && samples.captured[0]>130 && samples.captured[0]>samples.captured[1]*2,'Captured guest video track must show the actual movie');
    assert.deepEqual(errors,[],'Capture test browser errors');
    await page.close();
    console.log('PASS captured outgoing movie frames visible to a receiving player');
  }

  // Mobile and slow-network signaling regressions: no endless Joining screen.
  {
    const {page,errors}=await launchRoomPage();
    await page.locator('#roomInput').fill('ABCDEFGH');
    await page.waitForFunction(()=>!document.querySelector('#joinActive').hidden);
    assert.equal(await page.locator('#joinProgress').isVisible(),false);
    assert.equal(await page.locator('#retryJoin').isVisible(),false);
    assert.deepEqual(errors,[]);
    await page.close();
    console.log('PASS quick guest connect hides progress and retry controls');
  }
  {
    const {page,errors}=await launchRoomPage();
    await page.locator('#roomInput').fill('ABCDEFGH');
    await page.waitForFunction(()=>!document.querySelector('#joinActive').hidden);
    await page.locator('#leaveRoom').click();
    // Suppress the next data-channel open to exercise Cancel on an in-flight join.
    await page.evaluate(()=>{
      window.Peer.prototype.connect=function(id){
        const conn={peer:id,open:false,handlers:{},on(n,cb){this.handlers[n]=cb;},
          send(){},close(){this.open=false;}};
        window.__connections.push(conn);return conn;
      };
    });
    await page.locator('#roomInput').fill('ABCDEFGH');
    await page.locator('#roomInput').press('Enter');
    await page.waitForFunction(()=>!document.querySelector('#joinProgress').hidden);
    assert.equal(await page.locator('#cancelJoin').isVisible(),true);
    await page.locator('#cancelJoin').click();
    assert.equal(await page.locator('#joinProgress').isVisible(),false);
    assert.equal(await page.locator('#joinSection').isVisible(),true);
    assert.equal(await page.locator('#connectionText').textContent(),'Not connected');
    assert.deepEqual(errors,[]);
    await page.close();
    console.log('PASS guest can cancel a hanging join and retry later');
  }
  {
    const {page,errors}=await launchRoomPage();
    await page.evaluate(()=>{
      window.Peer.prototype.connect=function(id){
        const conn={peer:id,open:false,handlers:{},on(n,cb){this.handlers[n]=cb;},
          send(){},close(){this.open=false;}};
        window.__connections.push(conn);return conn;
      };
    });
    await page.locator('#roomInput').fill('ABCDEFGH');
    await page.waitForFunction(()=>window.__peers.length===1);
    await page.evaluate(()=>window.__peers[0].handlers.error({type:'network'}));
    await page.waitForFunction(()=>document.querySelector('#joinProgressText')?.textContent?.includes('Retrying'));
    await page.waitForFunction(()=>window.__peers.length===2,null,{timeout:4000});
    // The second attempt succeeds after recovering its signaling connection.
    await page.evaluate(()=>{
      const c=window.__connections[1];
      c.open=true;c.handlers.open();
    });
    await page.waitForFunction(()=>!document.querySelector('#joinActive').hidden);
    assert.equal(await page.locator('#connectionText').textContent(),'Watching with host');
    assert.deepEqual(errors,[]);
    await page.close();
    console.log('PASS guest retries signaling failure then successfully joins');
  }
  {
    const {page,errors}=await launchRoomPage();
    await page.evaluate(()=>{
      window.Peer.prototype.connect=function(id){
        const conn={peer:id,open:false,handlers:{},on(n,cb){this.handlers[n]=cb;},
          send(){},close(){this.open=false;}};
        window.__connections.push(conn);return conn;
      };
    });
    await page.locator('#roomInput').fill('ABCDEFGH');
    await page.waitForFunction(()=>window.__peers.length===1);
    await page.evaluate(()=>window.__peers[0].handlers.error({type:'peer-unavailable'}));
    await page.waitForFunction(()=>!document.querySelector('#retryJoin').hidden);
    assert.equal(await page.locator('#joinSection').isVisible(),true);
    assert((await page.locator('#stageSubtitle').textContent()).includes('fresh invitation'));
    assert.deepEqual(errors,[]);
    await page.close();
    console.log('PASS unavailable host exits Joining screen and offers Retry');
  }
  // A connected guest can choose an identically named, content-verified movie.
  // A negative check must not replace or interrupt incoming streaming media.
  {
    const directory=mkdtempSync(join(tmpdir(),'marmalade-sync-'));
    let fixture;
    try {
      const filename=join(directory,'movie.webm');
      execFileSync('ffmpeg',['-hide_banner','-loglevel','error',
        '-f','lavfi','-i','color=c=black:s=64x64:r=5','-t','2',
        '-an','-c:v','libvpx','-pix_fmt','yuv420p',
        '-deadline','realtime','-cpu-used','5','-crf','42','-b:v','0','-y',filename],
        {timeout:20000});
      fixture=readFileSync(filename);
    } finally {rmSync(directory,{recursive:true,force:true});}
    function sampledFingerprint(bytes) {
      const chunkSize=Math.min(65536,bytes.length);
      const samples=bytes.length<=chunkSize?1:16;
      const input=Buffer.alloc(16+chunkSize*samples);
      input.writeDoubleBE(bytes.length,0);
      input.writeUInt32BE(chunkSize,8);
      input.writeUInt32BE(samples,12);
      for(let i=0;i<samples;i++){
        const offset=samples===1?0:Math.floor((bytes.length-chunkSize)*i/(samples-1));
        bytes.copy(input,16+i*chunkSize,offset,offset+chunkSize);
      }
      return bytes.length+'-'+createHash('sha256').update(input).digest('hex');
    }
    const {page,errors}=await launchRoomPage('/?room=ABCDEFGH');
    await page.waitForFunction(()=>!document.querySelector('#joinActive').hidden,null,{timeout:6000});
    assert.equal(await page.locator('#localCopyPanel').isVisible(),true,'Guest local-copy option displayed');
    assert.equal(await page.locator('#localCopyButton').isDisabled(),true,'Wait for movie identity');
    assert.equal(await page.locator('#settingsPanel #localCopyPanel').count(),0,'No hidden duplicate controls');
    await page.evaluate(fp=>{
      const conn=window.__connections[0];
      conn.callbacks.data({type:'state',mediaKind:'file',name:'movie.webm',
        fingerprint:fp,revision:0,playing:false,time:0,duration:2,sourceWidth:64,
        sourceHeight:64,live:true});
    },sampledFingerprint(fixture));
    await page.waitForFunction(()=>!document.querySelector('#localCopyButton').disabled);
    await page.locator('#localCopyInput').setInputFiles({name:'wrong-name.webm',
      mimeType:'video/webm',buffer:fixture});
    await page.waitForFunction(()=>document.querySelector('#localCopyStatus').textContent.includes('Filename differs'));
    assert.equal(await page.locator('#player').getAttribute('src'),null,
      'Wrong filename must not replace a guest media stream');
    await page.locator('#localCopyInput').setInputFiles({name:'movie.webm',
      mimeType:'video/webm',buffer:Buffer.from('definitely not the same movie')});
    await page.waitForFunction(()=>document.querySelector('#localCopyStatus').textContent.includes('content or file size differs'));
    assert.equal(await page.locator('#player').getAttribute('src'),null,
      'Wrong content must keep streaming as fallback');
    await page.locator('#localCopyInput').setInputFiles({name:'movie.webm',
      mimeType:'video/webm',buffer:fixture});
    await page.waitForTimeout(1400);
    console.log('LOCAL SYNC TRACE',await page.locator('#localCopyStatus').textContent(),
      'video src:',await page.locator('#player').getAttribute('src'),'browserErrors:',errors);
    await page.waitForFunction(()=>document.querySelector('#localCopyStatus').textContent.includes('Verified ✓'),null,{timeout:6000});
    assert((await page.locator('#player').getAttribute('src')).startsWith('blob:'),
      'Matching playable local file must replace the incoming stream');
    assert.equal(await page.locator('#localCopyButton').isDisabled(),true);
    const confirmations=await page.evaluate(()=>window.__connections[0].sent.filter(
      x=>x.type==='local-verified'&&x.verified===true));
    assert.equal(confirmations.length,1,'Host must be told to stop this guest media stream');
    assert.deepEqual(errors,[],'Local-copy verification must not throw browser errors');
    await page.close();
    console.log('PASS guest same-name/size/fingerprint/decoding checks and streaming fallback');
  }
  {
    const {page,errors}=await launchRoomPage('/?room=ABCDEFGH');
    await page.waitForFunction(()=>!document.querySelector('#joinActive').hidden);
    assert.equal(await page.locator('#joinedCode').textContent(),'ABCDEFGH');
    assert.deepEqual(errors,[],'Opening invite URL must join cleanly');
    await page.close();
    console.log('PASS invitation link auto-join');
  }
} finally {
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
