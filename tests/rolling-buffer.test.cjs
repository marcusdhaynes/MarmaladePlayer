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

test('a seek during a decoder read or append invalidates cursors from other retained windows',()=>{
 const {changedWindow}=require('../rolling-buffer.js');
 const retained=ranges([[0,45],[100,285],[450,650]]);
 for(const [from,to] of [[120,20],[15,480],[121,87],[87,115],[87,94]])
   assert.equal(changedWindow(retained,from,to),true);
 for(const [from,to] of [[120,150],[280,112],[90,91]])
   assert.equal(changedWindow(retained,from,to),false);
});

test('diagnostics report an attainable target in the final minutes',()=>{
 const {bufferStatus}=require('../rolling-buffer.js');
 const s={duration:300,capacity:90,ready:true,buffer:{buffered:ranges([[250,300]])}};
 assert.equal(bufferStatus(s,20).target,180);
 assert.equal(bufferStatus(s,20).quotaLimited,true);
 assert.equal(bufferStatus(s,260).target,40);
 assert.equal(bufferStatus(s,260).seconds,40);
 assert.equal(bufferStatus(s,260).quotaLimited,false);
 assert.equal(bufferStatus(s,301).target,0);
});

test('shared host transfer scheduler bounds aggregate payload bursts and serves queued guests in order',async()=>{
 const {createTransferScheduler}=require('../rolling-buffer.js');
 let clock=0;const sent=[],sleeps=[];
 const schedule=createTransferScheduler({rate:16384*100,burst:16384,now:()=>clock,sleep:async ms=>{sleeps.push(ms);clock+=ms;}});
 const submit=id=>schedule(16384,()=>true,()=>sent.push([id,clock]));
 await Promise.all([submit('A1'),submit('B1'),submit('C1'),submit('A2')]);
 assert.deepEqual(sent,[['A1',0],['B1',10],['C1',20],['A2',30]]);
 assert.deepEqual(sleeps,[10,10,10]);
});
test('host transfer scheduler rejects overload, charges small requests, and skips revoked guests',async()=>{
 const {createTransferScheduler}=require('../rolling-buffer.js');
 let clock=0,release,revoked=false;const sent=[];
 const schedule=createTransferScheduler({rate:16384*100,burst:16384,maxPending:2,now:()=>clock,sleep:ms=>new Promise(resolve=>{release=()=>{clock+=ms;resolve();};})});
 await schedule(1,()=>true,()=>sent.push('first'));
 const blocked=schedule(1,()=>!revoked,()=>sent.push('revoked'));
 const next=schedule(1,()=>true,()=>sent.push('next'));
 await assert.rejects(schedule(1,()=>true,()=>{}),/budget/);
 revoked=true;release();
 assert.equal(await blocked,false);
 assert.equal(await next,true);
 assert.deepEqual(sent,['first','next']);
 await assert.rejects(schedule(16385,()=>true,()=>{}),/budget/);
});
test('simultaneous authorized guests receive intact independent ranges',async()=>{
 const {api,state,raw,channel}=hostFixture(),offer=api.offer();
 state.connections.set('guest2',{conn:{open:true}});
 const a=channel('guest',offer.id),b=channel('guest2',offer.id);
 api.hostChannel(a);api.hostChannel(b);
 await Promise.all([a.data({type:'read',id:1,offset:100,length:50000}),b.data({type:'read',id:1,offset:200,length:50000})]);
 for(const [c,offset] of [[a,100],[b,200]]){
   assert.equal(c.sent.at(-1).type,'done');
   assert.deepEqual(c.sent.filter(m=>m.type==='part').flatMap(m=>Array.from(m.bytes)),Array.from(raw.slice(offset,offset+50000)));
 }
});
test('host bounds simultaneous bulk guests without closing their control connection',()=>{
 const {api,state,channel}=hostFixture(),offer=api.offer();
 for(let i=0;i<33;i++){
   const peer='viewer'+i;state.connections.set(peer,{conn:{open:true}});
   const c=channel(peer,offer.id);api.hostChannel(c);
   assert.equal(c.open,i<32);assert.equal(state.connections.get(peer).conn.open,true);
 }
});

