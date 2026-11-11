// End-to-end regression: MKV with real E-AC-3 soundtrack automatically
// produces audible AAC, and a held Stop never opens the OS file chooser.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, extname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const tmp=mkdtempSync(join(tmpdir(),'marmalade-mkv-eac3-'));
const source=join(tmp,'marmalade-eac3-test.mkv');
execFileSync('ffmpeg',['-hide_banner','-loglevel','error',
  '-f','lavfi','-i','color=c=blue:s=320x180:r=24',
  '-f','lavfi','-i','sine=frequency=440:sample_rate=48000',
  '-t','12','-c:v','libx264','-preset','ultrafast',
  '-pix_fmt','yuv420p','-c:a','eac3','-b:a','192k','-y',source],
  {timeout:30000});
const mime={'.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm',
  '.html':'text/html','.svg':'image/svg+xml','.css':'text/css','.json':'application/json'};
const server=createServer((req,res)=>{
  const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const relative=path==='/'?'index.html':path.slice(1);
  const file=resolve(root,relative);
  if(!file.startsWith(root+'/')&&!file.startsWith(root+'\\')){res.writeHead(403);res.end();return;}
  try{
    const content=readFileSync(file);
    res.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream',
      'cache-control':'no-store'});
    res.end(content);
  }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port;
let browser;
try{
  try{browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});}
  catch{browser=await chromium.launch({headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});}
  const page=await browser.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.addInitScript(()=>{
    window.Peer=class MockPeer {
      constructor(){this.id='marmalade-TEST1234';this.open=true;this.handlers={};}
      on(name,handler){this.handlers[name]=handler;if(name==='open')setTimeout(()=>handler(this.id),10);}
      destroy(){}
      connect(){return {open:false,on(){},close(){}};}
    };
  });
  await page.route('https://cdn.jsdelivr.net/npm/peerjs@*/**',route=>route.fulfill({
    status:200,contentType:'application/javascript',body:''}));
  await page.route('https://unpkg.com/**',route=>route.fulfill({
    status:200,contentType:'application/javascript',body:''}));
  await page.goto('http://127.0.0.1:'+port+'/',{waitUntil:'domcontentloaded'});
  await page.locator('#fileInput').setInputFiles(source);
  await page.waitForFunction(()=>
    document.querySelector('#fileInfo').textContent.includes('Compatible AAC audio'),
    {timeout:45000});
  const video=page.locator('#player');
  await page.waitForFunction(()=>document.querySelector('#player').readyState>=2,
    {timeout:20000});
  await page.locator('#playPause').click({force:true});
  await page.waitForFunction(()=>document.querySelector('#player').currentTime>1,
    {timeout:15000});
  const playback=await page.evaluate(async()=>{
    const video=document.querySelector('#player');
    const stream=video.captureStream();
    const tracks=stream.getAudioTracks();
    if(!tracks.length)return {audioTracks:0,energy:0,currentTime:video.currentTime};
    const ctx=new AudioContext();
    const src=ctx.createMediaStreamSource(stream);
    const analyser=ctx.createAnalyser();analyser.fftSize=2048;
    src.connect(analyser);
    await ctx.resume();
    await new Promise(resolve=>setTimeout(resolve,500));
    const values=new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(values);
    const energy=Math.sqrt(values.reduce((sum,v)=>sum+v*v,0)/values.length);
    await ctx.close();
    return {audioTracks:tracks.length,energy,currentTime:video.currentTime};
  });
  console.log('EAC3 PLAYBACK',JSON.stringify(playback));
  assert(playback.audioTracks>0,'Remuxed video must include a real audio track');
  assert(playback.energy>.001,'Decoded E-AC-3 test tone must not be silent');

  // Verify pointer gesture can fully stop, without a delayed picker click.
  let chooserCount=0;
  page.on('filechooser',()=>chooserCount++);
  await page.locator('#playPause').dispatchEvent('pointerdown',
    {pointerId:1,isPrimary:true,button:0});
  await page.waitForTimeout(680);
  await page.locator('#playPause').dispatchEvent('pointerup',
    {pointerId:1,isPrimary:true,button:0});
  await page.locator('#playPause').dispatchEvent('click',
    {button:0});
  await page.waitForTimeout(500);
  assert.equal(chooserCount,0,'Stopping cannot automatically open the file explorer');
  assert.equal(await page.locator('#stageTitle').textContent(),'Choose a movie.');
  assert.equal(await page.locator('#player').getAttribute('src'),null);
  console.log('PASS E-AC-3 AAC automatic playback and Stop without opening file picker');
  if(errors.length)console.log('Non-fatal browser diagnostics:',JSON.stringify(errors.slice(0,5)));
  await page.close();
}finally{
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
  rmSync(tmp,{recursive:true,force:true});
}
