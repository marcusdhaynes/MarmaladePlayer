import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {resolve,extname,sep,join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const fallbackRoot=mkdtempSync(join(tmpdir(),'marmalade-library-'));
mkdirSync(join(fallbackRoot,'Nested'));
writeFileSync(join(fallbackRoot,'Nested','The Prestige (2006).mp4'),'fixture video');
writeFileSync(join(fallbackRoot,'Notes.txt'),'not a video');
const importRoot=mkdtempSync(join(tmpdir(),'marmalade-real-folder-'));
mkdirSync(join(importRoot,'Movies'),{recursive:true});
mkdirSync(join(importRoot,'TV Shows','Season 01'),{recursive:true});
writeFileSync(join(importRoot,'Movies','Blade Runner (1982).mkv'),'movie');
writeFileSync(join(importRoot,'A Single Movie (2025).mp4'),'root-level MP4');
writeFileSync(join(importRoot,'TV Shows','Season 01','Some.Show.S01E01.mp4'),'episode 1');
writeFileSync(join(importRoot,'TV Shows','Season 01','Some.Show.S01E02.mp4'),'episode 2');
const emptyRoot=mkdtempSync(join(tmpdir(),'marmalade-no-media-'));
writeFileSync(join(emptyRoot,'readme.txt'),'not media');
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
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/peerjs@*/**',route=>route.fulfill({
    status:200,contentType:'application/javascript',
    body:'window.Peer=class {constructor(){this.open=false} on(){} destroy(){}};'
  }));
  await page.route('**/mediainfo.js@*',route=>route.fulfill({
    status:200,contentType:'application/javascript',
    body:'window.MediaInfo=async()=>({analyzeData:async()=>({media:{track:[]}})});'
  }));
  await page.goto('http://127.0.0.1:'+server.address().port+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>Boolean(window.MarmaladeMediaLibrary?.ready));
  await page.evaluate(()=>window.MarmaladeMediaLibrary.ready);

  assert.equal(await page.locator('#mediaLibraryPanel').isVisible(),false,
    'Media library is disabled by default');
  await page.locator('#settingsBtn').click();
  await page.locator('#mlVisibilityToggle').check();
  assert.equal(await page.locator('#mediaLibraryPanel').isVisible(),true);
  assert.equal(await page.locator('#mediaInfoPanel').isVisible(),true);
  const layout=await page.locator('#movieInfoRow').evaluate(row=>{
    const left=document.getElementById('mediaLibraryPanel').getBoundingClientRect();
    const right=document.getElementById('mediaInfoPanel').getBoundingClientRect();
    return {left:left.width,right:right.width,sameRow:Math.abs(left.top-right.top)<3};
  });
  assert(layout.sameRow,'The library is beside Movie & Series Information');
  assert(Math.abs(layout.left-layout.right)<3,'The library occupies half of the information row');
  await page.locator('#closeSettingsPanel').click();
  assert.equal(await page.locator('#mlNewLibrary').isVisible(),true);

  // The native directory chooser is mocked in-browser so the test never
  // requests access to a developer's actual local machine.
  await page.evaluate(()=>{
    const mkFile=name=>({kind:'file',getFile:async()=>new File(['test video'],name,
      {type:name.endsWith('.mkv')?'video/x-matroska':'video/mp4',lastModified:12345})});
    const tree={
      'Arrival (2016).mp4':mkFile('Arrival (2016).mp4'),
      'The.Matrix.1999.mkv':mkFile('The.Matrix.1999.mkv'),
      'ignore.txt':mkFile('ignore.txt'),
      Extras:{'Moon.2009.avi':mkFile('Moon.2009.avi')}
    };
    const wrap=(name,files)=>({
      kind:'directory',name,
      queryPermission:async()=> name==='Films'&&!window.__filmAccessApproved?'prompt':'granted',
      requestPermission:async()=>{
        window.__permissionRequests=(window.__permissionRequests||0)+1;
        if(name==='Films')window.__filmAccessApproved=true;
        return 'granted';
      },
      async *entries(){
        for(const [entryName,item] of Object.entries(files))
          yield [entryName,item.kind?item:wrap(entryName,item)];
      },
      getFileHandle:async name=>files[name],
      getDirectoryHandle:async name=>wrap(name,files[name])
    });
    window.__mockFolders=[
      wrap('Films',tree),
      wrap('TV Shows',{
        'The Expanse':{
          'Season 01':{
            'The.Expanse.S01E01.mkv':mkFile('The.Expanse.S01E01.mkv'),
            'The.Expanse.S01E02.mkv':mkFile('The.Expanse.S01E02.mkv')
          }
        }
      })
    ];
    window.showDirectoryPicker=async()=>window.__mockFolders.shift();
  });
  await page.locator('#mlNewLibrary').click();
  assert.equal(await page.locator('#mlDialogTitle').textContent(),'Create Library');
  await page.locator('#mlLibraryName').fill('My Movies');
  await page.locator('#mlPickFolder').click();
  await page.waitForFunction(()=>document.querySelectorAll('#mlFolderList .ml-folder-entry').length===1);
  await page.waitForFunction(()=>document.getElementById('mlScanPreview')?.textContent.includes('3 videos'));
  assert((await page.locator('#mlScanPreview').textContent()).includes('3 videos'),
    'Selected video folder should index its actual video files before saving');
  assert.equal(await page.evaluate(()=>window.__permissionRequests),1,
    'Newly selected folder in prompt state must request access instead of silently staying empty');
  await page.locator('#mlDialogSave').click();
  await page.waitForFunction(()=>window.MarmaladeMediaLibrary.getLibraries().some(l=>
    l.name==='My Movies'&&l.count===3));
  assert.equal(await page.locator('#mlDialog').isVisible(),false);
  assert.equal(await page.locator('#mlCards .ml-card').count(),3,
    'Recursive scanning indexes videos and omits non-videos');
  assert.equal(await page.locator('.ml-shelf-category').filter({hasText:'MOVIES'}).count(),1,
    'Movie libraries must have a dedicated sidebar divider');
  assert.equal(await page.locator('.ml-shelf-category').filter({hasText:'TV SHOWS'}).count(),1,
    'TV libraries must have a dedicated sidebar divider');
  assert.equal(await page.locator('.ml-media-divider').filter({hasText:'MOVIES'}).count(),1,
    'Movie cards must have a visible in-library divider');
  assert.equal(await page.locator('#mlCards').getByText('Arrival',{exact:false}).count(),1);
  assert.equal(await page.locator('.ml-shelf-edit').count(),1,
    'Every named library exposes a direct pencil edit control');
  assert.equal(await page.locator('.ml-tool-icon svg.glass-icon').count(),5,
    'Library tool buttons have the player SVG style');
  const arrival=()=>page.locator('#mlCards .ml-card').filter({hasText:'Arrival'});
  const aspect=await arrival().locator('.ml-card-art').evaluate(art=>{
    const bounds=art.getBoundingClientRect();
    return bounds.width/bounds.height;
  });
  assert(Math.abs(aspect-2/3)<.04,'Poster artwork must be a portrait 2:3 aspect ratio');
  assert.equal(await arrival().locator('.ml-art-type').count(),0,'Movie label is removed from artwork');
  assert.equal(await arrival().locator('.ml-card-star').getAttribute('aria-pressed'),'false');
  await arrival().locator('.ml-card-star').click();
  assert.equal(await arrival().locator('.ml-card-star').getAttribute('aria-pressed'),'true',
    'The top-right star toggles favorites without opening playback');
  await arrival().locator('.ml-card-more').click();
  const contextLabels=await page.locator('#mlContextMenu .ml-menu-action').allTextContents();
  for(const forbidden of ['▶  Play','Add to Favorites','Remove Favorite',
    'Analyze','Refresh Metadata','Match / Fix Match']){
    assert(!contextLabels.some(label=>label.includes(forbidden)),
      'Removed menu action must remain absent: '+forbidden);
  }
  for(const required of ['Match','Get Info','Edit Poster']){
    assert(contextLabels.some(label=>label.includes(required)),
      'Unified menu action must exist: '+required);
  }
  assert.equal(await page.locator('#mlContextMenu').isVisible(),true,
    'Three-dot control must open the custom video options menu');
  assert(await page.locator('#mlContextMenu').getByText('Edit Details').isVisible());
  assert(await page.locator('#mlContextMenu').getByText('Mark as Watched').isVisible());
  // Uploading a poster must use the user's own image, not fetch a metadata API.
  const chooser=page.waitForEvent('filechooser');
  await page.locator('#mlContextMenu').getByText('Edit Poster').click();
  const filePicker=await chooser;
  await filePicker.setFiles({name:'cover.png',mimeType:'image/png',
    buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAwAAAASCAIAAADgy6hbAAAAGUlEQVR4nGNcEDCNgRBgIqhiVNGoIiorAgAlRAGq0hp+tgAAAABJRU5ErkJggg==','base64')});
  await page.waitForFunction(()=>Boolean(document.querySelector('#mlCards .ml-card img.ml-art-poster')));
  assert((await arrival().locator('img.ml-art-poster').getAttribute('src')).startsWith('data:image/'),
    'Compressed uploaded poster must appear on the card');
  await arrival().locator('.ml-card-more').click();
  await page.locator('#mlContextMenu').getByText('Mark as Watched').click();
  await arrival().click({button:'right'});
  assert.equal(await page.locator('#mlContextMenu').isVisible(),true,
    'Right-click must open the same browser-style context menu');
  await page.locator('#mlContextMenu').getByText('Edit Details').click();
  await page.locator('#mlEditTitle').fill('Arrival Custom Title');
  await page.locator('#mlItemDialogSave').click();
  await page.waitForFunction(()=>document.querySelector('#mlCards')?.textContent.includes('Arrival Custom Title'));
  await page.locator('#mlRescan').click();
  await page.waitForFunction(()=>!document.getElementById('mlRescan').disabled);
  assert.equal(await page.locator('#mlCards .ml-card').filter({hasText:'Arrival Custom Title'}).count(),1,
    'Manually edited titles must survive folder rescans');
  await page.locator('#mlCards .ml-card').filter({hasText:'Arrival Custom Title'}).locator('.ml-card-more').click();
  await page.locator('#mlContextMenu').getByText('Get Info').click();
  assert.equal(await page.locator('#mlItemDialogTitle').textContent(),'Get Info');
  assert((await page.locator('#mlItemDialogBody').textContent()).includes('Arrival (2016).mp4'));
  await page.locator('#mlItemDialogCancel').click();
  await page.locator('#mlSearch').fill('Moon');
  await page.waitForFunction(()=>document.querySelectorAll('#mlCards .ml-card').length===1);
  await page.locator('#mlSearch').fill('');
  await page.waitForFunction(()=>document.querySelectorAll('#mlCards .ml-card').length===3);
  await page.locator('#mlCards .ml-card').filter({hasText:'Arrival Custom Title'}).click();
  assert.equal(await page.evaluate(()=>window.MarmaladeAddonBridge.state.file?.name),
    'Arrival (2016).mp4','Library card opens its real file through the existing host player');
  // The thumbnail index is persisted, but a fake JS handle cannot be cloned
  // to IndexedDB; production Chromium stores real directory handles.
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>Boolean(window.MarmaladeMediaLibrary?.ready));
  await page.evaluate(()=>window.MarmaladeMediaLibrary.ready);
  assert.equal(await page.locator('#mediaLibraryPanel').isVisible(),true,
    'Visibility setting persists across browser reload');
  assert(await page.evaluate(()=>window.MarmaladeMediaLibrary.getLibraries().some(l=>
    l.name==='My Movies'&&l.count===3)),'Catalog persists after reload');

  // A second named library is independent, and episodes group under a show.
  await page.evaluate(()=>{
    const mkFile=name=>({kind:'file',getFile:async()=>new File(['episode'],name,
      {type:'video/x-matroska',lastModified:11000})});
    const dir=(name,entries)=>({
      kind:'directory',name,
      queryPermission:async()=> 'granted',requestPermission:async()=> 'granted',
      async *entries(){for(const [n,value] of Object.entries(entries))
        yield [n,value.kind?value:dir(n,value)];},
      getDirectoryHandle:async n=>dir(n,entries[n]),
      getFileHandle:async n=>entries[n]
    });
    window.showDirectoryPicker=async()=>dir('Shows',{
      'The Expanse':{'Season 01':{
        'The.Expanse.S01E01.mkv':mkFile('The.Expanse.S01E01.mkv'),
        'The.Expanse.S01E02.mkv':mkFile('The.Expanse.S01E02.mkv')
      }}
    });
  });
  await page.locator('#mlNewLibrary').click();
  await page.locator('#mlLibraryName').fill('Series Shelf');
  await page.locator('#mlLibraryKind').selectOption('tv');
  await page.locator('#mlPickFolder').click();
  await page.locator('#mlDialogSave').click();
  await page.waitForFunction(()=>window.MarmaladeMediaLibrary.getLibraries().some(l=>
    l.name==='Series Shelf'&&l.count===2));
  assert.equal(await page.locator('#mlCards .ml-card').count(),1,
    'Two TV episodes are grouped under one series');
  assert.equal(await page.locator('.ml-shelf-category').filter({hasText:'TV SHOWS'}).count(),1);
  await page.locator('.ml-shelf-edit').last().click();
  assert.equal(await page.locator('#mlDialogTitle').textContent(),'Manage Library');
  await page.locator('#mlDialogCancel').click();
  await page.locator('#mlCards .ml-card').first().click();
  assert.equal(await page.locator('#mlCards .ml-card').count(),2,
    'Opening a series shows its episodes');
  assert((await page.locator('#mlCards .ml-card').allTextContents()).some(x=>x.includes('S01 E02')));

  await page.locator('#mlManage').click();
  await page.locator('#mlLibraryName').fill('Series & Shows');
  await page.locator('#mlDialogSave').click();
  await page.waitForFunction(()=>window.MarmaladeMediaLibrary.getLibraries().some(l=>l.name==='Series & Shows'));
  await page.waitForFunction(()=>document.querySelector('#mlCurrentShelf')?.textContent==='Series & Shows');
  assert.equal(await page.locator('#mlCurrentShelf').textContent(),'Series & Shows',
    'Library can be renamed without losing its indexed entries');
  await page.evaluate(()=>window.confirm=()=>true);
  await page.locator('#mlManage').click();
  await page.locator('#mlDeleteLibrary').click();
  await page.waitForFunction(()=>!window.MarmaladeMediaLibrary.getLibraries().some(l=>l.name==='Series & Shows'));
  assert.equal(await page.evaluate(()=>window.MarmaladeMediaLibrary.getLibraries().length),1,
    'Deleting a catalog leaves the other library intact');

  // Safari/Firefox and restricted WebViews can use the directory input without
  // silent access after a browser restart. The indexed catalog still survives.
  await page.evaluate(()=>{window.showDirectoryPicker=undefined;});
  await page.locator('#mlNewLibrary').click();
  await page.locator('#mlLibraryName').fill('Fallback Folder');
  await page.locator('#mlDirectoryInput').setInputFiles(fallbackRoot);
  await page.waitForFunction(()=>document.querySelectorAll('#mlFolderList .ml-folder-entry').length===1);
  await page.locator('#mlDialogSave').click();
  await page.waitForFunction(()=>window.MarmaladeMediaLibrary.getLibraries().some(l=>
    l.name==='Fallback Folder'&&l.count===1));
  await page.waitForFunction(()=>document.querySelector('#mlCurrentShelf')?.textContent==='Fallback Folder');
  assert.equal(await page.locator('#mlCards .ml-card').count(),1,
    'Directory fallback includes nested videos, but not text files');
  await page.waitForFunction(()=>/saved in Fallback Folder/.test(
    document.querySelector('#mlStatus')?.textContent||''));
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>Boolean(window.MarmaladeMediaLibrary?.ready));
  await page.evaluate(()=>window.MarmaladeMediaLibrary.ready);
  assert(await page.evaluate(()=>window.MarmaladeMediaLibrary.getLibraries().some(l=>
    l.name==='Fallback Folder'&&l.count===1)),
    'Session-only source catalogs survive reopening without retaining raw video files');

  // Some real directories enumerate names even while a file's metadata read
  // fails. This must produce a visible library card rather than 0 videos.
  await page.evaluate(()=>{
    window.showDirectoryPicker=async()=>({
      kind:'directory',name:'Slow Metadata Videos',
      queryPermission:async()=> 'granted',
      requestPermission:async()=> 'granted',
      async *entries(){
        yield ['Hard.To.Read.2026.mkv',{
          kind:'file',
          getFile:async()=>{throw new DOMException('Disk is busy','NotReadableError');}
        }];
      }
    });
  });
  await page.locator('#mlNewLibrary').click();
  await page.locator('#mlLibraryName').fill('Disk Media');
  await page.locator('#mlPickFolder').click();
  await page.waitForFunction(()=>document.getElementById('mlScanPreview')?.textContent.includes('1 video'));
  await page.locator('#mlDialogSave').click();
  await page.waitForFunction(()=>window.MarmaladeMediaLibrary.getLibraries().some(l=>l.name==='Disk Media'&&l.count===1));
  assert.equal(await page.locator('#mlCards .ml-card').count(),1,
    'File must appear even when its initial metadata access fails');
  assert((await page.locator('#mlCards').textContent()).includes('Hard To Read'),
    'Filename metadata is enough to populate the library');
  assert((await page.locator('#mlCards').textContent()).includes('File access needed'),
    'A deferred metadata read is clearly labeled');


  // Regression for the reported real-world screenshot: "Test" already exists
  // with zero media folders and displays a + Choose Folder empty-state action.
  // A single click, plus the OS folder selection, MUST index and persist the
  // library automatically without requiring the user to find a second Save.
  await page.locator('#mlNewLibrary').click();
  await page.locator('#mlLibraryName').fill('Test');
  await page.locator('#mlDialogSave').click();
  await page.waitForFunction(()=>window.MarmaladeMediaLibrary.getLibraries().some(l=>
    l.name==='Test'&&l.count===0&&l.folders.length===0));
  assert(await page.locator('#mlCards').getByText('Add a Media Folder').isVisible(),
    'Empty library reproduces the screenshot before importing');
  await page.evaluate(()=>{
    const file=name=>({kind:'file',getFile:async()=>new File(['fixture'],name)});
    const dir=(name,entries)=>({
      kind:'directory',name,
      queryPermission:async()=> 'granted',
      requestPermission:async()=> 'granted',
      async *entries(){
        for(const [n,child] of Object.entries(entries))
          yield [n,child.kind?child:dir(n,child)];
      },
      getDirectoryHandle:async n=>dir(n,entries[n]),
      getFileHandle:async n=>entries[n]
    });
    window.showDirectoryPicker=async()=>dir('Test Media',{
      Movies:{'Blade Runner (1982).mkv':file('Blade Runner (1982).mkv')},
      'TV Shows':{'Season 01':{
        'Some.Show.S01E01.mp4':file('Some.Show.S01E01.mp4'),
        'Some.Show.S01E02.mp4':file('Some.Show.S01E02.mp4')
      }}
    });
  });
  await page.evaluate(()=>{window.showDirectoryPicker=undefined;});
  await page.locator('#mlCards').getByRole('button',{name:'+ Choose Folder'}).click();
  // Actual browser directory-input path, not a mocked showDirectoryPicker.
  // The user selected this folder containing a .mp4 and nested video files.
  await page.locator('#mlDirectoryInput').setInputFiles(importRoot);
  await page.waitForTimeout(500);
  console.log('REAL FOLDER IMPORT TRACE',JSON.stringify(await page.evaluate(()=>({
    activeLibraries:window.MarmaladeMediaLibrary.getLibraries(),
    preview:document.querySelector('#mlScanPreview')?.textContent,
    status:document.querySelector('#mlStatus')?.textContent,
    folderRows:[...document.querySelectorAll('#mlFolderList .ml-folder-entry')].map(n=>n.textContent),
    editorOpen:!document.querySelector('#mlDialog')?.hidden,
    selectedSource:document.querySelector('#mlDirectoryInput')?.files?.length,
    cards:document.querySelectorAll('#mlCards .ml-card').length
  }))));
  await page.waitForFunction(()=>window.MarmaladeMediaLibrary.getLibraries().some(l=>
    l.name==='Test'&&l.count===4&&l.folders.length===1));
  await page.waitForFunction(()=>document.querySelector('#mlDialog')?.hidden===true);
  assert.equal(await page.locator('#mlCards .ml-card').count(),3,
    'The import automatically shows two movie cards and one grouped series');
  assert.equal(await page.locator('#mlCards .ml-media-divider').count(),2,
    'Imported movies and TV shows display in separate sections');
  assert.equal(await page.locator('#mlCards').getByText('Blade Runner',{exact:false}).count(),1);
  assert.equal(await page.locator('#mlCards').getByText('A Single Movie',{exact:false}).count(),1,
    'A root-level .mp4 must appear without nested folders');
  assert.equal(await page.locator('#mlCards').getByText('Some Show',{exact:false}).count(),1);
  await page.waitForFunction(()=>/saved in Test/.test(
    document.getElementById('mlStatus')?.textContent||''));
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>Boolean(window.MarmaladeMediaLibrary?.ready));
  await page.evaluate(()=>window.MarmaladeMediaLibrary.ready);
  assert(await page.evaluate(()=>window.MarmaladeMediaLibrary.getLibraries().some(l=>
    l.name==='Test'&&l.count===4&&l.folders.length===1)),
    'One-click import must be saved to IndexedDB and survive reload');

  // The toolbar folder action must also attach directly to an existing shelf,
  // including the Safari/Firefox-compatible directory input fallback.
  await page.evaluate(()=>{window.showDirectoryPicker=undefined;});
  await page.locator('#mlQuickAdd').click();
  await page.locator('#mlDirectoryInput').setInputFiles(fallbackRoot);
  await page.waitForFunction(()=>window.MarmaladeMediaLibrary.getLibraries().some(l=>
    l.name==='Test'&&l.count===5&&l.folders.length===2));
  assert.equal(await page.locator('#mlDialog').isVisible(),false,
    'Toolbar folder import does not require another Save click');
  // A previous mock directory handle is not cloneable to IndexedDB and will
  // need reconnecting after reload, so a background scan may correctly report
  // "folder access needed" instead of "indexed". Check the durable catalog
  // rather than relying on transient progress text.
  await page.waitForFunction(()=>new Promise(resolve=>{
    const open=indexedDB.open('marmalade:local-library:v1');
    open.onerror=()=>resolve(false);
    open.onsuccess=()=>{
      const req=open.result.transaction('libraries','readonly')
        .objectStore('libraries').getAll();
      req.onerror=()=>resolve(false);
      req.onsuccess=()=>resolve(req.result.some(lib=>
        lib.name==='Test'&&lib.items?.length===5&&lib.folders?.length===2));
    };
  }));
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>Boolean(window.MarmaladeMediaLibrary?.ready));
  await page.evaluate(()=>window.MarmaladeMediaLibrary.ready);
  assert(await page.evaluate(()=>window.MarmaladeMediaLibrary.getLibraries().some(l=>
    l.name==='Test'&&l.count===5&&l.folders.length===2)),
    'Both folder-picker modes durably save the attached folder catalog');

  assert.deepEqual(errors,[],'Library and player must initialize without JavaScript errors');
  console.log('PASS Plex-style named libraries, recursive scan, search, TV grouping, player, persistence, rename, delete, split UI');
}finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
  rmSync(fallbackRoot,{recursive:true,force:true});
  rmSync(importRoot,{recursive:true,force:true});
  rmSync(emptyRoot,{recursive:true,force:true});
}