test('range deadline follows validated progress but never exceeds the hard cap',()=>{
 const {rangeDeadline}=require('../rolling-buffer.js');
 assert.equal(rangeDeadline(1000,1000),31000);
 assert.equal(rangeDeadline(1000,25000),55000);
 assert.equal(rangeDeadline(1000,100000),121000);
 assert.equal(rangeDeadline(1000,121000),121000);
});
test('a stalled open transport is recoverable, but invalid data on a healthy channel is not',()=>{
 const {rangeTimeoutError,recoverableRangeFailure}=require('../rolling-buffer.js');
 const channel={open:true},other={open:true};
 assert.equal(recoverableRangeFailure(rangeTimeoutError(),channel,channel,false),true);
 assert.equal(recoverableRangeFailure(Error('Invalid movie range'),channel,channel,false),false);
 assert.equal(recoverableRangeFailure(Error('Disconnected'),channel,other,false),true);
 assert.equal(recoverableRangeFailure(Error('Disconnected'),{open:false},channel,false),true);
 assert.equal(recoverableRangeFailure(Error('Disconnected'),channel,channel,true),true);
});

test('superseded control connections cannot authorize old bulk channels',async()=>{
 const {api,state,channel}=hostFixture(),offer=api.offer();
 const old=channel('guest',offer.id);api.hostChannel(old);
 const prior=state.connections.get('guest');
 state.connections.set('guest',{conn:{open:true}});
 assert.equal(prior.conn.open,true);
 await old.data({type:'read',id:1,offset:0,length:8});
 assert.equal(old.open,false);
 assert.equal(old.sent.length,0);
 const fresh=channel('guest',offer.id);api.hostChannel(fresh);
 await fresh.data({type:'read',id:1,offset:0,length:8});
 assert.equal(fresh.sent.at(-1).type,'done');
});

test('per-guest adaptive queue windows back off under congestion and recover gradually',()=>{
 const {createTransferWindow}=require('../rolling-buffer.js');
 const a=createTransferWindow(),b=createTransferWindow();
 assert.equal(a.limit,256*1024);
 assert.equal(a.observe(500),192*1024);
 assert.equal(b.limit,256*1024,'A congested guest must not change another guest window');
 for(let i=0;i<20;i++)a.observe(500);
 assert.equal(a.limit,128*1024);
 for(let i=0;i<15;i++)a.observe(0);
 assert.equal(a.limit,128*1024);
 a.observe(0);assert.equal(a.limit,144*1024);
 for(let i=0;i<1000;i++)a.observe(0);
 assert.equal(a.limit,512*1024);
});
test('queue watchdog tolerates progress beyond idle timeout but bounds indefinite drain',async()=>{
 const {createTransferWindow,waitTransferCapacity}=require('../rolling-buffer.js');
 const conn={dataChannel:{bufferedAmount:600000},bufferSize:0};
 let clock=0;
 const w=createTransferWindow();
 const opts={now:()=>clock,idleMs:20,maxMs:100,sleep:async ms=>{clock+=ms;conn.dataChannel.bufferedAmount-=60000;}};
 assert.equal(await waitTransferCapacity(conn,w,()=>true,opts),true);
 assert(clock>20,'Slow progress must outlive the idle threshold');
 assert(clock<100);
 clock=0;conn.dataChannel.bufferedAmount=600000;
 await assert.rejects(waitTransferCapacity(conn,w,()=>true,{...opts,sleep:async ms=>{clock+=ms;conn.dataChannel.bufferedAmount--;}}),{code:'TRANSFER_CONGESTION'});
 assert(clock>=100);
});
test('queue watchdog fails a stalled channel and stops promptly after permission revocation',async()=>{
 const {createTransferWindow,waitTransferCapacity}=require('../rolling-buffer.js');
 const conn={dataChannel:{bufferedAmount:600000},bufferSize:0},w=createTransferWindow();
 let clock=0;
 const opts={now:()=>clock,idleMs:20,maxMs:100,sleep:async ms=>{clock+=ms;}};
 await assert.rejects(waitTransferCapacity(conn,w,()=>true,opts),{code:'TRANSFER_CONGESTION'});
 assert(clock>=20&&clock<100);
 clock=0;
 assert.equal(await waitTransferCapacity(conn,w,()=>clock<12,opts),false);
 assert.equal(clock,12);
});

