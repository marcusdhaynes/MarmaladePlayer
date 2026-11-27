const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../sw.js'),'utf8');
function fixture(){
 const listeners=new Map(),deleted=[],scope='https://example.test/MarmaladePlayer/';
 const self={registration:{scope},addEventListener:(type,fn)=>listeners.set(type,fn),clients:{claim:async()=>{}},skipWaiting:async()=>{}};
 const caches={keys:async()=>['unrelated-app','marmalade-shell-v1','marmalade-shell-v75-audit','marmalade-shell-v76-search','marmalade-shell-v77-scenes','marmalade-shell-v78-frames','marmalade-shell-v79-audio-tracks','marmalade-shell-v80-audio-delay','marmalade-shell-v81-diagnostics','marmalade-shell-v82-timeline','marmalade-shell-v83-diagnostic-validation','marmalade-shell-v84-timeline-acceptance','marmalade-shell-v85-settings-backup','marmalade-shell-v86-settings-export'],delete:async key=>deleted.push(key)};
 const context={self,caches,URL,Response,Set,Promise};
 vm.createContext(context);vm.runInContext(source,context);
 return {scope,deleted,listeners,run:code=>vm.runInContext(code,context)};
}
test('activation removes only previous Marmaladeum caches',async()=>{
 const {listeners,deleted}=fixture();
 let completion;listeners.get('activate')({waitUntil:p=>completion=p});await completion;
 assert.deepEqual(deleted,['marmalade-shell-v1','marmalade-shell-v75-audit','marmalade-shell-v76-search','marmalade-shell-v77-scenes','marmalade-shell-v78-frames','marmalade-shell-v79-audio-tracks','marmalade-shell-v80-audio-delay','marmalade-shell-v81-diagnostics','marmalade-shell-v82-timeline','marmalade-shell-v83-diagnostic-validation','marmalade-shell-v84-timeline-acceptance','marmalade-shell-v85-settings-backup']);
});
test('HTML discovery uses exact asset versions and excludes other origins and video',()=>{
 const {run,scope}=fixture();
 const html='<script src="./rolling-buffer.js?v=new"></script><link href="./media-library.css?v=2"><script src="https://other.test/lib.js"></script><video src="./movie.mp4"></video><script src="../other.js"></script>';
 const discovered=Array.from(run('discover('+JSON.stringify(html)+')'));
 assert.ok(discovered.includes(scope+'rolling-buffer.js?v=new'));
 assert.ok(discovered.includes(scope+'media-library.css?v=2'));
 assert.ok(!discovered.some(u=>/other\.test|movie\.mp4|\/other\.js/.test(u)));
});
test('media, range, untrusted queries and decoder requests bypass service worker',()=>{
 const {listeners,scope}=fixture();
 for(const [url,headers,method] of [
  [scope+'movie.mp4',{},'GET'],[scope+'index.html',{range:'bytes=0-100'},'GET'],
  [scope+'vendor/libav-wasm/index.js',{},'GET'],[scope+'index.html?token=secret',{},'GET'],
  ['https://elsewhere.test/script.js',{},'GET'],[scope+'index.html',{},'POST']]){
   let handled=false;
   listeners.get('fetch')({request:{url,method,headers:{has:k=>k in headers}},respondWith:()=>handled=true});
   assert.equal(handled,false,url);
 }
});

test('upgrade and rollback isolate caches without touching other applications',async()=>{
 const old='a'.repeat(40),next='b'.repeat(40);
 const entries=new Set(['unrelated-app','marmalade-shell-'+old]);
 const cacheStore=new Map();
 const scope='https://example.test/MarmaladePlayer/';
 const worker=version=>{
  const listeners=new Map();
  const self={registration:{scope},addEventListener:(type,fn)=>listeners.set(type,fn),clients:{claim:async()=>{}},skipWaiting:async()=>{}};
  const caches={keys:async()=>[...entries],delete:async key=>{entries.delete(key);cacheStore.delete(key);},open:async key=>{
   entries.add(key);if(!cacheStore.has(key))cacheStore.set(key,new Map());
   const map=cacheStore.get(key);return {put:async(url,response)=>map.set(url,await response.text())};
  }};
  const context={self,caches,URL,Response,Set,Promise,fetch:async url=>new Response(url.includes('index.html')?'<script src="./runtime.js?v='+version+'"></script>':'runtime '+version)};
  vm.createContext(context);
  vm.runInContext(source.replace(/const CACHE = '[^']+';/,"const CACHE = 'marmalade-shell-"+version+"';"),context);
  return async event=>{let pending;listeners.get(event)({waitUntil:p=>pending=p});await pending;};
 };
 const upgrade=worker(next);
 await upgrade('install');
 assert(entries.has('marmalade-shell-'+old),'Old cache survives until activation');
 await upgrade('activate');
 assert.deepEqual([...entries].sort(),['marmalade-shell-'+next,'unrelated-app'].sort());
 assert.equal(cacheStore.get('marmalade-shell-'+next).get(scope+'runtime.js?v='+next),'runtime '+next);
 const rollback=worker(old);
 await rollback('install');await rollback('activate');
 assert.deepEqual([...entries].sort(),['marmalade-shell-'+old,'unrelated-app'].sort());
 assert.equal(cacheStore.get('marmalade-shell-'+old).get(scope+'runtime.js?v='+old),'runtime '+old);
});
