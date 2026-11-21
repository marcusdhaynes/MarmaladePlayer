import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';

const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const source=readFileSync(resolve(root,'extension/content.js'),'utf8');
const origin='https://marmaladeum.com';
const state={catalogSnapshot:[{id:'ext01',name:'Extension Movies',items:[]}]};

function session(promiseStyle=false){
  const listeners=new Map(),posted=[];
  const window={
    addEventListener(type,fn){listeners.set(type,fn);},
    postMessage(data){posted.push(data);}
  };
  const document={documentElement:{dataset:{}},addEventListener(){}};
  const storage={
    local:{
      get(keys,callback){
        const result=Object.fromEntries(keys.map(key=>[key,state[key]]));
        if(promiseStyle)return Promise.resolve(result);
        callback(result);
      },
      set(data,callback){
        Object.assign(state,data);
        if(promiseStyle)return Promise.resolve();
        callback?.();
      }
    }
  };
  const runtime={
    sendMessage(message,callback){
      const value={ok:true,version:'0.2.0'};
      if(promiseStyle)return Promise.resolve(value);
      callback(value);
    },
    lastError:null
  };
  const api={storage,runtime};
  const globals={window,document,location:{origin},
    ...(promiseStyle?{browser:api}:{chrome:api}),console,Date,Promise,
    setTimeout,clearTimeout};
  runInNewContext(source,globals,{filename:'extension/content.js'});
  const send=data=>listeners.get('message')({
    source:window,origin,data:{source:'marmalade-web',...data}
  });
  return {send,posted,document};
}
const sleep=()=>new Promise(resolve=>setTimeout(resolve,0));
for(const promiseStyle of [false,true]){
  const client=session(promiseStyle);
  assert.equal(client.document.documentElement.dataset.marmaladeExtension,'installed');
  for(let pass=1;pass<=10;pass++){
    client.send({type:'backup-site-catalog',revision:pass,
      libraries:[{
        id:'local-1',name:'My Movies',kind:'movie',
        folders:[{id:'folder-1',name:'Films',handle:{secret:'NEVER'}}],
        items:[{id:'video-1',folderId:'folder-1',name:'Film.mp4',
          path:'Film.mp4',title:'Film',size:99,handle:{secret:'NEVER'},favorite:true}]
      },{
        id:'addon:do-not-back-up',name:'Legacy Native',folders:[],items:[]
      }]});
    await sleep();
    assert.equal(state.siteCatalog.revision,pass);
    assert.equal(state.siteCatalog.libraries.length,1);
    assert.equal(state.siteCatalog.libraries[0].items.length,1);
    assert.equal(state.siteCatalog.libraries[0].folders[0].handle,undefined);
    assert.equal(state.siteCatalog.libraries[0].items[0].handle,undefined);
  }
  // Simulate a website cache clear and new tab with the extension profile
  // still installed. The catalog must be restored from extension storage.
  const fresh=session(promiseStyle);
  fresh.send({type:'get-catalog'});
  await sleep();
  const reply=fresh.posted.find(item=>item.type==='catalog');
  assert(reply,'Backup retrieval must respond to new website session');
  assert.equal(reply.siteLibraries.length,1);
  assert.equal(reply.siteLibraries[0].items[0].title,'Film');
  assert.equal(reply.libraries[0].id,'ext01');
  fresh.send({type:'ping'});await sleep();
  assert(fresh.posted.some(x=>x.type==='pong'),'Extension should respond to ping');
}
console.log('PASS 10x browser callback and Promise extension backup/restore, sanitized metadata, restart recovery');
