import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium, firefox } from 'playwright';

const fixtureDir=mkdtempSync(join(tmpdir(),'marmalade-webrtc-'));
const videoPath=join(fixtureDir,'red-test.webm');
execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i',
  'color=c=red:s=320x180:r=24','-t','10','-an','-c:v','libvpx','-pix_fmt','yuv420p',
  '-deadline','realtime','-cpu-used','5','-crf','23','-b:v','0','-y',videoPath],{timeout:25000});
const fixture=readFileSync(videoPath);
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const server=createServer((req,res)=>{
  if(req.url?.startsWith('/subtitle-search.js')){
    res.writeHead(200,{'content-type':'application/javascript'});
    res.end(readFileSync(new URL('../subtitle-search.js',import.meta.url)));
  }else if(req.url?.startsWith('/subtitle-match.js')){
    res.writeHead(200,{'content-type':'application/javascript'});
    res.end(readFileSync(new URL('../subtitle-match.js',import.meta.url)));
  }else if(req.url?.startsWith('/watch-sync-subtitles.js')){
    res.writeHead(200,{'content-type':'application/javascript'});
    res.end(readFileSync(new URL('../watch-sync-subtitles.js',import.meta.url)));
  }else if(req.url==='/movie-info.js' || req.url==='/movie-info.css'){
    const css=req.url.endsWith('.css');
    res.writeHead(200,{'content-type':css?'text/css':'application/javascript'});
    res.end(readFileSync(new URL('..'+req.url,import.meta.url)));
  }else if(req.url==='/manifest.webmanifest'){
    res.writeHead(200,{'content-type':'application/manifest+json'});
    res.end('{"name":"Marmalade Player","start_url":"./"}');
  }else if(req.url==='/sw.js'){
    res.writeHead(200,{'content-type':'application/javascript'});res.end('');
  }else{
    res.writeHead(200,{'content-type':'text/html;charset=utf-8'});res.end(html);
  }
});
await new Promise(resolve=>server.listen(38819,'127.0.0.1',resolve));

