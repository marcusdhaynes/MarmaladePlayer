import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,mkdirSync} from 'node:fs';
import {extname,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const pictures=resolve(root,'test-artifacts/rapid-ui');mkdirSync(pictures,{recursive:true});
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css',
 '.json':'application/json','.svg':'image/svg+xml'};
const server=createServer((req,res)=>{
 const name=new URL(req.url,'http://local').pathname.slice(1)||'index.html';
 const path=resolve(root,decodeURIComponent(name));
 if(path!==root&&!path.startsWith(root+sep)){res.writeHead(403);res.end();return;}
 try{res.writeHead(200,{'content-type':mime[extname(path)]||'application/octet-stream'});
   res.end(readFileSync(path));}catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
 for(const size of [{width:1280,height:850},{width:390,height:844},{width:320,height:568}]){
  const page=await browser.newPage({viewport:size});
  const errors=[];page.on('pageerror',error=>errors.push(String(error)));
  await page.route('**/peerjs@*/**',route=>route.fulfill({
    status:200,contentType:'application/javascript',body:'window.Peer=class {on(){} destroy(){}};'
  }));
  await page.route('https://unpkg.com/**',route=>route.fulfill({
    status:200,contentType:'application/javascript',body:'window.MediaInfo=async()=>({analyzeData:async()=>({media:{track:[]}})});'
  }));
  await page.goto('http://127.0.0.1:'+server.address().port+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>Boolean(window.MarmaladeRapidControls&&window.MarmaladeSubtitleCompact),null,{timeout:12000});
  assert.equal(await page.locator('#settingsPageParty #rapidRoomCard').count(),1);
  assert.equal(await page.locator('#subFindView #loadSubtitle').count(),1);
  assert.equal(await page.locator('#subFindView #subMoreFilters').count(),1);
  assert.equal(await page.locator('#subSyncView #subtitleTiming').count(),1);
  assert.equal(await page.locator('#subSyncView #subTimingAlign').count(),1);
  assert.equal(await page.locator('#subtitleFile').getAttribute('accept').then(s=>s.includes('.zip')),true);

  await page.evaluate(()=>{
    document.getElementById('settingsBtn').click();
    window.MarmaladeSettingsLayout.activate('party');
  });
  assert.equal(await page.locator('#settingsPanel').isVisible(),true);
  await page.screenshot({path:resolve(pictures,'party-'+size.width+'x'+size.height+'.png'),animations:'disabled'});
  await page.mouse.click(4,4);
  assert.equal(await page.locator('#settingsPanel').isVisible(),false,'Outside pointer immediately closes settings');
  await page.evaluate(()=>document.getElementById('subtitlesBtn').click());
  assert.equal(await page.locator('#subtitlePanel').isVisible(),true);
  assert.equal(await page.locator('.sub-tabs [role=tab]').count(),3);
  await page.screenshot({path:resolve(pictures,'subtitle-find-'+size.width+'x'+size.height+'.png'),animations:'disabled'});
  await page.locator('#subStyleTab').click();
  await page.screenshot({path:resolve(pictures,'subtitle-style-'+size.width+'x'+size.height+'.png'),animations:'disabled'});
  await page.locator('#subSyncTab').click();
  assert.equal(await page.locator('#subSyncView').isVisible(),true);
  await page.screenshot({path:resolve(pictures,'subtitle-sync-'+size.width+'x'+size.height+'.png'),animations:'disabled'});
  assert.equal(await page.locator('#subFindView').isVisible(),false);
  assert.equal(await page.locator('#subStyleView').isVisible(),false);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#subtitlePanel').isVisible(),false,'Escape closes subtitles');
  await page.evaluate(()=>{
    document.getElementById('subtitlesBtn').click();
    window.MarmaladeSubtitleCompact.select('find');
  });
  await page.mouse.click(4,4);
  assert.equal(await page.locator('#subtitlePanel').isVisible(),false,'Outside pointer closes subtitles');

  // Five timing checks: real local host, local guest, buffered guest, remote
  // guest display correction and explicit offset plus paused seek.
  const timing=await page.evaluate(()=>{
    const bridge=window.MarmaladeAddonBridge;
    const {state,media}=bridge;
    const stage=bridge.el.stage;stage.classList.add('has-video');
    const overlay=bridge.el.subtitleOverlay;
    const scenarios=[],original=Object.getOwnPropertyDescriptor(media,'currentTime');
    let local=10.25;
    Object.defineProperty(media,'currentTime',{configurable:true,get:()=>local,set:value=>{local=value;}});
    const refresh=()=>{
      window.MarmaladeSubtitleRefresh();
      return overlay.hidden?'':overlay.textContent;
    };
    state.subtitles=[{start:10,end:10.6,text:'THE DESCENT TEST'}];
    state.subtitlesEnabled=true;
    state.subtitlePreviewSuppressed=true;
    state.hostSyncActive=false;
    state.role='host';state.source='file';
    scenarios.push(['host current frame',refresh()]);
    state.role='guest';state.localVerified=true;state.bufferedMode=false;
    state.source='remote';state.sharedTime=145;state.sharedAt=performance.now();
    scenarios.push(['verified local guest',refresh()]);
    state.localVerified=false;state.bufferedMode=true;state.source='hosted-guest';
    scenarios.push(['buffered guest',refresh()]);
    state.bufferedMode=false;state.source='remote';
    state.sharedTime=10.75;state.sharedAt=performance.now();
    state.hostPlaying=false;state.guestPresentationMs=500;
    state.lastFrameLatencyReportAt=performance.now();
    scenarios.push(['live receiver presented timeline',refresh()]);
    state.role='host';state.source='file';
    const field=document.getElementById('subtitleTiming');
    field.value='0.5';field.dispatchEvent(new Event('change',{bubbles:true}));
    local=9.75;media.dispatchEvent(new Event('seeked'));
    scenarios.push(['saved offset after seek',refresh()]);
    field.value='0.0';field.dispatchEvent(new Event('change',{bubbles:true}));
    state.subtitles=[];state.subtitlesEnabled=false;
    if(original)Object.defineProperty(media,'currentTime',original);
    else delete media.currentTime;
    return scenarios;
  });
  assert.deepEqual(timing.map(x=>x[1]),Array(5).fill('THE DESCENT TEST'),
   'Every independent subtitle clock scenario must render the correct caption: '+JSON.stringify(timing));

  await page.evaluate(()=>{
    const {state}=window.MarmaladeAddonBridge;
    state.role='host';state.code='ABCDEFGHJKLM';state.peer={open:true,disconnected:false,destroyed:false};
    window.MarmaladeRapidControls.updateRoom();
  });
  await page.evaluate(()=>{document.getElementById('settingsBtn').click();window.MarmaladeSettingsLayout.activate('party');});
  assert.equal(await page.locator('#rapidCode').textContent(),'ABCDEFGHJKLM');
  assert.equal(await page.locator('#rapidCopyCode').isEnabled(),true);
  await page.mouse.click(4,4);
  const file=new File(['fake media bytes'],'The Descent (2005).mkv',{type:'video/x-matroska'});
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('marmalade:video-selected',{
    detail:{file:new File(['sample'],'The Descent (2005).mkv',{type:'video/x-matroska'})}
  })));
  await page.waitForFunction(()=>!document.getElementById('rapidResumeLast').hidden);
  assert.match(await page.locator('#rapidResumeLast').textContent(),/The Descent/);
  assert.deepEqual(errors,[],'No unhandled page errors across subtitle, settings and room UI');
  console.log('PASS rapid UX '+size.width+'×'+size.height);
  await page.close();
 }
 // Regression for wrong movie data. The catalog must reject a different
 // source title even when it claims to be a 2005 film.
 const page=await browser.newPage();
 await page.route('**/w/api.php?**',route=>{
  const search=route.request().url().includes('list=search');
  route.fulfill({status:200,contentType:'application/json',
   body:JSON.stringify(search?{query:{search:[{title:'The Cave (2005 film)',snippet:'film'}]}}:{} )});
 });
 await page.route('**/peerjs@*/**',route=>route.fulfill({
  status:200,contentType:'application/javascript',body:'window.Peer=class {on(){} destroy(){}};'
 }));
 await page.goto('http://127.0.0.1:'+server.address().port+'/',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>Boolean(window.MarmaladePublicMovieInfo));
 const result=await page.evaluate(async()=>{
  try{
   const x=await window.MarmaladePublicMovieInfo.lookup({kind:'movie',title:'The Descent',year:2005});
   return {incorrect:x.record?.wiki?.title||x.record?.title||''};
  }catch(error){return {rejected:String(error.message)};}
 });
 assert.ok(result.rejected&&!result.incorrect,
   'Unrelated The Cave metadata must not identify The Descent: '+JSON.stringify(result));
 await page.close();
 console.log('PASS The Descent (2005) never silently matched to The Cave (2005)');
}finally{
 await browser.close();
 await new Promise(resolve=>server.close(resolve));
}
