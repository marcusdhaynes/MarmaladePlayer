import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {extname,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'};
const server=createServer((request,response)=>{
  const relative=new URL(request.url,'http://localhost').pathname.slice(1)||'index.html';
  const path=resolve(root,decodeURIComponent(relative));
  if(path!==root&&!path.startsWith(root+sep)){response.writeHead(403);response.end();return;}
  try{response.writeHead(200,{'content-type':mime[extname(path)]||'application/octet-stream'});
    response.end(readFileSync(path));}
  catch{response.writeHead(404);response.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
  const page=await browser.newPage({viewport:{width:900,height:680}});
  await page.addInitScript(()=>{
    // The CI browser may not expose Document PiP; replace only its
    // window creation with a same-origin popup. The real player DOM is still
    // adopted into a second document and tested there.
    const mock={get window(){return window.__marmaladeTestPipWindow||null;},
      async requestWindow({width,height}){
        const win=window.open('about:blank','_blank',`width=${width},height=${height}`);
        if(!win)throw new Error('Test PiP popup blocked');
        window.__marmaladeTestPipWindow=win;
        return win;
      }};
    try{Object.defineProperty(window,'documentPictureInPicture',{configurable:true,value:mock});}
    catch{window.documentPictureInPicture=mock;}
  });
  await page.route('**/peerjs@*/**',route=>route.fulfill({
    status:200,contentType:'application/javascript',body:'window.Peer=class {on(){} destroy(){}};'
  }));
  await page.route('https://unpkg.com/**',route=>route.fulfill({
    status:200,contentType:'application/javascript',
    body:'window.MediaInfo=async()=>({analyzeData:async()=>({media:{track:[]}})});'
  }));
  await page.goto('http://127.0.0.1:'+server.address().port+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>Boolean(window.MarmaladeAddonBridge&&window.MarmaladeAdaptiveBrightness));
  await page.evaluate(()=>{
    const bridge=window.MarmaladeAddonBridge,video=bridge.media;
    Object.defineProperty(video,'readyState',{configurable:true,get:()=>4});
    bridge.state.role='host';bridge.state.source='file';bridge.state.fileReady=true;
    bridge.el.stage.classList.add('has-video','controls-visible');
    bridge.el.empty.hidden=true;
    bridge.state.subtitlesEnabled=true;
    bridge.state.subtitles=[{start:0,end:120,text:'CAPTIONS IN PICTURE-IN-PICTURE'}];
    window.MarmaladeAdaptiveBrightness.setLevel(72);
    window.MarmaladeSubtitleRefresh();
  });
  const popupPromise=page.waitForEvent('popup',{timeout:10000});
  await page.locator('#popoutBtn').click();
  const pip=await popupPromise;
  await pip.locator('#theaterControls').waitFor({state:'visible',timeout:10000});
  assert.equal(await pip.locator('#dropZone.pip-interactive').count(),1);
  assert.equal(await page.locator('#dropZone').count(),0,
    'PiP must move the actual video stage instead of making a copy');
  for(const id of ['playPause','skipBack','skipForward','seek','muteBtn','volume',
    'brightnessBtn','subtitlesBtn','popoutBtn','fullscreenBtn','settingsBtn'])
    assert.equal(await pip.locator('#'+id).count(),1,'PiP is missing '+id);
  assert.equal(await pip.locator('#miniPlayerOverlay').isVisible(),false,
    'Obsolete duplicate mini-transport should not cover the full player');
  assert.equal(await pip.locator('#subtitleOverlay').textContent(),
    'CAPTIONS IN PICTURE-IN-PICTURE');
  assert.equal(await pip.locator('#subtitleOverlay').isVisible(),true,
    'Timed subtitle overlay remains displayed inside external PiP');
  assert.equal(await pip.locator('#adaptiveBrightnessGamma').count(),1,
    'Adaptive tone curve definition must move with the actual player');
  assert.match(await pip.locator('#player').evaluate(el=>el.style.filter),
    /adaptiveBrightnessGamma/,
    'Adaptive brightness must not disappear in the second document');
  assert.equal(await page.evaluate(()=>
    window.MarmaladeAdaptiveBrightness.isExternalPlayback()),true);
  await pip.locator('#brightnessBtn').evaluate(button=>button.click());
  await pip.locator('#brightnessSlider').evaluate(slider=>{
    slider.value='87';slider.dispatchEvent(new Event('input',{bubbles:true}));
  });
  assert.equal(await page.evaluate(()=>
    window.MarmaladeAdaptiveBrightness.getLevel()),87,
    'PiP brightness control must update the same playback state');
  // Resizing the PiP viewport does not clamp width/height in app code.
  await pip.setViewportSize({width:215,height:125});
  await pip.waitForFunction(()=>
    Number.parseFloat(document.getElementById('dropZone')
      .style.getPropertyValue('--pip-controls-zoom'))<.5);
  assert.equal(await pip.locator('#theaterControls').isVisible(),true,
    'Full controls must continue to render in a smaller PiP');
  await pip.close();
  await page.waitForFunction(()=>document.getElementById('dropZone')!==null);
  assert.equal(await page.evaluate(()=>
    window.MarmaladeAdaptiveBrightness.isExternalPlayback()),false);
  assert.equal(await page.locator('#brightnessSlider').inputValue(),'87',
    'PiP brightness survives return to the original window');
  assert.equal(await page.locator('#subtitleOverlay').textContent(),
    'CAPTIONS IN PICTURE-IN-PICTURE');
  await page.close();
  console.log('PASS interactive PiP preserves controls, gamma, captions, resize, and state');
}finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
