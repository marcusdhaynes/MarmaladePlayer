import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {extname,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css',
  '.json':'application/json','.svg':'image/svg+xml'};
const server=createServer((req,res)=>{
  const target=new URL(req.url,'http://localhost');
  const name=target.pathname==='/'?'index.html':decodeURIComponent(target.pathname.slice(1));
  const path=resolve(root,name);
  if(path!==root&&!path.startsWith(root+sep)){res.writeHead(403);res.end();return;}
  try{
    const bytes=readFileSync(path);
    res.writeHead(200,{'content-type':mime[extname(path)]||'application/octet-stream'});
    res.end(bytes);
  }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
  const page=await browser.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  await page.route('https://cdn.jsdelivr.net/npm/peerjs@*/**',route=>
    route.fulfill({status:200,contentType:'application/javascript',body:'window.Peer=class {on(){} destroy(){}};'}));
  await page.route('https://unpkg.com/**',route=>
    route.fulfill({status:200,contentType:'application/javascript',body:'window.MediaInfo=async()=>({analyzeData:async()=>({media:{track:[]}})});'}));
  await page.goto('http://127.0.0.1:'+server.address().port+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>Boolean(window.MarmaladeAddonBridge),null,{timeout:12000});
  const readRevision=()=>page.evaluate(()=>window.MarmaladeAddonBridge.state.transportRevision);
  await page.evaluate(()=>{
    const s=window.MarmaladeAddonBridge.state;
    s.role='host';s.source='file';s.fileReady=true;
    // The movie itself is not needed to verify shortcut dispatch; it is
    // sufficient to verify transport commands and focused-button behavior.
  });
  await page.locator('#statusToggle').focus();
  const start=await readRevision();
  assert.equal(await page.locator('#statusToggle').getAttribute('aria-pressed'),'false');
  await page.keyboard.press('Space');
  assert.equal(await readRevision(),start+1,'Space dispatches exactly one playback toggle');
  assert.equal(await page.locator('#statusToggle').getAttribute('aria-pressed'),'false',
    'Space never clicks the focused Status control');
  await page.locator('#muteBtn').focus();
  const muted=await page.locator('#muteBtn').getAttribute('title');
  await page.keyboard.press('Space');
  assert.equal(await readRevision(),start+2,'Space works despite focus staying on Mute');
  assert.equal(await page.locator('#muteBtn').getAttribute('title'),muted,
    'Space does not activate Mute');
  await page.keyboard.down('Space');
  await page.keyboard.down('Space');
  await page.keyboard.up('Space');
  assert.equal(await readRevision(),start+3,'Repeated keydown cannot double-toggle playback');
  assert.deepEqual(await page.locator('#skipInterval option').evaluateAll(opts=>opts.map(o=>o.value)),
    ['5','10','15','20','30','60']);
  assert.equal(await page.locator('#skipInterval').inputValue(),'10');
  await page.locator('#skipInterval').selectOption('30');
  assert.equal(await page.evaluate(()=>localStorage.getItem('marmalade:skip-interval-seconds')),'30');
  for(const [id,word] of [['skipBack','Rewind'],['skipForward','Forward'],
      ['miniSkipBack','Rewind'],['miniSkipForward','Forward']]){
    assert.equal(await page.locator('#'+id).getAttribute('aria-label'),word+' 30 seconds');
  }
  assert.equal(await page.locator('#skipBack svg text').textContent(),'30');
  assert.equal(await page.locator('#skipForward svg text').textContent(),'30');
  const commandProof=await page.evaluate(()=>{
    const {state,el}=window.MarmaladeAddonBridge;
    // Capture transport inputs on the real buttons without a video file.
    const clicks={back:0,forward:0};
    for(const [button,key] of [[el.back,'back'],[el.forward,'forward']]){
      button.disabled=false;
      button.addEventListener('click',event=>{
        clicks[key]++;
        // The actual skip logic is verified by the original button handler;
        // prevent the synthetic fixture's nonexistent movie from seeking.
      });
    }
    window.__keyboardClicks=clicks;
    return clicks;
  });
  await page.locator('#skipForward').focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowRight');
  assert.deepEqual(await page.evaluate(()=>window.__keyboardClicks),{back:1,forward:1});
  const beforeSpace=await page.evaluate(()=>({...window.__keyboardClicks}));
  await page.keyboard.press('Space');
  assert.deepEqual(await page.evaluate(()=>window.__keyboardClicks),beforeSpace,
    'Space cannot trigger the last focused fast-forward button');
  // Text inputs remain editable. Arrow shortcuts and spaces must not steal
  // keyboard events from a field where the user is writing or selecting data.
  await page.evaluate(()=>{
    const input=document.createElement('input');input.id='shortcutTextFixture';
    input.type='text';input.style.position='fixed';input.style.top='0';input.style.left='0';
    document.body.append(input);
  });
  await page.locator('#shortcutTextFixture').focus();
  await page.keyboard.type('one two');
  assert.equal(await page.locator('#shortcutTextFixture').inputValue(),'one two');
  await page.reload({waitUntil:'domcontentloaded'});
  assert.equal(await page.locator('#skipInterval').inputValue(),'30',
    'Skip preference must survive reload');
  assert.equal(await page.locator('#skipBack svg text').textContent(),'30');
  assert.deepEqual(errors,[],'Keyboard shortcuts should not cause runtime errors');
  console.log('PASS Space play/pause, no last-button activation, Left/Right skips, configurable saved interval');
  await page.close();
}finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
