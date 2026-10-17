import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { chromium } from 'playwright';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const port = 38817;
const server = createServer((req,res) => {
  if (req.url?.startsWith('/manifest.webmanifest')) {
    res.writeHead(200, {'content-type':'application/manifest+json'});
    res.end('{"name":"Marmalade","start_url":"./"}');
  } else if (req.url?.startsWith('/favicon.svg')) {
    res.writeHead(200, {'content-type':'image/svg+xml'}); res.end('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
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
    await page.route('https://cdn.jsdelivr.net/npm/peerjs@*', route=>route.fulfill({status:200,contentType:'application/javascript',body:'window.Peer = function(){};'}));
    await page.goto('http://127.0.0.1:'+port+'/',{waitUntil:'domcontentloaded'});
    await page.waitForTimeout(400);
    assert.equal(await page.locator('#player').count(),1);
    assert.equal(await page.locator('.transport').count(),0,'Old Now Playing panel must be gone');
    assert.equal(await page.locator('#theaterControls').count(),1);
    assert.equal(await page.locator('#volume').getAttribute('max'),'200');
    assert.equal(await page.locator('#subtitlesBtn').count(),1);
    assert.equal(await page.locator('#popoutBtn').count(),1);
    assert.equal(await page.locator('#settingsBtn').count(),1);
    assert.equal(await page.locator('#bufferedFill').count(),1);
    const order = await page.locator('.theater-bottom button').evaluateAll(buttons=>buttons.map(b=>b.id));
    assert.deepEqual(order,['skipBack','playPause','skipForward','muteBtn','subtitlesBtn','popoutBtn','fullscreenBtn','settingsBtn']);
    // No dependence on browser autoplay or a remote network for UI tests.
    await page.locator('#dropZone').evaluate(el=>el.classList.add('has-video'));
    await page.locator('#settingsBtn').click({force:true});
    assert.equal(await page.locator('#settingsPanel').isVisible(),true);
    await page.locator('#joinTab').click();
    const options=await page.locator('#qualitySelect option').allTextContents();
    console.log('QUALITY DIAGNOSTIC',JSON.stringify({options,host:await page.locator('#hostTab').getAttribute('aria-selected'),guest:await page.locator('#joinTab').getAttribute('aria-selected'),errors}));
    assert(options.some(x=>x.includes('480')));
    assert(options.some(x=>x.includes('720')));
    await page.locator('#settingsBtn').click({force:true});
    await page.evaluate(()=>{const el=document.querySelector('#volume');el.value='0';el.dispatchEvent(new Event('input',{bubbles:true}));});
    assert.equal(await page.locator('#player').evaluate(el=>el.muted),true,'0% must hard-mute video element');
    assert.equal(await page.locator('#volumeMark').textContent(),'0%');
    await page.evaluate(()=>{const el=document.querySelector('#volume');el.value='200';el.dispatchEvent(new Event('input',{bubbles:true}));});
    assert.equal(await page.locator('#volumeMark').textContent(),'100%','100% volume detent');
    await page.evaluate(()=>{const el=document.querySelector('#volume');el.value='200';el.dispatchEvent(new Event('input',{bubbles:true}));});
    assert.equal(await page.locator('#volumeMark').textContent(),'200%');
    await page.locator('#fpsToggle').click({force:true});
    assert.equal(await page.locator('#fpsToggle').getAttribute('aria-pressed'),'true');
    await page.locator('#statusToggle').click({force:true});
    assert.equal(await page.locator('#statusToggle').getAttribute('aria-pressed'),'false');
    await page.locator('#subtitlesBtn').click({force:true});
    assert.equal(await page.locator('#subtitlePanel').isVisible(),true);
    await page.locator('#subtitleFile').setInputFiles({name:'test.vtt',mimeType:'text/vtt',buffer:Buffer.from('WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHello from subtitles!\n')});
    assert((await page.locator('#subtitleName').textContent()).includes('1 cues'));
    const overflow = await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2);
    assert.equal(overflow,false,'Theater must fit mobile viewport');
    assert.deepEqual(errors,[], 'Browser runtime errors');
    await page.close();
    console.log('PASS',viewport.width,'x',viewport.height,'theater UI / volume / subtitles / FPS');
  }
} finally {
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
