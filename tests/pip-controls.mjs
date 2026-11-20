import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {extname,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const mime={'.html':'text/html','.js':'application/javascript',
  '.css':'text/css','.json':'application/json','.svg':'image/svg+xml'};
const server=createServer((request,response)=>{
  const relative=new URL(request.url,'http://localhost').pathname.slice(1)||'index.html';
  const path=resolve(root,decodeURIComponent(relative));
  if(path!==root&&!path.startsWith(root+sep)){
    response.writeHead(403);response.end();return;
  }
  try{
    response.writeHead(200,{'content-type':mime[extname(path)]||'application/octet-stream'});
    response.end(readFileSync(path));
  }catch{response.writeHead(404);response.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,
  args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
try{
  const page=await browser.newPage({viewport:{width:900,height:680}});
  await page.addInitScript(()=>{
    // The live app now uses native system Picture-in-Picture, NOT a second
    // Document PiP browser window. Shim the OS PiP window only so the
    // browser-independent video compositor and transport can be tested in CI.
    let nativePip=null;
    window.__nativePipRequests=0;
    window.__pipSubtitlePaints=0;
    Object.defineProperty(document,'pictureInPictureEnabled',
      {configurable:true,get:()=>true});
    Object.defineProperty(document,'pictureInPictureElement',
      {configurable:true,get:()=>nativePip});
    HTMLVideoElement.prototype.requestPictureInPicture=async function(){
      nativePip=this;
      window.__nativePipRequests++;
      this.dispatchEvent(new Event('enterpictureinpicture'));
      return this;
    };
    document.exitPictureInPicture=async()=>{
      const old=nativePip;nativePip=null;
      old?.dispatchEvent(new Event('leavepictureinpicture'));
    };
    const originalFillText=CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText=function(text,...args){
      if(String(text).includes('CAPTIONS IN PICTURE-IN-PICTURE'))
        window.__pipSubtitlePaints++;
      return originalFillText.call(this,text,...args);
    };
  });
  await page.route('**/peerjs@*/**',route=>route.fulfill({
    status:200,contentType:'application/javascript',
    body:'window.Peer=class {on(){} destroy(){}};'
  }));
  await page.route('https://unpkg.com/**',route=>route.fulfill({
    status:200,contentType:'application/javascript',
    body:'window.MediaInfo=async()=>({analyzeData:async()=>({media:{track:[]}})});'
  }));
  await page.goto('http://127.0.0.1:'+server.address().port+'/',
    {waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>Boolean(window.MarmaladeAddonBridge &&
    window.MarmaladeAdaptiveBrightness && window.MarmaladeStandalonePiP));
  await page.evaluate(async()=>{
    const bridge=window.MarmaladeAddonBridge;
    const video=bridge.media,canvas=document.createElement('canvas');
    canvas.width=640;canvas.height=360;
    const ctx=canvas.getContext('2d');
    let frame=0;
    const paint=()=>{
      ctx.fillStyle='#c12026';ctx.fillRect(0,0,640,360);
      ctx.fillStyle='#ffc844';ctx.fillRect(20+(frame++%120),25,95,70);
    };
    paint();
    window.__testVideoTimer=setInterval(paint,42);
    video.muted=true;
    video.srcObject=canvas.captureStream(24);
    video.playsInline=true;
    await video.play();
    bridge.state.role='host';
    bridge.state.source='file';
    bridge.el.stage.classList.add('has-video','controls-visible');
    bridge.el.empty.hidden=true;
    bridge.state.subtitlesEnabled=true;
    bridge.state.subtitles=[{
      start:0,end:120,text:'CAPTIONS IN PICTURE-IN-PICTURE'
    }];
    window.MarmaladeAdaptiveBrightness.setLevel(72);
    window.MarmaladeSubtitleRefresh();
  });
  await page.waitForFunction(()=>{
    const diag=window.MarmaladeStandalonePiP.getDiagnostics();
    return diag.sourceReady>=2 && diag.pipReady>=2 &&
      diag.canvasWidth>=320 && diag.frames>0;
  },null,{timeout:15000});
  await page.locator('#popoutBtn').click({force:true});
  await page.waitForFunction(()=>window.MarmaladeStandalonePiP.isActive(),null,
    {timeout:10000});
  const active=await page.evaluate(()=>{
    const diag=window.MarmaladeStandalonePiP.getDiagnostics();
    const pip=document.pictureInPictureElement;
    return {diag,requests:window.__nativePipRequests,
      separateVideo:pip?.id==='marmaladeStandalonePipVideo',
      muted:pip?.muted,hasStream:!!pip?.srcObject?.getVideoTracks().length,
      stageStillOwned:!!document.getElementById('dropZone'),
      controlsStillOwned:!!document.getElementById('theaterControls'),
      subtitles:document.getElementById('subtitleOverlay').textContent,
      subtitlePaints:window.__pipSubtitlePaints,
      external:window.MarmaladeAdaptiveBrightness.isExternalPlayback()};
  });
  assert.equal(active.requests,1,'Pop-Out must use native system PiP');
  assert.equal(active.separateVideo,true,'PiP has a standalone video-only surface');
  assert.equal(active.muted,true,'PiP composition must not duplicate audio output');
  assert.equal(active.hasStream,true,'PiP must have an actual canvas video track');
  assert.equal(active.stageStillOwned,true,'Keep application controls in the main window');
  assert.equal(active.controlsStillOwned,true,'Never move the app chrome into a popup');
  assert.equal(active.external,true,'Adaptive brightness must track external playback');
  assert.match(active.subtitles,/CAPTIONS IN PICTURE-IN-PICTURE/);
  assert(active.subtitlePaints>0,'Timed captions must be painted onto the PiP video');
  assert(active.diag.frames>0,'PiP video compositor must render frames');
  assert(active.diag.canvasWidth<=960 && active.diag.canvasHeight<=540,
    'PiP video compositor must stay within its lightweight resolution budget');
  await page.locator('#popoutBtn').click({force:true});
  await page.waitForFunction(()=>!window.MarmaladeStandalonePiP.isActive(),null,
    {timeout:10000});
  assert.equal(await page.evaluate(()=>
    window.MarmaladeAdaptiveBrightness.isExternalPlayback()),false,
    'Returning from PiP must restore the original brightness state');
  // Android floats the same WebView rather than creating a document popup.
  await page.evaluate(()=>window.dispatchEvent(
    new CustomEvent('marmalade:native-floating',{detail:{active:true}})));
  const android=await page.locator('#theaterControls').evaluate(node=>({
    display:getComputedStyle(node).display,
    visibility:getComputedStyle(node).visibility,
    width:node.getBoundingClientRect().width
  }));
  assert.equal(android.display,'block');
  assert.equal(android.visibility,'visible');
  assert(android.width>0,'Native floating controls need a drawable surface');
  assert.equal(await page.evaluate(()=>
    window.MarmaladeAdaptiveBrightness.isExternalPlayback()),true);
  await page.evaluate(()=>{
    window.dispatchEvent(new CustomEvent('marmalade:native-floating',{detail:{active:false}}));
    clearInterval(window.__testVideoTimer);
  });
  assert.equal(await page.evaluate(()=>
    window.MarmaladeAdaptiveBrightness.isExternalPlayback()),false);
  const androidSource=readFileSync(resolve(root,'mobile/scripts/patch-native.mjs'),'utf8');
  assert.match(androidSource,/int width=Math\.max\(1,startWidth\+dx\)/,
    'Android mini-player must not enforce a screen-width maximum');
  await page.close();
  console.log('PASS native video-only PiP: actual frames, subtitles, gamma, controls and exit');
}finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
