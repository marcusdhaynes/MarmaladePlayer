import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {resolve,sep,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {deflateRawSync} from 'node:zlib';
import {chromium} from 'playwright';
const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const types={'.js':'application/javascript','.html':'text/html','.css':'text/css','.svg':'image/svg+xml'};
const server=createServer((req,res)=>{
  const name=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';
  const path=resolve(root,name);
  if(path!==root&&!path.startsWith(root+sep)){res.writeHead(403);res.end();return;}
  try{res.writeHead(200,{'content-type':types[extname(path)]||'application/octet-stream'});
    res.end(readFileSync(path));}catch{res.writeHead(404);res.end();}
});
function makeZip(name,subtitle){
  const file=Buffer.from(name),body=Buffer.from(subtitle);
  const payload=deflateRawSync(body);
  const head=Buffer.alloc(30),dir=Buffer.alloc(46),tail=Buffer.alloc(22);
  head.writeUInt32LE(0x04034b50);head.writeUInt16LE(8,8);
  head.writeUInt32LE(payload.length,18);head.writeUInt32LE(body.length,22);
  head.writeUInt16LE(file.length,26);
  const offset=head.length+file.length+payload.length;
  dir.writeUInt32LE(0x02014b50);dir.writeUInt16LE(8,10);
  dir.writeUInt32LE(payload.length,20);dir.writeUInt32LE(body.length,24);
  dir.writeUInt16LE(file.length,28);
  tail.writeUInt32LE(0x06054b50);tail.writeUInt16LE(1,8);tail.writeUInt16LE(1,10);
  tail.writeUInt32LE(dir.length+file.length,12);tail.writeUInt32LE(offset,16);
  return Buffer.concat([head,file,payload,dir,file,tail]);
}
const mockZip=makeZip('Example.2026.1080p.srt',
  '1\n00:00:00,000 --> 00:00:30,000\n<font color="red">Hello from SubDL</font>\n');
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage();
 const exceptions=[];page.on('pageerror',e=>exceptions.push(String(e)));
 await page.route('**/npm/peerjs@*/**',route=>
   route.fulfill({status:200,contentType:'application/javascript',body:'window.Peer=function(){};'}));
 await page.route('**/mediainfo.js@*',route=>
   route.fulfill({status:200,contentType:'application/javascript',body:'window.MediaInfo=async()=>({analyzeData:async()=>({media:{track:[]}})});'}));
 await page.route('https://marmalade-subdl-proxy-somnielsynchreaua-4637.vercel.app/**',route=>
   route.fulfill({status:200,contentType:'application/json',
     headers:{'access-control-allow-origin':'*'},
     body:JSON.stringify({status:true,results:[],
       subtitles:[{release_name:'Example.1080p',name:'Example.1080p.zip',
         url:'/subtitle/example.zip',language:'EN',fps:'25'}]})}));
 await page.route('https://v3-cinemeta.strem.io/**',route=>
   route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},
     body:JSON.stringify({metas:[]})}));
 await page.route('https://dl.subdl.com/**',route=>
   route.fulfill({status:200,contentType:'application/zip',
     headers:{'access-control-allow-origin':'*'},body:mockZip}));
 await page.goto('http://127.0.0.1:'+server.address().port+'/',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.MarmaladeSubtitleFinder&&window.MarmaladeSubtitleArchive);
 await page.evaluate(()=>{
   const {state,el}=window.MarmaladeAddonBridge;
   state.role='host';state.source='file';state.fileReady=true;
   state.file=new File([new Uint8Array(32)],'Example.2026.1080p.mkv');
   el.stage.classList.add('has-video');
   Object.defineProperty(el.player,'currentTime',{get:()=>1.2,configurable:true});
 });
 await page.locator('#subtitlesBtn').click({force:true});
 assert.equal(await page.locator('#subSearchTitle').inputValue(),'Example');
 await page.locator('#subSearchForm').evaluate(f=>f.requestSubmit());
 await page.locator('#subSearchResults button').filter({hasText:'Use'}).waitFor({timeout:10000});
 await page.locator('#subSearchResults button').filter({hasText:'Use'}).click();
 await page.waitForFunction(()=>document.getElementById('subtitleName')?.textContent?.includes('1 Cues'),
   null,{timeout:10000});
 assert.equal(await page.locator('#subtitleOverlay').textContent(),'Hello from SubDL');
 assert.equal(await page.locator('#subtitleOverlay').getAttribute('hidden'),null,
   'SubDL ZIP captions must be visibly rendered over the movie');
 assert.equal(await page.evaluate(()=>window.MarmaladeAddonBridge.state.subtitles[0].text),'Hello from SubDL');
 const stored=await page.evaluate(async()=>{
   const db=await new Promise((resolve,reject)=>{
     const req=indexedDB.open('marmalade-local-subtitles',1);
     req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
   });
   const key='file:example.2026.1080p.mkv|32';
   const entry=await new Promise((resolve,reject)=>{
     const tx=db.transaction('handles','readonly');
     const req=tx.objectStore('handles').get(key);
     req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
   });
   db.close();return entry;
 });
 assert.equal(stored.kind,'search');
 assert.equal(stored.name,'Example.2026.1080p.srt');
 assert.equal(stored.containerName,'Example.1080p.zip');
 assert.equal(stored.fps,25);
 assert.ok(stored.content.includes('Hello from SubDL'));
 await page.locator('#subtitleTiming').evaluate(el=>{
   el.value='2.3';el.dispatchEvent(new Event('change',{bubbles:true}));
 });
 assert.equal(await page.evaluate(()=>window.MarmaladeSubtitleTiming.get()),2.3);
 const timing=await page.evaluate(()=>JSON.parse(localStorage.getItem('marmalade:subtitle-offsets:v2')));
 assert.ok(Object.values(timing).some(entry=>entry.seconds===2.3));
 // Local MicroDVD .sub must also load, with clean text and correct FPS.
 await page.locator('#subtitleFile').setInputFiles({
   name:'Example.sub',mimeType:'text/plain',
   buffer:Buffer.from('{1}{1}25\n{25}{75}{y:i}Hello|world')
 });
 await page.waitForFunction(()=>document.getElementById('subtitleName').textContent.includes('Example.sub'));
 assert.deepEqual(await page.evaluate(()=>window.MarmaladeAddonBridge.state.subtitles[0]),
   {start:1,end:3,text:'Hello\nworld'});
 assert.equal(await page.evaluate(()=>window.MarmaladeSubtitleTiming.get()),0,
   'A different subtitle must not inherit the previous release timing');
 assert.deepEqual(exceptions,[]);
 console.log('PASS SubDL deflated ZIP Use -> visible captions, cached copy, timing; local .sub playback');
 await page.close();
}finally{
 await browser.close();await new Promise(resolve=>server.close(resolve));
}
