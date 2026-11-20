// Regression tests for the REAL-WORLD folder-import failures reported
// Nov 19-20, 2026 — the scenarios the mocked desktop test did not cover:
//  1. Fallback picker returning bare files (empty webkitRelativePath),
//     including the SAME filename arriving from different subfolders.
//  2. A library previously saved at 0 videos with a now-dead folder:
//     it must offer one-click Choose Folder and repopulate IN PLACE.
//  3. Native walk against a REAL Chromium directory handle (OPFS),
//     not a hand-rolled mock object.
//  4. The generic Minternet Local Media Library add-on bridge
//     (window.MinternetMediaLibrary): catalog appears on load as
//     clickable poster cards, plays via its asset URL, persists across
//     reload, and Choose Folder routes through addFolder().
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {resolve,extname,sep,join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css',
 '.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
const server=createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  const file=resolve(root,decodeURIComponent(url.pathname.slice(1)||'index.html'));
  if(file!==root&&!file.startsWith(root+sep)){res.writeHead(403);res.end();return;}
  try{
    res.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream'});
    res.end(readFileSync(file));
  }catch{res.writeHead(404);res.end();}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const base='http://127.0.0.1:'+server.address().port+'/';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});

async function newPage(){
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  page.on('pageerror',e=>{throw new Error('pageerror: '+e.message);});
  await page.route('**/peerjs@*/**',route=>route.fulfill({
    status:200,contentType:'application/javascript',
    body:'window.Peer=class {constructor(){this.open=false} on(){} destroy(){}};'}));
  await page.route('**/mediainfo.js@*',route=>route.fulfill({
    status:200,contentType:'application/javascript',
    body:'window.MediaInfo=async()=>({analyzeData:async()=>({media:{track:[]}})});'}));
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>Boolean(window.MarmaladeMediaLibrary?.ready));
  await page.evaluate(()=>window.MarmaladeMediaLibrary.ready);
  await page.locator('#settingsBtn').click();
  await page.locator('#mlVisibilityToggle').check();
  await page.locator('#closeSettingsPanel').click();
  return page;
}
// Feed files to #mlDirectoryInput the way Android/WebView pickers deliver
// them: bare File objects whose webkitRelativePath is EMPTY.
async function feedBareFiles(page,files){
  await page.evaluate(specs=>{
    const dt=new DataTransfer();
    for(const spec of specs){
      const file=new File(['fixture video'],spec.name,{type:'video/mp4',lastModified:999});
      Object.defineProperty(file,'webkitRelativePath',{value:spec.rel||''});
      dt.items.add(file);
    }
    const input=document.getElementById('mlDirectoryInput');
    input.files=dt.files;
    input.dispatchEvent(new Event('change',{bubbles:true}));
  },files);
}

