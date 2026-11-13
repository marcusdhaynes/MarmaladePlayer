import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const dir=mkdtempSync(join(tmpdir(),'marmalade-thumbs-')),fixture=join(dir,'scene.webm');
execFileSync('ffmpeg',['-hide_banner','-loglevel','error',
 '-f','lavfi','-i','color=c=red:s=160x90:r=24:d=4',
 '-f','lavfi','-i','color=c=blue:s=160x90:r=24:d=4',
 '-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0[v]',
 '-map','[v]','-c:v','libvpx','-deadline','realtime','-cpu-used','5',
 '-pix_fmt','yuv420p','-b:v','400k','-y',fixture],{timeout:30000});
const server=createServer((req,res)=>{
 const name=new URL(req.url,'http://local').pathname.slice(1)||'index.html',file=resolve(root,decodeURIComponent(name));
 if(!file.startsWith(root+sep)){res.writeHead(403);res.end();return;}
 try{const type={'.js':'application/javascript','.html':'text/html','.css':'text/css'}[extname(file)];
  res.writeHead(200,{'content-type':type||'application/octet-stream'});res.end(readFileSync(file));
 }catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:1100,height:800}});
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.route('**/npm/peerjs@*/**',route=>route.fulfill({status:200,contentType:'application/javascript',
  body:'window.Peer=class {on(){} destroy(){}};'}));
 await page.route('**/mediainfo.js@*',route=>route.fulfill({status:200,contentType:'application/javascript',
  body:'window.MediaInfo=async()=>({analyzeData:async()=>({media:{track:[]}})});'}));
 await page.goto('http://127.0.0.1:'+server.address().port+'/',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>!!window.MarmaladeSeekPreview&&!!window.MarmaladeSubtitleCompact);
 await page.locator('#fileInput').setInputFiles({name:'Scene.2026.webm',mimeType:'video/webm',buffer:readFileSync(fixture)});
 await page.waitForFunction(()=>document.querySelector('#player').duration>7.5&&!document.querySelector('#seek').disabled,null,{timeout:12000});
 await page.evaluate(()=>document.querySelector('#dropZone').classList.add('controls-visible'));
 const seek=await page.locator('#seek').boundingBox();
 const before=await page.locator('#player').evaluate(e=>({paused:e.paused,t:e.currentTime}));
 async function sample(frac){
  await page.mouse.move(seek.x+seek.width*frac,seek.y+seek.height/2);
  await page.waitForFunction(()=>!document.querySelector('#seekPreviewCanvas').hidden,null,{timeout:9000});
  return await page.locator('#seekPreviewCanvas').evaluate(c=>{
   const p=c.getContext('2d').getImageData(96,54,1,1).data;return [p[0],p[1],p[2]];
  });
 }
 const red=await sample(.25),blue=await sample(.75);
 assert(red[0]>95&&red[2]<85,'2-second hover shows red scene '+red);
 assert(blue[2]>95&&blue[0]<85,'6-second hover shows blue scene '+blue);
 const after=await page.locator('#player').evaluate(e=>({paused:e.paused,t:e.currentTime}));
 assert.equal(before.paused,after.paused);
 assert(Math.abs(before.t-after.t)<.1,'Preview never seeks playing video');
 await page.mouse.move(1,1);
 assert.equal(await page.locator('#seekPreview').isVisible(),false);
 console.log('PASS thumbnails show distinct frames at hovered scene times; main playback unchanged');

 await page.locator('#subtitlesBtn').click({force:true});
 await page.locator('#subSyncTab').click({force:true});
 assert.equal(await page.locator('label[for=subTimingCueSearch]').textContent(),'Line Alignment');
 const full='At the castle we found the beautiful blue river that winds forever along the steep dark mountains with the full subtitle line completely visible.';
 await page.evaluate(line=>{
  const {state}=window.MarmaladeAddonBridge;
  state.role='host';state.source='file';
  state.subtitles=[{start:1,end:2,text:'First subtitle.'},{start:4.2,end:6.7,text:line},{start:6.8,end:7.8,text:'Third subtitle.'}];
  state.subtitlesEnabled=true;state.subtitlePreviewSuppressed=true;
  window.MarmaladeSubtitleTiming.activate('file:test-scene','local:scene-subtitle');
  window.dispatchEvent(new Event('marmalade:subtitles-loaded'));
 },full);
 await page.locator('#subTimingCueSearch').fill('castle river');
 await page.waitForFunction(()=>document.querySelectorAll('#subTimingCue .sub-cue-option').length===1);
 const text=await page.locator('#subTimingCue .sub-cue-option').textContent();
 assert(text.startsWith('00:00:04.2 | ')&&text.includes(full),'Full Time | Line is preserved');
 await page.locator('#subTimingCue .sub-cue-option').click();
 await page.evaluate(()=>{document.querySelector('#player').currentTime=5;});
 await page.locator('#subTimingAlign').click();
 assert.equal(await page.locator('#subtitleTiming').inputValue(),'-0.8');
 const result=await page.evaluate(()=>{
  const {state,media}=window.MarmaladeAddonBridge;
  return {clock:window.MarmaladeSubtitleClock(media.currentTime),
    text:document.querySelector('#subtitleOverlay').textContent,
    offsets:localStorage.getItem('marmalade:subtitle-offsets:v2')};
 });
 assert(Math.abs(result.clock-4.2)<.051,'Align uses exactly the caption clock '+JSON.stringify(result));
 assert(result.text===full,'Aligned subtitle becomes visible immediately');
 assert(result.offsets.includes('local:scene-subtitle'),'Alignment offset saved for subtitle');
 console.log('PASS searchable full-length subtitle lines and exact per-video timing');

 await page.evaluate(()=>window.MarmaladeSubtitleTiming.set(0));
 const plus=page.locator('#subtitleTimingPlus'),minus=page.locator('#subtitleTimingMinus');
 await plus.evaluate(e=>e.click());
 assert.equal(await page.locator('#subtitleTiming').inputValue(),'0.1');
 const hold=async(locator,ms,id)=>{
  await locator.dispatchEvent('pointerdown',{button:0,pointerId:id,pointerType:'mouse',isPrimary:true});
  await page.waitForTimeout(ms);
  await locator.dispatchEvent('pointerup',{button:0,pointerId:id,pointerType:'mouse',isPrimary:true});
  await locator.dispatchEvent('click');
 };
 await hold(plus,800,13);
 assert.equal(await page.locator('#subtitleTiming').inputValue(),'1.1','Long press must change exactly once');
 await page.locator('#subtitlesBtn').click({force:true});
 await page.locator('#settingsBtn').click({force:true});
 await page.evaluate(()=>window.MarmaladeSettingsLayout.activate('controls'));
 assert.equal(await page.locator('#subtitleTimingHold').inputValue(),'250');
 await page.locator('#subtitleTimingHold').selectOption('150');
 await page.locator('#settingsBtn').click({force:true});
 await page.locator('#subtitlesBtn').click({force:true});
 await page.locator('#subSyncTab').click({force:true});
 await hold(minus,250,14);
 assert.equal(await page.locator('#subtitleTiming').inputValue(),'0.1','Configured hold changes once');
 await minus.evaluate(e=>e.click());
 assert.equal(await page.locator('#subtitleTiming').inputValue(),'0.0','Tap changes one tenth');
 console.log('PASS configurable 0.25-second, nonrepeating long press');

 assert.deepEqual(errors,[],'No uncaught JS errors');
}finally{await browser.close();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
