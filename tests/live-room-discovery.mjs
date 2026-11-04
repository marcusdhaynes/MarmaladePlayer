// Live external PeerJS Cloud smoke: verifies that a host ID really becomes
// discoverable to an independent browser, with no locally mocked signaling.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
  const host=await browser.newPage(),guest=await browser.newPage();
  const errors=[];
  for(const page of [host,guest])page.on('pageerror',e=>errors.push(String(e)));
  const url='https://marcusdhaynes.github.io/MarmaladePlayer/';
  await Promise.all([host.goto(url,{waitUntil:'domcontentloaded'}),guest.goto(url,{waitUntil:'domcontentloaded'})]);
  await Promise.all([host.waitForFunction(()=>typeof Peer==='function',{timeout:25000}),guest.waitForFunction(()=>typeof Peer==='function',{timeout:25000})]);
  const room='marmalade-ci'+Date.now().toString(36);
  await host.evaluate(id=>{
    window.__cloud={id,connected:false};
    const p=new Peer(id,{debug:0});
    window.__cloudPeer=p;
    p.on('open',()=>window.__cloud.ready=true);
    p.on('error',e=>window.__cloud.error=e.type||e.message);
    p.on('connection',c=>{
      c.on('open',()=>{window.__cloud.connected=true;c.send({type:'hello'});});
    });
  },room);
  await host.waitForFunction(()=>window.__cloud.ready||window.__cloud.error,null,{timeout:25000});
  const hs=await host.evaluate(()=>window.__cloud);
  assert.equal(hs.error,undefined,'host failed cloud registration '+JSON.stringify(hs));
  await guest.evaluate(id=>{
    window.__guest={id,open:false};
    const p=new Peer({debug:0});
    window.__guestPeer=p;
    p.on('open',()=>{
      const c=p.connect(id,{reliable:true});
      c.on('open',()=>window.__guest.open=true);
      c.on('data',x=>{if(x.type==='hello')window.__guest.received=true;});
      c.on('error',e=>window.__guest.error=e.message);
    });
    p.on('error',e=>window.__guest.error=e.type||e.message);
  },room);
  await guest.waitForFunction(()=>window.__guest.received||window.__guest.error,null,{timeout:30000});
  const gs=await guest.evaluate(()=>window.__guest);
  assert.equal(gs.received,true,'Guest failed to discover cloud-host '+JSON.stringify(gs));
  assert.deepEqual(errors,[]);
  console.log('PASS live PeerJS cloud host registration and external guest discovery',room);
  // Now test MarmaladePlayer's production room registration and invitation
  // handling rather than merely proving the PeerJS server itself works.
  const appHost=await browser.newPage(),appGuest=await browser.newPage();
  for(const page of [appHost,appGuest])page.on('pageerror',e=>errors.push(String(e)));
  await appHost.goto(url,{waitUntil:'load'});
  await appHost.waitForFunction(()=>typeof Peer==='function');
  await appHost.locator('#createRoom').evaluate(button=>button.click());
  await appHost.waitForFunction(()=>!document.querySelector('#hostActive').hidden &&
    document.querySelector('#connectionText').textContent==='Room is ready',null,{timeout:25000});
  const invite=await appHost.locator('#inviteLink').inputValue();
  assert.match(invite,/\\?room=[A-Z2-9]{8}$/);
  await appGuest.goto(invite,{waitUntil:'load'});
  await appGuest.waitForFunction(()=>document.querySelector('#connectionText').textContent==='Watching with host',
    null,{timeout:30000});
  assert.equal(await appGuest.locator('#joinActive').evaluate(e=>!e.hidden),true);
  console.log('PASS live MarmaladePlayer app-host registration and guest invitation',invite);
  await Promise.all([appHost.close(),appGuest.close()]);
}finally{await browser.close();}