async function test(browserType,name){
  const browser=await browserType.launch({headless:true,args:name==='Chromium'?['--no-sandbox']:[]});
  try{
    const page=await browser.newPage();
    const errors=[];page.on('pageerror',error=>errors.push(error.stack||String(error)));
    await page.route('**/npm/peerjs@*/**',route=>route.fulfill({status:200,contentType:'application/javascript',
      body:`window.Peer=class {
        constructor(id){this.id=typeof id==='string'?id:'mock-guest';this.open=true;}
        on(name,cb){if(name==='open')setTimeout(()=>cb(this.id),0);}
        destroy(){}
      }`}));
    await page.route('**/mediainfo.js@*',route=>route.fulfill({
      status:200,contentType:'application/javascript',body:'window.MediaInfo=async()=>({analyzeData:async()=>({media:{track:[]}})});'
    }));
    await page.addInitScript(()=>{
      const native=HTMLCanvasElement.prototype.captureStream;
      HTMLCanvasElement.prototype.captureStream=function(...args){
        const result=native.apply(this,args);
        window.__outgoingCanvas={canvas:this,stream:result};return result;
      };
    });
    await page.goto('http://127.0.0.1:38819/',{waitUntil:'domcontentloaded'});
    await page.locator('#fileInput').setInputFiles({name:'red-test.webm',mimeType:'video/webm',buffer:fixture});
    await page.waitForFunction(()=>!document.querySelector('#hostActive').hidden && !document.querySelector('#playPause').disabled,null,{timeout:12000});
    await page.locator('#playPause').evaluate(button=>button.click());
    try {
      await page.waitForFunction(()=>window.MarmaladeAddonBridge?.state.outgoing?.getVideoTracks?.()[0]?.readyState==='live',null,{timeout:12000});
    } catch(error) {
      console.log('CAPTURE START DIAGNOSTIC',name,JSON.stringify(await page.evaluate(()=>{
        const {state,media,el}=window.MarmaladeAddonBridge||{};
        const tracks=stream=>stream?.getTracks?.().map(t=>({kind:t.kind,readyState:t.readyState,enabled:t.enabled,settings:t.getSettings?.()}));
        return {fileReady:state?.fileReady,broadcasting:state?.broadcasting,
          broadcastStarting:state?.broadcastStarting,source:state?.source,
          peerOpen:state?.peer?.open,role:state?.role,stage:el?.stage?.className,
          connection:document.querySelector('#connectionText')?.textContent,
          outgoing:tracks(state?.outgoing),native:tracks(state?.nativeCapture),
          canvas:tracks(state?.canvasStream),media:{readyState:media?.readyState,
            paused:media?.paused,error:media?.error?.message||null,
            time:media?.currentTime,videoWidth:media?.videoWidth,videoHeight:media?.videoHeight}};
      })),errors);
      throw error;
    }
    const samples=await page.evaluate(async()=>{
      const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
      const screenshotSample=(source)=>{
        const cv=document.createElement('canvas');cv.width=64;cv.height=36;
        const cx=cv.getContext('2d',{willReadFrequently:true});
        cx.drawImage(source,0,0,cv.width,cv.height);
        return Array.from(cx.getImageData(32,18,1,1).data);
      };
      const from=window.__outgoingCanvas;
      const outgoing=window.MarmaladeAddonBridge.state.outgoing;
      await delay(700);
      const host=screenshotSample(document.getElementById('player'));
      const canvas=from?.canvas?screenshotSample(from.canvas):null;
      const a=new RTCPeerConnection({iceServers:[]}),b=new RTCPeerConnection({iceServers:[]});
      a.onicecandidate=e=>{if(e.candidate)void b.addIceCandidate(e.candidate).catch(()=>{});};
      b.onicecandidate=e=>{if(e.candidate)void a.addIceCandidate(e.candidate).catch(()=>{});};
      const streamPromise=new Promise(resolve=>{b.ontrack=e=>resolve(e.streams[0]||new MediaStream([e.track]));});
      const videoTrack=outgoing.getVideoTracks()[0];
      a.addTrack(videoTrack,outgoing);
      await a.setLocalDescription(await a.createOffer());
      await b.setRemoteDescription(a.localDescription);
      await b.setLocalDescription(await b.createAnswer());
      await a.setRemoteDescription(b.localDescription);
      const incoming=await Promise.race([streamPromise,delay(11000).then(()=>{throw Error('WebRTC track timeout');})]);
      const receiver=document.createElement('video');
      receiver.muted=true;receiver.autoplay=true;receiver.playsInline=true;receiver.srcObject=incoming;
      document.body.appendChild(receiver);
      await receiver.play();
      const deadline=performance.now()+9000;
      let received=null;
      while(performance.now()<deadline){
        await delay(200);
        if(receiver.videoWidth && receiver.readyState>=2){
          received=screenshotSample(receiver);
          if(received[0]>125 && received[0]>received[1]*2)break;
        }
      }
      const result={host,canvas,received,width:receiver.videoWidth,
        outgoing:videoTrack.getSettings(),incoming:incoming.getVideoTracks()[0]?.getSettings(),
        aState:a.connectionState,bState:b.connectionState};
      receiver.remove();a.close();b.close();
      return result;
    });
    console.log('REAL WEBRTC CAPTURE',name,JSON.stringify(samples));
    assert(samples.host[0]>125 && samples.host[0]>samples.host[1]*2,'Host is red');
    if(samples.canvas)assert(samples.canvas[0]>125 && samples.canvas[0]>samples.canvas[1]*2,'Canvas fallback must be red');
    assert(samples.received?.[0]>125 && samples.received[0]>samples.received[1]*2,'WebRTC receiver must not be black');
    assert.deepEqual(errors,[]);
    console.log('PASS real WebRTC decoded nonblack video on '+name);
    await page.close();
  }finally{await browser.close();}
}
try{
  await test(chromium,'Chromium');
  await test(firefox,'Firefox');
}finally{
  await new Promise(resolve=>server.close(resolve));
  rmSync(fixtureDir,{recursive:true,force:true});
}
