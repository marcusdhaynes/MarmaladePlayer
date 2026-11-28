import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,extname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
import {PeerServer} from 'peer';

const WEB_PORT=38843,PEER_PORT=38844;
const dir=mkdtempSync(join(tmpdir(),'marmalade-e2e-'));
const video=join(dir,'full-stream.webm');
// A real moving picture is critical: a static red slide can pass a
// resolution check while the live stream is barely moving at 0-2 FPS.
// An animated overlay preserves the center red-pixel assertions.
const scenario=process.argv[2]||'all';
if(!['all','live','720','1080'].includes(scenario))throw Error('Unknown room scenario: '+scenario);
const runLive=scenario==='all'||scenario==='live';
function makeLiveFixture(){
execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi',
  '-i','color=c=red:s=1920x1080:r=24','-f','lavfi',
  '-i','sine=frequency=440:sample_rate=48000','-f','lavfi',
  '-i','testsrc2=size=320x180:rate=24',
  '-filter_complex','[0:v][2:v]overlay=24:24:shortest=1[v]',
  '-map','[v]','-map','1:a','-t','70',
  '-c:v','libvpx','-deadline','realtime','-cpu-used','5','-crf','24','-b:v','0','-c:a','libopus',
  '-b:a','64k','-shortest','-y',video],{timeout:150000});
