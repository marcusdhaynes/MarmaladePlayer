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
    res.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream'});
    res.end(readFileSync(file));
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
      get:()=>HTMLMediaElement.HAVE_METADATA});
    Object.defineProperty(media,'duration',{configurable:true,get:()=>120});
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
      return Number.isFinite(seconds)&&seconds>=0&&seconds<120;
    };
    bridge.stopGameVideo=()=>{
      window.__onlyFramesHarness.stops++;
      bridge.state.source=null;return true;
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
  await page.locator('#gamesLogClose').click();
  await page.locator('.game-score-plus').first().click();
  assert.equal(await page.locator('.game-score-value').first().textContent(),'01');
  await page.locator('#onlyFramesLaunch').click();
  assert.equal(await page.locator('#onlyFramesAction').textContent(),'End Game');
  await page.locator('#onlyFramesAction').click();
  assert.equal(await page.evaluate(()=>window.MarmaladeGames.isGameActive()),false);
  assert.equal(await page.evaluate(()=>window.__onlyFramesHarness.stops),1,
    'End Game must invoke the actual player stop bridge');
  assert.equal(await page.locator('.game-score-value').first().textContent(),'00',
    'All existing scores reset without removing player names');
  assert.equal(await page.locator('#gamesNext').isDisabled(),true);
  assert.equal(await page.locator('#gamesLogToggle').isDisabled(),true);
  assert.equal(await page.locator('#gamesLogPanel').isVisible(),false);
  await page.locator('#onlyFramesLaunch').click();
  await page.locator('#onlyFramesMode').selectOption('choice');
  await page.locator('#onlyFramesAction').click();
  await page.locator('#onlyFramesTimeStep').waitFor({state:'visible'});
  assert.equal(await page.locator('#onlyFramesTimeRange').getAttribute('max'),'119');
  await page.locator('#onlyFramesTimeRange').evaluate(input=>{
    input.value='42';input.dispatchEvent(new Event('input',{bubbles:true}));
  });
  assert.equal(await page.locator('#onlyFramesTimeValue').textContent(),'00:42');
  await page.locator('#onlyFramesConfirmTime').click();
  await page.waitForFunction(()=>window.MarmaladeGames.history().length===1);
  assert.equal(await page.evaluate(()=>window.MarmaladeGames.history()[0].timestamp),42,
    'Player chooses and confirms a timestamp within real video duration');
  assert.equal(await page.evaluate(()=>window.__onlyFramesHarness.seeks.at(-1)),42);
  await page.locator('#onlyFramesLaunch').click();
  await page.locator('#onlyFramesAction').click();
  assert.equal(await page.evaluate(()=>window.__onlyFramesHarness.stops),2);
  assert.equal(pageErrors.length,0,'Browser runtime errors: '+pageErrors.join('\n'));
  console.log('PASS OnlyFrames automatic and player-choice modes, frame history, receipt log, disabled D-pad, and End Game');
}finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
