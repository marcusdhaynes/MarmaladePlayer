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
 try{const data=readFileSync(path);res.writeHead(200,{'content-type':mime[extname(path)]||'application/octet-stream'});res.end(data);}catch{res.writeHead(404);res.end();}
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
  // The shortcut must join the last confirmed room, not open Join Settings.
  assert.equal(await page.locator('#rapidQuickJoin').textContent(),'Rejoin Last Room');
  await page.evaluate(()=>localStorage.setItem('marmalade:last-joined-room-code','ABCD2345'));
  await page.locator('#rapidQuickJoin').click();
  assert.equal(await page.locator('#roomInput').inputValue(),'ABCD2345');
  assert.equal(await page.evaluate(()=>window.MarmaladeAddonBridge.state.role),'guest');
  await page.evaluate(()=>{
    document.getElementById('hostTab').click();
    localStorage.removeItem('marmalade:last-joined-room-code');
  });
  // Role-specific header action and the supplied paper-plane share artwork.
  assert.equal(await page.locator('#localCopyButton').isVisible(),false);
  assert.equal(await page.locator('#copyLink svg path[fill-rule="evenodd"]').count(),1);
  assert.equal(await page.locator('#copyLink').getAttribute('aria-label'),'Share Room');
  await page.evaluate(()=>document.getElementById('joinTab').click());
  assert.equal(await page.locator('#localCopyButton').isVisible(),true,
    'Guest sees local file selector');
  assert.equal(await page.locator('#localCopyButton').isEnabled(),false,
    'Disconnected guest cannot select until joined');
  await page.evaluate(()=>document.getElementById('hostTab').click());
  assert.equal(await page.locator('#localCopyButton').isVisible(),false);

  // Adaptive brightness lives to the right of the volume readout and
  // controls video gamma rather than putting a white overlay over the stage.
  await page.waitForFunction(()=>Boolean(window.MarmaladeAdaptiveBrightness));
  assert.equal(await page.locator('.theater-volume-group + .theater-right > #adaptiveBrightnessControl:first-child').count(),1,
    'Brightness control must be the first action immediately after the volume group');
  const volumeBounds=await page.locator('.theater-volume-group').boundingBox();
  const brightnessBounds=await page.locator('#adaptiveBrightnessControl').boundingBox();
  assert(volumeBounds&&brightnessBounds&&brightnessBounds.x>=volumeBounds.x+volumeBounds.width-2,
    'Brightness must visually follow volume without overlap');
  assert.equal(await page.locator('#brightnessBtn svg').count(),1);
  assert.equal(await page.locator('#brightnessBtn svg').getAttribute('viewBox'),'0 0 24 24',
    'Brightness button uses the current compact flashlight artwork');
  assert.equal(await page.locator('#adaptiveFlashlightFill').count(),1,
    'Flashlight icon fill must remain driven by the brightness setting');
  assert.equal(await page.locator('#brightnessBtn').getAttribute('aria-expanded'),'false');
  await page.locator('#brightnessBtn').click();
  assert.equal(await page.locator('#brightnessPopover').isVisible(),true,
    'Brightness opens a vertical slider');
  assert.equal(await page.locator('#brightnessSlider').getAttribute('aria-orientation'),'vertical');
  await page.locator('#brightnessSlider').evaluate(el=>{
    el.value='74';el.dispatchEvent(new Event('input',{bubbles:true}));
  });
  assert.equal(await page.locator('#brightnessValue').textContent(),'74%');
  assert.equal(await page.evaluate(()=>localStorage.getItem('marmalade:adaptive-video-brightness:v1')),'74');
  assert.equal(await page.locator('#player').evaluate(el=>el.style.filter.includes('adaptiveBrightnessGamma')),true);
  assert.equal(await page.evaluate(()=>window.MarmaladeAdaptiveBrightness.computeGamma(
    new Uint8ClampedArray(Array.from({length:640},(_,i)=>i%4===3?255:30)),80)<1),true,
    'Adaptive gamma must selectively lift dark frames');
  assert.equal(await page.evaluate(()=>window.MarmaladeAdaptiveBrightness.computeGamma(
    new Uint8ClampedArray(Array.from({length:640},(_,i)=>i%4===3?255:245)),80)),1,
    'Bright scenes should not be washed out');
  await page.locator('#brightnessSlider').evaluate(el=>{
    el.value='0';el.dispatchEvent(new Event('input',{bubbles:true}));
  });
  assert.equal(await page.locator('#player').evaluate(el=>el.style.filter),'',
    'Brightness 0% must restore untouched video');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#brightnessPopover').isVisible(),false);

  // The full toolbar must be visible and interactive on the empty landing
  // screen; only media transport and scrubbing require a movie.
  assert.equal(await page.locator('#dropZone').evaluate(node=>node.classList.contains('has-video')),false);
  assert.equal(await page.locator('#theaterControls').isVisible(),true,
    'Empty stage must expose the player toolbar');
  const emptyToolbar=await page.locator('#theaterControls').evaluate(node=>{
    const css=getComputedStyle(node);
    return {opacity:css.opacity,pointerEvents:css.pointerEvents};
  });
  assert.equal(emptyToolbar.opacity,'1','Empty-stage toolbar must not be transparent');
  // Decorative empty-stage chrome intentionally lets a movie-selection tap
  // pass through; the actual enabled toolbar controls must remain clickable.
  for(const id of ['muteBtn','volume','subtitlesBtn','popoutBtn','fullscreenBtn','settingsBtn']){
    const accepts=await page.locator('#'+id).evaluate(node=>getComputedStyle(node).pointerEvents!=='none');
    assert(accepts,id+' must accept input on the empty stage');
  }
  for(const id of ['playPause','skipBack','skipForward','seek'])
    assert.equal(await page.locator('#'+id).isEnabled(),false,id+' should require media');
  for(const id of ['muteBtn','volume','subtitlesBtn','popoutBtn','fullscreenBtn','settingsBtn'])
    assert.equal(await page.locator('#'+id).isEnabled(),true,id+' should work without media');
  await page.locator('#muteBtn').click();
  assert.equal(await page.evaluate(()=>window.MarmaladeAddonBridge.state.soundMuted),true,
    'Mute must work before selecting a movie');
  await page.locator('#muteBtn').click();
  await page.locator('#settingsBtn').click();
  assert.equal(await page.locator('#settingsPanel').isVisible(),true,
    'Settings must open on an empty stage');
  await page.locator('#closeSettingsPanel').click();
  await page.locator('#subtitlesBtn').click();
  assert.equal(await page.locator('#subtitlePanel').isVisible(),true,
    'Subtitles must open on an empty stage');
  await page.locator('#closeSubtitlePanel').click();
  assert.equal(await page.locator('#dropZone').evaluate(node=>node.classList.contains('has-video')),false,
    'Opening toolbar options must not select a movie');
  // Fullscreen is an in-place theater layout change, never a capture
  // permission request. Test both directions with actual user double-clicks.
  await page.evaluate(()=>{
    const {state,el,media}=window.MarmaladeAddonBridge;
    state.role='host';state.source='file';state.fileReady=true;
    el.stage.classList.add('has-video','controls-visible');
    el.empty.hidden=true;
    window.__fullscreenCaptureCalls=0;
    window.__fullscreenPlayCalls=0;
    const devices=navigator.mediaDevices;
    if(devices){
      for(const name of ['getUserMedia','getDisplayMedia']){
        try{
          const original=devices[name]?.bind(devices);
          Object.defineProperty(devices,name,{configurable:true,value:(...args)=>{
            window.__fullscreenCaptureCalls++;
            throw new Error('Fullscreen tried to request '+name);
          }});
          // No capture calls are expected; the test is a strict sentinel.
        }catch{}
      }
    }
    media.play=()=>{
      window.__fullscreenPlayCalls++;
      return Promise.resolve();
    };
  });
  const stage=page.locator('#dropZone');
  async function doubleClickPicture(){
    await stage.scrollIntoViewIfNeeded();
    // Find a real hit-tested picture point rather than assuming a fixed
    // percentage of the stage remains uncovered on narrow/mobile screens.
    const point=await stage.evaluate(el=>{
      const box=el.getBoundingClientRect();
      const controls='button,input,select,label,textarea,a,[role="button"],[role="slider"],[role="switch"],[role="menuitem"],[role="dialog"],[contenteditable="true"],.theater-controls,.theater-top,.theater-popover,.mini-player-overlay,.stage-quick-actions,.exit-theater,#guestAudioUnlock,#hostVideoDiagnostic,[data-no-video-toggle]';
      for(const y of [.4,.5,.3,.6,.2,.7,.1,.8,.9])for(const x of [.5,.3,.7,.2,.8,.1,.9]){
        const px=Math.round(box.left+box.width*x),py=Math.round(box.top+box.height*y);
        if(px<0||py<0||px>=innerWidth||py>=innerHeight)continue;
        const target=document.elementFromPoint(px,py);
        if(target&&el.contains(target)&&!target.closest(controls))return {x:px,y:py};
      }
      return null;
    });
    assert.ok(point,'A real video-picture gesture target must exist at '+size.width+'×'+size.height);
    await page.mouse.dblclick(point.x,point.y,{delay:70});
  }
  await doubleClickPicture();
  await page.waitForFunction(()=>window.MarmaladeAddonBridge.state.theaterMode&&document.fullscreenElement===document.getElementById('dropZone'),null,{timeout:12000});
  assert.equal(await stage.evaluate(el=>el.classList.contains('fullscreen-fallback')),true,
    'Double-click expands the regular video to actual browser fullscreen');
  await doubleClickPicture();
  await page.waitForFunction(()=>!window.MarmaladeAddonBridge.state.theaterMode&&!document.fullscreenElement,null,{timeout:12000});
  assert.equal(await stage.evaluate(el=>el.classList.contains('fullscreen-fallback')),false,
    'Second double-click returns to regular video');
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(()=>window.__fullscreenPlayCalls),0,
    'Double-click does not play or pause the movie');
  assert.equal(await page.evaluate(()=>window.__fullscreenCaptureCalls),0,
    'Entering/leaving fullscreen never requests microphone, camera or screen capture');
  // Controls should remain independent: double-click on Settings is not
  // interpreted as video fullscreen or a playback toggle.
  await page.evaluate(()=>document.getElementById('settingsBtn').click());
  assert.equal(await page.evaluate(()=>window.MarmaladeAddonBridge.state.theaterMode),false);
  await page.evaluate(()=>document.getElementById('closeSettingsPanel').click());
  await page.evaluate(()=>{
    const {state,el}=window.MarmaladeAddonBridge;
    state.fileReady=false;state.source=null;
    el.stage.classList.remove('has-video','controls-visible');
    el.empty.hidden=false;
  });


  assert.equal(await page.locator('#settingsPageParty #rapidRoomCard').count(),1);
  assert.equal(await page.locator('#subFindView #loadSubtitle').count(),1);
  assert.equal(await page.locator('#subFindView #subMoreFilters').count(),1);
  assert.equal(await page.locator('#subSyncView #subtitleTiming').count(),1);
  assert.equal(await page.locator('#subSyncView #subTimingCueSearch').count(),1);
  assert.equal(await page.locator('#subSyncView #subSelectedLine').count(),1);
  assert.equal(await page.locator('#subSyncView #subTimingReset').count(),1);
  assert.equal(await page.locator('#subtitleFile').getAttribute('accept').then(s=>s.includes('.zip')),true);

  await page.evaluate(()=>{
    document.getElementById('settingsBtn').click();
    window.MarmaladeSettingsLayout.activate('party');
  });
  assert.equal(await page.locator('#settingsPanel').isVisible(),true);
  await page.screenshot({path:resolve(pictures,'party-'+size.width+'x'+size.height+'.png'),animations:'disabled'});
  await page.mouse.click(4,4);
  const settingsDocked=await page.locator('#settingsPanel').evaluate(el=>el.classList.contains('player-docked'));
 assert.equal(settingsDocked,size.height>size.width,'Responsive settings docking follows orientation');
  assert.equal(await page.locator('#settingsPanel').isVisible(),settingsDocked,'Docked settings remain open; floating settings dismiss on outside pointer');
  if(settingsDocked)await page.locator('#closeSettingsPanel').click();
  await page.evaluate(()=>document.getElementById('subtitlesBtn').click());
  assert.equal(await page.locator('#subtitlePanel').isVisible(),true);
  assert.equal(await page.locator('.sub-tabs [role=tab]').count(),3);
  await page.screenshot({path:resolve(pictures,'subtitle-find-'+size.width+'x'+size.height+'.png'),animations:'disabled'});
  await page.locator('#subStyleTab').click();
  await page.screenshot({path:resolve(pictures,'subtitle-style-'+size.width+'x'+size.height+'.png'),animations:'disabled'});
  await page.locator('#subSyncTab').click();
  assert.equal(await page.locator('#subSyncView').isVisible(),true);
  // Exercise the current word-level alignment control, not just its markup.
  await page.evaluate(()=>{
    const {state,media}=window.MarmaladeAddonBridge;
    state.role='host';state.source='file';state.subtitles=[{start:0,end:2,text:'First word'}];
    state.subtitlesEnabled=true;
    Object.defineProperty(media,'currentTime',{configurable:true,get:()=>1.5});
    window.MarmaladeSubtitleCompact.refreshCues();
  });
  await page.locator('#subTimingCueSearch').fill('First');
  await page.locator('#subTimingCue [role=option]').filter({hasText:'First word'}).click();
  await page.locator('#subSelectedLine .sub-word').filter({hasText:'First'}).click();
  assert.equal(await page.evaluate(()=>window.MarmaladeSubtitleTiming.get()),1.5,'Align a spoken word to playback');
  await page.locator('#subTimingReset').click();
  assert.equal(await page.evaluate(()=>window.MarmaladeSubtitleTiming.get()),0);
  await page.evaluate(()=>{
    const {state,media}=window.MarmaladeAddonBridge;
    delete media.currentTime;state.subtitles=[];state.subtitlesEnabled=false;state.source=null;
    window.MarmaladeSubtitleCompact.refreshCues();
  });
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
  const subtitlesDocked=await page.locator('#subtitlePanel').evaluate(el=>el.classList.contains('player-docked'));
 assert.equal(subtitlesDocked,size.height>size.width,'Responsive subtitle docking follows orientation');
  assert.equal(await page.locator('#subtitlePanel').isVisible(),subtitlesDocked,'Docked subtitles remain open; floating subtitles dismiss on outside pointer');
  if(subtitlesDocked)await page.locator('#closeSubtitlePanel').click();

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
    local=10.75;media.dispatchEvent(new Event('seeked'));
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
 // A persisted FileSystemFileHandle reopens the original location without
 // triggering a file chooser. Real local handles use the same getFile() API.
 const resumePage=await browser.newPage();
 await resumePage.route('**/peerjs@*/**',route=>route.fulfill({
   status:200,contentType:'application/javascript',body:'window.Peer=class {on(){} destroy(){}};'
 }));
 await resumePage.goto('http://127.0.0.1:'+server.address().port+'/',{waitUntil:'domcontentloaded'});
 await resumePage.waitForFunction(()=>Boolean(window.MarmaladeRapidControls));
 const canPersist=await resumePage.evaluate(async()=>{
   if(!navigator.storage?.getDirectory)return false;
   const dir=await navigator.storage.getDirectory();
   const handle=await dir.getFileHandle('resume-from-saved-location.mp4',{create:true});
   const writer=await handle.createWritable();
   await writer.write(new Uint8Array([0,0,0,24,102,116,121,112,105,115,111,109]));
   await writer.close();
   const file=await handle.getFile();
   const db=await new Promise((resolve,reject)=>{
     // Open the schema already initialized by the current application.
     // Do not force an older database version after a storage migration.
     const req=indexedDB.open('marmalade-recent-video');
     req.onupgradeneeded=()=>{
       for(const name of ['recents','videoChunks'])
         if(!req.result.objectStoreNames.contains(name))req.result.createObjectStore(name);
     };
     req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
   });
   await new Promise((resolve,reject)=>{
     const tx=db.transaction('recents','readwrite');
     tx.objectStore('recents').put({
       name:file.name,size:file.size,lastModified:file.lastModified,
       handle,updated:Date.now()
     },'latest');
     tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
   });
   db.close();
   return true;
 });
 if(canPersist){
   await resumePage.reload({waitUntil:'domcontentloaded'});
   await resumePage.waitForFunction(()=>Boolean(window.MarmaladeRapidControls));
   await resumePage.locator('#rapidResumeLast').waitFor({state:'visible',timeout:12000});
   await resumePage.evaluate(()=>{
     window.__resumePickerCount=0;
     window.showOpenFilePicker=()=>{
       window.__resumePickerCount++;
       throw new Error('Unexpected file chooser');
     };
   });
   await resumePage.locator('#rapidResumeLast').click();
   await resumePage.waitForFunction(()=>window.MarmaladeAddonBridge?.state?.source==='file',
     null,{timeout:12000});
   assert.equal(await resumePage.locator('#fileName').textContent(),'resume-from-saved-location.mp4');
   assert.equal(await resumePage.evaluate(()=>window.__resumePickerCount),0,
     'Saved-file resume must not reopen the file picker');
   console.log('PASS saved video location resumes without dialog');
 }
 await resumePage.close();
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
