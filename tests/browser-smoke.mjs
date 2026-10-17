import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { chromium } from 'playwright';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const infoJs = readFileSync(new URL('../movie-info.js', import.meta.url), 'utf8');
const parserBody = infoJs.match(/function parseFilename\\(name\\) \\{[\\s\\S]*?\\n  \\}/)?.[0];
assert(parserBody, 'The filename parser must remain available');
const parseMovieFilename = new Function('name', 'return ('+parserBody+')(name)');
assert.deepEqual(parseMovieFilename('The.Matrix.1999.1080p.BluRay.x264.mkv'),
  {title:'The Matrix',year:1999,kind:'movie',season:null,episode:null});
assert.deepEqual(parseMovieFilename('Interstellar (2014) [1080p].mp4'),
  {title:'Interstellar',year:2014,kind:'movie',season:null,episode:null});
assert.deepEqual(parseMovieFilename('Oz.S02E02.WEBRip.mkv'),
  {title:'Oz',year:null,kind:'tv',season:2,episode:2});
assert.deepEqual(parseMovieFilename('The.Last.of.Us.1x03.720p.mp4'),
  {title:'The Last of Us',year:null,kind:'tv',season:1,episode:3});
const port = 38817;
const server = createServer((req,res) => {
  if (req.url?.startsWith('/manifest.webmanifest')) {
    res.writeHead(200, {'content-type':'application/manifest+json'});
    res.end('{"name":"Marmalade","start_url":"./"}');
  } else if (req.url?.startsWith('/favicon.svg')) {
    res.writeHead(200, {'content-type':'image/svg+xml'}); res.end('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  } else if (req.url?.startsWith('/movie-info.js')) {
    res.writeHead(200, {'content-type':'application/javascript'});
    res.end(readFileSync(new URL('../movie-info.js', import.meta.url), 'utf8'));
  } else if (req.url?.startsWith('/movie-info.css')) {
    res.writeHead(200, {'content-type':'text/css'});
    res.end(readFileSync(new URL('../movie-info.css', import.meta.url), 'utf8'));
  } else if (req.url?.startsWith('/sw.js')) {
    res.writeHead(200, {'content-type':'application/javascript'}); res.end('');
  } else {
    res.writeHead(200, {'content-type':'text/html;charset=utf-8'});res.end(html);
  }
});
await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
const browser = await chromium.launch({headless:true,args:['--no-sandbox']});
try {
  for(const viewport of [{width:1366,height:900},{width:390,height:844}]) {
    const page = await browser.newPage({viewport});
    const errors=[];
    page.on('pageerror', error => errors.push(error.stack || String(error)));
    await page.route('**/npm/peerjs@*/**', route=>route.fulfill({status:200,contentType:'application/javascript',body:'window.Peer = function(){};'}));
    await page.route('**/mediainfo.js@*', route=>route.fulfill({status:200,contentType:'application/javascript',body:'window.MediaInfo = async () => ({analyzeData:async()=>({media:{track:[]}})});'}));
    await page.goto('http://127.0.0.1:'+port+'/',{waitUntil:'domcontentloaded'});
    await page.waitForTimeout(400);
    assert.equal(await page.locator('#player').count(),1);
    assert.equal(await page.locator('#overlayPlay').count(),0,'Floating center play icon removed');
    assert.equal(await page.locator('.transport').count(),0,'Old Now Playing panel must be gone');
    assert.equal(await page.locator('#theaterControls').count(),1);
    assert.equal(await page.locator('#volume').getAttribute('max'),'200');
    assert.equal(await page.locator('#subtitlesBtn').count(),1);
    assert.equal(await page.locator('#popoutBtn').count(),1);
    assert.equal(await page.locator('#settingsBtn').count(),1);
    assert.equal(await page.locator('#bufferedFill').count(),1);
    assert.equal(await page.locator('.buffer-line').count(),0,'Remove old buffer strip');
    assert.equal(await page.locator('#networkLabel').isVisible(),false,'No WebRTC Active label');
    assert.equal(await page.locator('#subtitlesBtn .captions-icon').count(),1,'Caption icon replaces CC letters');
    assert.equal((await page.locator('#subtitlesBtn').textContent()).trim(),'','No CC text');
    assert.equal(await page.locator('#bufferToggle').getAttribute('aria-pressed'),'false');
    assert.equal(await page.locator('#bufferReadout').isVisible(),false,'Buffer readout is off initially');
    assert.equal(await page.locator('#joinSection').isVisible(),true,'Join field must be visible initially');
    assert.equal(await page.locator('.compact-cdn').isVisible(),true,'CDN option must remain');
    assert.equal(await page.locator('#hostTab').isVisible(),false,'No manual Host/Join tabs');
    assert.equal(await page.locator('#chooseFile').isVisible(),false,'File picker belongs in the video');
    assert.equal(await page.locator('.panel-intro').count(),0,'Remove decorative sidebar intro');
    const openedFilePicker = await page.locator('#dropZone').evaluate(stage => {
      let clicks=0;
      const f=document.getElementById('fileInput');
      f.addEventListener('click', e=>{clicks++; e.preventDefault();},{once:true});
      stage.click();
      return clicks;
    });
    assert.equal(openedFilePicker,1,'Clicking empty video must open file picker');
    const order = await page.locator('.theater-bottom button').evaluateAll(buttons=>buttons.map(b=>b.id));
    assert.deepEqual(order,['skipBack','playPause','skipForward','muteBtn','subtitlesBtn','mediaInfoToggle','popoutBtn','fullscreenBtn','settingsBtn']);
    assert.equal(await page.locator('#mediaInfoPanel').isVisible(),false,'Info drawer starts closed');
    await page.locator('#mediaInfoToggle').click({force:true});
    assert.equal(await page.locator('#mediaInfoPanel').isVisible(),true,'Info button opens drawer');
    assert.equal(await page.locator('#miSources').count(),1,'API sources exist');
    await page.locator('#miClose').click();
    assert.equal(await page.locator('#mediaInfoPanel').isVisible(),false,'Close button hides drawer');
    // No dependence on browser autoplay or a remote network for UI tests.
    await page.locator('#dropZone').evaluate(el=>el.classList.add('has-video'));
    await page.locator('#settingsBtn').click({force:true});
    assert.equal(await page.locator('#settingsPanel').isVisible(),true);
    await page.locator('#joinTab').evaluate(el=>el.click()); // hidden compatibility action, not user-facing
    await page.locator('#dropZone').evaluate(el=>el.classList.add('has-video'));
    const options=await page.locator('#qualitySelect option').allTextContents();
    assert(options.some(x=>x.includes('480')));
    assert(options.some(x=>x.includes('720')));
    await page.locator('#settingsBtn').click({force:true});
    await page.locator('#closeSettingsPanel').click({force:true});
    await page.evaluate(()=>{const el=document.querySelector('#volume');el.value='0';el.dispatchEvent(new Event('input',{bubbles:true}));});
    assert.equal(await page.locator('#player').evaluate(el=>el.muted),true,'0% must hard-mute video element');
    assert.equal(await page.locator('#volumeMark').textContent(),'0%');
    await page.evaluate(()=>{const el=document.querySelector('#volume');el.value='200';el.dispatchEvent(new Event('input',{bubbles:true}));});
    assert.equal(await page.locator('#volumeMark').textContent(),'100%','100% volume detent');
    await page.evaluate(()=>{const el=document.querySelector('#volume');el.value='200';el.dispatchEvent(new Event('input',{bubbles:true}));});
    assert.equal(await page.locator('#volumeMark').textContent(),'200%');
    await page.locator('#bufferToggle').click({force:true});
    assert.equal(await page.locator('#bufferToggle').getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('#bufferReadout').isVisible(),true);
    assert.match((await page.locator('#bufferReadout').textContent()).trim(),/^(?:—|\d+\.\d)s$/,'Only forward seconds appear');
    await page.locator('#bufferToggle').click({force:true});
    assert.equal(await page.locator('#bufferReadout').isVisible(),false);
    await page.locator('#fpsToggle').click({force:true});
    assert.equal(await page.locator('#fpsToggle').getAttribute('aria-pressed'),'true');
    await page.locator('#statusToggle').click({force:true});
    assert.equal(await page.locator('#statusToggle').getAttribute('aria-pressed'),'false');
    await page.locator('#subtitlesBtn').click({force:true});
    assert.equal(await page.locator('#subtitlePanel').isVisible(),true);
    await page.locator('#subtitleFile').setInputFiles({name:'test.vtt',mimeType:'text/vtt',buffer:Buffer.from('WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHello from subtitles!\n')});
    await page.waitForFunction(()=>document.querySelector('#subtitleName')?.textContent?.includes('1 cues'),{timeout:3000});
    const overflow = await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2);
    assert.equal(overflow,false,'Theater must fit mobile viewport');
    assert.deepEqual(errors,[], 'Browser runtime errors');
    await page.close();
    console.log('PASS',viewport.width,'x',viewport.height,'theater UI / volume / subtitles / FPS');
  }

  // Simulated signaling: verify that the entry point determines Host or Guest.
  const fakePeer = `
    window.__peerTrace=[];
    window.__connections=[];
    window.Peer = class MockPeer {
      constructor(id) {this.id=typeof id==='string'?id:'guest-test';this.open=true;this.handlers={};window.__peerTrace.push(['constructed',this.id]);}
      on(name,callback) {
        this.handlers[name]=callback;window.__peerTrace.push(['peer-on',name]);
        if(name==='open') setTimeout(()=>{window.__peerTrace.push(['peer-open',this.id]);callback(this.id)},0);
      }
      connect(id) {
        window.__peerTrace.push(['connect',id]);
        const conn={
          peer:id,open:false,callbacks:{},sent:[],
          on(name,callback){this.callbacks[name]=callback;window.__peerTrace.push(['connection-on',name]);
            if(name==='open')setTimeout(()=>{this.open=true;window.__peerTrace.push(['connection-open']);callback();},0);},
          send(message){this.sent.push(message);},close(){this.open=false;}
        };
        window.__connections.push(conn);
        return conn;
      }
      destroy(){}
      reconnect(){}
    };
  `;
  async function launchRoomPage(path='/') {
    const page=await browser.newPage({viewport:{width:1280,height:800}});
    const errors=[];
    page.on('pageerror',e=>errors.push(e.stack||String(e)));
    await page.route('**/npm/peerjs@*/**',route=>route.fulfill({
      status:200,contentType:'application/javascript',body:fakePeer}));
    await page.route('**/mediainfo.js@*', route=>route.fulfill({status:200,contentType:'application/javascript',body:'window.MediaInfo = async () => ({analyzeData:async()=>({media:{track:[]}})});'}));
    await page.goto('http://127.0.0.1:'+port+path,{waitUntil:'load'});
    return {page,errors};
  }
  {
    const {page,errors}=await launchRoomPage();
    await page.locator('#fileInput').setInputFiles({
      name:'movie.mp4',mimeType:'video/mp4',buffer:Buffer.from('not a real mp4')
    });
    await page.waitForFunction(()=>!document.querySelector('#hostActive').hidden);
    assert((await page.locator('#inviteLink').inputValue()).includes('?room='));
    await page.evaluate(()=>{
      const video=document.querySelector('#player');
      Object.defineProperty(video,'buffered',{configurable:true,value:{length:1,start:()=>0,end:()=>18}});
      Object.defineProperty(video,'currentTime',{configurable:true,value:10});
      Object.defineProperty(video,'duration',{configurable:true,value:100});
    });
    await page.locator('#bufferToggle').click({force:true});
    await page.waitForFunction(()=>document.querySelector('#bufferReadout')?.textContent === '8.0s',null,{timeout:3000});
    await page.locator('#bufferToggle').click({force:true});
    assert.equal(await page.locator('#joinSection').isVisible(),false);
    assert.deepEqual(errors,[],'Hosting must not produce runtime errors');
    await page.close();
    console.log('PASS choose-file automatically creates host room');
  }
  {
    const {page,errors}=await launchRoomPage();
    await page.locator('#roomInput').fill('ABCDEFGH');
    await page.waitForTimeout(800);
    console.log('AUTOJOIN TRACE', JSON.stringify(await page.evaluate(()=>({
      role:document.querySelector('#hostTab')?.getAttribute('aria-selected'),
      code:document.querySelector('#roomInput')?.value,
      connected:!document.querySelector('#joinActive')?.hidden,
      label:document.querySelector('#connectionText')?.textContent,
      peerType:typeof window.Peer,
      joinSectionHidden:document.querySelector('#joinSection')?.hidden,
      trace:window.__peerTrace
    }))),errors.join(' | '));
    await page.waitForFunction(()=>!document.querySelector('#joinActive').hidden,null,{timeout:5500});
    assert.equal(await page.locator('#joinedCode').textContent(),'ABCDEFGH');
    assert.equal(await page.locator('#joinSection').isVisible(),false);
    assert.deepEqual(errors,[],'Pasted room must join cleanly');
    await page.close();
    console.log('PASS pasted code automatically joins guest room');
  }

  // A connected guest can choose an identically named, content-verified movie.
  // A negative check must not replace or interrupt incoming streaming media.
  {
    const directory=mkdtempSync(join(tmpdir(),'marmalade-sync-'));
    let fixture;
    try {
      const filename=join(directory,'movie.mp4');
      execFileSync('ffmpeg',['-hide_banner','-loglevel','error',
        '-f','lavfi','-i','color=c=black:s=64x64:r=5','-t','2',
        '-an','-c:v','libx264','-pix_fmt','yuv420p',
        '-preset','ultrafast','-crf','42','-movflags','+faststart','-y',filename],
        {timeout:20000});
      fixture=readFileSync(filename);
    } finally {rmSync(directory,{recursive:true,force:true});}
    function sampledFingerprint(bytes) {
      const chunkSize=Math.min(65536,bytes.length);
      const samples=bytes.length<=chunkSize?1:16;
      const input=Buffer.alloc(16+chunkSize*samples);
      input.writeDoubleBE(0,0); // overwritten with little-endian DataView parity below
      input.writeDoubleLE(bytes.length,0);
      input.writeUInt32LE(chunkSize,8);
      input.writeUInt32LE(samples,12);
      for(let i=0;i<samples;i++){
        const offset=samples===1?0:Math.floor((bytes.length-chunkSize)*i/(samples-1));
        bytes.copy(input,16+i*chunkSize,offset,offset+chunkSize);
      }
      return bytes.length+'-'+createHash('sha256').update(input).digest('hex');
    }
    const {page,errors}=await launchRoomPage('/?room=ABCDEFGH');
    await page.waitForFunction(()=>!document.querySelector('#joinActive').hidden,null,{timeout:6000});
    assert.equal(await page.locator('#localCopyPanel').isVisible(),true,'Guest local-copy option displayed');
    assert.equal(await page.locator('#localCopyButton').isDisabled(),true,'Wait for movie identity');
    assert.equal(await page.locator('#settingsPanel #localCopyPanel').count(),0,'No hidden duplicate controls');
    await page.evaluate(fp=>{
      const conn=window.__connections[0];
      conn.callbacks.data({type:'state',mediaKind:'file',name:'movie.mp4',
        fingerprint:fp,revision:0,playing:false,time:0,duration:2,sourceWidth:64,
        sourceHeight:64,live:true});
    },sampledFingerprint(fixture));
    await page.waitForFunction(()=>!document.querySelector('#localCopyButton').disabled);
    await page.locator('#localCopyInput').setInputFiles({name:'wrong-name.mp4',
      mimeType:'video/mp4',buffer:fixture});
    await page.waitForFunction(()=>document.querySelector('#localCopyStatus').textContent.includes('Filename differs'));
    assert.equal(await page.locator('#player').getAttribute('src'),null,
      'Wrong filename must not replace a guest media stream');
    await page.locator('#localCopyInput').setInputFiles({name:'movie.mp4',
      mimeType:'video/mp4',buffer:Buffer.from('definitely not the same movie')});
    await page.waitForFunction(()=>document.querySelector('#localCopyStatus').textContent.includes('content or file size differs'));
    assert.equal(await page.locator('#player').getAttribute('src'),null,
      'Wrong content must keep streaming as fallback');
    await page.locator('#localCopyInput').setInputFiles({name:'movie.mp4',
      mimeType:'video/mp4',buffer:fixture});
    await page.waitForFunction(()=>document.querySelector('#localCopyStatus').textContent.includes('Verified ✓'),null,{timeout:12000});
    assert((await page.locator('#player').getAttribute('src')).startsWith('blob:'),
      'Matching playable local file must replace the incoming stream');
    assert.equal(await page.locator('#localCopyButton').isDisabled(),true);
    const confirmations=await page.evaluate(()=>window.__connections[0].sent.filter(
      x=>x.type==='local-verified'&&x.verified===true));
    assert.equal(confirmations.length,1,'Host must be told to stop this guest media stream');
    assert.deepEqual(errors,[],'Local-copy verification must not throw browser errors');
    await page.close();
    console.log('PASS guest same-name/size/fingerprint/decoding checks and streaming fallback');
  }
  {
    const {page,errors}=await launchRoomPage('/?room=ABCDEFGH');
    await page.waitForFunction(()=>!document.querySelector('#joinActive').hidden);
    assert.equal(await page.locator('#joinedCode').textContent(),'ABCDEFGH');
    assert.deepEqual(errors,[],'Opening invite URL must join cleanly');
    await page.close();
    console.log('PASS invitation link auto-join');
  }
} finally {
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
