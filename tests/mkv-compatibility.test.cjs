'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {fromFile,fromNativeStream}=require('../mkv-decoder-io.js');
const root=path.resolve(__dirname,'..');
const key='a'.repeat(64);
const url='http://127.0.0.1:18761/video/13?key='+key;

test('File inputs produce bounded, seekable slices without loading full movie',async()=>{
  const bytes=Uint8Array.from({length:20},(_,i)=>i);
  const calls=[];
  const file={name:'Movie.mkv',size:20,
    slice(start,end){calls.push({start,end});return {
      arrayBuffer:async()=>bytes.slice(start,end).buffer
    };}
  };
  const source=fromFile(file);
  assert.equal(source.kind,'file');
  assert.deepEqual([...new Uint8Array(await source.read(6,5))],[6,7,8,9,10]);
  assert.deepEqual([...new Uint8Array(await source.read(19,20))],[19]);
  assert.equal((await source.read(20,100)).byteLength,0);
  assert.deepEqual(calls,[{start:6,end:11},{start:19,end:20}]);
});

test('Native Minternet source requests strict HTTP 206 ranges and validates Content-Range',async()=>{
  const calls=[];
  const source=fromNativeStream({url,name:'Movie.mkv',size:20,fetchImpl:async(request,opts)=>{
    calls.push({request,opts});
    const range=opts.headers.Range;
    assert.equal(range,'bytes=9-16');
    assert.equal(opts.mode,'cors');
    assert.equal(opts.credentials,'omit');
    return {
      status:206,
      headers:{get(name){return name==='Content-Range'?'bytes 9-16/20':null;}},
      arrayBuffer:async()=>new Uint8Array(8).fill(42).buffer
    };
  }});
  assert.equal(source.kind,'native');
  assert.equal(source.name,'Movie.mkv');
  const bytes=await source.read(9,8);
  assert.equal(bytes.byteLength,8);
  assert.equal(calls.length,1);
  assert.equal((await source.read(20,4096)).byteLength,0);
  assert.equal(calls.length,1);
});

test('Never accept web addresses, wrong ports, or missing native server capability keys',()=>{
  for(const input of [
    'https://example.com/movie.mkv',
    'http://127.0.0.1:18762/video/0?key='+key,
    'http://localhost:18761/video/0?key='+key,
    'http://127.0.0.1:18761/admin?key='+key,
    'http://127.0.0.1:18761/video/1?key=123'
  ])assert.throws(()=>fromNativeStream({url:input,size:200}));
});

test('Reject non-range responses, malformed ranges, or truncated video bytes',async()=>{
  const response=(status,range,bytes)=>({
    status,
    headers:{get:()=>range},
    arrayBuffer:async()=>new Uint8Array(bytes).buffer
  });
  for(const result of [
    response(200,'bytes 0-7/20',8),
    response(206,'bytes 1-8/20',8),
    response(206,'bytes 0-7/20',4)
  ]){
    const source=fromNativeStream({url,size:20,fetchImpl:async()=>result});
    await assert.rejects(source.read(0,8));
  }
  assert.throws(()=>fromNativeStream({url,size:Number.MAX_SAFE_INTEGER+1}));
});

test('Minternet stream and browser File must both be wired to the audio decoder',()=>{
  const player=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const script=fs.readFileSync(path.join(root,'auto-mkv-audio.js'),'utf8');
  const media=fs.readFileSync(path.join(root,'media-library.js'),'utf8');
  assert.match(player,/MarmaladeMkvAudio\.handleNative/);
  assert.match(player,/mkv-decoder-io\.js/);
  assert.ok(player.indexOf('mkv-decoder-io.js')<player.indexOf('auto-mkv-audio.js'));
  assert.match(script,/async function handleSource\(source, file=null\)/);
  assert.match(script,/async function handleNative/);
  assert.match(script,/compatibilityWorker/);
  assert.match(fs.readFileSync(path.join(root,'mkv-asyncify-worker.js'),'utf8'),/WebAssembly/);
  assert.match(script,/read:\s*source\.read/);
  assert.match(media,/chooseNativeStream/);
});
