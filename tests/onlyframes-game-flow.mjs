import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const mime={'.html':'text/html','.js':'application/javascript',
  '.css':'text/css','.svg':'image/svg+xml'};
const server=createServer((req,res)=>{
  const file=resolve(root,decodeURIComponent(new URL(req.url,'http://localhost').pathname.slice(1)||'index.html'));
  if(file!==root&&!file.startsWith(root+sep)){res.writeHead(403);res.end();return;}
  try{
    const data=readFileSync(file);
    res.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream'});
    res.end(data);
  }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try {
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  const pageErrors=[];
  page.on('pageerror',error=>pageErrors.push(String(error)));
  await page.route('**/peerjs@*/**',route=>route.fulfill({
    status:200,contentType:'application/javascript',
    body:'window.Peer=class {on(){} destroy(){}};'
  }));
  await page.goto('http://127.0.0.1:'+server.address().port+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>Boolean(window.MarmaladeGames &&
    window.MarmaladeMediaLibrary && window.MarmaladeAddonBridge));
  await page.evaluate(()=>{
    const library=window.MarmaladeMediaLibrary;
    const bridge=window.MarmaladeAddonBridge;
    const media=bridge.media;
    window.__onlyFramesHarness={opened:[],seeks:[],stops:0};
    Object.defineProperty(media,'readyState',{configurable:true,
      get:()=>HTMLMediaElement.HAVE_CURRENT_DATA});
    Object.defineProperty(media,'duration',{configurable:true,get:()=>120});
    Object.defineProperty(media,'videoWidth',{configurable:true,get:()=>640});
    Object.defineProperty(media,'videoHeight',{configurable:true,get:()=>360});
    Object.defineProperty(media,'paused',{configurable:true,get:()=>true});
    Object.defineProperty(media,'seeking',{configurable:true,get:()=>false});
    let framePosition=0;
    Object.defineProperty(media,'currentTime',{configurable:true,
      get:()=>framePosition,set:value=>{framePosition=value;}});
    library.getGameLibraries=()=>[{id:'test-library',name:'Sample Movies',count:2}];
    library.getGameVideos=()=>[
      {id:'a',title:'Sample A',name:'Sample A.mp4',libraryId:'test-library',
        libraryName:'Sample Movies'},
      {id:'b',title:'Sample B',name:'Sample B.mp4',libraryId:'test-library',
        libraryName:'Sample Movies'}
    ];
    library.playGameVideo=async(libraryId,itemId)=>{
      window.__onlyFramesHarness.opened.push({libraryId,itemId});
      bridge.state.role='host';bridge.state.source='file';
      media.dispatchEvent(new Event('loadedmetadata'));
      return {libraryId,id:itemId};
    };
    bridge.pauseAndSeekGameFrame=seconds=>{
      window.__onlyFramesHarness.seeks.push(seconds);
      media.currentTime=seconds;
      media.dispatchEvent(new Event('seeked'));
      return Number.isFinite(seconds)&&seconds>=0&&seconds<120;
    };
    bridge.stopGameVideo=()=>{
      window.__onlyFramesHarness.stops++;
      bridge.state.source=null;
      bridge.setGameFrameMode(false);
      return true;
    };
  });
  await page.locator('#settingsBtn').click();
  await page.locator('#gamesVisibilityToggle').check();
  await page.locator('#closeSettingsPanel').click();
  assert.equal(await page.locator('#gamesPrevious').isDisabled(),true,
    'Previous starts disabled');
  assert.equal(await page.locator('#gamesNext').isDisabled(),true,
    'Next starts disabled');
  assert.equal(await page.locator('#gamesLogToggle').isDisabled(),true,
    'Log starts disabled');
  for(const id of ['gamesUp','gamesDown','gamesLeft','gamesRight'])
    assert.equal(await page.locator('#'+id).isDisabled(),true,'D-pad stays disabled');
  await page.locator('#onlyFramesLaunch').click();
  const dialogLayer=await page.locator('#onlyFramesDialog').evaluate(dialog=>{
    const surface=dialog.querySelector('.games-dialog-surface');
    const bounds=surface.getBoundingClientRect();
    return {open:dialog.open,portaled:dialog.parentElement===document.body,
      midpointHit:document.elementFromPoint(bounds.x+bounds.width/2,
        bounds.y+bounds.height/2)?.closest('#onlyFramesDialog')===dialog,
      backgroundHit:document.elementFromPoint(12,Math.round(innerHeight/2))===dialog};
  });
  assert(dialogLayer.open&&dialogLayer.portaled&&dialogLayer.midpointHit&&dialogLayer.backgroundHit,
    'Game details must occupy the browser top layer above every video control');
  const modeWidths=await page.locator('#onlyFramesMode').evaluate(pill=>
    [...pill.querySelectorAll('button')].map(btn=>btn.getBoundingClientRect().width));
  assert(Math.abs(modeWidths[0]-modeWidths[1])<1,
    'Automatic and Player Choice must have equal-width pill halves');
  assert.equal(await page.locator('#onlyFramesModeAutomatic').getAttribute('aria-pressed'),'true');
  await page.locator('#onlyFramesModeChoice').click();
  assert.equal(await page.locator('#onlyFramesModeChoice').getAttribute('aria-pressed'),'true');
  await page.locator('#onlyFramesModeAutomatic').click();
  assert.equal(await page.locator('#onlyFramesAction').isEnabled(),true,
    'With a nonempty library, Play Game is available');
  assert.equal(await page.locator('#onlyFramesLibrary').inputValue(),'test-library');
  await page.locator('#onlyFramesClose').click();
  assert.equal(await page.evaluate(()=>window.MarmaladeGames.isGameActive()),false,
    'Closing details is not the same as selecting a game');
  await page.locator('#onlyFramesLaunch').click();
  await page.locator('#onlyFramesAction').click();
  await page.waitForFunction(()=>window.MarmaladeGames.history().length===1);
  assert.equal(await page.evaluate(()=>window.MarmaladeGames.isGameActive()),true);
  assert.equal(await page.evaluate(()=>window.MarmaladeAddonBridge.state.gameFrameMode),true,
    'Game owns the player and suppresses normal playback');
  assert.equal(await page.locator('#onlyFramesLaunch').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('#gamesNext').isEnabled(),true);
  assert.equal(await page.locator('#gamesPrevious').isDisabled(),true);
  assert.equal(await page.locator('#gamesLogToggle').isEnabled(),true);
  const first=await page.evaluate(()=>window.MarmaladeGames.history()[0]);
  assert(first.timestamp>=0&&first.timestamp<120);
  await page.locator('#gamesNext').click();
  await page.waitForFunction(()=>window.MarmaladeGames.history().length===2);
  const history=await page.evaluate(()=>window.MarmaladeGames.history());
  assert.notEqual(history[0].id,history[1].id,
    'With two candidates, Next should pick a different random video');
  assert.equal(await page.locator('#gamesPrevious').isEnabled(),true);
  await page.locator('#gamesPrevious').click();
  await page.waitForFunction(()=>document.querySelector('#gamesStatus')
    ?.textContent?.includes('FRAME 01'));
  const seeks=await page.evaluate(()=>window.__onlyFramesHarness.seeks);
  assert.equal(seeks.at(-1),first.timestamp,
    'Previous reopens the earlier video at its original timestamp');
  await page.locator('#gamesLogToggle').click();
  assert.equal(await page.locator('#gamesLogPanel').isVisible(),true);
  assert.match(await page.locator('#gamesLogPanel').textContent(),/Sample A/);
  assert.match(await page.locator('#gamesLogPanel').textContent(),/Sample Movies/);
  const receipt=await page.locator('#gamesLogPanel').evaluate(panel=>{
    const entries=[...panel.querySelectorAll('.games-log-entry')];
    const frame=entries.find(entry=>entry.dataset.kind==='frame');
    const bounds=frame.getBoundingClientRect();
    const stamp=frame.querySelector('.games-log-timestamp');
    return {rows:entries.length,frameHeight:bounds.height,
      childLines:[...frame.children].map(el=>{
        const r=el.getBoundingClientRect();
        return {top:r.top,bottom:r.bottom};
      }),stampCount:frame.querySelectorAll('.games-log-timestamp').length,
      timestamp:stamp?.textContent||'',
      description:frame.querySelector('.games-log-item-description')?.textContent||'',
      wallClockCount:panel.querySelectorAll('.games-log-item-time').length,
      source:frame.querySelector('.games-log-source')?.textContent||'',
      tooltip:frame.title,
      topPadding:getComputedStyle(frame).paddingTop,
      bottomPadding:getComputedStyle(frame).paddingBottom};
  });
  assert(receipt.rows>=3,'Session receipt retains all player actions');
  assert(receipt.frameHeight<=25,'Receipt rows must be compact and single-line');
  const baseline=(receipt.childLines[0].top+receipt.childLines[0].bottom)/2;
  assert(receipt.childLines.every(line=>
    Math.abs((line.top+line.bottom)/2-baseline)<2),
    'Title, mode, library and timestamp share one vertically centered row');
  assert.equal(receipt.stampCount,1,'Only one timecode per selected frame');
  assert.equal(receipt.wallClockCount,0,'No duplicate real-world clock timestamps');
  assert(!/\d{2}:\d{2}/.test(receipt.description),
    'Frame mode must not repeat the timecode');
  assert.equal(receipt.source,'Sample Movies');
  assert(receipt.tooltip.includes('Sample Movies')&&
    receipt.tooltip.includes(receipt.timestamp),
    'Truncated receipts still expose complete details on hover');
  assert.equal(receipt.topPadding,receipt.bottomPadding);
  await page.locator('#gamesLogClose').click();
  await page.locator('.game-score-plus').first().click();
  assert.equal(await page.locator('.game-score-value').first().textContent(),'01');
  await page.locator('#onlyFramesLaunch').click();
  assert.equal(await page.locator('#onlyFramesAction').textContent(),'End Game');
  await page.locator('#onlyFramesAction').click();
  assert.equal(await page.evaluate(()=>window.MarmaladeGames.isGameActive()),false);
  // End Game's real bridge must restore the player's ordinary playback mode.
  assert.equal(await page.evaluate(()=>window.MarmaladeAddonBridge.state.gameFrameMode),false);
  assert.equal(await page.evaluate(()=>window.__onlyFramesHarness.stops),1,
    'End Game must invoke the actual player stop bridge');
  assert.equal(await page.locator('.game-score-value').first().textContent(),'00',
    'All existing scores reset without removing player names');
  assert.equal(await page.locator('#gamesNext').isDisabled(),true);
  assert.equal(await page.locator('#gamesLogToggle').isDisabled(),true);
  assert.equal(await page.locator('#gamesLogPanel').isVisible(),false);
  await page.locator('#onlyFramesLaunch').click();
  await page.locator('#onlyFramesModeChoice').click();
  await page.locator('#onlyFramesAction').click();
  await page.locator('#onlyFramesTimeStep').waitFor({state:'visible'});
  assert.equal(await page.locator('#onlyFramesTimeRange').getAttribute('max'),'119');
  await page.locator('#onlyFramesTimeRange').evaluate(input=>{
    input.value='42';input.dispatchEvent(new Event('input',{bubbles:true}));
  });
  assert.equal(await page.locator('#onlyFramesTimeValue').textContent(),'00:42');
  const timestampInput=page.locator('#onlyFramesTimeInput');
  assert.equal(await timestampInput.inputValue(),'00:00:42',
    'Moving the scrubber updates the exact HH:MM:SS field');
  const exactLayout=await timestampInput.evaluate(input=>{
    const rect=input.getBoundingClientRect();
    const slider=document.getElementById('onlyFramesTimeRange').getBoundingClientRect();
    const left=document.getElementById('onlyFramesTimeValue').getBoundingClientRect();
    const right=document.getElementById('onlyFramesTimeDuration').getBoundingClientRect();
    return {belowSlider:rect.top>slider.bottom,centered:Math.abs(
      (rect.left+rect.right)/2-(left.left+right.right)/2)<2,
      width:rect.width};
  });
  assert(exactLayout.belowSlider&&exactLayout.centered&&exactLayout.width<=150,
    'Timestamp field must be compact and centered beneath the scrubber endpoints');
  await timestampInput.fill('00:01:59');
  assert.equal(await page.locator('#onlyFramesTimeRange').inputValue(),'119',
    'Exact timestamp entry updates the scrubber precisely');
  assert.equal(await page.locator('#onlyFramesTimeValue').textContent(),'01:59');
  await timestampInput.fill('00:02:00');
  assert.equal(await page.locator('#onlyFramesConfirmTime').isDisabled(),true,
    'Cannot select a frame beyond the video runtime');
  assert.equal(await timestampInput.getAttribute('aria-invalid'),'true');
  await timestampInput.fill('00:61:42');
  assert.equal(await page.locator('#onlyFramesConfirmTime').isDisabled(),true,
    'Minutes must never exceed 59');
  await timestampInput.fill('00:00:42');
  assert.equal(await page.locator('#onlyFramesConfirmTime').isEnabled(),true);
  assert.equal(await page.locator('#onlyFramesTimeRange').inputValue(),'42');
  await timestampInput.press('ControlOrMeta+A');
  await timestampInput.pressSequentially('000042');
  assert.equal(await timestampInput.inputValue(),'00:00:42',
    'Typing digits must fill only the six HHMMSS positions and retain colons');
  await timestampInput.pressSequentially('xyz');
  assert.equal(await timestampInput.inputValue(),'00:00:42',
    'Alphabetic characters must be ignored by numeric timestamp masking');
  await page.locator('#onlyFramesConfirmTime').click();
  await page.waitForFunction(()=>window.MarmaladeGames.history().length===1);
  assert.equal(await page.evaluate(()=>window.MarmaladeGames.history()[0].timestamp),42,
    'Player chooses and confirms a timestamp within real video duration');
  assert.equal(await page.evaluate(()=>window.__onlyFramesHarness.seeks.at(-1)),42);
  await page.locator('#onlyFramesLaunch').click();
  await page.locator('#onlyFramesAction').click();
  assert.equal(await page.evaluate(()=>window.__onlyFramesHarness.stops),2);
  // Video/Timeline controls are independent. Choosing a video must not
  // require timestamp choice; the opposite combination is tested above.
  await page.locator('#onlyFramesLaunch').click();
  await page.locator('#onlyFramesVideoChoice').click();
  await page.locator('#onlyFramesModeAutomatic').click();
  await page.locator('#onlyFramesAction').click();
  await page.locator('#onlyFramesVideoStep').waitFor({state:'visible'});
  assert.equal(await page.locator('#onlyFramesVideoRandom').getAttribute('aria-pressed'),'false');
  assert.equal(await page.locator('#onlyFramesModeAutomatic').getAttribute('aria-pressed'),'true');
  await page.locator('#onlyFramesVideoSearch').fill('Sample B');
  assert.equal(await page.locator('.games-video-card').count(),1);
  await page.locator('#onlyFramesVideoPlus').click();
  assert.equal(await page.locator('#onlyFramesVideoColumns').textContent(),'4 / row');
  await page.locator('#onlyFramesVideoMinus').click();
  assert.equal(await page.locator('#onlyFramesVideoColumns').textContent(),'3 / row');
  await page.locator('.games-video-card').click();
  await page.waitForFunction(()=>window.MarmaladeGames.history().length===1);
  assert.equal(await page.evaluate(()=>window.MarmaladeGames.history()[0].id),'b',
    'Video Choice must open the specifically chosen video');
  await page.locator('#onlyFramesLaunch').click();
  await page.locator('#onlyFramesAction').click();

  // Choice + Choice: first the compact video window, then exact timestamp.
  await page.locator('#onlyFramesLaunch').click();
  await page.locator('#onlyFramesModeChoice').click();
  await page.locator('#onlyFramesAction').click();
  await page.locator('#onlyFramesVideoStep').waitFor({state:'visible'});
  await page.locator('.games-video-card').first().click();
  await page.locator('#onlyFramesTimeStep').waitFor({state:'visible'});
  await page.locator('#onlyFramesTimeInput').fill('00:00:30');
  await page.locator('#onlyFramesConfirmTime').click();
  await page.waitForFunction(()=>window.MarmaladeGames.history().length===1);
  assert.equal(await page.evaluate(()=>window.MarmaladeGames.history()[0].timestamp),30);
  await page.locator('#onlyFramesLaunch').click();
  await page.locator('#onlyFramesAction').click();

  // Hundreds of catalog entries should be indexed only once when gameplay
  // begins, not re-filtered/re-scanned for each Next button press.
  await page.evaluate(()=>{
    const library=window.MarmaladeMediaLibrary;
    window.__onlyFramesHarness.catalogReads=0;
    library.getGameLibraries=()=>[{id:'test-library',name:'Sample Movies',
      count:500,playableCount:500}];
    const videos=Array.from({length:500},(_,index)=>({
      id:'bulk-'+index,title:'Movie '+String(index).padStart(3,'0'),
      name:'Movie '+index+'.mp4',libraryId:'test-library',
      libraryName:'Sample Movies',kind:index%2?'tv':'movie',
      favorite:index===40,year:2000+index%20
    }));
    library.getGameVideos=()=>{
      window.__onlyFramesHarness.catalogReads++;
      return videos;
    };
  });
  await page.locator('#onlyFramesLaunch').click();
  await page.locator('#onlyFramesVideoChoice').click();
  await page.locator('#onlyFramesModeAutomatic').click();
  await page.locator('#onlyFramesAction').click();
  await page.locator('#onlyFramesVideoStep').waitFor({state:'visible'});
  assert.equal(await page.locator('.games-video-card').count(),72,
    'Large library chooser must render only its first page');
  await page.locator('#onlyFramesVideoSearch').fill('Movie 040');
  assert.equal(await page.locator('.games-video-card').count(),1);
  await page.locator('#onlyFramesVideoFilter').selectOption('favorite');
  assert.equal(await page.locator('.games-video-card').count(),1);
  await page.locator('#onlyFramesVideoFilter').selectOption('tv');
  assert.equal(await page.locator('.games-video-card').count(),0);
  await page.locator('#onlyFramesVideoFilter').selectOption('all');
  await page.locator('.games-video-card').click();
  await page.waitForFunction(()=>window.MarmaladeGames.history().length===1);
  assert.equal(await page.evaluate(()=>window.MarmaladeGames.history()[0].id),'bulk-40');
  const reads=await page.evaluate(()=>window.__onlyFramesHarness.catalogReads);
  await page.locator('#gamesNext').click();
  await page.locator('#onlyFramesVideoStep').waitFor({state:'visible'});
  assert.equal(await page.evaluate(()=>window.__onlyFramesHarness.catalogReads),reads,
    'Opening Next must not scan or copy 500 catalog entries again');
  await page.locator('#onlyFramesVideoCancel').click();
  await page.locator('#onlyFramesLaunch').click();
  await page.locator('#onlyFramesAction').click();

  // In Random mode, each Next turn reads from the in-memory snapshot,
  // even with 500 indexed titles, not the Media Library API.
  await page.locator('#onlyFramesLaunch').click();
  await page.locator('#onlyFramesVideoRandom').click();
  await page.locator('#onlyFramesModeAutomatic').click();
  await page.locator('#onlyFramesAction').click();
  await page.waitForFunction(()=>window.MarmaladeGames.history().length===1);
  const randomReads=await page.evaluate(()=>window.__onlyFramesHarness.catalogReads);
  for(let turn=2;turn<=5;turn++){
    await page.locator('#gamesNext').click();
    await page.waitForFunction(expected=>
      window.MarmaladeGames.history().length===expected,turn);
  }
  assert.equal(await page.evaluate(()=>window.__onlyFramesHarness.catalogReads),randomReads,
    'Random Next turns must not re-read the large video catalog');
  const bulkHistory=await page.evaluate(()=>window.MarmaladeGames.history());
  for(let i=1;i<bulkHistory.length;i++){
    assert.notEqual(bulkHistory[i].id,bulkHistory[i-1].id,
      'Random mode should not immediately repeat the previous video');
  }
  await page.locator('#onlyFramesLaunch').click();
  await page.locator('#onlyFramesAction').click();
  assert.equal(pageErrors.length,0,'Browser runtime errors: '+pageErrors.join('\n'));
  console.log('PASS OnlyFrames automatic and player-choice modes, frame history, receipt log, disabled D-pad, and End Game');
}finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