try{
  // ---- 1. Empty webkitRelativePath + duplicate filenames ---------------
  {
    const page=await newPage();
    await page.evaluate(()=>{window.showDirectoryPicker=undefined;});
    await page.locator('#mlNewLibrary').click();
    await page.locator('#mlLibraryName').fill('Phone Picks');
    await feedBareFiles(page,[
      {name:'Root Movie (2020).mp4'},
      {name:'Episode.mp4'},   // e.g. Season 1 copy
      {name:'Episode.mp4'},   // e.g. Season 2 copy, same bare name
      {name:'notes.txt'},
    ]);
    await page.waitForFunction(()=>
      document.getElementById('mlScanPreview')?.textContent.includes('3 videos'),
      null,{timeout:5000});
    await page.locator('#mlDialogSave').click();
    await page.waitForFunction(()=>window.MarmaladeMediaLibrary.getLibraries()
      .some(l=>l.name==='Phone Picks'&&l.count===3));
    assert.equal(await page.locator('#mlCards .ml-card').count(),3,
      'Bare-file fallback indexes every video, duplicates included');
    await page.close();
    console.log('PASS bare-file fallback (empty webkitRelativePath, duplicate names kept)');
  }

  // ---- 2. Saved-at-0 dead library repopulates in place -----------------
  {
    const page=await newPage();
    // A folder whose scan legitimately returns 0 videos (only a text
    // file): the library saves at 0 with a handle folder attached.
    await page.evaluate(()=>{
      const txt={kind:'file',getFile:async()=>new File(['x'],'readme.txt')};
      window.showDirectoryPicker=async()=>({
        kind:'directory',name:'Empty Shelf',
        queryPermission:async()=>'granted',requestPermission:async()=>'granted',
        async *entries(){yield ['readme.txt',txt];}
      });
    });
    await page.locator('#mlNewLibrary').click();
    await page.locator('#mlLibraryName').fill('Dead Shelf');
    await page.locator('#mlPickFolder').click();
    await page.waitForFunction(()=>
      document.getElementById('mlScanPreview')?.textContent.includes('0 videos'));
    await page.locator('#mlDialogSave').click();
    await page.waitForFunction(()=>window.MarmaladeMediaLibrary.getLibraries()
      .some(l=>l.name==='Dead Shelf'&&l.count===0&&l.folders.length===1));
    // Reload: the mock handle cannot be cloned to IndexedDB, so the saved
    // folder comes back handle:null — dead. This is the user's state.
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>Boolean(window.MarmaladeMediaLibrary?.ready));
    await page.evaluate(()=>window.MarmaladeMediaLibrary.ready);
    assert(await page.evaluate(()=>window.MarmaladeMediaLibrary.getLibraries()
      .some(l=>l.name==='Dead Shelf'&&l.count===0)),
      'Dead library still shows 0 before reconnect (reproduces the report)');
    const status=await page.locator('#mlStatus').textContent();
    assert(/Choose Folder/.test(status||''),
      'Dead library tells the user the one-click fix, got: '+status);
    // Select the dead library and use its empty-state Choose Folder.
    await page.evaluate(()=>{window.showDirectoryPicker=undefined;});
    await page.locator('.ml-shelf').filter({hasText:'Dead Shelf'}).click();
    const chooseBtn=page.locator('#mlCards').getByRole('button',{name:'+ Choose Folder'});
    assert(await chooseBtn.isVisible(),'Empty dead library offers + Choose Folder');
    await chooseBtn.click();
    await feedBareFiles(page,[
      {name:'Recovered (2024).mp4',rel:'Real/Recovered (2024).mp4'},
      {name:'Second (2023).mkv',rel:'Real/Sub/Second (2023).mkv'},
    ]);
    await page.waitForFunction(()=>window.MarmaladeMediaLibrary.getLibraries()
      .some(l=>l.name==='Dead Shelf'&&l.count===2&&l.folders.length===1),
      null,{timeout:5000});
    assert.equal(await page.locator('#mlDialog').isVisible(),false,
      'Repopulation saves automatically, no second Save click');
    assert(await page.locator('#mlCards .ml-card').filter({hasText:'Recovered'}).count()===1,
      'Recovered videos appear as cards');
    await page.close();
    console.log('PASS dead saved-at-0 library repopulates in place via + Choose Folder');
  }

  // ---- 3. Real Chromium directory handle (OPFS) -------------------------
  {
    const page=await newPage();
    await page.evaluate(async()=>{
      const opfs=await navigator.storage.getDirectory();
      const picked=await opfs.getDirectoryHandle('Picked',{create:true});
      const write=async(dir,name)=>{
        const handle=await dir.getFileHandle(name,{create:true});
        const writable=await handle.createWritable();
        await writable.write('fixture');await writable.close();
      };
      await write(picked,'Root Film (2020).mp4');
      const sub=await picked.getDirectoryHandle('Sub',{create:true});
      await write(sub,'Nested Film (2021).mkv');
      await write(picked,'notes.txt');
      window.showDirectoryPicker=async()=>picked;
    });
    await page.locator('#mlNewLibrary').click();
    await page.locator('#mlLibraryName').fill('Real Handle');
    await page.locator('#mlPickFolder').click();
    await page.waitForFunction(()=>
      document.getElementById('mlScanPreview')?.textContent.includes('2 videos'),
      null,{timeout:5000});
    await page.locator('#mlDialogSave').click();
    await page.waitForFunction(()=>window.MarmaladeMediaLibrary.getLibraries()
      .some(l=>l.name==='Real Handle'&&l.count===2));
    assert.equal(await page.locator('#mlCards .ml-card').count(),2,
      'Real handle walk renders root + nested cards');
    await page.close();
    console.log('PASS native walk with a real Chromium (OPFS) directory handle');
  }

  // ---- 4. Minternet add-on bridge (generic API) -------------------------
  {
    const context=await browser.newContext({viewport:{width:1440,height:900}});
    const page=await context.newPage();
    await page.addInitScript(()=>{
      const items=[
        {id:'mf1|Arrival (2016).mp4',folderId:'mf1',path:'Arrival (2016).mp4',
         name:'Arrival (2016).mp4',size:10,lastModified:1,
         url:'https://example.invalid/arrival.mp4'},
        {id:'mf1|Movies/Blade Runner (1982).mkv',folderId:'mf1',
         path:'Movies/Blade Runner (1982).mkv',name:'Blade Runner (1982).mkv',
         size:10,lastModified:1,url:'https://example.invalid/blade.mkv'},
        {id:'mf1|Shows/Season 01/Some.Show.S01E01.mp4',folderId:'mf1',
         path:'Shows/Season 01/Some.Show.S01E01.mp4',name:'Some.Show.S01E01.mp4',
         size:10,lastModified:1,url:'https://example.invalid/e1.mp4'},
        {id:'mf1|Shows/Season 01/Some.Show.S01E02.mp4',folderId:'mf1',
         path:'Shows/Season 01/Some.Show.S01E02.mp4',name:'Some.Show.S01E02.mp4',
         size:10,lastModified:1,url:'https://example.invalid/e2.mp4'},
      ];
      const catalog=()=>({libraries:[{id:'main',name:'Minternet Library',kind:'movie',
        folders:[{id:'mf1',name:'Movies',source:'native'}],
        items:localStorage.getItem('mockAddonExtra')==='1'?
          [...items,{id:'mf1|Extra (2025).mp4',folderId:'mf1',path:'Extra (2025).mp4',
            name:'Extra (2025).mp4',size:10,lastModified:1,
            url:'https://example.invalid/extra.mp4'}]:items,
        lastScan:123}]});
      window.MinternetMediaLibrary={
        getCatalog:async()=>catalog(),
        addFolder:async()=>{localStorage.setItem('mockAddonExtra','1');return catalog();},
        rescan:async()=>catalog(),
      };
    });
    await page.route('**/peerjs@*/**',route=>route.fulfill({
      status:200,contentType:'application/javascript',
      body:'window.Peer=class {constructor(){this.open=false} on(){} destroy(){}};'}));
    await page.route('**/mediainfo.js@*',route=>route.fulfill({
      status:200,contentType:'application/javascript',
      body:'window.MediaInfo=async()=>({analyzeData:async()=>({media:{track:[]}})});'}));
    await page.goto(base,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>Boolean(window.MarmaladeMediaLibrary?.ready));
    await page.evaluate(()=>window.MarmaladeMediaLibrary.ready);
    assert.equal(await page.evaluate(()=>window.MarmaladeMediaLibrary.hasNativeLibrary()),true);
    await page.locator('#settingsBtn').click();
    await page.locator('#mlVisibilityToggle').check();
    await page.locator('#closeSettingsPanel').click();
    // Catalog appears on load with NO folder picking in the page at all.
    await page.waitForFunction(()=>window.MarmaladeMediaLibrary.getLibraries()
      .some(l=>l.name==='Minternet Library'&&l.count===4));
    assert.equal(await page.locator('#mlCards .ml-card').count(),3,
      'Add-on catalog renders 2 movie cards + 1 grouped series card');
    // Cards are clickable and play through the add-on asset URL.
    await page.locator('#mlCards .ml-card').filter({hasText:'Arrival'}).click();
    await page.waitForFunction(()=>
      (window.MarmaladeAddonBridge?.media?.src||'').includes('arrival.mp4'));
    assert((await page.locator('#mlStatus').textContent()).includes('Minternet'),
      'Native play is reported honestly');
    // Choose Folder in the editor routes through the add-on.
    await page.locator('#mlNewLibrary').click();
    await page.locator('#mlPickFolder').click();
    await page.waitForFunction(()=>window.MarmaladeMediaLibrary.getLibraries()
      .some(l=>l.name==='Minternet Library'&&l.count===5),null,{timeout:5000});
    await page.waitForFunction(()=>document.querySelector('#mlDialog')?.hidden===true,
      null,{timeout:5000});
    // Persists across reload (add-on rescans natively; Marmalade re-syncs).
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>Boolean(window.MarmaladeMediaLibrary?.ready));
    await page.evaluate(()=>window.MarmaladeMediaLibrary.ready);
    assert(await page.evaluate(()=>window.MarmaladeMediaLibrary.getLibraries()
      .some(l=>l.name==='Minternet Library'&&l.count===5)),
      'Add-on catalog persists across reload');
    await context.close();
    console.log('PASS Minternet add-on bridge: auto catalog, poster cards, play URL, addFolder route, reload persistence');
  }

  console.log('PASS all media-library regression scenarios');
}finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
