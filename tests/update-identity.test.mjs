import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const code=readFileSync(new URL('../updates.js',import.meta.url),'utf8');
const current='a'.repeat(40),next='b'.repeat(40);
function fixture(commit=current,nativeCommit=''){
 let requestCount=0,reloads=0,notice='',handler,respond,storage=new Map();
 const video={paused:true},state={broadcasting:false,connections:new Map()};
 const window={location:{reload:()=>reloads++},MarmaladeAddonBridge:{state,notify:msg=>notice=msg}};
 const document={readyState:'loading',baseURI:'https://example.test/',querySelector:selector=>{const value=selector.includes('native-build')?nativeCommit:commit;return value?{content:value}:null;},getElementById:id=>id==='player'?video:null,addEventListener:(_,fn)=>handler=fn};
 const fetch=async()=>{requestCount++;return respond();};
 const localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)};
 const context={window,document,fetch,localStorage,URL};
 vm.runInNewContext(code,context);
 return {api:window.MuseUpdates,video,state,setResponse:fn=>respond=fn,counts:()=>({requestCount,reloads,notice})};
}
const manifest=commit=>({ok:true,json:async()=>({commit,files:{'index.html':'c'.repeat(64)}})});
test('running web identity compares with deployed identity, not semantic versions',async()=>{
 const f=fixture();f.setResponse(()=>manifest(current));assert.equal(await f.api.checkForUpdate(),null);
 f.setResponse(()=>manifest(next));const info=await f.api.checkForUpdate();
 assert.equal(info.tag,next);assert.equal(info.web,true);
 f.api.applyUpdate(info);assert.equal(f.counts().reloads,1);
 f.video.paused=false;f.api.applyUpdate(info);assert.equal(f.counts().reloads,1);assert.match(f.counts().notice,/Pause playback/);
 f.video.paused=true;f.state.connections.set('guest',{});f.api.applyUpdate(info);assert.equal(f.counts().reloads,1);
});
test('failed and malformed deployments never claim that the build is current',async()=>{
 const f=fixture();f.setResponse(()=>({ok:false}));await assert.rejects(f.api.checkForUpdate(),/Deployment check failed/);
 f.setResponse(()=>({ok:true,json:async()=>({commit:next,files:{'index.html':'bad'}})}));await assert.rejects(f.api.checkForUpdate(),/Invalid deployment manifest/);
 f.setResponse(()=>manifest(current));assert.equal(await f.api.checkForUpdate(),null);
});
test('concurrent update requests share one network operation',async()=>{
 const f=fixture();let finish;f.setResponse(()=>new Promise(r=>finish=r));
 const first=f.api.checkForUpdate(),second=f.api.checkForUpdate();assert.equal(first,second);assert.equal(f.counts().requestCount,1);
 finish(manifest(next));assert.equal((await first).tag,next);
});
test('unstamped builds reject non-versioned backup tags and HTTP errors',async()=>{
 const f=fixture('');f.setResponse(()=>({ok:true,json:async()=>({tag_name:'marmalade-backup-1234'})}));await assert.rejects(f.api.checkForUpdate(),/No comparable release version/);
 f.setResponse(()=>({ok:false}));await assert.rejects(f.api.checkForUpdate(),/Release check failed/);
 f.setResponse(()=>({ok:true,json:async()=>({tag_name:'v0.1.0'})}));assert.equal(await f.api.checkForUpdate(),null);
});

test('commit-pinned native packages do not misreport a web or semantic release as their installer update',async()=>{
 const f=fixture('',current);
 await assert.rejects(f.api.checkForUpdate(),/Native installer update feed unavailable/);
 assert.equal(f.counts().requestCount,0);
});
