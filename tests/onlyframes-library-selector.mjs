import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'};
const server=createServer((req,res)=>{
  const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname.slice(1)||'index.html');
  const file=resolve(root,name);
  if(file!==root&&!file.startsWith(root+sep)){res.writeHead(403);res.end();return;}
  try{res.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream'});
    res.end(readFileSync(file));}catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
  const page=await browser.newPage({viewport:{width:1337,height:733}});
  const errors=[];
  page.on('pageerror',error=>errors.push(String(error)));
  await page.route('**/peerjs@*/**',route=>route.fulfill({
    status:200,contentType:'application/javascript',body:'window.Peer=class {on(){} destroy(){}};'
  }));
  const url='http://127.0.0.1:'+server.address().port+'/';
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>Boolean(window.MarmaladeGames&&window.MarmaladeMediaLibrary?.ready));
  await page.evaluate(()=>window.MarmaladeMediaLibrary.ready);
  // Use realistic persisted catalog records, not mocks of getGameLibraries:
  // reproduce zero-video and extension-only libraries being silently omitted.
  await page.evaluate(async()=>{
    const request=indexedDB.open('marmalade:local-library:v1',1);
    const db=await new Promise((resolve,reject)=>{
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error);
    });
    const tx=db.transaction('libraries','readwrite');
    const store=tx.objectStore('libraries');
    const records=[
      {id:'test-empty',name:'Empty Library',kind:'movie',
        folders:[],items:[],hiddenIds:[]},
      {id:'extlib:test',name:'Extension Vault',kind:'movie',
        folders:[{id:'ext-folder',name:'Ext Folder',source:'extension',handle:null}],
        items:[{id:'ext-video',folderId:'ext-folder',title:'Extension Video',
          name:'ext.mp4',path:'ext.mp4'}],hiddenIds:[]},
      {id:'addon:test',name:'Minternet Movies',kind:'movie',
        folders:[{id:'native-folder',name:'Native Videos',source:'native',handle:null}],
        items:[{id:'native-video',folderId:'native-folder',title:'Native Video',
          name:'native.mp4',path:'native.mp4',
          url:'http://127.0.0.1:18761/video/native-video'}],hiddenIds:[]}
    ];
    for(const item of records)store.put(item);
    await new Promise((resolve,reject)=>{
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
      tx.onabort=()=>reject(tx.error||Error('Transaction aborted'));
    });
    db.close();
  });
  await page.reload({waitUntil:'domcontentloaded'});
  await page.evaluate(()=>window.MarmaladeMediaLibrary.ready);
  const list=await page.evaluate(()=>window.MarmaladeMediaLibrary.getGameLibraries());
  const byId=new Map(list.map(row=>[row.id,row]));
  assert(byId.has('test-empty'),'Empty Library must appear in game catalog');
  assert(byId.has('extlib:test'),'Extension-only library must appear in game catalog');
  assert(byId.has('addon:test'),'Native library must appear in game catalog');
  assert.equal(byId.get('test-empty').count,0);
  assert.equal(byId.get('extlib:test').count,1);
  assert.equal(byId.get('extlib:test').playableCount,0);
  assert.equal(byId.get('addon:test').playableCount,1);
  await page.locator('#settingsBtn').click();
  await page.locator('#gamesVisibilityToggle').check();
  await page.locator('#closeSettingsPanel').click();
  await page.locator('#onlyFramesLaunch').click();
  const visible=await page.locator('#onlyFramesLibrary option').evaluateAll(options=>
    options.map(option=>({text:option.textContent,id:option.value})));
  assert.equal(visible.length,4,'Every library plus placeholder must be displayed');
  for(const [id,name] of [['test-empty','Empty Library'],
    ['extlib:test','Extension Vault'],['addon:test','Minternet Movies']]){
    assert(visible.some(v=>v.id===id&&v.text.includes(name)),'Missing library '+name);
  }
  // Actual native dialog must paint ABOVE the player controls as one top layer.
  const modal=await page.locator('#onlyFramesDialog').evaluate(el=>{
    const left=document.elementFromPoint(14,Math.round(innerHeight*.5));
    const box=el.getBoundingClientRect();
    return {open:el.open,portaled:el.parentElement===document.body,
      viewport:Math.abs(box.width-innerWidth)<2,
      hit:left===el};
  });
  assert(modal.open&&modal.portaled&&modal.viewport&&modal.hit,
    'Top-layer dialog must intercept player controls, not be painted beneath them: '+
    JSON.stringify(modal));
  const groups=await page.locator('#onlyFramesMode').evaluate(el=>
    [...el.querySelectorAll('.games-mode-pill')].map(group=>
      [...group.querySelectorAll('button')].map(button=>button.getBoundingClientRect().width)));
  assert.equal(groups.length,2,'Video and Timestamp must have separate split pills');
  assert(groups.every(halves=>halves.length===2&&Math.abs(halves[0]-halves[1])<1),
    'Each Random/Choice split-pill must have equal-width halves');
  await page.locator('#onlyFramesModeChoice').click();
  assert.equal(await page.locator('#onlyFramesModeChoice').getAttribute('aria-pressed'),'true');
  await page.locator('#onlyFramesLibrary').selectOption('test-empty');
  assert.equal(await page.locator('#onlyFramesAction').isDisabled(),true);
  assert.match(await page.locator('#onlyFramesHint').textContent(),/empty/i);
  await page.locator('#onlyFramesLibrary').selectOption('extlib:test');
  assert.equal(await page.locator('#onlyFramesAction').isEnabled(),true,
    'Indexed extension libraries must offer an in-place connection path');
  assert.equal(await page.locator('#onlyFramesAction').textContent(),'Connect & Play');
  assert.equal(await page.locator('#onlyFramesConnectLibrary').isVisible(),true);
  assert.doesNotMatch(await page.locator('#onlyFramesHint').textContent(),/none can be opened here/i);
  // Mimic a genuine user-authorized folder handle, with a real File object
  // returned when a catalog relative path is opened.
  await page.evaluate(()=>{
    window.__linkedFileName='';
    const root={
      kind:'directory',
      queryPermission:async()=> 'granted',
      getFileHandle:async name=>{
        if(name!=='ext.mp4')throw Error('Unknown file');
        return {kind:'file',getFile:async()=>new File(['video'],'ext.mp4',{type:'video/mp4'})};
      }
    };
    window.showDirectoryPicker=async()=>root;
  });
  await page.locator('#onlyFramesConnectLibrary').click();
  await page.waitForFunction(()=>
    window.MarmaladeMediaLibrary.getGameLibraries()
      .find(lib=>lib.id==='extlib:test')?.playableCount===1);
  await page.waitForFunction(()=>
    document.querySelector('#onlyFramesAction')?.textContent==='Play Game'&&
    document.querySelector('#onlyFramesConnectLibrary')?.hidden===true);
  assert.equal(await page.locator('#onlyFramesConnectLibrary').isVisible(),false);
  assert.equal(await page.evaluate(()=>window.MarmaladeMediaLibrary.getGameVideos('extlib:test').length),1);
  await page.evaluate(async()=>{
    const bridge=window.MarmaladeAddonBridge;
    bridge.state.role='host';
    bridge.chooseVideo=file=>{window.__linkedFileName=file.name;return true;};
    await window.MarmaladeMediaLibrary.playGameVideo('extlib:test','ext-video');
  });
  assert.equal(await page.evaluate(()=>window.__linkedFileName),'ext.mp4',
    'The reconnected video must open in Marmaladeum, not in an extension tab');
  // An extension refresh must preserve the website-origin connection.
  await page.evaluate(async()=>{
    window.MarmaladeNativeLibrary={
      getCatalog:async()=>({libraries:[{id:'test',name:'Extension Vault',kind:'movie',
        folders:[{id:'ext-folder',name:'Ext Folder'}],
        items:[{id:'ext-video',folderId:'ext-folder',title:'Extension Video',
          name:'ext.mp4',path:'ext.mp4'}]}]})
    };
    await window.MarmaladeMediaLibrary.syncFromExtension();
    delete window.MarmaladeNativeLibrary;
  });
  assert.equal(await page.evaluate(()=>window.MarmaladeMediaLibrary.getGameVideos('extlib:test').length),1,
    'Refreshing the extension catalog must not drop the authorized file handle');
  await page.locator('#onlyFramesLibrary').selectOption('addon:test');
  assert.equal(await page.locator('#onlyFramesAction').isEnabled(),true,
    'A connected native source can be selected for play');
  await page.evaluate(()=>{
    const lib=window.MarmaladeMediaLibrary;
    const get=lib.getGameLibraries;
    lib.getGameLibraries=()=>[...get(),{id:'new-library',name:'Added While Open',
      count:0,playableCount:0}];
    window.dispatchEvent(new Event('marmalade:media-library-updated'));
  });
  assert.equal(await page.locator('#onlyFramesLibrary option[value="new-library"]').count(),1,
    'Game selector must refresh when Media Library changes');
  assert.equal(await page.locator('#onlyFramesLibrary').inputValue(),'addon:test',
    'Catalog refresh must preserve the current selection');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#onlyFramesDialog').evaluate(el=>el.open),false);
  assert.equal(await page.evaluate(()=>window.MarmaladeGames.isGameActive()),false);
  assert.deepEqual(errors,[],'No browser errors');
  console.log('PASS extension library reauthorization and in-player playback, modal layer, mode pills and catalog preservation');
}finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