test('interrupted range resumes from validated prefix rather than redownloading it',async()=>{
 const {resumeRange,interruptedRange}=require('../rolling-buffer.js');
 const calls=[];let restores=0;
 const bytes=new Uint8Array([10,11,12,13,14,15,16,17]);
 const result=await resumeRange(100,8,async(offset,length)=>{
   calls.push([offset,length]);
   if(calls.length===1)throw interruptedRange(Error('connection'),{bytes,received:3});
   return bytes.slice(offset-100,offset-100+length).buffer;
 },()=>true,async()=>{restores++;});
 assert.deepEqual(calls,[[100,8],[103,5]]);assert.equal(restores,1);assert.deepEqual(new Uint8Array(result),bytes);
});
test('range retry never accepts invalid data or loops indefinitely',async()=>{
 const {resumeRange,interruptedRange}=require('../rolling-buffer.js');
 let attempts=0;
 await assert.rejects(resumeRange(0,8,async()=>{attempts++;throw Error('Invalid range');},()=>false,async()=>{}),/Invalid range/);
 assert.equal(attempts,1);attempts=0;
 await assert.rejects(resumeRange(0,8,async()=>{attempts++;throw interruptedRange(Error('stall'),{bytes:new Uint8Array(8),received:0});},()=>true,async()=>{}),/stall/);
 assert.equal(attempts,3);
 assert.equal(interruptedRange(Error('missing done'),{bytes:new Uint8Array(8),received:8}).prefix.length,7);
});
test('transfer telemetry reports active progress and expires idle throughput',()=>{
 const {transferHealth}=require('../rolling-buffer.js');
 const s={requests:new Map([[1,{}]]),lastTransferAt:1000,receivedBytes:4096,rangeRetries:2,goodputBps:500000};
 assert.deepEqual(transferHealth(s,2500),{receivedBytes:4096,rangeRetries:2,pendingRanges:1,transferIdleMs:1500,goodputBps:500000});
 s.requests.clear();assert.equal(transferHealth(s,7000).goodputBps,null);assert.equal(transferHealth(s,7000).transferIdleMs,0);
});

test('parallel host lanes require an authorized primary and remain globally bounded',async()=>{
 const {api,state,channel}=hostFixture(),offer=api.offer();
 const aux=channel('guest',offer.id);aux.metadata.lane=1;api.hostChannel(aux);assert.equal(aux.open,false);
 const primary=channel('guest',offer.id);api.hostChannel(primary);
 const lanes=[1,2].map(lane=>{const c=channel('guest',offer.id);c.metadata.lane=lane;api.hostChannel(c);return c;});
 const invalid=channel('guest',offer.id);invalid.metadata.lane=3;api.hostChannel(invalid);assert.equal(invalid.open,false);
 await Promise.all([primary,...lanes].map((c,i)=>c.data({type:'read',id:1,offset:i*100,length:100})));
 for(const c of [primary,...lanes])assert.equal(c.sent.at(-1).type,'done');
 primary.close();for(const c of lanes)assert.equal(c.open,false);
 assert.equal(state.connections.get('guest').conn.open,true);
});
test('parallel range requests reconstruct exact bytes and retry only failed slices',async()=>{
 const {splitRange,readParallel}=require('../rolling-buffer.js');
 const raw=Uint8Array.from({length:700000},(_,i)=>i%251),parts=splitRange(7,600000,3),calls=[],retries=[];
 assert.equal(parts.length,3);assert.equal(parts.reduce((sum,p)=>sum+p.length,0),600000);
 const result=await readParallel(7,600000,['a','b','c'],async(at,len,lane)=>{
   calls.push([at,len,lane]);if(lane==='b')throw Error('interrupted');
   return raw.slice(at,at+len).buffer;
 },async(p,error,lane)=>{retries.push(lane);return raw.slice(p.offset,p.offset+p.length).buffer;});
 assert.deepEqual(new Uint8Array(result),raw.slice(7,600007));
 assert.equal(calls.length,3);assert.deepEqual(retries,['b']);
});
