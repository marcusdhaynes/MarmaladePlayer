'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const original=fs.readFileSync(path.join(__dirname,'../auto-mkv-audio.js'),'utf8');
assert.match(original,/await import\('\.\/vendor\/libav-wasm\/index\.js'\)/);
const code=original.replace(
  "await import('./vendor/libav-wasm/index.js')","await __fakeImport()"
);
const NATIVE='http://127.0.0.1:18761/video/5?key='+'a'.repeat(64);

function createRuntime(failures=1,codecOptions={}){
  let lastSource=null,plays=0;
  const attempts=[],notifications=[];
  class URLShim extends URL {
    static createObjectURL(source){lastSource=source;return 'blob:compat-mkv';}
    static revokeObjectURL(){}
  }
  class BufferShim {
    constructor(){
      this.listeners=new Map();this.updating=false;this.mode='segments';
      this.count=0;this.appends=[];
      this.buffered={length:0,start:()=>0,end:()=>42};
    }
    addEventListener(type,fn){this.listeners.set(type,[...(this.listeners.get(type)||[]),fn]);}
    removeEventListener(type,fn){this.listeners.set(type,(this.listeners.get(type)||[]).filter(x=>x!==fn));}
    dispatch(type){for(const fn of this.listeners.get(type)||[])fn();}
    appendBuffer(data){this.count++;this.appends.push(data);if(this.count>1)this.buffered.length=1;
      queueMicrotask(()=>this.dispatch('updateend'));}
    remove(){queueMicrotask(()=>this.dispatch('updateend'));}
  }
  class MediaSourceShim {
    constructor(){this.listeners=new Map();this.readyState='open';this.duration=42;}
    static isTypeSupported(type){
      if(type.includes('hev1'))return codecOptions.hev1Supported!==false;
      if(type.includes('hvc1'))return codecOptions.hvc1Supported!==false;
      return true;
    }
    addEventListener(type,fn){this.listeners.set(type,[...(this.listeners.get(type)||[]),fn]);}
    open(){for(const fn of this.listeners.get('sourceopen')||[])fn();}
    addSourceBuffer(){this.buffer=new BufferShim();return this.buffer;}
    endOfStream(){this.readyState='ended';}
  }
  const media={
    src:NATIVE,currentSrc:NATIVE,currentTime:0,paused:true,
    addEventListener(){},removeEventListener(){},
    load(){queueMicrotask(()=>lastSource?.open());},
    pause(){this.paused=true;},
    play(){plays++;this.paused=false;return Promise.resolve();}
  };
  const state={source:'native',nativeStreamUrl:NATIVE,role:'host'};
  const app={state,media,el:{fileInfo:{textContent:''}},
    notify(message){notifications.push(message)}};
  const window={MarmaladeAddonBridge:app,addEventListener(){},
    MarmaladeMkvIO:{fromNativeStream:({url,name})=>({
      kind:'native',url,name,length:1024,read:async()=>new ArrayBuffer(8)
    })}};
  const makeRemuxer=async({workerUrl})=>{
    attempts.push(workerUrl);
    if(attempts.length<=failures)throw new Error('Simulated WebView2 worker failure');
    return {
      init:async()=>({timestampOffset:0,
        data:codecOptions.initData||new Uint8Array([1]),
        info:{input:{duration:42},output:{videoMimeType:codecOptions.videoCodec||'avc1.42E01E',audioMimeType:'mp4a.40.2'}}}),
      read:async()=>({data:new Uint8Array([2]),finished:false}),
      seek:async()=>({data:new Uint8Array([2]),finished:false}),
      destroy:async()=>{}
    };
  };
  vm.runInNewContext(code,{window,document:{baseURI:'https://marmaladeum.com/'},
    URL:URLShim,MediaSource:MediaSourceShim,clearInterval(){},setInterval:()=>1,
    __fakeImport:async()=>({makeRemuxer}),console:{warn(){},error(){}}});
  return {window,app,attempts,notifications,get mediaSource(){return lastSource},get plays(){return plays}};
}

test('WebView2 MKV audio recovers from failed Asyncify worker using upstream worker',async()=>{
  const env=createRuntime(1);
  const ready=await env.window.MarmaladeMkvAudio.handleNative({
    url:NATIVE,name:'Supported.mkv',size:1024
  });
  assert.equal(ready,true);
  assert.equal(env.attempts.length,2);
  assert.match(env.attempts[0],/mkv-asyncify-worker\.js/);
  assert.match(env.attempts[1],/vendor\/libav-wasm\/worker\.js/);
  assert.equal(env.app.media.src,'blob:compat-mkv');
  assert.equal(env.plays,1);
  assert.match(env.app.el.fileInfo.textContent,/AAC/);
  assert.equal(env.window.MarmaladeMkvAudio.getDuration(),42);
  env.window.MarmaladeMkvAudio.cleanup();
});

test('Both worker failures report the actual errors and leave original video URL intact',async()=>{
  const env=createRuntime(2);
  const ready=await env.window.MarmaladeMkvAudio.handleNative({
    url:NATIVE,name:'Unsupported.mkv',size:1024
  });
  assert.equal(ready,false);
  assert.equal(env.attempts.length,2);
  assert.equal(env.app.media.src,NATIVE);
  assert.ok(env.notifications.some(x=>x.includes('Both MKV decoding engines failed')));
});

function hevcInit(){
  // One 120-byte HEVC sample-entry box with hvcC decoder configuration.
  const data=new Uint8Array(120);
  data[3]=120;data.set([104,101,118,49],4);
  data.set([104,118,99,67],90);
  return data;
}
test('HEVC uses supported hvc1 sample-entry variant when hev1 is rejected',async()=>{
  const env=createRuntime(0,{
    videoCodec:'hev1.2.4.L120.90',hev1Supported:false,hvc1Supported:true,
    initData:hevcInit()
  });
  assert.equal(await env.window.MarmaladeMkvAudio.handleNative({
    url:NATIVE,name:'HEVC.mkv',size:1024
  }),true);
  const appended=env.mediaSource.buffer.appends[0];
  assert.equal(String.fromCharCode(...appended.slice(4,8)),'hvc1');
  assert.equal(env.plays,1);
  env.window.MarmaladeMkvAudio.cleanup();
});
test('HEVC reports true device incompatibility instead of switching to dead MSE',async()=>{
  const env=createRuntime(0,{
    videoCodec:'hev1.2.4.L120.90',hev1Supported:false,hvc1Supported:false,
    initData:hevcInit()
  });
  assert.equal(await env.window.MarmaladeMkvAudio.handleNative({
    url:NATIVE,name:'HEVC.mkv',size:1024
  }),false);
  assert.equal(env.app.media.src,NATIVE);
  assert.ok(env.notifications.some(x=>x.includes('HEVC/H.265 video is unsupported')));
});
