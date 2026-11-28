/* Rolling seekable movie buffer. No upload or transcoding of video on the host.
 * A dedicated reliable PeerJS channel carries bounded ranges of the currently
 * shared movie only. The guest's existing libav worker remuxes on demand into MSE.
 */
(function(root){
 'use strict';
 const TARGET=180,LOW=3,BLOCK=1024*1024,PART=16*1024,CACHE_LIMIT=24*BLOCK,QUOTA_RETRY_MS=30000;
 const LABEL='marmalade-buffer-v1';
 const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const bridge=()=>root.MarmaladeAddonBridge;
 const keys=new WeakMap(),hostChannels=new Set();
 let session=null,failedKey='',retryAt=0;
 function ahead(ranges,time){
   for(let i=0;i<(ranges?.length||0);i++)
     if(ranges.start(i)<=time+.08&&ranges.end(i)>time)return ranges.end(i)-time;
   return 0;
 }
 // A host seek can land in an older retained range while a newer segment is
 // in flight. Only reuse the decoder cursor within the same contiguous range.
 function changedWindow(ranges,from,to){
   if(Math.abs(to-from)<=2)return false;
   const end=ahead(ranges,from);
   return !end||!ahead(ranges,to)||Math.abs(from+end-to-ahead(ranges,to))>.08;
 }
 function goal(time,duration){return Math.max(0,Math.min(TARGET+5,duration-time));}
 function playable(ranges,time,duration){return ahead(ranges,time)>=Math.min(LOW,goal(time,duration))-.05;}
 function validRange(offset,length,total){
   return Number.isSafeInteger(offset)&&Number.isSafeInteger(length)&&offset>=0&&length>0&&length<=BLOCK&&offset<total&&length<=total-offset;
 }
 // A second-tier, encrypted temporary range cache. The key is only in RAM:
 // browser crashes cannot leave readable movie data behind. Storage is optional
 // and bounded; MSE playable-buffer quota remains a separate browser limit.
 async function openDiskCache(env,limit=128*BLOCK){
   if(!env?.caches||!env.crypto?.subtle||!env.crypto.randomUUID||!env.Response||!env.URL||!env.location)return null;
   const prefix='marmalade-range-v1-',name=prefix+Date.now()+'-'+env.crypto.randomUUID();
   let cache,key;
   try{
     key=await env.crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
     // Remove abandoned encrypted caches only; do not touch other app caches.
     const stale=Date.now()-24*60*60*1000;
     for(const n of await env.caches.keys()){
       if(n.startsWith(prefix)&&Number(n.slice(prefix.length).split('-')[0])<stale)
         await env.caches.delete(n).catch(()=>{});
     }
     cache=await env.caches.open(name);
   }catch{return null;}
   const entries=new Map();let bytes=0,closed=false,tail=Promise.resolve();
   const url=offset=>new env.URL('/__marmalade_temporary_range__/'+offset,env.location.origin).href;
   const queue=fn=>{const next=tail.then(fn);tail=next.catch(()=>{});return next;};
   return {
     get size(){return bytes;},
     get:offset=>queue(async()=>{
       if(closed||!entries.has(offset))return null;
       try{
         const res=await cache.match(url(offset));if(!res)throw Error('Cache entry evicted');
         const data=new Uint8Array(await res.arrayBuffer());
         const clear=await env.crypto.subtle.decrypt({name:'AES-GCM',iv:data.subarray(0,12)},key,data.subarray(12));
         const result=new Uint8Array(clear);
         if(result.length!==entries.get(offset))throw Error('Invalid cached range');
         entries.delete(offset);entries.set(offset,result.length);return result;
       }catch{
         bytes-=entries.get(offset)||0;entries.delete(offset);
         await cache.delete(url(offset)).catch(()=>{});return null;
       }
     }),
     put:(offset,data)=>queue(async()=>{
       if(closed||entries.has(offset)||data.byteLength>limit)return false;
       try{
         while(entries.size&&bytes+data.byteLength>limit){
           const k=entries.keys().next().value;
           await cache.delete(url(k));bytes-=entries.get(k);entries.delete(k);
         }
         const iv=env.crypto.getRandomValues(new Uint8Array(12));
         const cipher=new Uint8Array(await env.crypto.subtle.encrypt({name:'AES-GCM',iv},key,data));
         if(closed)return false;
         const packed=new Uint8Array(iv.length+cipher.length);packed.set(iv);packed.set(cipher,iv.length);
         await cache.put(url(offset),new env.Response(packed));
         entries.set(offset,data.byteLength);bytes+=data.byteLength;return true;
       }catch{return false;}
     }),
     close:()=>{closed=true;return queue(async()=>{entries.clear();bytes=0;key=null;await env.caches.delete(name).catch(()=>{});});}
   };
 }
 // Shared FIFO chunk admission: each busy guest queues at most one chunk.
 // A congested connection waits outside this scheduler, so other guests continue.
 // Charge short chunks as a full part to bound tiny-request abuse too.
 function createTransferScheduler({rate=32*BLOCK,burst=256*1024,maxPending=64,now=Date.now,sleep=delay}={}){
   let tokens=burst,last=now(),running=false;
   const queue=[];
   async function drain(){
     if(running)return;
     running=true;
     try{
       while(queue.length){
         const job=queue[0];
         if(!job.allowed()){queue.shift();job.resolve(false);continue;}
         const time=now(),elapsed=Math.max(0,time-last);
         last=Math.max(last,time);
         tokens=Math.min(burst,tokens+elapsed*rate/1000);
         if(tokens<job.cost){
           await sleep(Math.max(1,Math.ceil((job.cost-tokens)*1000/rate)));
           continue;
         }
         queue.shift();tokens-=job.cost;
         try{job.send();job.resolve(true);}catch(e){job.reject(e);}
       }
     }catch(e){for(const job of queue.splice(0))job.reject(e);}
     finally{running=false;}
   }
   return (bytes,allowed,send)=>{
     const cost=Math.max(PART,bytes);
     if(!Number.isSafeInteger(bytes)||bytes<=0||bytes>PART||cost>burst||queue.length>=maxPending)
       return Promise.reject(Error('Host transfer budget unavailable'));
     return new Promise((resolve,reject)=>{queue.push({cost,allowed,send,resolve,reject});void drain();});
   };
 }
 const scheduleHostPart=createTransferScheduler();
 const MAX_BULK_GUESTS=32;
 function hostSource(state){
   if(state?.source==='file'&&state.file?.size)return state.file;
   if(state?.source==='native'&&state.nativeBufferSource?.length)return state.nativeBufferSource;
   return null;
 }
 function offer(){
   const a=bridge(),s=a?.state,file=hostSource(s);
   if(!s||s.role!=='host'||!s.broadcasting||!s.fileReady||!file||s.allowOriginalBuffer===false)return null;
   if(!keys.has(file))keys.set(file,crypto.randomUUID?.()||Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join(''));
   return {id:keys.get(file),size:file.size||file.length,name:file.name};
 }
 function validOffer(o){return o&&typeof o.id==='string'&&o.id.length<=100&&typeof o.name==='string'&&o.name.length<=512&&Number.isSafeInteger(o.size)&&o.size>0;}
 function hostChannel(conn){
   if(conn.label!==LABEL)return false;
   const a=bridge(),o=offer(),entry=a?.state.connections.get(conn.peer);
   if(!o||!entry?.conn.open||conn.metadata?.id!==o.id){conn.close();return true;}
   const file=hostSource(a.state);
   for(const prior of hostChannels)if(prior.peer===conn.peer)prior.close();
   if(hostChannels.size>=MAX_BULK_GUESTS){conn.close();return true;}
   hostChannels.add(conn);
   let busy=false,invalid=0,lastId=0;
   const authorized=()=>conn.open&&a.state.connections.get(conn.peer)===entry&&entry.conn.open&&hostSource(a.state)===file&&offer()?.id===o.id;
   const reply=m=>{if(authorized())conn.send(m);};
   conn.on('data',async m=>{
     if(!authorized()){conn.close();return;}
     if(m?.type!=='read'||!Number.isSafeInteger(m.id)||m.id<=lastId||!validRange(m.offset,m.length,o.size)||busy){
       if(++invalid>=8)conn.close();return;
     }
     invalid=0;lastId=m.id;
     busy=true;
     try{
       const bytes=new Uint8Array(await (file.read?file.read(m.offset,m.length):file.slice(m.offset,m.offset+m.length).arrayBuffer()));
       if(bytes.length!==m.length)throw Error('Short file read');
       for(let pos=0;pos<bytes.length;pos+=PART){
         const started=Date.now();
         while(authorized()&&((conn.dataChannel?.bufferedAmount||0)>512*1024||(conn.bufferSize||0)>32)){
           if(Date.now()-started>20000)throw Error('Range channel congested');
           await delay(12);
         }
         if(!authorized())return;
         const part=bytes.slice(pos,pos+PART);
         if(!await scheduleHostPart(part.length,authorized,()=>reply({type:'part',id:m.id,offset:pos,bytes:part})))return;
       }
       reply({type:'done',id:m.id});
     }catch(e){try{reply({type:'failed',id:m.id});}catch{}}
     finally{busy=false;}
   });
   conn.on('close',()=>hostChannels.delete(conn));
   conn.on('error',()=>{hostChannels.delete(conn);try{conn.close();}catch{}});
   return true;
 }
 function closeHost(){const file=hostSource(bridge()?.state);if(file)keys.delete(file);for(const conn of hostChannels)try{conn.close();}catch{}hostChannels.clear();}
 function current(s){const a=bridge();return session===s&&!s.closed&&a?.state.role==='guest'&&a.state.guestConn===s.control&&!a.state.localVerified;}
 function send(s,m){if(s.control.open)try{s.control.send(m);}catch{}}
 function cancel(s){
   s.closed=true;clearInterval(s.timer);clearTimeout(s.kickTimer);
   for(const req of s.requests.values()){clearTimeout(req.timer);req.reject(Error('Buffer session cancelled'));}
   s.requests.clear();s.cache.clear();
   void s.disk?.close();s.disk=null;
   try{s.conn?.close();}catch{}
   try{Promise.resolve(s.remuxer?.destroy?.()).catch(()=>{});}catch{}
   if(s.url)URL.revokeObjectURL(s.url);
 }
 function stop(fallback=false,reason=''){
   const s=session;if(!s)return;
   session=null;cancel(s);
   const a=bridge();
   if(!a)return;
   if(s.attached&&a.state.source==='buffered-guest'){
     a.state.bufferedMode=false;a.state.waitingForBuffer=false;
     a.media.pause();a.media.removeAttribute('src');a.media.srcObject=null;a.media.load();
     a.state.source=null;
   }
   if(fallback&&a.state.role==='guest'&&a.state.guestConn===s.control&&!a.state.localVerified){
     failedKey=s.offer.id;retryAt=Date.now()+60000;
     send(s,{type:'buffered-file-active',id:s.offer.id,active:false});
     send(s,{type:'requestmedia',reason:'buffered-file-fallback'});
     a.notify?.('Buffered movie unavailable; using live stream. '+String(reason).slice(0,100));
   }
 }
 // A healthy-looking RTC channel can silently stop delivering data.
 // Reset the idle watchdog on validated progress, never beyond the hard cap.
 const RANGE_IDLE_MS=30000,RANGE_MAX_MS=120000;
 function rangeDeadline(start,last){return Math.min(start+RANGE_MAX_MS,last+RANGE_IDLE_MS);}
 function rangeTimeoutError(){const error=Error('Movie range stopped progressing');error.code='RANGE_TIMEOUT';return error;}
 function recoverableRangeFailure(error,channel,currentChannel,reconnecting){
   return error?.code==='RANGE_TIMEOUT'||channel!==currentChannel||!channel?.open||reconnecting;
 }
 function request(s,offset,length){
   if(!current(s)||!s.conn?.open||!validRange(offset,length,s.offer.size))return Promise.reject(Error('Invalid or disconnected range'));
   return new Promise((resolve,reject)=>{
     const now=()=>root?.performance?.now?.()??Date.now();
     const id=++s.sequence,req={bytes:new Uint8Array(length),received:0,resolve,reject,timer:0,started:now()};
     req.arm=()=>{
       clearTimeout(req.timer);
       const deadline=rangeDeadline(req.started,now());
       req.timer=setTimeout(()=>{
         if(s.requests.get(id)!==req)return;
         s.requests.delete(id);reject(rangeTimeoutError());
       },Math.max(0,deadline-now()));
     };
     req.arm();
     s.requests.set(id,req);
     try{s.conn.send({type:'read',id,offset,length});}catch(e){clearTimeout(req.timer);s.requests.delete(id);reject(e);}
   });
 }
 function receive(s,m){
   const req=s.requests.get(m?.id);if(!req)return;
   const finish=(error)=>{clearTimeout(req.timer);s.requests.delete(m.id);error?req.reject(error):req.resolve(req.bytes.buffer);};
   if(m.type==='part'){
     const b=m.bytes instanceof ArrayBuffer?new Uint8Array(m.bytes):ArrayBuffer.isView(m.bytes)?new Uint8Array(m.bytes.buffer,m.bytes.byteOffset,m.bytes.byteLength):null;
     if(!b||!b.length||b.length>PART||m.offset!==req.received||req.received+b.length>req.bytes.length){finish(Error('Invalid movie range'));return;}
     req.bytes.set(b,req.received);req.received+=b.length;req.arm();
   }else if(m.type==='done'){finish(req.received===req.bytes.length?null:Error('Incomplete movie range'));}
   else if(m.type==='failed')finish(Error('Host could not read movie range'));
 }
 // Keep an in-flight decoder read alive while its transport is replaced.
 // Rejecting a read here can permanently fault the worker even if MSE survived.
 async function requestRecoverable(s,offset,length){
   for(let attempt=0;;attempt++){
     if(!current(s))throw Error('Buffer session cancelled');
     const channel=s.conn;
     try{return await request(s,offset,length);}
     catch(error){
       if(!current(s)||attempt>=2||
          !recoverableRangeFailure(error,channel,s.conn,s.reconnecting))throw error;
       await reconnect(s);
     }
   }
 }
 async function read(s,offset,size){
   if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(size)||offset<0||size<0||size>16*BLOCK)throw Error('Invalid decoder read');
   const length=Math.max(0,Math.min(size,s.offer.size-offset));
   const out=new Uint8Array(length);let written=0;
   // Serialize decoder requests; host allows one outstanding block per viewer.
   while(written<length){
     if(!current(s))throw Error('Buffer session cancelled');
     const pos=offset+written,start=Math.floor(pos/BLOCK)*BLOCK;
     let block=s.cache.get(start);
     if(!block){
       const expected=Math.min(BLOCK,s.offer.size-start);
       block=await s.disk?.get(start);
       if(!block||block.length!==expected){
         if(!current(s))throw Error('Buffer session cancelled');
         block=new Uint8Array(await requestRecoverable(s,start,expected));
       }
       if(!current(s))throw Error('Buffer session cancelled');
       s.cache.set(start,block);s.cacheBytes+=block.length;
       while(s.cacheBytes>CACHE_LIMIT){const k=s.cache.keys().next().value,evicted=s.cache.get(k);s.cacheBytes-=evicted.length;s.cache.delete(k);if(s.disk)await s.disk.put(k,evicted);}
     }else{s.cache.delete(start);s.cache.set(start,block);}
     const count=Math.min(length-written,block.length-(pos-start));
     out.set(block.subarray(pos-start,pos-start+count),written);written+=count;
   }
   return out.buffer;
 }
 function update(buffer,fn){
   return new Promise((resolve,reject)=>{
     const clear=()=>{buffer.removeEventListener('updateend',ok);buffer.removeEventListener('error',bad);buffer.removeEventListener('abort',bad);clearTimeout(timer);};
     const ok=()=>{clear();resolve();},bad=()=>{clear();reject(Error('Media buffer update failed'));};
     const timer=setTimeout(bad,12000);
     buffer.addEventListener('updateend',ok);buffer.addEventListener('error',bad);buffer.addEventListener('abort',bad);
     try{fn();}catch(e){clear();reject(e);}
   });
 }
 async function prune(s,time,aggressive=false){
   const ranges=s.buffer.buffered,remove=[];
   const back=Math.max(0,time-(aggressive?2:30)),end=time+TARGET+30;
   for(let i=0;i<ranges.length;i++){
     const a=ranges.start(i),b=ranges.end(i);
     if(a<back-.5)remove.push([a,Math.min(b,back)]);
     if(b>end+.5)remove.push([Math.max(a,end),b]);
   }
   for(const [a,b] of remove)if(current(s)&&b>a)await update(s.buffer,()=>s.buffer.remove(a,b));
 }
 function kick(s,ms=0){
   if(!current(s)||!s.buffer)return;
   clearTimeout(s.kickTimer);s.kickTimer=setTimeout(()=>void pump(s),ms);
 }
 function position(s){return Math.max(0,Math.min(Math.max(0,s.duration-.02),bridge().expectedHostTime()));}
 async function pump(s){
   if(!current(s)||!s.buffer||s.running||s.buffer.updating||s.reconnecting)return;
   const a=bridge(),v=a.media,time=position(s);
   const available=ahead(s.buffer.buffered,time);
    // Recover the target gradually after a browser quota event; do not permanently lock a room to the first observed limit.
    if(s.capacity<TARGET+5&&Date.now()>=(s.quotaRetryAt||0)){
      s.capacity=Math.min(TARGET+5,Math.max(LOW,s.capacity+5));s.quotaRetryAt=Date.now()+QUOTA_RETRY_MS;
    }
    const wanted=Math.min(s.capacity,goal(time,s.duration));
   if(available>=wanted-.15){kick(s,200);return;}
   s.running=true;
   try{
     await prune(s,time);
     if(!current(s))return;
     // A seek outside the downloaded window starts at the new playhead;
     // a seek within it reuses the existing segments. Refill even while paused.
     const reset=s.cursor===null||(!available&&Math.abs(time-s.cursor)>2)||
       (available>0&&Math.abs(time+available-s.cursor)>8);
     const revision=a.state.hostSyncVersion;
     const chunk=reset?await s.remuxer.seek(available?time+available:time):await s.remuxer.read();
     if(!current(s))return;
     const latest=position(s);
     if(revision!==a.state.hostSyncVersion&&changedWindow(s.buffer.buffered,time,latest)){
       s.cursor=null;kick(s);return;
     }
     if(chunk?.data?.byteLength){
       try{await update(s.buffer,()=>s.buffer.appendBuffer(chunk.data));}
       catch(e){
         if(e.name!=='QuotaExceededError')throw e;
         await prune(s,latest,true);
         try{await update(s.buffer,()=>s.buffer.appendBuffer(chunk.data));}
         catch(e2){
           if(e2.name!=='QuotaExceededError')throw e2;
           // Device MSE quota is a hard limit; report actual buffered seconds.
           s.capacity=Math.max(LOW,ahead(s.buffer.buffered,latest)-.25);s.quotaRetryAt=Date.now()+QUOTA_RETRY_MS;
           s.cursor=null;kick(s,500);return;
         }
       }
       if(!current(s))return;
       const ranges=s.buffer.buffered;
       if(revision!==a.state.hostSyncVersion&&changedWindow(ranges,time,position(s))){
         s.cursor=null;kick(s);return;
       }
       s.cursor=latest+ahead(ranges,latest);
       if(!ahead(ranges,latest)&&ranges.length)s.cursor=ranges.end(ranges.length-1);
       s.emptyReads=0;
       if(!s.ready&&playable(ranges,latest,s.duration)){
         s.ready=true;send(s,{type:'buffered-file-active',id:s.offer.id,active:true});
         send(s,{type:'buffer-status',ready:playable(ranges,latest,s.duration)});
         const call=a.state.guestCall;a.state.guestCall=null;try{call?.close();}catch{}
       }
       a.updateBufferDisplay();a.recoveryCheck();a.updateQualityHint?.();void a.syncSeekablePlayback();
     }else if(++s.emptyReads>6&&goal(latest,s.duration)>.5&&ahead(s.buffer.buffered,latest)<.1){
       throw Error('No playable segments at requested time');
     }
     if(chunk?.finished&&ahead(s.buffer.buffered,latest)<wanted-.5)s.cursor=null;
     kick(s,chunk?.data?.byteLength?0:300);
   }catch(e){if(current(s)){if(s.reconnecting||!s.conn?.open){s.cursor=null;void reconnect(s);}else stop(true,e.message);}}
   finally{s.running=false;}
 }
 async function openChannel(s){
   const a=bridge(),conn=a.state.peer.connect(s.control.peer,{label:LABEL,reliable:true,metadata:{id:s.offer.id}});
   s.conn=conn;
   conn.on('data',m=>{if(s.conn===conn)receive(s,m);});
   const lost=()=>{
     if(!current(s)||s.conn!==conn)return;
     for(const req of s.requests.values()){clearTimeout(req.timer);req.reject(Error('Movie transfer disconnected'));}
     s.requests.clear();
     if(s.buffer)void reconnect(s);
   };
   conn.on('close',lost);conn.on('error',lost);
   await new Promise((resolve,reject)=>{
     const timer=setTimeout(()=>reject(Error('Media transfer connection timed out')),10000);
     conn.on('open',()=>{clearTimeout(timer);resolve();});conn.on('error',e=>{clearTimeout(timer);reject(e);});conn.on('close',()=>{clearTimeout(timer);reject(Error('Media transfer closed'));});
   });
 }
 function reconnect(s){
   if(!current(s))return;
   if(!s.reconnectTask){
     s.reconnectTask=restoreChannel(s).finally(()=>{s.reconnectTask=null;});
   }
   return s.reconnectTask;
 }
 async function restoreChannel(s){
   s.reconnecting=true;
   // Keep already appended A/V available while the bulk channel reconnects.
   // A data interruption does not discard the guest's downloaded window.
   const deadline=Date.now()+150000;
   for(let attempt=0;attempt<5&&current(s);attempt++){
     try{
       const old=s.conn;s.conn=null;try{old?.close();}catch{}
       await delay(attempt?Math.min(3000,400*2**attempt):0);
       if(!current(s))return;
       // Do not spend attempts while signaling or room registration is down.
       const roomReady=()=>s.control.open&&bridge()?.state.peer?.open&&!bridge()?.state.peer?.disconnected&&root.navigator?.onLine!==false;
       while(current(s)&&!roomReady()&&Date.now()<deadline)await delay(150);
       if(!current(s))return;
       if(!roomReady()||Date.now()>=deadline)break;
       await openChannel(s);
       if(!current(s))return;
       s.cursor=null;s.reconnecting=false;kick(s);return;
     }catch{}
   }
   if(current(s))stop(true,'Media transfer could not reconnect');
 }
 async function start(o,control){
   const a=bridge();
   if(!a?.state.peer||!root.MediaSource||!root.MediaSource.isTypeSupported)return;
   const s={offer:o,control,conn:null,requests:new Map(),sequence:0,cache:new Map(),cacheBytes:0,readTail:Promise.resolve(),closed:false,attached:false,ready:false,running:false,cursor:null,capacity:TARGET+5,emptyReads:0};
   session=s;
   try{
     // Optional storage must never delay room playback or connection setup.
     void openDiskCache(root).then(disk=>{if(current(s))s.disk=disk;else void disk?.close();}).catch(()=>{});
     await openChannel(s);
     if(!current(s))return;
     const module=await import('./vendor/libav-wasm/index.js');
     const base=new URL('./vendor/libav-wasm/',document.baseURI).href;
     let header=null,lastError;
     for(const workerUrl of [new URL('worker.js',base).href,new URL('./mkv-asyncify-worker.js',document.baseURI).href]){
       if(!current(s))return;
       try{
         s.remuxer=await module.makeRemuxer({publicPath:base,workerUrl,workerOptions:{type:'module'},length:o.size,bufferSize:BLOCK,
           read:(offset,size)=>{const next=s.readTail.then(()=>read(s,offset,size));s.readTail=next.catch(()=>{});return next;}});
         if(!current(s)){await s.remuxer.destroy();return;}
         header=await s.remuxer.init();if(!header?.info?.output)throw Error('No playable tracks');break;
       }catch(e){lastError=e;try{await s.remuxer?.destroy?.();}catch{}s.remuxer=null;}
     }
     if(!current(s))return;
     if(!header)throw lastError||Error('Decoder unavailable');
     const {videoMimeType,audioMimeType}=header.info.output;
     const mime=(videoMimeType?'video':'audio')+'/mp4; codecs="'+[videoMimeType,audioMimeType].filter(Boolean).join(',')+'"';
     if(!audioMimeType||!root.MediaSource.isTypeSupported(mime))throw Error('Source codec unavailable in this browser');
     s.duration=Number(header.info.input?.duration)||a.state.sharedDuration;
     if(!Number.isFinite(s.duration)||s.duration<=0)throw Error('Unknown movie duration');
     const ms=new MediaSource();s.ms=ms;s.url=URL.createObjectURL(ms);
     const opened=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('MediaSource open timed out')),8000);ms.addEventListener('sourceopen',()=>{clearTimeout(timer);resolve();},{once:true});});
     s.attached=true;a.state.bufferedMode=true;a.state.waitingForBuffer=true;a.state.source='buffered-guest';
     a.stopGuestAudioRelay(false);a.media.pause();a.media.srcObject=null;a.media.src=s.url;a.media.preload='auto';a.media.load();a.applyVolume();
     a.showStage(true);a.badge('BUFFERED MOVIE');
     clearTimeout(a.state.streamWaitTimer);a.state.streamWaitTimer=null;
     await opened;if(!current(s))return;
     s.buffer=ms.addSourceBuffer(mime);s.buffer.mode='segments';s.buffer.timestampOffset=header.timestampOffset||0;ms.duration=s.duration;
     await update(s.buffer,()=>s.buffer.appendBuffer(header.data));
     if(!current(s))return;
     a.media.currentTime=position(s);
     s.timer=setInterval(()=>{kick(s);if(s.ready&&Date.now()-(s.lastReport||0)>1000){s.lastReport=Date.now();const t=position(s);send(s,{type:'buffer-status',ready:playable(s.buffer.buffered,t,s.duration)});}},250);
     kick(s);
   }catch(e){if(current(s))stop(true,e.message);}
 }
 function rebind(control){
   const s=session;if(!s?.ready||s.closed)return false;
   s.control=control;
   if(s.conn?.open&&!s.reconnecting){try{s.conn.close();}catch{}void reconnect(s);}
   else void reconnect(s);
   return true;
 }
 function announce(){
   const s=session;if(s?.ready&&current(s)){send(s,{type:'buffered-file-active',id:s.offer.id,active:true});kick(s);}
 }
 function observe(o){
   const a=bridge(),s=a?.state;
   if(!s||s.role!=='guest'||s.localVerified){stop();return;}
   if(!validOffer(o)){if(session)stop(true,'Original-file buffering no longer available');return;}
   if(session?.offer.id===o.id){kick(session);return;}
   if(session)stop();
   if(failedKey===o.id&&Date.now()<retryAt)return;
   if(s.guestConn?.open)void start(o,s.guestConn);
 }
 function bufferStatus(s,time){
   const remaining=Number.isFinite(s.duration)?Math.max(0,s.duration-time):TARGET;
   const target=Math.min(TARGET,remaining);
   return {target,capacity:s.capacity,ready:s.ready,seconds:s.buffer?ahead(s.buffer.buffered,time):0,
     reconnecting:!!s.reconnecting,quotaLimited:s.capacity<Math.min(TARGET+5,remaining),
     diskBytes:s.disk?.size||0,diskAvailable:!!s.disk};
 }
 if(typeof module!=='undefined'&&module.exports)module.exports={ahead,changedWindow,goal,playable,validRange,openDiskCache,bufferStatus,createTransferScheduler,rangeDeadline,rangeTimeoutError,recoverableRangeFailure,TARGET};
 if(!root)return;
 root.MarmaladeRollingBuffer={offer,hostChannel,closeHost,observe,stop,rebind,announce,kick:()=>{if(session)kick(session);},getStatus:()=>session?bufferStatus(session,session.buffer&&current(session)?position(session):0):null};
 root.addEventListener('marmalade:media-cleared',()=>{stop();closeHost();});
 const media=bridge()?.media;
 for(const event of ['play','pause','seeking','seeked','waiting','stalled','loadeddata','canplay','progress','timeupdate','suspend','ended'])media?.addEventListener(event,()=>{if(session)kick(session);});
 document.addEventListener('visibilitychange',()=>{if(session)kick(session);});
})(typeof window!=='undefined'?window:null);
