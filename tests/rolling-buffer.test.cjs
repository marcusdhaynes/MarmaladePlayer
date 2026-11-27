const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../rolling-buffer.js'),'utf8');
const {ahead,goal,playable,validRange,openDiskCache,TARGET}=require('../rolling-buffer.js');
function ranges(pairs){return {length:pairs.length,start:i=>pairs[i][0],end:i=>pairs[i][1]};}
test('rolling target is three minutes with five seconds of refill headroom',()=>{
 assert.equal(TARGET,180);
 assert.equal(goal(10,1000),185);
 assert.equal(goal(975,1000),25);
 assert.equal(goal(1000,1000),0);
});
test('buffer counts only the contiguous playable range at the current time',()=>{
 const r=ranges([[0,40],[100,285],[290,400]]);
 assert.equal(ahead(r,100),185);
 assert.equal(ahead(r,110),175);
 assert.equal(ahead(r,30),10);
 assert.equal(ahead(r,80),0);
 assert.equal(ahead(r,287),0);
 assert.equal(ahead(r,295),105);
});
test('range validation rejects oversized or invalid reads',()=>{
 assert.equal(validRange(0,1048576,5000000),true);
 assert.equal(validRange(4999999,1,5000000),true);
 for(const [a,b,c] of [[-1,5,20],[0,0,20],[0,1048577,5000000],[20,1,20],[19,2,20],[.2,1,20],[0,NaN,20],[0,Infinity,20]])assert.equal(validRange(a,b,c),false);
});
function hostFixture(){
 const raw=Uint8Array.from({length:66000},(_,i)=>i%251);
 const file={name:'test.mp4',size:raw.length,slice(a,b){return {arrayBuffer:async()=>raw.slice(a,b).buffer};}};
 const state={role:'host',source:'file',broadcasting:true,fileReady:true,file,connections:new Map([['guest',{conn:{open:true}}]])};
 const root={MarmaladeAddonBridge:{state},addEventListener(){}};
 const doc={addEventListener(){}};
 vm.runInNewContext(source,{window:root,document:doc,crypto:{randomUUID:()=> 'fixture-token'},Uint8Array,ArrayBuffer,Map,Set,WeakMap,Date,Math,Number,Promise,setTimeout,clearTimeout,setInterval,clearInterval,console});
 function channel(peer,id,label='marmalade-buffer-v1'){
  const listeners=new Map(),sent=[];
  return {peer,label,metadata:{id},open:true,sent,dataChannel:{bufferedAmount:0},bufferSize:0,on(t,fn){listeners.set(t,fn);},send(m){sent.push(m);},close(){this.open=false;listeners.get('close')?.();},async data(m){await listeners.get('data')?.(m);}};
 }
 return {api:root.MarmaladeRollingBuffer,state,raw,channel};
}
test('authorized host serves only requested bytes in bounded ordered chunks',async()=>{
 const {api,raw,channel}=hostFixture(),offer=api.offer();
 const c=channel('guest',offer.id);assert.equal(api.hostChannel(c),true);
 await c.data({type:'read',id:1,offset:123,length:50000});
 assert.equal(c.sent.at(-1).type,'done');
 const result=[];let pos=0;
 for(const m of c.sent.slice(0,-1)){assert.equal(m.type,'part');assert.equal(m.offset,pos);assert.ok(m.bytes.length<=16384);pos+=m.bytes.length;result.push(...m.bytes);}
 assert.deepEqual(result,Array.from(raw.slice(123,50123)));
});
test('unauthorized, stale, out-of-bounds, and post-stop requests are rejected',async()=>{
 const {api,state,channel}=hostFixture(),offer=api.offer();
 const unknown=channel('stranger',offer.id);api.hostChannel(unknown);assert.equal(unknown.open,false);
 const stale=channel('guest','wrong-token');api.hostChannel(stale);assert.equal(stale.open,false);
 const c=channel('guest',offer.id);api.hostChannel(c);
 await c.data({type:'read',id:1,offset:66000,length:1});assert.equal(c.sent.length,0);
 state.broadcasting=false;
 await c.data({type:'read',id:2,offset:0,length:8});assert.equal(c.open,false);assert.equal(c.sent.length,0);assert.equal(api.offer(),null);
});
test('bulk connections never replace the room control connection',()=>{
 const {api,channel}=hostFixture(),c=channel('guest','anything','ordinary');
 assert.equal(api.hostChannel(c),false);assert.equal(c.open,true);
});

test('buffered stream readiness requires three contiguous seconds except at end of media',()=>{
 const r=ranges([[0,.2],[1,10],[90,100]]);
 assert.equal(playable(r,0,100),false);
 assert.equal(playable(r,1,100),true);
 assert.equal(playable(r,8,100),false);
 assert.equal(playable(r,98,100),true);
 assert.equal(playable(r,99,100),true);
 assert.equal(playable(r,10.5,100),false);
});
test('host can revoke original-file transfer without ending room',async()=>{
 const {api,state,channel}=hostFixture(),offer=api.offer();
 const c=channel('guest',offer.id);api.hostChannel(c);
 state.allowOriginalBuffer=false;
 assert.equal(api.offer(),null);
 await c.data({type:'read',id:1,offset:0,length:8});
 assert.equal(c.open,false);assert.equal(c.sent.length,0);
 state.allowOriginalBuffer=true;assert.ok(api.offer());
});
test('repeated invalid or replayed read requests close only the bulk channel',async()=>{
 const {api,state,channel}=hostFixture(),offer=api.offer();
 const c=channel('guest',offer.id);api.hostChannel(c);
 await c.data({type:'read',id:1,offset:0,length:8});
 const count=c.sent.length;
 for(let n=0;n<8;n++)await c.data({type:'read',id:1,offset:0,length:8});
 assert.equal(c.open,false);assert.equal(c.sent.length,count);
 assert.equal(state.connections.get('guest').conn.open,true);
});

test('temporary range cache encrypts bytes, enforces LRU bounds and deletes on close',async()=>{
 const {webcrypto}=require('node:crypto');
 const stores=new Map();
 const caches={
   keys:async()=>[...stores.keys()],
   open:async name=>{
     const entries=new Map();stores.set(name,entries);
     return {match:async k=>entries.get(k)?.clone(),put:async(k,v)=>entries.set(k,v.clone()),delete:async k=>entries.delete(k)};
   },
   delete:async name=>stores.delete(name)
 };
 const env={caches,crypto:webcrypto,Response,URL,location:{origin:'https://example.test'}};
 const disk=await openDiskCache(env,8);
 assert.ok(disk);
 const original=Uint8Array.from([1,2,3,4]);
 assert.equal(await disk.put(0,original),true);
 const raw=new Uint8Array(await [...[...stores.values()][0].values()][0].clone().arrayBuffer());
 assert.equal(raw.length,32); // nonce + data + authentication tag
 assert.notDeepEqual(raw.subarray(12,16),original);
 assert.deepEqual(await disk.get(0),original);
 await disk.put(4,Uint8Array.from([5,6,7,8]));
 await disk.get(0);
 await disk.put(8,Uint8Array.from([9,10,11,12]));
 assert.equal(disk.size,8);
 assert.equal(await disk.get(4),null);
 assert.deepEqual(await disk.get(0),original);
 assert.equal(await disk.put(12,new Uint8Array(9)),false);
 await disk.close();
 assert.equal(stores.size,0);
 assert.equal(disk.size,0);
 assert.equal(await disk.get(0),null);
 assert.equal(await disk.put(0,original),false);
});
test('optional disk cache degrades cleanly when unavailable',async()=>{
 assert.equal(await openDiskCache({}),null);
});
