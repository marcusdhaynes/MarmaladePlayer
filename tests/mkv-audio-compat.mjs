// End-to-end regression: MKV with real E-AC-3 soundtrack automatically
// produces audible AAC, and a held Stop never opens the OS file chooser.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync, writeFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, extname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const tmp=mkdtempSync(join(tmpdir(),'marmalade-mkv-eac3-'));
const source=join(tmp,'marmalade-eac3-test.mkv');
const subA=join(tmp,'english.srt'),subB=join(tmp,'arabic.srt');
writeFileSync(subA,'1\n00:00:01,000 --> 00:00:03,000\nEMBEDDED EARLY\n\n2\n00:00:07,000 --> 00:00:10,000\nEMBEDDED LATE\n');
writeFileSync(subB,'1\n00:00:01,000 --> 00:00:03,000\nمرحبا بالعالم\n');

execFileSync('ffmpeg',['-hide_banner','-loglevel','error',
  '-f','lavfi','-i','color=c=blue:s=320x180:r=24',
  '-f','lavfi','-i','sine=frequency=440:sample_rate=48000',
  '-i',subA,'-i',subB,'-map','0:v','-map','1:a','-map','2:s','-map','3:s',
  '-metadata:s:s:0','language=eng','-metadata:s:s:1','language=ara','-c:s:0','srt','-c:s:1','ass',
  '-t','12','-c:v','libx264','-preset','ultrafast',
  '-pix_fmt','yuv420p','-c:a','eac3','-b:a','192k','-y',source],
  {timeout:30000});
const mime={'.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm',
  '.html':'text/html','.svg':'image/svg+xml','.css':'text/css','.json':'application/json'};
const server=createServer((req,res)=>{
  const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const relative=path==='/'?'index.html':path.slice(1);
  const file=resolve(root,relative);
  if(!file.startsWith(root+'/')&&!file.startsWith(root+'\\')){res.writeHead(403);res.end();return;}
  try{
    const content=readFileSync(file);
    res.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream',
      'cache-control':'no-store'});
    res.end(content);
  }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port;
