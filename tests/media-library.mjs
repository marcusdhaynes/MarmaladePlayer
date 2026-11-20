import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
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
      queryPermission:async()=> 'granted',
      requestPermission:async()=> 'granted',
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
  await page.locator('#mlDialogSave').click();
  await page.waitForFunction(()=>window.MarmaladeMediaLibrary.getLibraries().some(l=>
    l.name==='My Movies'&&l.count===3));
  assert.equal(await page.locator('#mlDialog').isVisible(),false);
  assert.equal(await page.locator('#mlCards .ml-card').count(),3,
    'Recursive scanning indexes videos and omits non-videos');
  assert.equal(await page.locator('#mlCards').getByText('Arrival',{exact:false}).count(),1);
  await page.locator('#mlSearch').fill('Moon');
  await page.waitForFunction(()=>document.querySelectorAll('#mlCards .ml-card').length===1);
  await page.locator('#mlSearch').fill('');
  await page.waitForFunction(()=>document.querySelectorAll('#mlCards .ml-card').length===3);
  await page.locator('#mlCards .ml-card').filter({hasText:'Arrival'}).click();
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
  await page.locator('#mlCards .ml-card').first().click();
  assert.equal(await page.locator('#mlCards .ml-card').count(),2,
    'Opening a series shows its episodes');
  assert((await page.locator('#mlCards .ml-card').allTextContents()).some(x=>x.includes('S01 E02')));

  await page.locator('#mlManage').click();
  await page.locator('#mlLibraryName').fill('Series & Shows');
  await page.locator('#mlDialogSave').click();
  await page.waitForFunction(()=>window.MarmaladeMediaLibrary.getLibraries().some(l=>l.name==='Series & Shows'));
  assert.equal(await page.locator('#mlCurrentShelf').textContent(),'Series & Shows',
    'Library can be renamed without losing its indexed entries');
  await page.evaluate(()=>window.confirm=()=>true);
  await page.locator('#mlManage').click();
  await page.locator('#mlDeleteLibrary').click();
  await page.waitForFunction(()=>!window.MarmaladeMediaLibrary.getLibraries().some(l=>l.name==='Series & Shows'));
  assert.equal(await page.evaluate(()=>window.MarmaladeMediaLibrary.getLibraries().length),1,
    'Deleting a catalog leaves the other library intact');

  assert.deepEqual(errors,[],'Library and player must initialize without JavaScript errors');
  console.log('PASS Plex-style named libraries, recursive scan, search, TV grouping, player, persistence, rename, delete, split UI');
}finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
