import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {resolve,extname,sep,join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {chromium,firefox,webkit} from 'playwright';

const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const directory=mkdtempSync(join(tmpdir(),'marmalade-media-'));
mkdirSync(join(directory,'Season 1'));
writeFileSync(join(directory,'Movie.mp4'),'test movie');
writeFileSync(join(directory,'Season 1','Episode.mkv'),'test episode');
writeFileSync(join(directory,'desktop.ini'),'not video');
const types={'.html':'text/html','.js':'application/javascript',
  '.css':'text/css','.svg':'image/svg+xml'};
const server=createServer((req,res)=>{
  const file=resolve(root,decodeURIComponent(new URL(req.url,'http://localhost').pathname.slice(1)||'index.html'));
  if(file!==root&&!file.startsWith(root+sep)){res.writeHead(403);res.end();return;}
  try{res.writeHead(200,{'content-type':types[extname(file)]||'application/octet-stream'});
    res.end(readFileSync(file));}catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const engine=process.env.MARMALADE_BROWSER||'chromium';
const browserType={chromium,firefox,webkit}[engine];
if(!browserType)throw Error('Unsupported test browser: '+engine);
const browser=await browserType.launch({headless:true,
  ...(engine==='chromium'?{args:['--no-sandbox']}:{})});
try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];page.on('pageerror',error=>errors.push(String(error)));
  await page.route('**/peerjs@*/**',route=>route.fulfill({status:200,
    contentType:'application/javascript',body:'window.Peer=class {on(){} destroy(){}};'}));
  await page.goto('http://127.0.0.1:'+server.address().port+'/',{waitUntil:'domcontentloaded'});
  await page.evaluate(()=>window.MarmaladeMediaLibrary.ready);
  await page.evaluate(()=>{
    delete window.MarmaladeNativeLibrary;delete window.MinternetMediaLibrary;
    window.__blockedCalls=0;window.__standardCalls=0;
    window.showDirectoryPicker=async()=>{
      window.__blockedCalls++;
      throw new DOMException('This folder contains system files','AbortError');
    };
    const directoryInput=document.getElementById('mlDirectoryInput');
    directoryInput.click=()=>{window.__standardCalls++;};
  });
  await page.locator('#settingsBtn').click();
  await page.locator('#mlVisibilityToggle').check();
  await page.locator('#closeSettingsPanel').click();
  await page.locator('#mlNewLibrary').click();
  await page.locator('#mlLibraryName').fill('Browser Movies');
  await page.locator('#mlPickFolder').click();
  assert.equal(await page.evaluate(()=>window.__blockedCalls),0,
    'Primary folder import must avoid the system-files restriction');
  assert.equal(await page.evaluate(()=>window.__standardCalls),1,
    'Primary folder import must use browser-standard file input');
  // A blocked/cancelled picker must not silently save an empty collection.
  await page.locator('#mlDialogSave').click();
  assert.match(await page.locator('#mlScanPreview').textContent(),
    /No video files have been added/i);
  assert.equal(await page.evaluate(()=>window.MarmaladeMediaLibrary.getGameLibraries()
    .some(lib=>lib.name==='Browser Movies')),false,
    'A failed folder selection must not create an empty indexed library');
  // Chromium (and current Firefox/Safari) provide webkitRelativePath for
  // folder-input selections, including nested videos.
  await page.locator('#mlDirectoryInput').setInputFiles(directory);
  await page.waitForFunction(()=>
    (document.getElementById('mlScanPreview')?.textContent||'').includes('2 videos'));
  await page.locator('#mlDialogSave').click();
  await page.waitForFunction(()=>{
    const info=window.MarmaladeMediaLibrary.getGameLibraries()
      .find(lib=>lib.name==='Browser Movies');
    return info?.count===2&&info?.playableCount===2;
  });
  const id=await page.evaluate(()=>window.MarmaladeMediaLibrary.getGameLibraries()
    .find(lib=>lib.name==='Browser Movies').id);
  assert.equal(await page.evaluate(()=>window.__blockedCalls),0);
  assert.equal(await page.locator('#mlCards .ml-card').count(),2,
    'Two real local videos, not an empty saved library');
  await page.evaluate(async id=>{
    const bridge=window.MarmaladeAddonBridge;
    window.__opened=[];
    bridge.state.role='host';
    bridge.chooseVideo=file=>{window.__opened.push(file.name);return true;};
    const videos=window.MarmaladeMediaLibrary.getGameVideos(id);
    for(const video of videos)await window.MarmaladeMediaLibrary.playGameVideo(id,video.id);
  },id);
  assert.deepEqual((await page.evaluate(()=>window.__opened)).sort(),
    ['Episode.mkv','Movie.mp4']);
  // Indexed metadata is retained after reload, but the FileList is not.
  await page.reload({waitUntil:'domcontentloaded'});
  await page.evaluate(()=>window.MarmaladeMediaLibrary.ready);
  const retained=await page.evaluate(id=>
    window.MarmaladeMediaLibrary.getGameLibraries().find(lib=>lib.id===id),id);
  assert.equal(retained.count,2);
  assert.equal(retained.playableCount,0);
  await page.evaluate(()=>window.MarmaladeMediaLibrary.select(
    window.MarmaladeMediaLibrary.getGameLibraries().find(x=>x.name==='Browser Movies').id));
  // Re-select files, 10 times, and assert no duplicate catalog entries.
  await page.locator('#mlQuickFiles').setInputFiles([
    {name:'Movie.mp4',mimeType:'video/mp4',buffer:Buffer.from('test movie')},
    {name:'Episode.mkv',mimeType:'video/x-matroska',buffer:Buffer.from('test episode')}
  ]);
  await page.waitForFunction(id=>window.MarmaladeMediaLibrary.getGameLibraries()
    .find(x=>x.id===id)?.playableCount===2,id);
  for(let round=0;round<10;round++){
    const result=await page.evaluate(async id=>{
      const files=[new File(['v'],'Movie.mp4',{type:'video/mp4'}),
        new File(['v'],'Episode.mkv',{type:'video/x-matroska'})];
      return window.MarmaladeMediaLibrary.importGameFiles(id,files);
    },id);
    assert(result.connected&&result.playableCount===2&&result.imported===2,
      'Every repeated import must relink without duplicating: '+round);
    const current=await page.evaluate(id=>
      window.MarmaladeMediaLibrary.getGameLibraries().find(lib=>lib.id===id),id);
    assert.equal(current.count,2,'Catalog stays at two real videos: '+round);
  }
  assert.deepEqual(errors,[]);
  console.log('PASS '+engine+' browser-only folder and file imports, nested videos, protected-folder bypass, real playback and 10x relink');
}finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
  rmSync(directory,{recursive:true,force:true});
}
