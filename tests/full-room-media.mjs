import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
import {PeerServer} from 'peer';

const WEB_PORT=38843,PEER_PORT=38844;
const dir=mkdtempSync(join(tmpdir(),'marmalade-e2e-'));
const video=join(dir,'full-stream.webm');
execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi',
  '-i','color=c=red:s=320x180:r=24','-f','lavfi',
  '-i','sine=frequency=440:sample_rate=48000','-t','12',
  '-c:v','libvpx','-crf','24','-b:v','0','-c:a','libopus',
  '-b:a','64k','-shortest','-y',video],{timeout:30000});
const bytes=readFileSync(video);
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const peerLib=readFileSync(new URL('../node_modules/peerjs/dist/peerjs.min.js',import.meta.url),'utf8');
const shim=[
  '(function(){const Actual=window.Peer;',
  'window.Peer=function(idOrOptions,options){',
  "const local={host:'127.0.0.1',port:38844,path:'/',secure:false};",
  "return typeof idOrOptions==='string'",
  '?new Actual(idOrOptions,{...options,...local})',
  ':new Actual({...idOrOptions,...local});};})();'
].join('');
const web=createServer((req,res)=>{
  if(req.url?.startsWith('/movie-info.js')){
    res.writeHead(200,{'content-type':'application/javascript'});
    res.end(readFileSync(new URL('../movie-info.js',import.meta.url)));return;
  }
  if(req.url?.startsWith('/movie-info.css')){
    res.writeHead(200,{'content-type':'text/css'});
    res.end(readFileSync(new URL('../movie-info.css',import.meta.url)));return;
  }
  if(req.url?.startsWith('/manifest.webmanifest')){
    res.writeHead(200,{'content-type':'application/manifest+json'});
    res.end('{"name":"Marmalade","start_url":"./"}');return;
  }
  res.writeHead(200,{'content-type':'text/html;charset=utf-8'});res.end(html);
});
await new Promise(resolve=>web.listen(WEB_PORT,'127.0.0.1',resolve));
const signaling=PeerServer({port:PEER_PORT,host:'127.0.0.1',path:'/'});
const browser=await chromium.launch({headless:true,args:[
  '--no-sandbox','--autoplay-policy=no-user-gesture-required'
]});
try {
  const errors=[];
  const makePage=async()=>{
    const page=await browser.newPage();
    page.on('pageerror',e=>errors.push(e.stack||String(e)));
    await page.route('**/npm/peerjs@*/**',route=>route.fulfill({
      status:200,contentType:'application/javascript',body:peerLib+shim}));
    await page.route('**/mediainfo.js@*',route=>route.fulfill({
      status:200,contentType:'application/javascript',
      body:'window.MediaInfo=async()=>({analyzeData:async()=>({media:{track:[]}})});'}));
    return page;
  };
  console.log('E2E host opening');
  const host=await makePage();
  await host.goto('http://127.0.0.1:'+WEB_PORT,{waitUntil:'load'});
  await host.locator('#fileInput').setInputFiles({
    name:'full-stream.webm',mimeType:'video/webm',buffer:bytes
  });
  await host.waitForFunction(()=>!document.querySelector('#hostActive').hidden &&
    !document.querySelector('#playPause').disabled,null,{timeout:16000});
  console.log('E2E host room ready');
  await host.locator('#playPause').click({force:true});
  await host.waitForFunction(()=>document.querySelector('#connectionText').textContent==='Broadcasting live',
    null,{timeout:12000});
  const invite=await host.locator('#inviteLink').inputValue();
  console.log('HOST BROADCAST READY',invite);
  console.log('E2E host streaming');
  const guest=await makePage();
  await guest.goto(invite,{waitUntil:'load'});
  await guest.waitForFunction(()=>document.querySelector('#joinActive').hidden===false,
    null,{timeout:18000});
  console.log('E2E guest joined control channel');
  await guest.waitForFunction(()=>document.querySelector('#player').srcObject?.getVideoTracks()?.length>0,
    null,{timeout:22000});
  console.log('E2E guest received media tracks');
  await guest.waitForFunction(()=>{
    const v=document.querySelector('#player');return v.videoWidth>0 && v.readyState>=2;
  },null,{timeout:12000});
  const report=await guest.evaluate(async()=>{
    const player=document.querySelector('#player');
    if(player.paused){player.muted=true;await player.play();}
    await new Promise(resolve=>setTimeout(resolve,450));
    const canvas=document.createElement('canvas');canvas.width=32;canvas.height=20;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    ctx.drawImage(player,0,0,32,20);
    const rgb=Array.from(ctx.getImageData(16,10,1,1).data);
    const stream=player.srcObject;
    // Inspect decoded PCM energy, not just a nominally live audio track.
    // This catches an incoming silent stream that a track-count test misses.
    let audioRms=0;
    if(stream.getAudioTracks().length){
      const probe=new AudioContext();
      const source=probe.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
      const analyser=probe.createAnalyser();analyser.fftSize=1024;
      const sink=probe.createGain();sink.gain.value=0;
      source.connect(analyser);analyser.connect(sink);sink.connect(probe.destination);
      await Promise.race([probe.resume(),new Promise((_,reject)=>
        setTimeout(()=>reject(Error('Audio analyzer could not resume')),2500))]);
      const samples=new Float32Array(analyser.fftSize);
      for(let i=0;i<35;i++){
        await new Promise(resolve=>setTimeout(resolve,100));
        analyser.getFloatTimeDomainData(samples);
        const rms=Math.sqrt(samples.reduce((sum,x)=>sum+x*x,0)/samples.length);
        audioRms=Math.max(audioRms,rms);
        if(audioRms>0.002)break;
      }
      source.disconnect();analyser.disconnect();sink.disconnect();
      await probe.close();
    }
    return {
      rgb,audioRms,videoWidth:player.videoWidth,
      videoTracks:stream.getVideoTracks().map(t=>({state:t.readyState,muted:t.muted})),
      audioTracks:stream.getAudioTracks().map(t=>({state:t.readyState,muted:t.muted})),
      currentTime:player.currentTime,
      connection:document.querySelector('#connectionText').textContent
    };
  });
  console.log('ACTUAL PEERJS END TO END MEDIA',JSON.stringify(report));
  assert(report.rgb[0]>125 && report.rgb[0]>report.rgb[1]*2,'Guest must see movie picture');
  assert(report.videoTracks.some(t=>t.state==='live'),'Guest video track must be live');
  assert(report.audioTracks.some(t=>t.state==='live'),'Guest audio track must be live');
  assert(report.audioRms>0.002,'Decoded guest audio must contain an audible sine-wave signal, not silence');
  assert.deepEqual(errors,[],'Browser runtime errors');
  console.log('PASS actual two-browser Marmalade PeerJS movie + sound');
  await guest.close();await host.close();
} catch(error) {
  console.error('MARMALADE FULL PEERJS TEST FAILED',error);
  process.exitCode=1;
} finally {
  await browser.close().catch(()=>{});
  try{signaling.close?.();}catch{}
  web.close();
  rmSync(dir,{recursive:true,force:true});
  process.exit(process.exitCode || 0);
}