let browser;
try{
  try{browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});}
  catch{browser=await chromium.launch({headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});}
  const page=await browser.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.addInitScript(()=>{
    window.Peer=class MockPeer {
      constructor(){this.id='marmalade-TEST1234';this.open=true;this.handlers={};}
      on(name,handler){this.handlers[name]=handler;if(name==='open')setTimeout(()=>handler(this.id),10);}
      destroy(){}
      connect(){return {open:false,on(){},close(){}};}
    };
  });
  await page.route('https://cdn.jsdelivr.net/npm/peerjs@*/**',route=>route.fulfill({
    status:200,contentType:'application/javascript',body:''}));
  await page.route('https://unpkg.com/**',route=>route.fulfill({
    status:200,contentType:'application/javascript',body:''}));
  await page.goto('http://127.0.0.1:'+port+'/',{waitUntil:'domcontentloaded'});
  await page.locator('#fileInput').setInputFiles(source);
  await page.waitForFunction(()=>
    document.querySelector('#fileInfo').textContent.includes('Compatible AAC audio'),
    null,{timeout:60000}).catch(async error=>{
      const diagnostic=await page.evaluate(()=>({
        status:document.querySelector('#fileInfo')?.textContent,
        toast:document.querySelector('#toast')?.textContent,
        adapter:!!window.MarmaladeMkvIO,
        decoder:!!window.MarmaladeMkvAudio,
        webAssembly:typeof WebAssembly,
        mediaSource:typeof MediaSource
      }));
      console.error('MKV DECODER INIT FAILURE',JSON.stringify(diagnostic));
      console.error('Page errors:',JSON.stringify(errors.slice(-15)));
      throw error;
    });
  const video=page.locator('#player');
  await page.waitForFunction(()=>document.querySelector('#player').readyState>=2,
    {timeout:20000});
  await page.locator('#playPause').click({force:true});
  await page.waitForFunction(()=>document.querySelector('#player').currentTime>1,
    {timeout:15000});
  const playback=await page.evaluate(async()=>{
    const video=document.querySelector('#player');
    const stream=video.captureStream();
    const tracks=stream.getAudioTracks();
    if(!tracks.length)return {audioTracks:0,energy:0,currentTime:video.currentTime};
    const ctx=new AudioContext();
    const src=ctx.createMediaStreamSource(stream);
    const analyser=ctx.createAnalyser();analyser.fftSize=2048;
    src.connect(analyser);
    await ctx.resume();
    await new Promise(resolve=>setTimeout(resolve,500));
    const values=new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(values);
    const energy=Math.sqrt(values.reduce((sum,v)=>sum+v*v,0)/values.length);
    await ctx.close();
    return {audioTracks:tracks.length,energy,currentTime:video.currentTime};
  });
  console.log('EAC3 PLAYBACK',JSON.stringify(playback));
  assert(playback.audioTracks>0,'Remuxed video must include a real audio track');
  assert(playback.energy>.001,'Decoded E-AC-3 test tone must not be silent');

  // An actual remuxed E-AC-3/MSE file: seeking backward and forward must
  // never make the movie's reported or seekable length collapse. Subtitles
  // must follow the newly presented timeline while paused.
  await page.locator('#playPause').click({force:true});
  await page.waitForFunction(()=>document.querySelector('#player').paused);
  const fullDuration=await page.evaluate(()=>document.querySelector('#player').duration);
  assert(fullDuration>=11.5&&fullDuration<=12.5,
    'The original 12s MKV duration must be preserved through audio remux');
  // Real FFmpeg-muxed MKV with S_TEXT/UTF8 and S_TEXT/ASS tracks.
  await page.locator('#subMkvScan').evaluate(button=>button.click());
  await page.waitForFunction(()=>document.querySelector('#subMkvTrack').options.length===2);
  const tracks=await page.evaluate(()=>window.MarmaladeEmbeddedSubtitles.scan());
  assert.deepEqual(tracks.map(t=>[t.codec,t.language,t.supported]),[['S_TEXT/UTF8','eng',true],['S_TEXT/ASS','ara',true]]);
  await page.locator('#subMkvLoad').evaluate(button=>button.click());
  await page.waitForFunction(()=>document.querySelector('#subMkvStatus').textContent.includes('Embedded subtitles loaded.'));
  const embedded=await page.evaluate(()=>window.MarmaladeAddonBridge.state.subtitles);
  assert.deepEqual(embedded.map(c=>c.text),['EMBEDDED EARLY','EMBEDDED LATE']);
  assert(Math.abs(embedded[0].start-1)<.1&&Math.abs(embedded[0].end-3)<.1);
  await page.locator('#subMkvTrack').evaluate(select=>{select.value=select.options[1].value;select.dispatchEvent(new Event('change'));});
  await page.locator('#subMkvLoad').evaluate(button=>button.click());
  await page.waitForFunction(()=>window.MarmaladeAddonBridge.state.subtitles[0]?.text==='مرحبا بالعالم');
  console.log('PASS actual Matroska SRT and ASS embedded subtitle extraction');
  await page.locator('#subtitleFile').setInputFiles({
    name:'seek-regression.vtt',mimeType:'text/vtt',
    buffer:Buffer.from('WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nEARLY CUE\n\n00:00:07.000 --> 00:00:10.000\nLATE CUE\n')
  });
  await page.waitForFunction(()=>document.querySelector('#subtitleName').textContent.includes('2 Cues'));
  for(const [time,caption] of [[8.1,'LATE CUE'],[1.6,'EARLY CUE'],
      [8.6,'LATE CUE'],[2.1,'EARLY CUE']]){
    await page.evaluate(target=>{document.querySelector('#player').currentTime=target;},time);
    await page.waitForFunction(({at,cue})=>{
      const video=document.querySelector('#player'),sub=document.querySelector('#subtitleOverlay');
      return !video.seeking && Math.abs(video.currentTime-at)<.55 &&
        !sub.hidden && sub.textContent.includes(cue);
    },{at:time,cue:caption},{timeout:12000});
    const duration=await page.evaluate(()=>({
      media:document.querySelector('#player').duration,
      stable:window.MarmaladeStableDuration?.()
    }));
    assert(Math.abs(duration.media-fullDuration)<1,
      'MSE must not reduce the real media duration after a skip or rewind');
    assert(Math.abs(duration.stable-fullDuration)<1,
      'The player timeline must match the actual full runtime');
  }
  console.log('PASS real remuxed MKV seeking and paused caption synchrony');

  // Verify pointer gesture can fully stop, without a delayed picker click.
  let chooserCount=0;
  page.on('filechooser',()=>chooserCount++);
  await page.locator('#playPause').dispatchEvent('pointerdown',
    {pointerId:1,isPrimary:true,button:0});
  // Hold long enough that a timer-only suppression would have expired.
  await page.waitForTimeout(1750);
  await page.evaluate(()=>document.dispatchEvent(new PointerEvent('pointerup',
    {pointerId:1,isPrimary:true,button:0,bubbles:true})));
  // Simulate the delayed click some browsers synthesize onto the stage
  // after the original Play button is disabled by Stop.
  await page.locator('#dropZone').dispatchEvent('click',{button:0});
  await page.waitForTimeout(300);
  assert.equal(chooserCount,0,'Releasing a long Stop hold cannot open the file explorer');
  assert.equal(await page.locator('#stageTitle').textContent(),'Choose a movie.');
  assert.equal(await page.locator('#player').getAttribute('src'),null);
  console.log('PASS E-AC-3 AAC automatic playback and Stop without opening file picker');

  // Minternet-specific second half: the SAME synthetic E-AC-3 MKV is now
  // served over the loopback HTTP Range API, not selected as a browser File.
  // This reproduces the extension path that previously displayed video with
  // no audio, while leaving the real browser codec/audio graph intact.
  const nativeBytes=readFileSync(source);
  const nativeKey='a'.repeat(64);
  const rangeServer=createServer((req,res)=>{
    const target=new URL(req.url,'http://127.0.0.1:18761');
    const headers={
      'Access-Control-Allow-Origin':'http://127.0.0.1:'+port,
      'Access-Control-Allow-Private-Network':'true',
      'Access-Control-Allow-Methods':'GET, OPTIONS',
      'Access-Control-Allow-Headers':'Range',
      'Access-Control-Expose-Headers':'Content-Range, Content-Length, Accept-Ranges',
      'Cache-Control':'no-store',
      'Accept-Ranges':'bytes'
    };
    if(req.method==='OPTIONS'){res.writeHead(204,headers);res.end();return;}
    if(target.pathname!=='/video/0'||target.searchParams.get('key')!==nativeKey){
      res.writeHead(403,headers);res.end();return;
    }
    const match=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range||'');
    const start=match?Number(match[1]):0;
    const end=match&&match[2]?Math.min(nativeBytes.length-1,Number(match[2])):
      nativeBytes.length-1;
    if(!Number.isSafeInteger(start)||start<0||start>end||start>=nativeBytes.length){
      res.writeHead(416,{...headers,'Content-Range':'bytes */'+nativeBytes.length});
      res.end();return;
    }
    const payload=nativeBytes.subarray(start,end+1);
    res.writeHead(match?206:200,{
      ...headers,
      'Content-Type':'video/x-matroska',
      'Content-Length':payload.length,
      ...(match?{'Content-Range':`bytes ${start}-${end}/${nativeBytes.length}`}:{})
    });
    res.end(payload);
  });
  await new Promise(resolve=>rangeServer.listen(18761,'127.0.0.1',resolve));
  try{
    const result=await page.evaluate(({url,size})=>
      window.MarmaladeAddonBridge.chooseNativeStream({
        url,name:'marmalade-eac3-test.mkv',size
      }),{
      url:'http://127.0.0.1:18761/video/0?key='+nativeKey,
      size:nativeBytes.length
    });
    assert.equal(result,true,'Minternet native stream must start in the host player');
    await page.waitForFunction(()=>
      document.querySelector('#fileInfo').textContent.includes('Compatible AAC audio'),
      null,{timeout:60000}).catch(async error=>{
        console.error('NATIVE MKV AUDIO ERROR',JSON.stringify(await page.evaluate(()=>({
          fileInfo:document.querySelector('#fileInfo')?.textContent,
          toast:document.querySelector('#toast')?.textContent,
          source:window.MarmaladeAddonBridge?.state?.source
        }))));
        throw error;
      });
    await page.waitForFunction(()=>document.querySelector('#player').currentTime>1,
      null,{timeout:20000});
    const nativeSound=await page.evaluate(async()=>{
      const video=document.querySelector('#player');
      const audioTracks=video.captureStream().getAudioTracks();
      if(!audioTracks.length)return {audioTracks:0,energy:0};
      const stream=video.captureStream();
      const ctx=new AudioContext();
      const src=ctx.createMediaStreamSource(stream);
      const analyser=ctx.createAnalyser();analyser.fftSize=2048;
      src.connect(analyser);
      await ctx.resume();
      await new Promise(done=>setTimeout(done,600));
      const samples=new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(samples);
      const energy=Math.sqrt(samples.reduce((sum,v)=>sum+v*v,0)/samples.length);
      await ctx.close();
      return {audioTracks:audioTracks.length,energy};
    });
    assert(nativeSound.audioTracks>0,'Minternet HTTP Range remux must contain an audio track');
    assert(nativeSound.energy>.001,'Minternet HTTP Range E-AC-3 conversion must produce audible PCM');
    console.log('PASS: Minternet native HTTP Range MKV audio',JSON.stringify(nativeSound));
  }finally{
    await new Promise(resolve=>rangeServer.close(resolve));
  }
  if(errors.length)console.log('Non-fatal browser diagnostics:',JSON.stringify(errors.slice(0,5)));
  await page.close();
}finally{
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
  rmSync(tmp,{recursive:true,force:true});
}
