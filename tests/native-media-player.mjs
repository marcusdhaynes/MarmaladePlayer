// Native Minternet library integration: a library card must behave like a
// selected local video with active controls. Exercises an actual MP4 streamed
// from a loopback Range server, not a fake data URL or direct File picker.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,join,extname,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const temp=mkdtempSync(join(tmpdir(),'marmalade-library-player-'));
const file=join(temp,'Controls (2026).mp4');
execFileSync('ffmpeg',['-hide_banner','-loglevel','error',
  '-f','lavfi','-i','color=c=purple:s=320x180:r=24',
  '-f','lavfi','-i','sine=frequency=440:sample_rate=48000',
  '-t','16','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',
  '-c:a','aac','-b:a','96k','-movflags','+faststart','-y',file],{timeout:40000});
const bytes=readFileSync(file);
const key='a'.repeat(64);
const originPort=38829;
const app=createServer((req,res)=>{
  const loc=new URL(req.url,'http://127.0.0.1:'+originPort);
  const name=loc.pathname==='/'?'index.html':decodeURIComponent(loc.pathname.slice(1));
  const full=resolve(root,name);
  if(full!==root&&!full.startsWith(root+sep)){
    res.writeHead(403);res.end();return;
  }
  try{
    const content=readFileSync(full);
    const mime={
      '.js':'application/javascript','.html':'text/html','.css':'text/css',
      '.svg':'image/svg+xml','.webmanifest':'application/manifest+json'
    };
    res.writeHead(200,{'content-type':mime[extname(full)]||'application/octet-stream','cache-control':'no-store'});
    res.end(content);
  }catch{res.writeHead(404);res.end();}
});
const mediaServer=createServer((req,res)=>{
  const reqUrl=new URL(req.url,'http://127.0.0.1:18761');
  const cors={'Access-Control-Allow-Origin':'http://127.0.0.1:'+originPort,
    'Access-Control-Allow-Private-Network':'true',
    'Access-Control-Allow-Headers':'Range',
    'Access-Control-Allow-Methods':'GET, OPTIONS',
    'Access-Control-Expose-Headers':'Content-Range, Content-Length, Accept-Ranges',
    'Accept-Ranges':'bytes','Cache-Control':'no-store'};
  if(req.method==='OPTIONS'){res.writeHead(204,cors);res.end();return;}
  if(reqUrl.pathname!=='/video/0'||reqUrl.searchParams.get('key')!==key){
    res.writeHead(403,cors);res.end();return;
  }
  const match=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range||'');
  const start=match?Number(match[1]):0;
  const end=match&&match[2]?Math.min(bytes.length-1,Number(match[2])):bytes.length-1;
  if(!Number.isSafeInteger(start)||start>=bytes.length||start>end){
    res.writeHead(416,{...cors,'Content-Range':'bytes */'+bytes.length});res.end();return;
  }
  const payload=bytes.subarray(start,end+1);
  res.writeHead(match?206:200,{...cors,'Content-Type':'video/mp4',
    'Content-Length':payload.length,
    ...(match?{'Content-Range':`bytes ${start}-${end}/${bytes.length}`}:{})});
  res.end(payload);
});
const listen=server=>new Promise((resolve,reject)=>{
  server.once('error',reject);
  server.listen(server===app?originPort:18761,'127.0.0.1',resolve);
});
let browser;
try{
  await listen(app);await listen(mediaServer);
  // The unbranded headless Chromium shell may lack proprietary H.264/AAC codecs.
  // This native MP4 compatibility test must run on a codec-capable browser.
  browser=await chromium.launch({channel:'chrome',headless:true,
    args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
  const page=await browser.newPage();
  const errors=[],mediaRequests=[];
  page.on('pageerror',error=>errors.push(String(error)));
  page.on('requestfailed',request=>{if(request.url().includes(':18761/'))mediaRequests.push({failed:request.failure()?.errorText});});
  page.on('response',response=>{if(response.url().includes(':18761/'))mediaRequests.push({status:response.status()});});
  await page.route('**/peerjs@*/**',route=>route.fulfill({
    status:200,contentType:'application/javascript',
    body:'window.Peer=class{constructor(){this.open=false}on(){}destroy(){}};'
  }));
  await page.addInitScript(({url,size})=>{
    const library={
      id:'native-test',name:'Native Movies',kind:'movie',
      folders:[{id:'folder-test',name:'Movies'}],
      items:[{id:'folder-test|Controls (2026).mp4',folderId:'folder-test',
        path:'Controls (2026).mp4',name:'Controls (2026).mp4',
        title:'Controls',year:2026,type:'movie',size,url}],lastScan:Date.now()
    };
    window.MinternetMediaLibrary=Object.freeze({
      getCatalog:async()=>({libraries:[library]}),
      rescan:async()=>({libraries:[library]}),
      updateItem:async()=>true
    });
  },{url:'http://127.0.0.1:18761/video/0?key='+key,size:bytes.length});
  await page.goto('http://127.0.0.1:'+originPort+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>Boolean(window.MarmaladeMediaLibrary?.ready));
  await page.evaluate(()=>window.MarmaladeMediaLibrary.ready);
  // Native integration is optional, not an automatic dependency of the site.
  // Explicitly load the granted compatibility catalog before exercising playback.
  const imported=await page.evaluate(()=>window.MarmaladeMediaLibrary.syncFromNative());
  assert.equal(imported.count,1,'Granted native catalog is available through the optional bridge');
  await page.locator('#settingsBtn').click();
  await page.locator('#mlVisibilityToggle').check();
  await page.locator('#closeSettingsPanel').click();
  await page.waitForFunction(()=>window.MarmaladeMediaLibrary.getLibraries().some(
    l=>l.name==='Native Movies'&&l.count===1));
  const video=page.locator('#mlCards .ml-card').filter({hasText:'Controls'});
  await video.waitFor({state:'visible'});
  assert.equal(await video.count(),1);
  await video.click();
  await page.waitForFunction(()=>{
    const player=window.MarmaladeAddonBridge;
    return player?.state?.source==='native'&&player?.state?.fileReady&&
      !document.querySelector('#playPause').disabled&&
      !document.querySelector('#skipBack').disabled&&
      !document.querySelector('#skipForward').disabled&&
      !document.querySelector('#seek').disabled&&
      player?.media?.duration>10;
  },null,{timeout:20000}).catch(async error=>{
    console.error('NATIVE PLAYBACK DIAGNOSTICS',JSON.stringify({mediaRequests,errors,browser:await page.evaluate(()=>{const {state,media}=window.MarmaladeAddonBridge;return {role:state.role,source:state.source,fileReady:state.fileReady,readyState:media.readyState,networkState:media.networkState,error:media.error?.message,code:media.error?.code,duration:media.duration,canMP4:media.canPlayType('video/mp4; codecs="avc1.42E01E,mp4a.40.2"'),canWebM:media.canPlayType('video/webm; codecs="vp8,opus"'),url:media.currentSrc,toast:document.querySelector('#toast')?.textContent,libraryStatus:document.querySelector('#mlStatus')?.textContent};})}));throw error;
  });
  const actual=await page.evaluate(()=>({
    source:window.MarmaladeAddonBridge.state.source,
    ready:window.MarmaladeAddonBridge.state.fileReady,
    name:document.querySelector('#fileName')?.textContent,
    stage:document.querySelector('#dropZone').className
  }));
  assert.equal(actual.source,'native');
  await page.waitForFunction(()=>!document.querySelector('#player').paused,null,{timeout:8000});
  await page.locator('#playPause').click();
  let paused=await page.locator('#player').evaluate(m=>m.paused);
  assert.equal(paused,true,'Native video responds to the normal pause control');
  await page.locator('#playPause').click();
  await page.waitForFunction(()=>!document.querySelector('#player').paused);
  await page.locator('#seek').evaluate(input=>{
    input.value='500';input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await page.waitForFunction(()=>document.querySelector('#player').currentTime>5,
    null,{timeout:8000});
  await page.locator('#skipBack').click();
  await page.waitForFunction(()=>document.querySelector('#player').currentTime<4,
    null,{timeout:8000});
  assert.equal(await page.locator('#subtitlesBtn').isDisabled(),false,
    'Subtitles must remain available for library videos');
  assert.equal(await page.locator('#fullscreenBtn').isDisabled(),false,
    'Fullscreen control must remain available for library videos');
  assert.deepEqual(errors,[],'Native Media Library playback must not throw page errors');
  console.log('PASS Native Minternet media card behaves like a selected playable video',actual);
  await page.close();
}finally{
  await browser?.close();
  if(app.listening)await new Promise(done=>app.close(done));
  if(mediaServer.listening)await new Promise(done=>mediaServer.close(done));
  rmSync(temp,{recursive:true,force:true});
}
