import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const code=readFileSync(new URL('../updates.js',import.meta.url),'utf8');
const current='a'.repeat(40),next='b'.repeat(40);
function fixture(commit=current,nativeCommit='',shell='',ua=''){
 let requestCount=0,reloads=0,notice='',handler,respond,storage=new Map(),opened=[];
 const video={paused:true},state={broadcasting:false,connections:new Map()};
 const window={open:url=>opened.push(url),location:{reload:()=>reloads++},MarmaladeAddonBridge:{state,notify:msg=>notice=msg}};
 const document={readyState:'loading',baseURI:'https://example.test/',querySelector:selector=>{const value=selector.includes('native-build')?nativeCommit:selector.includes('native-shell')?shell:commit;return value?{content:value}:null;},getElementById:id=>id==='player'?video:null,addEventListener:(_,fn)=>handler=fn};
 const fetch=async(url)=>{requestCount++;return respond(String(url));};
 const localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)};
 const context={window,document,fetch,localStorage,URL,navigator:{userAgent:ua}};
 vm.runInNewContext(code,context);
 return {api:window.MuseUpdates,video,state,setResponse:fn=>respond=fn,counts:()=>({requestCount,reloads,notice,opened})};
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

const older='c'.repeat(40),latest='d'.repeat(40);
const release=(sha,label,ext,overrides={})=>{
 const short=sha.slice(0,12),tag='marmalade-backup-'+short,name='Marmaladeum-'+label+'-'+short+'.'+ext;
 return {tag_name:tag,target_commitish:sha,draft:false,assets:[{name,state:'uploaded',size:1234,
 browser_download_url:'https://github.com/marcusdhaynes/MarmaladePlayer/releases/download/'+tag+'/'+name,...overrides}]};
};
const reply=data=>({ok:true,json:async()=>data});
function feed(f,releases,status='ahead',history=[latest,next,current,older]){
 f.setResponse(url=>{
  if(url.includes('/commits?'))return reply(history.map(sha=>({sha})));
  if(url.includes('/releases?'))return reply(releases);
  if(url.includes('/compare/'))return reply({status,ahead_by:status==='ahead'?1:0,behind_by:status==='ahead'?0:1});
  throw Error('Unexpected request '+url);
 });
}
test('native feed finds newest completed matching package by commit order, ignores web-only and old releases',async()=>{
 const f=fixture('',current,'desktop','Windows NT 10.0');
 feed(f,[release(older,'Windows','exe'),release(latest,'Linux','AppImage'),release(next,'Windows','exe')]);
 const info=await f.api.checkForUpdate();
 assert.equal(info.tag,next);assert.equal(info.native,true);assert.equal(info.preview,false);
 assert.match(info.downloadUrl,/Windows-b{12}\.exe$/);
 f.video.paused=false;f.api.applyUpdate(info);assert.equal(f.counts().opened.length,0);
 f.video.paused=true;f.api.applyUpdate(info);assert.equal(f.counts().opened.length,1);assert.equal(f.counts().reloads,0);
});
test('native feed rejects spoofed URLs, unfinished assets and divergent candidates',async()=>{
 const f=fixture('',current,'desktop','Linux x86_64');
 feed(f,[release(latest,'Linux','AppImage',{browser_download_url:'https://evil.test/file'}),release(next,'Linux','AppImage',{state:'new'})]);
 assert.equal(await f.api.checkForUpdate(),null);
 feed(f,[release(next,'Linux','AppImage')],'diverged');assert.equal(await f.api.checkForUpdate(),null);
});
test('Android offers only explicitly labelled preview APK and iOS never offers simulator ZIP',async()=>{
 const f=fixture('',current,'mobile','Android');
 feed(f,[release(latest,'iOS-Simulator','zip'),release(next,'Android','apk')]);
 const info=await f.api.checkForUpdate();assert.equal(info.preview,true);assert.match(info.notes,/debug preview/);
 const ios=fixture('',current,'mobile','iPhone');await assert.rejects(ios.api.checkForUpdate(),/No iOS device installer feed/);
 assert.equal(ios.counts().requestCount,0);
});
test('old installed commits require proven ancestry; missing history never reports current',async()=>{
 const f=fixture('',older,'desktop','Macintosh');
 feed(f,[release(next,'macOS','dmg')],'ahead',[latest,next]);assert.equal((await f.api.checkForUpdate()).tag,next);
 feed(f,[],'ahead',[latest,next]);await assert.rejects(f.api.checkForUpdate(),/outside recent release history/);
});
