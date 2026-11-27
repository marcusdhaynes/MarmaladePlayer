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
  const data=readFileSync(file);res.writeHead(200,{'content-type':type||'application/octet-stream'});res.end(data);
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
 // A new local hover must schedule its decoder work without the former
 // 100ms timer, and repeated nearby frames should reuse a bounded cache.
 assert.equal(await page.evaluate(()=>document.querySelector('#seekPreviewDecoder').preload),'auto');

 // Broadcasting the paused source must not call video.play() or move its clock.
 const broadcast=await page.evaluate(async()=>{
  const {state,media,el}=window.MarmaladeAddonBridge;
  state.role='host';state.source='file';state.fileReady=true;
  state.peer={open:true,disconnected:false,destroyed:false};
  const pausedBefore=media.paused,timeBefore=media.currentTime;
  const realPlay=media.play.bind(media);let unexpectedPlay=0;
  media.play=()=>{unexpectedPlay++;return Promise.reject(Error('Broadcast must not play'));};
  try{
   el.broadcastToggle.disabled=false;el.broadcastToggle.click();
   for(let i=0;i<80&&!state.broadcasting;i++)await new Promise(r=>setTimeout(r,25));
   const started=state.broadcasting,pausedAfter=media.paused,timeAfter=media.currentTime;
   if(started)el.broadcastToggle.click();
   return {started,pausedBefore,pausedAfter,timeBefore,timeAfter,unexpectedPlay};
  }finally{media.play=realPlay;}
 });
 assert.equal(broadcast.pausedBefore,true,'Video starts paused');
 assert.equal(broadcast.started,true,'Paused file can be broadcast');
 assert.equal(broadcast.pausedAfter,true,'Restart never plays the movie');
 assert.equal(broadcast.unexpectedPlay,0,'Broadcast does not call play');
 assert(Math.abs(broadcast.timeAfter-broadcast.timeBefore)<.1,'Broadcast preserves time');

 async function sample(frac){
  await page.mouse.move(seek.x+seek.width*frac,seek.y+seek.height/2);
  await page.waitForFunction(frac=>{
   const c=document.querySelector('#seekPreviewCanvas');
   if(!c||c.hidden)return false;
   const p=c.getContext('2d').getImageData(96,54,1,1).data;
   return frac<.5?p[0]>95&&p[2]<85:p[2]>95&&p[0]<85;
  },frac,{timeout:9000});
  return await page.locator('#seekPreviewCanvas').evaluate(c=>{
   const p=c.getContext('2d').getImageData(96,54,1,1).data;return [p[0],p[1],p[2]];
  });
 }
 const red=await sample(.25),blue=await sample(.75);
 assert(red[0]>95&&red[2]<85,'2-second hover shows red scene '+red);
 assert(blue[2]>95&&blue[0]<85,'6-second hover shows blue scene '+blue);
 // Re-enter at exactly the same timestamp after the previous preview closes.
 await page.mouse.move(1,1);
 const repeated=await sample(.75);
 assert(repeated[2]>95&&repeated[0]<85,'Reopening an identical hover must redraw the cached frame');
 const after=await page.locator('#player').evaluate(e=>({paused:e.paused,t:e.currentTime}));
 assert.equal(before.paused,after.paused);
 assert(Math.abs(before.t-after.t)<.1,'Preview never seeks playing video');
 await page.mouse.move(1,1);
 assert.equal(await page.locator('#seekPreview').isVisible(),false);
 console.log('PASS thumbnails show distinct frames at hovered scene times; main playback unchanged');
 // Bookmarks use exact movie identity, real seeks and durable local storage.
 await page.waitForFunction(()=>!document.querySelector('#bookmarkAdd').disabled,null,{timeout:12000});
 await page.evaluate(async()=>{const v=document.querySelector('#player');v.pause();v.currentTime=2;await new Promise(r=>v.addEventListener('seeked',r,{once:true}));});
 await page.evaluate(()=>{document.querySelector('#bookmarkName').value='Red Scene';document.querySelector('#bookmarkAdd').click();});
 assert.equal(await page.locator('#timelineBookmarkMarkers .timeline-bookmark-marker').count(),1);
 assert.match(await page.locator('#bookmarkList').textContent(),/00:00:02 · Red Scene/);
 await page.evaluate(async()=>{const v=document.querySelector('#player');v.currentTime=6;await new Promise(r=>v.addEventListener('seeked',r,{once:true}));document.querySelector('.bookmark-jump').click();});
 await page.waitForFunction(()=>Math.abs(document.querySelector('#player').currentTime-2)<.1&&!document.querySelector('#player').seeking);
 assert.equal(await page.locator('#player').evaluate(v=>v.paused),true);
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>!!window.MarmaladeSeekPreview&&!!window.MarmaladeSubtitleCompact);
 await page.locator('#fileInput').setInputFiles({name:'Scene.2026.webm',mimeType:'video/webm',buffer:readFileSync(fixture)});
 await page.waitForFunction(()=>document.querySelector('#bookmarkList').textContent.includes('Red Scene'),null,{timeout:12000});
 assert.equal(await page.locator('#timelineBookmarkMarkers .timeline-bookmark-marker').count(),1);
 await page.evaluate(()=>document.querySelector('#bookmarkList button[aria-label^="Delete bookmark"]').click());
 assert.equal(await page.locator('#timelineBookmarkMarkers .timeline-bookmark-marker').count(),0);
 assert.equal(await page.evaluate(()=>Object.keys(JSON.parse(localStorage.getItem('marmalade:timeline-bookmarks:v1'))).length),0);
 console.log('PASS movie bookmarks persist across reload, seek precisely and delete durably');
 // A typed timestamp must not be rounded to the range slider step.
 await page.evaluate(()=>document.querySelector('#dropZone').classList.add('controls-visible'));
 await page.locator('#timestampToggle').click({force:true});
 await page.locator('#timestampInput').fill('00:00:03.125');
 await page.locator('#timestampInput').press('Enter');
 await page.waitForFunction(()=>Math.abs(document.querySelector('#player').currentTime-3.125)<.025&&!document.querySelector('#player').seeking);
 assert.equal(await page.locator('#player').evaluate(v=>v.paused),true);
 assert.equal(await page.locator('#timestampEditor').isVisible(),false);
 await page.locator('#timestampToggle').click({force:true});
 for(const bad of ['00:00:60','-1','00:00:09.000','NaN']){
   await page.locator('#timestampInput').fill(bad);
   await page.locator('#timestampInput').press('Enter');
   assert.equal(await page.locator('#timestampInput').getAttribute('aria-invalid'),'true');
   assert(Math.abs(await page.locator('#player').evaluate(v=>v.currentTime)-3.125)<.025);
 }
 await page.locator('#timestampInput').press('Escape');
 assert.equal(await page.locator('#timestampEditor').isVisible(),false);
 await page.locator('#timestampToggle').click({force:true});
 await page.locator('#timestampInput').fill('5.25');
 await page.locator('#timestampGo').click();
 await page.waitForFunction(()=>Math.abs(document.querySelector('#player').currentTime-5.25)<.025&&!document.querySelector('#player').seeking);
 console.log('PASS precise timestamp entry, invalid range rejection, cancel and paused state');

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
 await page.waitForFunction(()=>{const v=document.querySelector('#player');return !v.seeking&&Math.abs(v.currentTime-5)<.01;});
 const firstWord=page.locator('#subSelectedLine .sub-word').first();
 assert.equal(await firstWord.textContent(),'At');
 await firstWord.click();
 assert.equal(await firstWord.getAttribute('aria-pressed'),'true');
 assert.equal(await page.locator('#subtitleTiming').inputValue(),'0.8');
 const result=await page.evaluate(()=>{
  const {state,media}=window.MarmaladeAddonBridge;
  return {clock:window.MarmaladeSubtitleClock(media.currentTime),
    text:document.querySelector('#subtitleOverlay').textContent,
    offsets:JSON.parse(localStorage.getItem('marmalade:subtitle-offsets:v3')||'{}')};
 });
 assert(Math.abs(result.clock-4.2)<.051,'Align uses exactly the caption clock '+JSON.stringify(result));
 assert(result.text===full,'Aligned subtitle becomes visible immediately');
 assert.equal(result.offsets['file:test-scene\u0000local:scene-subtitle']?.seconds,0.8,
  'Alignment offset saved under the exact movie and subtitle identity');
 await page.evaluate(()=>{
  window.MarmaladeSubtitleTiming.activate('file:other-scene','local:scene-subtitle');
  window.MarmaladeSubtitleTiming.activate('file:test-scene','local:scene-subtitle');
 });
 assert.equal(await page.locator('#subtitleTiming').inputValue(),'0.8','Saved alignment restored when revisiting the movie');
 console.log('PASS searchable full-length subtitle lines and exact per-video timing');

 await page.evaluate(()=>window.MarmaladeSubtitleTiming.set(0));
 const finePlus=page.locator('#subtitleTimingFinePlus'),fineMinus=page.locator('#subtitleTimingFineMinus');
 const majorPlus=page.locator('#subtitleTimingPlus'),majorMinus=page.locator('#subtitleTimingMinus');
 await finePlus.click();
 assert.equal(await page.locator('#subtitleTiming').inputValue(),'0.1','Outer plus changes one tenth');
 await majorPlus.click();
 assert.equal(await page.locator('#subtitleTiming').inputValue(),'1.1','Inner plus changes one second');
 await majorMinus.click();
 assert.equal(await page.locator('#subtitleTiming').inputValue(),'0.1','Inner minus changes one second');
 await fineMinus.click();
 assert.equal(await page.locator('#subtitleTiming').inputValue(),'0.0','Outer minus changes one tenth');
 // A held pointer must not repeat or silently change the fixed step.
 for(const [button,expected] of [[finePlus,'0.1'],[majorPlus,'1.1'],[majorMinus,'0.1'],[fineMinus,'0.0']]){
  await button.hover();
  await page.mouse.down();
  await page.waitForTimeout(800);
  await page.mouse.up();
  assert.equal(await page.locator('#subtitleTiming').inputValue(),expected,'Hold retains the same fixed adjustment exactly once');
 }
 console.log('PASS fixed fine/major subtitle timing controls and nonrepeating holds');

 // The host can provide an actual scene over the room's existing data channel.
 const hostPacket=await page.evaluate(async()=>{
  const conn={open:true};let packet=null;
  await window.MarmaladeSeekPreview.handleRequest(
   conn,{type:'seek-thumbnail-request',id:73,time:6},
   (_conn,result)=>{packet=result;});
  return packet;
 });
 assert.equal(hostPacket?.id,73);
 assert.match(hostPacket?.frame||'',/^data:image\/jpeg;base64,/);
 assert(hostPacket.frame.length<68000,'Peer thumbnail must be bandwidth bounded');
 await page.evaluate(()=>{
  const {state,el}=window.MarmaladeAddonBridge;
  el.subtitlePanel.hidden=true;
  window.MarmaladeSeekPreview.hide();
  state.role='guest';state.source='remote';state.localVerified=false;
  state.bufferedMode=false;state.sharedDuration=8;state.code='ABCDEFGH';
  state.guestConn={open:true,sent:[],send(packet){this.sent.push(packet);}};
  el.seek.disabled=false;el.stage.classList.add('has-video','controls-visible');
 });
 await page.mouse.move(1,1);
 const guestSeek=page.locator('#seek');
 await guestSeek.scrollIntoViewIfNeeded();
 await page.evaluate(()=>window.MarmaladeAddonBridge.el.stage.classList.add('controls-visible'));
 const guestRect=await guestSeek.boundingBox();
 assert(guestRect&&guestRect.width>0,'Guest scrubber is visible');
 await guestSeek.hover({position:{x:Math.floor(guestRect.width*.75),y:Math.floor(guestRect.height/2)}});
 await page.waitForFunction(()=>window.MarmaladeAddonBridge.state.guestConn.sent
  .some(p=>p.type==='seek-thumbnail-request'),null,{timeout:4000});
 const sent=await page.evaluate(packet=>{
  const request=window.MarmaladeAddonBridge.state.guestConn.sent.findLast(p=>p.type==='seek-thumbnail-request');
  window.MarmaladeSeekPreview.handleResponse({...packet,id:request.id+1,time:request.time});
  if(!document.querySelector('#seekPreviewCanvas').hidden)throw Error('Unsolicited response displayed');
  window.MarmaladeSeekPreview.handleResponse({...packet,id:request.id,time:request.time});
  return request;
 },hostPacket);
 assert(Math.abs(sent.time-6)<.3,'Guest request matches hovered timestamp '+sent.time);
 await page.waitForFunction(()=>!document.querySelector('#seekPreviewCanvas').hidden,null,{timeout:4000});
 const peerPixel=await page.locator('#seekPreviewCanvas').evaluate(c=>{
  const p=c.getContext('2d').getImageData(96,54,1,1).data;return [p[0],p[1],p[2]];
 });
 assert(peerPixel[2]>95&&peerPixel[0]<85,'Guest sees host blue scene '+peerPixel);
 console.log('PASS on-demand host/guest thumbnail requests and scene response over room data channel');
 await page.evaluate(()=>{const b=window.MarmaladeAddonBridge;b.el.stage.classList.add('controls-visible');b.state.hostPlaying=false;b.state.sharedTime=6;b.state.sharedAt=performance.now();document.querySelector('#timestampToggle').disabled=false;});
 await page.locator('#timestampToggle').click({force:true});
 await page.locator('#timestampInput').fill('00:00:01.375');
 await page.locator('#timestampInput').press('Enter');
 const precise=await page.evaluate(()=>window.MarmaladeAddonBridge.state.guestConn.sent.findLast(p=>p.type==='transport'&&p.action==='seek'));
 assert.equal(precise?.value,1.375,'Guest sends precise timestamp through shared transport');
 console.log('PASS exact guest timestamp uses synchronized transport');

 assert.deepEqual(errors,[],'No uncaught JS errors');
}finally{await browser.close();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
