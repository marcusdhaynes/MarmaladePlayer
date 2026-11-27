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
  try{const data=readFileSync(file);res.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream'});
    res.end(data);}catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
  const page=await browser.newPage({viewport:{width:1260,height:780}});
  const errors=[];
  page.on('pageerror',error=>errors.push(String(error)));
  await page.route('**/peerjs@*/**',route=>route.fulfill({status:200,
    contentType:'application/javascript',
    body:'window.Peer=class {on(){} destroy(){}};'}));
  await page.goto('http://127.0.0.1:'+server.address().port+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>Boolean(window.MarmaladeGames&&
    window.MarmaladeMediaLibrary&&window.MarmaladeAddonBridge));
  await page.evaluate(()=>{
    const library=window.MarmaladeMediaLibrary,bridge=window.MarmaladeAddonBridge,media=bridge.media;
    let ready=0,width=0,height=0,seeking=false,current=0;
    const state={opened:[],pendingSeek:null,stops:0};
    window.__frameGate={
      state,
      metadata:()=>{
        ready=HTMLMediaElement.HAVE_METADATA;
        media.dispatchEvent(new Event('loadedmetadata'));
      },
      picture:()=>{
        ready=HTMLMediaElement.HAVE_CURRENT_DATA;
        width=640;height=360;
        media.dispatchEvent(new Event('loadeddata'));
      },
      sought:()=>{
        seeking=false;ready=HTMLMediaElement.HAVE_CURRENT_DATA;
        media.dispatchEvent(new Event('seeked'));
        media.dispatchEvent(new Event('loadeddata'));
        state.pendingSeek=null;
      }
    };
    Object.defineProperty(media,'readyState',{configurable:true,get:()=>ready});
    Object.defineProperty(media,'videoWidth',{configurable:true,get:()=>width});
    Object.defineProperty(media,'videoHeight',{configurable:true,get:()=>height});
    Object.defineProperty(media,'duration',{configurable:true,get:()=>120});
    Object.defineProperty(media,'paused',{configurable:true,get:()=>true});
    Object.defineProperty(media,'seeking',{configurable:true,get:()=>seeking});
    Object.defineProperty(media,'currentTime',{configurable:true,
      get:()=>current,set:value=>{current=value;seeking=true;
        ready=HTMLMediaElement.HAVE_METADATA;state.pendingSeek=value;}});
    library.getGameLibraries=()=>[{id:'gate-library',name:'Loading Test Library',count:2}];
    library.getGameVideos=()=>[
      {id:'one',title:'First Movie',libraryId:'gate-library',libraryName:'Loading Test Library'},
      {id:'two',title:'Second Movie',libraryId:'gate-library',libraryName:'Loading Test Library'}
    ];
    library.playGameVideo=async(libraryId,itemId)=>{
      ready=0;width=0;height=0;seeking=false;current=0;
      state.pendingSeek=null;state.opened.push(itemId);
      bridge.state.role='host';bridge.state.source='file';
      return {id:itemId,libraryId};
    };
    bridge.pauseAndSeekGameFrame=seconds=>{
      media.currentTime=seconds;return true;
    };
    bridge.stopGameVideo=()=>{
      state.stops++;bridge.state.source=null;
      bridge.setGameFrameMode(false);
      return true;
    };
  });
  await page.locator('#settingsBtn').click();
  await page.locator('#gamesVisibilityToggle').check();
  await page.locator('#closeSettingsPanel').click();

  await page.locator('#onlyFramesLaunch').click();
  await page.locator('#onlyFramesAction').click();
  await page.locator('#onlyFramesLoadingStep').waitFor({state:'visible'});
  assert.equal(await page.locator('#gamesNext').isDisabled(),true);
  assert.equal(await page.evaluate(()=>window.MarmaladeGames.history().length),0);
  await page.evaluate(()=>window.__frameGate.metadata());
  await page.waitForTimeout(160);
  assert.equal(await page.evaluate(()=>window.MarmaladeGames.history().length),0,
    'Metadata alone must not start the game');
  assert.equal(await page.locator('#onlyFramesLoadingStep').isVisible(),true,
    'Loading phase remains visible until a picture has decoded');
  await page.evaluate(()=>window.__frameGate.picture());
  await page.waitForFunction(()=>window.__frameGate.state.pendingSeek!==null);
  assert.equal(await page.evaluate(()=>window.MarmaladeGames.history().length),0,
    'Even decoded initial picture is not enough: selected timestamp must finish seeking');
  assert.equal(await page.locator('#gamesNext').isDisabled(),true);
  assert.equal(await page.locator('#onlyFramesLoadingStep').isVisible(),true);
  await page.evaluate(()=>window.__frameGate.sought());
  await page.waitForFunction(()=>window.MarmaladeGames.history().length===1);
  assert.equal(await page.locator('#gamesNext').isEnabled(),true,
    'Next activates only after requested frame loads');
  assert.equal(await page.locator('#onlyFramesLoadingStep').isVisible(),false);

  // During a later turn, a slow video must not replace the previously
  // completed turn or advance the session.
  await page.locator('#gamesNext').click();
  await page.locator('#onlyFramesLoadingStep').waitFor({state:'visible'});
  assert.equal(await page.evaluate(()=>window.MarmaladeGames.history().length),1);
  assert.equal(await page.locator('#gamesPrevious').isDisabled(),true);
  assert.equal(await page.locator('#gamesNext').isDisabled(),true);
  await page.locator('#onlyFramesEndLoading').click();
  assert.equal(await page.evaluate(()=>window.MarmaladeGames.isGameActive()),false);
  await page.evaluate(()=>{
    window.__frameGate.metadata();
    window.__frameGate.picture();
  });
  await page.waitForTimeout(120);
  assert.equal(await page.evaluate(()=>window.MarmaladeGames.history().length),0,
    'Late loading events after End Game must not resurrect a game turn');
  assert.equal(await page.evaluate(()=>window.__frameGate.state.stops),1);

  // Player's Choice must also wait for playable frame BEFORE presenting
  // the timestamp picker; confirmation waits for the chosen frame to decode.
  await page.locator('#onlyFramesLaunch').click();
  await page.locator('#onlyFramesModeChoice').click();
  await page.locator('#onlyFramesAction').click();
  assert.equal(await page.locator('#onlyFramesTimeStep').isVisible(),false);
  await page.evaluate(()=>window.__frameGate.metadata());
  await page.waitForTimeout(160);
  assert.equal(await page.locator('#onlyFramesTimeStep').isVisible(),false);
  await page.evaluate(()=>window.__frameGate.picture());
  await page.locator('#onlyFramesTimeStep').waitFor({state:'visible'});
  assert.equal(await page.evaluate(()=>window.MarmaladeGames.history().length),0);
  await page.locator('#onlyFramesTimeInput').fill('00:00:42');
  assert.equal(await page.locator('#onlyFramesTimeRange').inputValue(),'42',
    'Exact HH:MM:SS typing updates the scrubber without starting playback');
  await page.locator('#onlyFramesConfirmTime').click();
  await page.waitForFunction(()=>window.__frameGate.state.pendingSeek===42);
  assert.equal(await page.evaluate(()=>window.MarmaladeGames.history().length),0);
  assert.equal(await page.locator('#onlyFramesLoadingStep').isVisible(),true);
  assert.equal(await page.locator('#gamesNext').isDisabled(),true);
  await page.evaluate(()=>window.__frameGate.sought());
  await page.waitForFunction(()=>window.MarmaladeGames.history().length===1);
  const frame=await page.evaluate(()=>window.MarmaladeGames.history()[0]);
  assert.equal(frame.timestamp,42,'Timestamp is recorded only after its frame loads');
  assert.equal(await page.locator('#gamesNext').isEnabled(),true);
  await page.locator('#onlyFramesLaunch').click();
  await page.locator('#onlyFramesAction').click();
  assert.deepEqual(errors,[],'Browser errors: '+errors.join('\n'));
  console.log('PASS game phases wait for decoded media and finished seeking, no premature Next or history, End cancels delayed loads');
}finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