return readFileSync(video);
}
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const peerLib=readFileSync(new URL('../node_modules/peerjs/dist/peerjs.min.js',import.meta.url),'utf8');
const shim=[
  '(function(){const Actual=window.Peer;',
  'window.Peer=function(idOrOptions,options){',
  "const local={host:'127.0.0.1',port:38844,path:'/',secure:false};",
  "return typeof idOrOptions==='string'",
  '?new Actual(idOrOptions,{...options,...local})',
  ':new Actual({...idOrOptions,...local});};})();'
].join('');
const web=createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(['/games.js','/games.css','/updates-ui.css',
      '/assets/onlyframes-logo.svg','/assets/onlyframes-poster.svg'].includes(pathname)){
    const contentType=pathname.endsWith('.js')?'application/javascript':
      pathname.endsWith('.css')?'text/css':'image/svg+xml';
    res.writeHead(200,{'content-type':contentType});
    res.end(readFileSync(new URL('..'+pathname,import.meta.url)));
    return;
  }

  if(req.url?.startsWith('/rapid-controls.js') || req.url?.startsWith('/subtitle-compact.js') || req.url?.startsWith('/seek-preview.js')){
    const name=req.url.split('?')[0];
    res.writeHead(200,{'content-type':'application/javascript'});
    res.end(readFileSync(new URL('..'+name,import.meta.url)));return;
  }
  if(req.url?.startsWith('/rapid-controls.css')){
    res.writeHead(200,{'content-type':'text/css'});
    res.end(readFileSync(new URL('../rapid-controls.css',import.meta.url)));return;
  }
  if(req.url?.startsWith('/settings-layout.js')){
    res.writeHead(200,{'content-type':'application/javascript'});
    res.end(readFileSync(new URL('../settings-layout.js',import.meta.url)));return;
  }
  if(req.url?.startsWith('/settings-layout.css')){
    res.writeHead(200,{'content-type':'text/css'});
    res.end(readFileSync(new URL('../settings-layout.css',import.meta.url)));return;
  }
  if(req.url?.startsWith('/subtitle-archive.js')){
    res.writeHead(200,{'content-type':'application/javascript'});
    res.end(readFileSync(new URL('../subtitle-archive.js',import.meta.url)));return;
  }
  if(req.url?.startsWith('/subtitle-codec.js')){
    res.writeHead(200,{'content-type':'application/javascript'});
    res.end(readFileSync(new URL('../subtitle-codec.js',import.meta.url)));return;
  }
  if(req.url?.startsWith('/subtitle-match.js')){
    res.writeHead(200,{'content-type':'application/javascript'});
    res.end(readFileSync(new URL('../subtitle-match.js',import.meta.url)));return;
  }
  if(req.url?.startsWith('/subtitle-search.js')){
    res.writeHead(200,{'content-type':'application/javascript'});
    res.end(readFileSync(new URL('../subtitle-search.js',import.meta.url)));return;
  }
  if(req.url?.startsWith('/auto-mkv-audio.js')){
    res.writeHead(200,{'content-type':'application/javascript'});
    res.end(readFileSync(new URL('../auto-mkv-audio.js',import.meta.url)));return;
  }
  if(req.url?.startsWith('/watch-sync-subtitles.js')){
    res.writeHead(200,{'content-type':'application/javascript'});
    res.end(readFileSync(new URL('../watch-sync-subtitles.js',import.meta.url)));return;
  }
  if(req.url?.startsWith('/public-movie-info.js')){
    res.writeHead(200,{'content-type':'application/javascript'});
    res.end(readFileSync(new URL('../public-movie-info.js',import.meta.url)));return;
  }
  if(req.url?.startsWith('/movie-info.js')){
    res.writeHead(200,{'content-type':'application/javascript'});
    res.end(readFileSync(new URL('../movie-info.js',import.meta.url)));return;
  }
  if(req.url?.startsWith('/movie-info.css')){
    res.writeHead(200,{'content-type':'text/css'});
    res.end(readFileSync(new URL('../movie-info.css',import.meta.url)));return;
  }
  if(req.url?.startsWith('/media-library.js') || req.url?.startsWith('/media-library.css')){
    const path=req.url.split('?')[0];
    res.writeHead(200,{'content-type':path.endsWith('.css')?'text/css':'application/javascript'});
    res.end(readFileSync(new URL('..'+path,import.meta.url)));return;
  }
  if(req.url?.startsWith('/manifest.webmanifest')){
    res.writeHead(200,{'content-type':'application/manifest+json'});
    res.end('{"name":"Marmalade","start_url":"./"}');return;
  }
  // Serve any bundled static asset (not just the original hardcoded scripts).
  // HTML as a fallback for a JS request produces "Unexpected token '<'" and
  // masks genuine host/guest video problems; unknown assets must be 404.
  const requestPath=new URL(req.url,'http://localhost').pathname;
  if(requestPath!=='/'&&requestPath!=='/index.html'){
    if(!/^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9._-]+$/.test(requestPath) ||
       requestPath.includes('..')){res.writeHead(403);res.end();return;}
    try{
      const bytes=readFileSync(new URL('..'+requestPath,import.meta.url));
      const types={'.js':'application/javascript','.css':'text/css',
        '.svg':'image/svg+xml','.webmanifest':'application/manifest+json',
        '.webp':'image/webp','.png':'image/png','.ico':'image/x-icon',
        '.json':'application/json','.wasm':'application/wasm'};
      res.writeHead(200,{'content-type':types[extname(requestPath)]||'application/octet-stream'});
      res.end(bytes);
    }catch{res.writeHead(404);res.end();}
    return;
  }
  res.writeHead(200,{'content-type':'text/html;charset=utf-8'});res.end(html);
});
await new Promise(resolve=>web.listen(WEB_PORT,'127.0.0.1',resolve));
const signaling=PeerServer({port:PEER_PORT,host:'127.0.0.1',path:'/'});
const browser=await chromium.launch({headless:true,args:[
  '--no-sandbox','--autoplay-policy=no-user-gesture-required'
]});
try {
  const errors=[];
  const makePage=async()=>{
    const page=await browser.newPage();
    await page.addInitScript(()=>{
      window.__debugPeerConnections=[];
      const native=RTCPeerConnection.prototype.setRemoteDescription;
      RTCPeerConnection.prototype.setRemoteDescription=function(...args){
        if(!window.__debugPeerConnections.includes(this))window.__debugPeerConnections.push(this);
        return native.apply(this,args);
      };
      const nativeAdd=RTCPeerConnection.prototype.addTrack;
      RTCPeerConnection.prototype.addTrack=function(...args){
        if(!window.__debugPeerConnections.includes(this))window.__debugPeerConnections.push(this);
        return nativeAdd.apply(this,args);
      };
    });
    page.on('pageerror',e=>errors.push(e.stack||String(e)));
    await page.route('**/npm/peerjs@*/**',route=>route.fulfill({
      status:200,contentType:'application/javascript',body:peerLib+shim}));
    await page.route('**/mediainfo.js@*',route=>route.fulfill({
      status:200,contentType:'application/javascript',
      body:'window.MediaInfo=async()=>({analyzeData:async()=>({media:{track:[]}})});'}));
    return page;
  };
  if(runLive){
  const bytes=makeLiveFixture();
  console.log('E2E host opening');
  const host=await makePage();
  await host.goto('http://127.0.0.1:'+WEB_PORT,{waitUntil:'load'});
  await host.locator('#fileInput').setInputFiles({
    name:'full-stream.webm',mimeType:'video/webm',buffer:bytes
  });
  await host.waitForFunction(()=>!document.querySelector('#hostActive').hidden &&
    !document.querySelector('#playPause').disabled,null,{timeout:16000});
  console.log('E2E host room ready');
  await host.locator('#playPause').click({force:true});
  await host.waitForFunction(()=>document.querySelector('#connectionText').textContent==='Broadcasting live',
    null,{timeout:12000});
  const invite=await host.locator('#inviteLink').inputValue();
  console.log('HOST BROADCAST READY',invite);
  console.log('E2E host streaming');
  const guest=await makePage();
  // Simulate real mobile autoplay restrictions: audible media can only start
  // after a normal trusted interaction; no dedicated sound button is required.
  await guest.addInitScript(()=>{
    let audioUnlocked=false;
    document.addEventListener('click',event=>{
      if(event.isTrusted)audioUnlocked=true;
    },true);
    const nativePlay=HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play=function(...args){
      if(this.id==='player'&&this.srcObject&&!this.muted&&!audioUnlocked)
        return Promise.reject(new DOMException(
          'Audible autoplay blocked until user gesture','NotAllowedError'));
      return nativePlay.apply(this,args);
    };
  });
  await guest.goto(invite,{waitUntil:'load'});
  await guest.waitForFunction(()=>document.querySelector('#joinActive').hidden===false,
    null,{timeout:18000});
  console.log('E2E guest joined control channel');
  await guest.waitForFunction(()=>document.querySelector('#player').srcObject?.getVideoTracks()?.length>0,
    null,{timeout:22000});
  console.log('E2E guest received media tracks');
  await guest.waitForFunction(()=>{
    const st=window.MarmaladeAddonBridge.state;
    const unlock=document.querySelector('#guestAudioUnlock');
    const player=document.querySelector('#player');
    return st.guestAudioFallback || (!player.paused&&!player.muted) || document.querySelector('#dropZone').classList.contains('needs-gesture');
  },null,{timeout:12000});
  const startedWithSound=await guest.evaluate(()=>{
    const st=window.MarmaladeAddonBridge.state;
    const player=document.querySelector('#player');
    return !player.paused&&(!player.muted||(st.guestAudioFallback && st.guestAudioContext?.state==='running'));
  });
  if(!startedWithSound){
    await guest.locator('#dropZone').evaluate(stage=>stage.classList.add('controls-visible'));
    await guest.locator('#playPause').click({force:true});
    if(await host.locator('#player').evaluate(player=>player.paused))await host.locator('#playPause').click({force:true});
  }
  await guest.waitForFunction(()=>{
    const player=document.querySelector('#player');
    const st=window.MarmaladeAddonBridge.state;
    const unlock=document.querySelector('#guestAudioUnlock');
    return !player.paused&&(!unlock||unlock.hidden) &&
      (!player.muted||(st.guestAudioFallback&&st.guestAudioContext?.state==='running')) &&
      !document.querySelector('#dropZone').classList.contains('needs-gesture');
  },null,{timeout:12000});
  console.log(startedWithSound?
    'PASS guest starts with audio relay and no unlock prompt':
    'PASS browser-blocked guest sound can be enabled with a gesture');
  // Direct taps on the guest movie surface must control the authoritative
  // host movie, not merely the guest's own local MediaStream element.
  await guest.evaluate(()=>{const toggle=document.querySelector('#tapVideoPlayback');if(!toggle.checked){toggle.checked=true;toggle.dispatchEvent(new Event('change',{bubbles:true}));}});
  const guestVideo=guest.locator('#player');
  await guestVideo.click({force:true});
  await host.waitForFunction(()=>document.querySelector('#player').paused,null,{timeout:8000});
  await guest.waitForFunction(()=>!window.MarmaladeAddonBridge.state.hostPlaying,
    null,{timeout:8000});
  await guestVideo.click({force:true});
  await host.waitForFunction(()=>!document.querySelector('#player').paused,null,{timeout:8000});
  await guest.waitForFunction(()=>window.MarmaladeAddonBridge.state.hostPlaying,
    null,{timeout:8000});
  console.log('PASS guest video-area click pauses and resumes the host movie');
  // Mute, volume, status and the surrounding controls are NOT video taps.
  // Keep the host running and the guest connected during those actions.
  const hostPlayingBefore=await host.evaluate(()=>!document.querySelector('#player').paused);
  assert(hostPlayingBefore,'Host must be playing before testing guest controls');
  // A real user first reveals the floating controls; never force a click
  // through pointer-events:none elements onto the underlying movie.
  await guest.locator('#dropZone').evaluate(stage=>stage.classList.add('controls-visible'));
  await guest.locator('#muteBtn').click();
  const guestControls=[
    '#volumeMark','#currentTime','#seekArea','.theater-controls',
    '.theater-top','#statusToggle','#settingsBtn','#subtitlesBtn'
  ];
  for(const selector of guestControls){
    await guest.evaluate(selector=>{
      const el=document.querySelector(selector);
      if(!el)throw Error('Missing guest control '+selector);
      el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
    },selector);
    assert(await host.evaluate(()=>!document.querySelector('#player').paused),
      'Guest clicking '+selector+' must not pause the host movie');
  }
  await guest.locator('#dropZone').evaluate(stage=>stage.classList.add('controls-visible'));
  await guest.locator('#muteBtn').click(); // Restore audible guest output.
  assert.equal(await guest.evaluate(()=>window.MarmaladeAddonBridge.state.soundMuted),
    false,'Guest mute toggles without affecting shared play state');
  assert(await host.evaluate(()=>!document.querySelector('#player').paused),
    'Guest mute/unmute must never pause the host');
  console.log('PASS guest mute and all non-play controls preserve host playback');
  // The host can choose to monitor a separately decoded file delayed to
  // guest presentation time without changing the transmitted video source.
  const initialTrack=await host.evaluate(()=>{
    return [...window.MarmaladeAddonBridge.state.connections.values()][0]?.call
      ?.peerConnection?.getSenders?.().find(sender=>sender.track?.kind==='video')?.track?.id;
  });
  await host.locator('#hostMatchTiming').evaluate(node=>node.click());
  await host.waitForFunction(()=>window.MarmaladeAddonBridge.state.hostMonitorActive,
    null,{timeout:12000});
  await guest.evaluate(()=>window.MarmaladeAddonBridge.state.guestConn.send({
    type:'presentation-delay',ms:1200
  }));
  await host.waitForFunction(()=>window.MarmaladeAddonBridge.state.hostMonitorDelayMs>500,
    null,{timeout:8000});
  const hostMirror=await host.evaluate(()=>{
    const state=window.MarmaladeAddonBridge.state;
    const track=[...state.connections.values()][0]?.call?.peerConnection
      ?.getSenders?.().find(sender=>sender.track?.kind==='video')?.track?.id;
    return {active:state.hostMonitorActive,requested:state.hostMonitorRequested,
      delay:state.hostMonitorDelayMs,
      monitorPlaying:!document.querySelector('#hostMonitor').paused,
      originalPlaying:!document.querySelector('#player').paused,
      sourceTrackUnchanged:!!track};
  });
  assert(hostMirror.active && hostMirror.monitorPlaying && hostMirror.originalPlaying,
    'Host mirror must play while the original still broadcasts');
  assert(hostMirror.delay>500,'Host monitor must respond to the guest presentation delay');
  const mirrorAudio=await guest.evaluate(async()=>{
    const track=document.querySelector('#player').srcObject?.getAudioTracks()[0];
    if(!track)return 0;
    const audio=new AudioContext();
    const source=audio.createMediaStreamSource(new MediaStream([track]));
    const analyzer=audio.createAnalyser();analyzer.fftSize=1024;
    const gain=audio.createGain();gain.gain.value=0;
    source.connect(analyzer);analyzer.connect(gain);gain.connect(audio.destination);
    await audio.resume();
    const data=new Float32Array(analyzer.fftSize);let loudest=0;
    for(let i=0;i<24;i++){
      await new Promise(resolve=>setTimeout(resolve,60));
      analyzer.getFloatTimeDomainData(data);
      loudest=Math.max(loudest,Math.sqrt(data.reduce((a,x)=>a+x*x,0)/data.length));
    }
    await audio.close();return loudest;
  });
  assert(mirrorAudio>0.002,
    'Guest audio must stay audible while host locally monitors with delay');
  console.log('PASS guest hears audio with independently delayed host view',mirrorAudio);
  const duringMirrorTrack=await host.evaluate(()=>[...window.MarmaladeAddonBridge.state.connections.values()][0]?.call
    ?.peerConnection?.getSenders?.().find(sender=>sender.track?.kind==='video')?.track?.id);
  assert.equal(duringMirrorTrack,initialTrack,'Host mirror must not replace outgoing video');
  await host.locator('#hostMatchTiming').evaluate(node=>node.click());
  await host.waitForFunction(()=>!window.MarmaladeAddonBridge.state.hostMonitorActive,null,{timeout:6000});
  console.log('PASS independent host-only video/audio mirror preserves P2P source');
  // 1080p must negotiate a real picture before testing 720p fallback.
  await guest.waitForFunction(()=>document.querySelector('#qualitySelect option[value="1080"]'),
    null,{timeout:8000});
  await guest.locator('#qualitySelect').evaluate(el=>{
    el.value='1080';el.dispatchEvent(new Event('change',{bubbles:true}));
  });
  // 1080p is selected before receiving the movie. Re-selecting the same
  // quality need not trigger a second encoder hint; decoded dimensions
  // checked below are the authoritative resolution regression.
  await guest.waitForFunction(()=>{
    const st=window.MarmaladeAddonBridge.state;
    return st.requestedQuality==='1080' &&
      document.querySelector('#qualitySelect').value==='1080';
  },null,{timeout:15000});
  await guest.waitForTimeout(8200);
  const encoder1080=await host.evaluate(async()=>{
    const pc=window.__debugPeerConnections.at(-1);
    if(!pc)return {error:'No captured peer connection'};
    const stats=await pc.getStats();
    const video=[...stats.values()].filter(x=>x.type==='outbound-rtp'&&(x.kind==='video'||x.mediaType==='video'));
    return {track:pc.getSenders().filter(x=>x.track?.kind==='video').map(s=>({
      settings:s.track.getSettings(),params:s.getParameters().encodings})),
      outbound:video.map(x=>({width:x.frameWidth,height:x.frameHeight,fps:x.framesPerSecond,
        framesEncoded:x.framesEncoded,limit:x.qualityLimitationReason,encoder:x.encoderImplementation})),
      candidatePairs:[...stats.values()].filter(x=>x.type==='candidate-pair'&&x.state==='succeeded')
        .map(x=>({outgoing:x.availableOutgoingBitrate,incoming:x.availableIncomingBitrate,
          rtt:x.currentRoundTripTime,nominated:x.nominated}))};
  });
  const decoder1080=await guest.evaluate(async()=>{
    const pc=window.__debugPeerConnections.at(-1);
    if(!pc)return {error:'No receiver PC'};
    const stats=await pc.getStats();
    return [...stats.values()].filter(x=>x.type==='inbound-rtp'&&(x.kind==='video'||x.mediaType==='video'))
      .map(x=>({width:x.frameWidth,height:x.frameHeight,decoded:x.framesDecoded,
        dropped:x.framesDropped,decoder:x.decoderImplementation,jitter:x.jitter}));
  });
  console.log('HIGH RESOLUTION ENCODER DIAGNOSTIC',JSON.stringify(encoder1080));
  console.log('HIGH RESOLUTION DECODER DIAGNOSTIC',JSON.stringify(decoder1080));
  const result1080=await guest.evaluate(async()=>{
    const v=document.querySelector('#player');
    const c=document.createElement('canvas');c.width=24;c.height=16;
    const ctx=c.getContext('2d',{willReadFrequently:true});
    ctx.drawImage(v,0,0,24,16);
    const pix=Array.from(ctx.getImageData(12,8,1,1).data);
    return {pix,width:v.videoWidth,height:v.videoHeight};
  });
  assert(result1080.pix[0]>125 && result1080.pix[0]>result1080.pix[1]*2,
    '1080p must deliver real non-black frames');
  // A 1080p UI label with only a 270p transport is NOT a quality pass.
  // Judge actual decoded dimensions, never the negotiated input track.
  assert(result1080.height >= 1080 && result1080.width >= 1920,
    '1080p selection must decode real full-HD frames, not silently downscale');
  assert(encoder1080.outbound.some(x => x.height >= 1080 && (x.fps || 0) >= 21),
    'Full-HD sender must encode at approximately 24 fps on the local healthy test link');
  console.log('PASS real 1080p delivery at 24fps target',JSON.stringify(result1080));
  // The optional delayed monitor must not overlay a healthy movie by default:
  // some browsers render a second video playback head as solid black.
  const defaultSync=await host.locator('#hostSyncMode').inputValue();
  assert.equal(defaultSync,'off','Host video monitor starts disabled to protect local picture');
  assert.equal(await host.locator('#dropZone').evaluate(el=>el.classList.contains('host-sync-active')),
    false,'Secondary monitor must not cover the host video by default');
  assert.equal(await host.locator('#hostSyncPreview').evaluate(el=>getComputedStyle(el).display),
    'none','Inactive monitor must actually be hidden by the CSS cascade');
  assert.equal(await guest.locator('#hostSyncPreview').evaluate(el=>getComputedStyle(el).display),
    'none','Empty monitor must not cover the guest picture');
  // Exercise opt-in alignment separately; it never replaces the outgoing track.
  await host.locator('#hostSyncMode').evaluate(select=>{
    select.value='auto';
    select.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await guest.evaluate(()=>{
    window.MarmaladeAddonBridge.state.guestConn.send({type:'presentation-delay',ms:1200});
  });
  await host.waitForFunction(()=>window.MarmaladeAddonBridge?.state.hostSyncActive===true,
    null,{timeout:14000});
  const aligned=await host.evaluate(()=>{
    const source=document.querySelector('#player');
    const monitor=document.querySelector('#hostSyncPreview');
    const sender=window.__debugPeerConnections.at(-1)?.getSenders()
      .find(x=>x.track?.kind==='video');
    return {active:document.querySelector('#dropZone').classList.contains('host-sync-active'),
      sourceTime:source.currentTime,localTime:monitor.currentTime,
      sourceTrackHeight:sender?.track?.getSettings()?.height||0};
  });
  assert(aligned.active && aligned.sourceTime>aligned.localTime+.35,
    'Host must watch and hear a delayed local monitor rather than advancing ahead of guest');
  assert(aligned.sourceTrackHeight>=720,
    'Host monitor must not downscale or replace the working high-resolution WebRTC sender');
  console.log('PASS host-only delayed A/V monitor without changing outgoing video',JSON.stringify(aligned));
  // Return to default streaming before codec, audio and sustained FPS checks.
  // A second full-HD preview imposes unrelated local CPU/audio-graph load.
  await host.locator('#hostSyncMode').evaluate(select=>{
    select.value='off';
    select.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await host.waitForFunction(()=>!window.MarmaladeAddonBridge.state.hostSyncActive,
    null,{timeout:8000});
  console.log('PASS optional host monitor releases resources after sync validation');

  // Switch 1080p -> 720p -> 540p, checking each retains actual WebRTC media.
  await guest.waitForFunction(()=>document.querySelector('#qualitySelect option[value="720"]'),null,{timeout:8000});
  // The selector is inside a closed settings palette. Drive the real change
  // event rather than attempting to click an invisible control.
  await guest.locator('#qualitySelect').evaluate(el=>{
    el.value='720';el.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await guest.waitForFunction(()=>{
    const text=document.querySelector('#qualityHint')?.textContent||'';
    return /Receiving 720p/.test(text);
  },null,{timeout:14000});
  const highImage=await guest.evaluate(async()=>{
    await new Promise(resolve=>setTimeout(resolve,600));
    const el=document.querySelector('#player'),c=document.createElement('canvas');
    c.width=24;c.height=16;
    const cx=c.getContext('2d',{willReadFrequently:true});
    cx.drawImage(el,0,0,24,16);
    return Array.from(cx.getImageData(12,8,1,1).data);
  });
  assert(highImage[0]>125 && highImage[0]>highImage[1]*2,
    '720p must transmit a visible movie after track replacement');
  await guest.waitForFunction(()=>{
    const v=document.querySelector('#player');
    return v.videoHeight >= 720 && v.videoWidth >= 1280;
  },null,{timeout:8000});
  console.log('PASS real 720p delivery with visible frames',highImage);
  // Reproduce a device that receives frame callbacks but renders only black
  // pixels. The host's independent red-pixel probe must trigger per-guest
  // compatibility capture rather than falsely reporting healthy playback.
  await guest.evaluate(()=>{
    const proto=CanvasRenderingContext2D.prototype;
    const original=proto.drawImage;
    window.__restorePictureProbe=()=>{proto.drawImage=original;};
    proto.drawImage=function(...args){
      if(this.canvas.width===32 && this.canvas.height===18 &&
         args[0]?.id==='player'){
        this.fillStyle='#000';this.fillRect(0,0,32,18);return;
      }
      return original.apply(this,args);
    };
  });
  await host.waitForFunction(()=>[...window.MarmaladeAddonBridge.state.connections.values()]
    .some(e=>e.compatCanvas===true),null,{timeout:12000});
  const compatibility=await host.evaluate(()=>{
    const e=[...window.MarmaladeAddonBridge.state.connections.values()][0];
    const sender=e.call?.peerConnection?.getSenders().find(x=>x.track?.kind==='video');
    const native=window.MarmaladeAddonBridge.state.nativeCapture?.getVideoTracks()[0];
    return {enabled:e.compatCanvas,usingDifferentTrack:sender?.track!==native,
      trackReady:sender?.track?.readyState};
  });
  assert(compatibility.enabled && compatibility.usingDifferentTrack &&
    compatibility.trackReady==='live','Black guest frame must switch to live compatibility canvas');
  await guest.evaluate(()=>window.__restorePictureProbe?.());
  console.log('PASS black-frame detector switches a single guest to compatibility video',compatibility);
  await guest.locator('#qualitySelect').evaluate(el=>{
    el.value='540';el.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await guest.waitForFunction(()=>/Receiving 540p/.test(
    document.querySelector('#qualityHint')?.textContent||''),null,{timeout:14000});
  console.log('PASS returning to proven 540p capture path');
  await guest.waitForFunction(()=>{
    const v=document.querySelector('#player');return v.videoWidth>0 && v.readyState>=2;
  },null,{timeout:12000});
  const report=await guest.evaluate(async()=>{
    const player=document.querySelector('#player');
    if(player.paused){player.muted=true;await player.play();}
    await new Promise(resolve=>setTimeout(resolve,450));
    const canvas=document.createElement('canvas');canvas.width=32;canvas.height=20;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    ctx.drawImage(player,0,0,32,20);
    const rgb=Array.from(ctx.getImageData(16,10,1,1).data);
    const stream=player.srcObject;
    // Inspect decoded PCM energy, not just a nominally live audio track.
    // This catches an incoming silent stream that a track-count test misses.
    let audioRms=0;
    if(stream.getAudioTracks().length){
      const probe=new AudioContext();
      const source=probe.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
      const analyser=probe.createAnalyser();analyser.fftSize=1024;
      const sink=probe.createGain();sink.gain.value=0;
      source.connect(analyser);analyser.connect(sink);sink.connect(probe.destination);
      await Promise.race([probe.resume(),new Promise((_,reject)=>
        setTimeout(()=>reject(Error('Audio analyzer could not resume')),2500))]);
      const samples=new Float32Array(analyser.fftSize);
      for(let i=0;i<35;i++){
        await new Promise(resolve=>setTimeout(resolve,100));
        analyser.getFloatTimeDomainData(samples);
        const rms=Math.sqrt(samples.reduce((sum,x)=>sum+x*x,0)/samples.length);
        audioRms=Math.max(audioRms,rms);
        if(audioRms>0.002)break;
      }
      source.disconnect();analyser.disconnect();sink.disconnect();
      await probe.close();
    }
    return {
      rgb,audioRms,videoWidth:player.videoWidth,
      videoTracks:stream.getVideoTracks().map(t=>({state:t.readyState,muted:t.muted})),
      audioTracks:stream.getAudioTracks().map(t=>({state:t.readyState,muted:t.muted})),
      currentTime:player.currentTime,
      connection:document.querySelector('#connectionText').textContent
    };
  });
  console.log('ACTUAL PEERJS END TO END MEDIA',JSON.stringify(report));
  assert(report.rgb[0]>125 && report.rgb[0]>report.rgb[1]*2,'Guest must see movie picture');
  assert(report.videoTracks.some(t=>t.state==='live'),'Guest video track must be live');
  assert(report.audioTracks.some(t=>t.state==='live'),'Guest audio track must be live');
  assert(report.audioRms>0.002,'Decoded guest audio must contain an audible sine-wave signal, not silence');

  // Sustained frame-rate regression for every selectable receiver resolution.
  // Measure RTP encoded and decoded frames over multi-second windows, not
  // only frame metadata, dimensions, or a single 1080p screenshot.
  const rtpSample=async(page,direction)=>{
    return page.evaluate(async direction=>{
      const state=window.MarmaladeAddonBridge.state;
      const pc=direction==='host'
        ?[...state.connections.values()][0]?.call?.peerConnection
        :state.guestCall?.peerConnection;
      if(!pc)throw Error('Missing PeerConnection for sustained FPS');
      const stats=await pc.getStats();
      const packet=[...stats.values()].find(x=>x.type===
        (direction==='host'?'outbound-rtp':'inbound-rtp') &&
        (x.kind==='video'||x.mediaType==='video')&&!x.isRemote);
      if(!packet)throw Error('Missing video RTP counters for sustained FPS');
      return {
        time:performance.now(),frames:direction==='host'?
          packet.framesEncoded:packet.framesDecoded,
        width:packet.frameWidth||0,height:packet.frameHeight||0,
        limitation:packet.qualityLimitationReason||'unknown',
        dropped:packet.framesDropped||0,
        receivedFrames:packet.framesReceived??null,packetsLost:packet.packetsLost??null,
        jitter:packet.jitter??null,jitterDelay:packet.jitterBufferDelay??null,
        jitterEmitted:packet.jitterBufferEmittedCount??null,
        totalDecodeTime:packet.totalDecodeTime??null,totalEncodeTime:packet.totalEncodeTime??null,
        target:state.jitterTarget,
        rendered:state.remoteVideoFrameCount||0,
        sourceFrames:document.querySelector('#player').getVideoPlaybackQuality?.().totalVideoFrames||0,
        sourceTime:document.querySelector('#player').currentTime,
        senderSourceHeight:direction==='host'?
          pc.getSenders().find(sender=>sender.track?.kind==='video')?.track?.getSettings?.().height||0:0,
        compatibilityCanvas:direction==='host'
          ?!![...state.connections.values()][0]?.compatCanvas:false,
        highCanvas:!!state.highCanvas,highPaintIdle:!!state.highPaintIdle,
        baseCaptureFrames:state.baseCaptureFrames||0,highCaptureFrames:state.highCaptureFrames||0,
        exactCaptures:[...state.lowCompatCaptures.values()].map(c=>({height:c.height,decoded:c.decodedPaints,watchdog:c.watchdogPaints})),
        muted:document.querySelector('#player').muted,
        audioRelayed:!!state.guestAudioFallback &&
          state.guestAudioContext?.state==='running',
        paused:document.querySelector('#player').paused
      };
    },direction);
  };
  const performanceIssues=[];
  for(const tier of ['144','240','360','480','540','720','1080']){
    await guest.locator('#qualitySelect').evaluate((el,value)=>{
      el.value=value;
      el.dispatchEvent(new Event('change',{bubbles:true}));
    },tier);
    await guest.waitForTimeout(1400); // Allow replaceTrack/encoder to settle.
    const [hostA,guestA]=await Promise.all([
      rtpSample(host,'host'),rtpSample(guest,'guest')]);
    await guest.waitForTimeout(3400);
    const [hostB,guestB]=await Promise.all([
      rtpSample(host,'host'),rtpSample(guest,'guest')]);
    const encodedFps=(hostB.frames-hostA.frames)*1000/(hostB.time-hostA.time);
    const decodedFps=(guestB.frames-guestA.frames)*1000/(guestB.time-guestA.time);
    const renderedFps=(guestB.rendered-guestA.rendered)*1000/(guestB.time-guestA.time);
    const sourceFps=(hostB.sourceFrames-hostA.sourceFrames)*1000/
      (hostB.time-hostA.time);
    const metrics={tier,encodedFps,decodedFps,renderedFps,sourceFps,
      actualHeight:guestB.height,senderSourceHeight:hostB.senderSourceHeight,
      compatibilityCanvas:hostB.compatibilityCanvas,
      limited:hostB.limitation,videoPaused:guestB.paused,
      guestMuted:guestB.muted,hostTime:hostB.sourceTime};
    const captureFps=((Number(tier)<=540?hostB.baseCaptureFrames-hostA.baseCaptureFrames:hostB.highCaptureFrames-hostA.highCaptureFrames)*1000/(hostB.time-hostA.time));
    const delta=(before,after,key)=>Number.isFinite(before[key])&&Number.isFinite(after[key])?after[key]-before[key]:null;
    const received=delta(guestA,guestB,'receivedFrames'),emitted=delta(guestA,guestB,'jitterEmitted'),delay=delta(guestA,guestB,'jitterDelay');
    const decodeTime=delta(guestA,guestB,'totalDecodeTime'),encodeTime=delta(hostA,hostB,'totalEncodeTime');
    console.log('SUSTAINED FRAME RATE',JSON.stringify({...metrics,captureFps,highPaintIdle:hostB.highPaintIdle,
      receivedFps:received===null?null:received*1000/(guestB.time-guestA.time),
      lostPackets:delta(guestA,guestB,'packetsLost'),droppedFrames:delta(guestA,guestB,'dropped'),
      packetJitterMs:guestB.jitter===null?null:guestB.jitter*1000,
      measuredPlayoutMs:emitted>0&&delay!==null?delay*1000/emitted:null,requestedPlayoutMs:guestB.target,
      averageDecodeMs:decodeTime!==null&&guestB.frames>guestA.frames?decodeTime*1000/(guestB.frames-guestA.frames):null,
      averageEncodeMs:encodeTime!==null&&hostB.frames>hostA.frames?encodeTime*1000/(hostB.frames-hostA.frames):null,
      exactCaptures:hostB.exactCaptures,priorExactCaptures:hostA.exactCaptures}));
    if(Number(tier)<540&&hostB.compatibilityCanvas)
      assert.deepEqual(hostB.exactCaptures.map(c=>c.height),[Number(tier)],'Only the actively selected low-tier canvas should remain for one guest');
    if(Number(tier)<540&&hostB.compatibilityCanvas)
      assert.equal(hostB.senderSourceHeight,Number(tier),'Low-tier compatibility capture should match selected tier without secondary sender scaling');
    if(Number(tier)<=540&&hostB.highCanvas)assert(hostB.highPaintIdle,'Unused HD canvas must be idle at '+tier+'p');
    if(Number(tier)>540&&hostB.highCanvas)assert(!hostB.highPaintIdle,'HD canvas must resume at '+tier+'p');
    assert(!guestB.paused,'Guest video must keep playing at '+tier+'p');
    assert(!guestB.muted||guestB.audioRelayed,
      'Guest audio must remain audible at '+tier+'p');
    // CI runs on CPU-only virtual machines. The software canvas repair path
    // for an intentionally simulated black video can sustain 18-20 FPS
    // despite a healthy native 24 FPS stream. Keep a separate regression
    // floor for that compatibility path; don't misrepresent it as 24 FPS.
    const floor=hostB.compatibilityCanvas && tier==='720'?18:20;
    if(encodedFps<floor||decodedFps<floor||renderedFps<18)
      performanceIssues.push({...metrics,captureFps,highPaintIdle:hostB.highPaintIdle});
  }
  console.log('SUSTAINED PERFORMANCE RESULTS',JSON.stringify(performanceIssues));
  if(!performanceIssues.length)
    console.log('PASS sustained host-to-guest moving video at every selectable tier');
  // Exercise actual visible diagnostics after sustained performance sampling.
  // No invented RTP values or production-state fixture mutations.
  await guest.locator('#settingsBtn').click({force:true});
  await guest.locator('#settingsTabParty').click();
  await guest.evaluate(()=>{
    const advanced=document.querySelector('#settingsAdvanced');advanced.open=true;
    if(document.querySelector('#stabilityInfo').hidden)document.querySelector('#diagnosticsToggle').click();
  });
  await guest.waitForFunction(()=>{
    const value=key=>document.querySelector('[data-metric='+key+']')?.textContent||'';
    return value('mode')==='Live WebRTC'&&value('resolution')==='1920 × 1080'&&
      parseFloat(value('decoded'))>0&&parseFloat(value('bandwidth'))>0&&
      Number.isFinite(parseFloat(value('loss')))&&parseFloat(value('fps'))>0;
  },null,{timeout:12000});
  const liveDiagnostics=await guest.evaluate(()=>Object.fromEntries([...document.querySelectorAll('#diagnosticGrid output')].map(o=>[o.dataset.metric,o.textContent])));
  console.log('PASS real live diagnostics match received resolution, decoded FPS, frame counters and bandwidth',JSON.stringify(liveDiagnostics));
  assert.equal(liveDiagnostics.buffer,'—','Live WebRTC must not advertise future file buffering');
  assert.equal(liveDiagnostics.drift,'—','Live WebRTC must not invent a seekable clock offset');
  // Leave diagnostics enabled but hide its window before changing sources.
  await guest.locator('#closeSettingsPanel').click();
  // Explicitly preserve the separate local-file path and its host clock.
  await guest.waitForFunction(()=>window.MarmaladeAddonBridge.state.remoteFingerprint,
    null,{timeout:10000});
  await guest.locator('#localCopyInput').setInputFiles({
    name:'full-stream.webm',mimeType:'video/webm',buffer:bytes
  });
  await guest.waitForFunction(()=>window.MarmaladeAddonBridge.state.localVerified &&
    window.MarmaladeAddonBridge.state.source==='local-guest',
    null,{timeout:20000});
  await host.locator('#skipBack').click({force:true});
  await guest.waitForTimeout(1800);
  const [hostTime,guestTime]=await Promise.all([
    host.evaluate(()=>document.querySelector('#player').currentTime),
    guest.evaluate(()=>document.querySelector('#player').currentTime)
  ]);
  assert(Math.abs(hostTime-guestTime)<2,
    'Locally verified guest must follow host seek: '+hostTime+' vs '+guestTime);
  console.log('PASS matching-file local sync follows host seek');
  await guest.locator('#settingsBtn').click({force:true});
  await guest.locator('#settingsTabParty').click();
  await guest.evaluate(()=>{
    document.querySelector('#settingsAdvanced').open=true;
    if(document.querySelector('#stabilityInfo').hidden)document.querySelector('#diagnosticsToggle').click();
  });
  await guest.waitForFunction(()=>{
    const value=key=>document.querySelector('[data-metric='+key+']')?.textContent||'';
    return value('mode')==='Verified Local File'&&value('decoded')==='—'&&value('bandwidth')==='—'&&
      value('encoder')==='—'&&value('route')==='—'&&Number.isFinite(parseFloat(value('drift')));
  },null,{timeout:10000});
  await guest.locator('#closeSettingsPanel').click();
  console.log('PASS verified local diagnostics clear obsolete live network readings and show measured clock drift');
  await guest.locator('#localCopyButton').dispatchEvent('pointerdown',{
    button:0,bubbles:true
  });
  await guest.waitForTimeout(540);
  await guest.locator('#localCopyButton').dispatchEvent('pointerup',{button:0,bubbles:true});
  await guest.waitForFunction(()=>window.MarmaladeAddonBridge.state.source==='remote' &&
    !window.MarmaladeAddonBridge.state.localVerified &&
    document.querySelector('#player').srcObject?.getVideoTracks().some(t=>t.readyState==='live'),
    null,{timeout:20000});
  console.log('PASS local-sync-to-stream transition returns host video and audio');
  // A broken outbound media call must recover inside the SAME room without
  // requiring a guest refresh or changing the invitation. Preserve separate
  // listening levels and explicit mute, then measure actual received PCM.
  const setListeningLevel=(page,value)=>page.locator('#volume').evaluate((input,value)=>{
    input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));
  },value);
  await guest.waitForFunction(()=>{
    const s=window.MarmaladeAddonBridge.state,v=document.querySelector('#player');
    return s.source==='remote'&&!v.paused&&v.srcObject?.getAudioTracks().some(t=>t.readyState==='live');
  },null,{timeout:12000});
  await setListeningLevel(host,30);
  await setListeningLevel(guest,60);
  assert.equal(await host.evaluate(()=>window.MarmaladeAddonBridge.state.volumePercent),30);
  assert.equal(await guest.evaluate(()=>window.MarmaladeAddonBridge.state.volumePercent),60);
  // This assertion exercises the actual mute handler, not hit testing (already
  // covered above). A forced coordinate click can hit the returning-local-copy
  // overlay instead of the control while the replacement stream settles.
  if(!await guest.evaluate(()=>window.MarmaladeAddonBridge.state.soundMuted))
    await guest.locator('#muteBtn').evaluate(button=>button.click());
  assert.equal(await guest.evaluate(()=>window.MarmaladeAddonBridge.state.soundMuted),true);
  const guestRoom=await guest.evaluate(()=>window.MarmaladeAddonBridge.state.code);
  const originalCallId=await host.evaluate(()=>{
    const e=[...window.MarmaladeAddonBridge.state.connections.values()][0];
    const id=e.mediaAttempt;
    e.call.close();
    return id;
  });
  await host.waitForFunction(id=>{
    const e=[...window.MarmaladeAddonBridge.state.connections.values()][0];
    return e && e.mediaAttempt>id && e.call && e.mediaConfirmed;
  },originalCallId,{timeout:18000});
  await guest.waitForFunction(()=>document.querySelector('#player').srcObject?.getVideoTracks()
    .some(t=>t.readyState==='live')&&
    window.MarmaladeAddonBridge.state.source==='remote',null,{timeout:18000});
  await guest.waitForFunction(()=>{
    const s=window.MarmaladeAddonBridge.state,v=document.querySelector('#player');
    return !v.paused&&v.srcObject?.getAudioTracks().some(t=>t.readyState==='live')&&s.soundMuted&&
      (s.guestAudioFallback?Math.abs(s.guestAudioGain?.gain.value||0)<.001:v.muted);
  },null,{timeout:15000});
  assert.equal(await guest.evaluate(()=>window.MarmaladeAddonBridge.state.code),guestRoom);
  assert.equal(await guest.evaluate(()=>window.MarmaladeAddonBridge.state.volumePercent),60);
  assert.equal(await host.evaluate(()=>window.MarmaladeAddonBridge.state.volumePercent),30);
  await guest.locator('#muteBtn').evaluate(button=>button.click());
  await guest.waitForFunction(()=>{
    const s=window.MarmaladeAddonBridge.state,v=document.querySelector('#player');
    return !s.soundMuted&&!s.audioUnlockRequired&&!v.paused&&
      (s.guestAudioFallback?s.guestAudioContext?.state==='running'&&Math.abs(s.guestAudioGain?.gain.value-.6)<.05:
        !v.muted&&(s.speakerGain&&s.audioContext?.state==='running'?Math.abs(s.speakerGain.gain.value-.6)<.05:Math.abs(v.volume-.6)<.05));
  },null,{timeout:15000});
  const recoveredRms=await guest.evaluate(async()=>{
    const tracks=document.querySelector('#player').srcObject.getAudioTracks();
    const probe=new AudioContext(),source=probe.createMediaStreamSource(new MediaStream(tracks));
    const analyser=probe.createAnalyser(),sink=probe.createGain();sink.gain.value=0;
    source.connect(analyser);analyser.connect(sink);sink.connect(probe.destination);
    try{
      await Promise.race([probe.resume(),new Promise((_,reject)=>setTimeout(()=>reject(Error('Recovery audio probe blocked')),2500))]);
      const samples=new Float32Array(analyser.fftSize);
      let rms=0;
      for(let i=0;i<35;i++){
        await new Promise(resolve=>setTimeout(resolve,100));
        analyser.getFloatTimeDomainData(samples);
        rms=Math.max(rms,Math.sqrt(samples.reduce((sum,x)=>sum+x*x,0)/samples.length));
        if(rms>.002)break;
      }
      return rms;
    }finally{source.disconnect();analyser.disconnect();sink.disconnect();await probe.close();}
  });
  assert(recoveredRms>.002,'Recovered stream must contain audible PCM, not merely a live track');
  assert(await host.evaluate(()=>!document.querySelector('#player').paused),'Guest audio controls must not interrupt host playback');
  console.log('PASS same-room media recovery preserves independent volumes and mute; audible PCM restored',recoveredRms);
  assert.equal(performanceIssues.length,0,
    'Sustained performance regressions: '+JSON.stringify(performanceIssues));
  assert.deepEqual(errors,[],'Browser runtime errors');
  console.log('PASS actual two-browser Marmalade PeerJS movie + sound');
  await guest.close();await host.close();
  }
  // Use the same decoder assets as the published player for original-file rooms.
  if(scenario!=='live')execFileSync(process.execPath,['scripts/install-mkv-decoder.mjs'],{stdio:'inherit',timeout:120000});
  for(const height of [720,1080].filter(h=>scenario==='all'||scenario===String(h))){
    const width=height===720?1280:1920;
    const clip=join(dir,'buffer-clip-'+height+'.webm');
    const movie=join(dir,'buffer-movie-'+height+'.webm');
    // Loop a short encoded sequence so the out-of-window seek has real keyframes
    // and over three minutes remaining without encoding a full feature film.
    execFileSync('ffmpeg',['-v','error','-f','lavfi','-i',
      'testsrc2=size='+width+'x'+height+':rate=24','-f','lavfi','-i',
      'sine=frequency=440:sample_rate=48000','-t','2','-c:v','libvpx-vp9',
      '-deadline','realtime','-cpu-used','8','-crf','42','-b:v','0','-g','24','-pix_fmt','yuv420p',
      '-c:a','libopus','-y',clip],{timeout:60000});
    execFileSync('ffmpeg',['-v','error','-stream_loop','359','-i',clip,
      '-c','copy','-y',movie],{timeout:60000});
    const sender=await makePage(),viewer=await makePage();
    try{
      await sender.goto('http://127.0.0.1:'+WEB_PORT);
      await sender.locator('#fileInput').setInputFiles(movie);
      try{
        await sender.waitForFunction(()=>!document.querySelector('#hostActive').hidden&&!document.querySelector('#playPause').disabled);
      }catch(error){
        console.error('Buffered host setup',await sender.evaluate(()=>{
          const v=document.querySelector('#player'),s=window.MarmaladeAddonBridge?.state;
          return {source:s?.source,fileReady:s?.fileReady,role:s?.role,readyState:v.readyState,
            mediaError:v.error?.message,connection:document.querySelector('#connectionText')?.textContent};
        }));
        throw error;
      }
      await sender.locator('#playPause').click({force:true});
      await sender.waitForFunction(()=>!!window.MarmaladeRollingBuffer?.offer());
      let began=Date.now();
      await viewer.goto(await sender.locator('#inviteLink').inputValue());
      const full=async(label,minTime,maxTime=Infinity)=>{
        await viewer.waitForFunction(({height,minTime,maxTime})=>{
          const v=document.querySelector('#player');
          if(window.MarmaladeAddonBridge.state.source!=='buffered-guest'||
             v.videoHeight!==height||v.currentTime<minTime||v.currentTime>maxTime)return false;
          for(let i=0;i<v.buffered.length;i++){
            if(v.buffered.start(i)<=v.currentTime&&v.buffered.end(i)-v.currentTime>=180)return true;
          }
          return false;
        },{height,minTime,maxTime},{timeout:120000});
        console.log('PASS contiguous guest buffer',height,label,'elapsed ms',Date.now()-began);
      };
      await full('join',0);
      const original=await viewer.locator('#player').evaluate(v=>v.currentSrc);
      began=Date.now();
      await viewer.evaluate(()=>{
         const state=window.MarmaladeAddonBridge.state;
         const bulk=Object.values(state.peer.connections).flat().find(c=>c.open&&c.label==='marmalade-buffer-v1');
         if(!bulk)throw Error('Missing active bulk channel');
         window.__stalledBulk=bulk;
         const send=bulk.send.bind(bulk);
         bulk.send=message=>{
           if(message?.type!=='read')return send(message);
           bulk.send=send;
           window.__silentRead={offset:message.offset,length:message.length,open:bulk.open};
           // Silently drop a read without closing or reporting an error.
         };
       });
       await sender.locator('#player').evaluate(v=>{v.currentTime=220;});
       await viewer.waitForFunction(()=>{
         const s=window.MarmaladeAddonBridge.state;
         return window.__silentRead?.open&&!window.__stalledBulk.open&&
           Object.values(s.peer.connections).flat().some(c=>c.open&&c!==window.__stalledBulk&&c.label==='marmalade-buffer-v1');
       },null,{timeout:60000});
      await full('silent open-channel stall and outside-window seek',218);
       assert.equal(await viewer.locator('#player').evaluate(v=>v.currentSrc),original,'Silent stall recovery must retain the MSE source');
      began=Date.now();
      await viewer.evaluate(()=>{
        const state=window.MarmaladeAddonBridge.state;
        const bulk=Object.values(state.peer.connections).flat().find(c=>c.open&&c.label==='marmalade-buffer-v1');
        if(!bulk)throw Error('Missing active movie transfer');
        window.__lostBulk=bulk;
        const send=bulk.send.bind(bulk);
        bulk.send=message=>{
          if(message?.type!=='read')return send(message);
          bulk.send=send;
          window.__interruptedRange={offset:message.offset,length:message.length};
          send(message);
          bulk.close();
        };
      });
      await sender.locator('#player').evaluate(v=>{v.currentTime=475;});
      await viewer.waitForFunction(()=>{
        const state=window.MarmaladeAddonBridge.state;
        return window.__interruptedRange&&Object.values(state.peer.connections).flat().some(c=>c.open&&c!==window.__lostBulk&&c.label==='marmalade-buffer-v1');
      },null,{timeout:30000});
      await full('in-flight disconnect and refill',473);
      assert.equal(await viewer.locator('#player').evaluate(v=>v.currentSrc),original);
      const sample=await viewer.locator('#player').evaluate(async v=>{
        const before=v.getVideoPlaybackQuality(),start=performance.now(),initial=v.currentTime;
        await new Promise(resolve=>setTimeout(resolve,10000));
        const after=v.getVideoPlaybackQuality(),seconds=(performance.now()-start)/1000;
        return {seconds,advanced:v.currentTime-initial,
          displayedFPS:(after.totalVideoFrames-before.totalVideoFrames-after.droppedVideoFrames+before.droppedVideoFrames)/seconds,
          dropped:after.droppedVideoFrames-before.droppedVideoFrames};
      });
      console.log('Buffered guest playback',height,JSON.stringify(sample));
      assert(sample.advanced>=9&&sample.displayedFPS>=23.5,'24 FPS source must sustain playback within half a frame/s');
      await sender.locator('#playPause').click({force:true});
      await viewer.waitForFunction(()=>document.querySelector('#player').paused);
      began=Date.now();
      await sender.locator('#player').evaluate(v=>{v.currentTime=30;});
      await full('paused rewind',29,32);
      assert(await viewer.locator('#player').evaluate(v=>v.paused),'Refilling must preserve the deliberate pause');
      await sender.locator('#playPause').click({force:true});
      await viewer.waitForFunction(()=>!document.querySelector('#player').paused&&document.querySelector('#player').currentTime>31);
      await sender.locator('#player').evaluate(v=>{v.currentTime=v.duration-20;});
      await viewer.waitForFunction(()=>{
        const v=document.querySelector('#player'),status=window.MarmaladeRollingBuffer.getStatus();
        if(!status||v.duration-v.currentTime>22||v.ended||status.target<=0||status.target>22)return false;
        for(let i=0;i<v.buffered.length;i++){
          if(v.buffered.start(i)<=v.currentTime&&v.buffered.end(i)>=v.duration-.25)return true;
        }
        return false;
      },null,{timeout:15000});
      assert.equal(await viewer.locator('#player').evaluate(v=>v.currentSrc),original);
      console.log('PASS paused rewind, resumed playback and contiguous buffer to end',height);
    }finally{await viewer.close();await sender.close();}
  }
  assert.deepEqual(errors,[],'Buffered room runtime errors');
} catch(error) {
  console.error('MARMALADE FULL PEERJS TEST FAILED',error);
  process.exitCode=1;
} finally {
  await browser.close().catch(()=>{});
  try{signaling.close?.();}catch{}
  web.close();
  rmSync(dir,{recursive:true,force:true});
  process.exit(process.exitCode || 0);
}

