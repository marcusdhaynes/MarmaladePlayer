import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'};
const server=createServer((req,res)=>{
  const path=resolve(root,decodeURIComponent(new URL(req.url,'http://localhost').pathname.slice(1)||'index.html'));
  if(path!==root&&!path.startsWith(root+sep)){res.writeHead(403);res.end();return;}
  try{res.writeHead(200,{'content-type':mime[extname(path)]||'application/octet-stream'});
    res.end(readFileSync(path));}catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
  const page=await browser.newPage({viewport:{width:1152,height:800}});
  const errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  await page.route('**/peerjs@*/**',route=>route.fulfill({status:200,
    contentType:'application/javascript',body:'window.Peer=class {on(){} destroy(){}};'}));
  await page.route('http://127.0.0.1:18761/video/**',route=>route.fulfill({
    status:200,contentType:'video/mp4',body:'not-real-video'
  }));
  await page.goto('http://127.0.0.1:'+server.address().port+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>Boolean(window.MarmaladeAddonBridge?.setGameFrameMode));
  const check=await page.evaluate(async()=>{
    const bridge=window.MarmaladeAddonBridge;
    const media=bridge.media;
    const counter={plays:0,pauses:0,seeks:[],nativeLoads:0};
    // Count every attempted play on the real native-library path without
    // consuming actual time. The game must not even REQUEST playback.
    media.play=()=>{counter.plays++;return Promise.resolve();};
    media.pause=()=>{counter.pauses++;};
    Object.defineProperty(media,'paused',{configurable:true,get:()=>true});
    Object.defineProperty(media,'duration',{configurable:true,get:()=>120});
    Object.defineProperty(media,'readyState',{configurable:true,
      get:()=>HTMLMediaElement.HAVE_CURRENT_DATA});
    let currentTime=0;
    Object.defineProperty(media,'currentTime',{configurable:true,
      get:()=>currentTime,set:value=>{currentTime=value;counter.seeks.push(value);}});
    bridge.el.stage.classList.add('poster-preview-active');
    const nameVisibleBeforeGame=getComputedStyle(
      document.getElementById('mediaInfoToggle')).display!=='none';
    bridge.setGameFrameMode(true);
    const nameHiddenDuringGame=getComputedStyle(
      document.getElementById('mediaInfoToggle')).display==='none';
    const viewersRemainVisible=getComputedStyle(
      document.querySelector('.theater-title .watchers')).display!=='none';
    const previewRemovedOnStart=!bridge.el.stage.classList.contains('poster-preview-active');
    // Simulate an async artwork preview trying to reappear after game start.
    bridge.el.stage.classList.add('poster-preview-active');
    const previewHiddenByGameCSS=getComputedStyle(
      document.getElementById('stagePosterPreview')).display==='none';
    bridge.el.stage.classList.remove('poster-preview-active');
    const url='http://127.0.0.1:18761/video/test-clip';
    const selected=bridge.chooseNativeStream({
      url,name:'Sample.mp4',size:1000,id:'game-video'
    });
    counter.nativeLoads++;
    const playAttemptsDuringGame=counter.plays;
    const gameActive=bridge.state.gameFrameMode;
    const durationReady=bridge.state.fileReady;
    // Metadata event should not trigger automatic resume or broadcast.
    media.dispatchEvent(new Event('loadedmetadata'));
    const afterMetadata=counter.plays;
    bridge.el.play.click();
    await new Promise(resolve=>setTimeout(resolve,0));
    const afterPlayButton=counter.plays;
    // Explicit game-only seek is permitted, without the usual Play toggle.
    const positioned=bridge.pauseAndSeekGameFrame(42);
    const afterSeek=counter.plays;
    const seekTime=currentTime;
    const progressBefore=localStorage.getItem('marmalade:watch-progress:v1');
    media.dispatchEvent(new Event('pause'));
    const progressAfter=localStorage.getItem('marmalade:watch-progress:v1');
    bridge.setGameFrameMode(false);
    const nameRestoredAfterGame=getComputedStyle(
      document.getElementById('mediaInfoToggle')).display!=='none';
    bridge.chooseNativeStream({url,name:'Sample.mp4',size:1000,id:'normal-video'});
    const normalPlayAttempts=counter.plays;
    bridge.stopGameVideo();
    return {selected,gameActive,durationReady,playAttemptsDuringGame,
      afterMetadata,afterPlayButton,positioned,afterSeek,seekTime,
      previewRemovedOnStart,previewHiddenByGameCSS,
      nameVisibleBeforeGame,nameHiddenDuringGame,nameRestoredAfterGame,
      viewersRemainVisible,progressUnchanged:progressBefore===progressAfter,
      normalPlayAttempts,gameModeAfterStop:bridge.state.gameFrameMode};
  });
  assert.equal(check.selected,true,'Native Media Library game video should select');
  assert.equal(check.gameActive,true);
  assert.equal(check.nameVisibleBeforeGame,true,
    'Movie title normally appears in the video controls');
  assert.equal(check.nameHiddenDuringGame,true,
    'OnlyFrames must never reveal the movie title in its video controls');
  assert.equal(check.viewersRemainVisible,true,
    'OnlyFrames hides just the movie name, not the spectators');
  assert.equal(check.nameRestoredAfterGame,true,
    'Ending OnlyFrames must restore the normal player title');
  assert.equal(check.previewRemovedOnStart,true,
    'OnlyFrames must dismiss pre-play artwork even while video stays paused');
  assert.equal(check.previewHiddenByGameCSS,true,
    'Late artwork preview may never cover the game frame');
  assert.equal(check.playAttemptsDuringGame,0,'No native video autoplay at selection');
  assert.equal(check.afterMetadata,0,'Metadata must not trigger playback during a game');
  assert.equal(check.afterPlayButton,0,'Normal play button must remain inactive in game mode');
  assert.equal(check.positioned,true,'Game-specific seek must work while paused');
  assert.equal(check.seekTime,42,'OnlyFrames must display its requested frame');
  assert.equal(check.afterSeek,0,'Seeking must not resume playback');
  assert.equal(check.progressUnchanged,true,'Game frame must not replace saved watch progress');
  assert.equal(check.normalPlayAttempts,1,
    'Ordinary Media Library videos must retain their existing autoplay behavior');
  assert.equal(check.gameModeAfterStop,false,'Ending game releases player lock');
  assert.deepEqual(errors,[],'No runtime errors: '+errors.join('\n'));
  console.log('PASS OnlyFrames never starts playback, normal library keeps existing behavior, paused seeking works');
}finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
