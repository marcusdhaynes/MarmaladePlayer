/* Rolling seekable movie buffer. No upload or transcoding of video on the host.
 * A dedicated reliable PeerJS channel carries bounded ranges of the currently
 * shared movie only. The guest's existing libav worker remuxes on demand into MSE.
 */
(function(root){
 'use strict';
 const TARGET=180,LOW=3,BLOCK=1024*1024,PART=16*1024,CACHE_LIMIT=24*BLOCK;
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
 function goal(time,duration){return Math.max(0,Math.min(TARGET+5,duration-time));}
 function validRange(offset,length,total){
   return Number.isSafeInteger(offset)&&Number.isSafeInteger(length)&&offset>=0&&length>0&&length<=BLOCK&&offset<total&&length<=total-offset;
 }
 function offer(){
   const a=bridge(),s=a?.state;
   if(!s||s.role!=='host'||!s.broadcasting||!s.fileReady||s.source!=='file'||!s.file?.size)return null;
   const file=s.file;
   if(!keys.has(file))keys.set(file,crypto.randomUUID?.()||Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join(''));
   return {id:keys.get(file),size:file.size,name:file.name};
 }
 function validOffer(o){return o&&typeof o.id==='string'&&o.id.length<=100&&typeof o.name==='string'&&o.name.length<=512&&Number.isSafeInteger(o.size)&&o.size>0;}
 function hostChannel(conn){
   if(conn.label!==LABEL)return false;
   const a=bridge(),o=offer(),entry=a?.state.connections.get(conn.peer);
   if(!o||!entry?.conn.open||conn.metadata?.id!==o.id){conn.close();return true;}
   const file=a.state.file;
   for(const prior of hostChannels)if(prior.peer===conn.peer)prior.close();
   hostChannels.add(conn);
   let busy=false;
   const authorized=()=>conn.open&&a.state.connections.get(conn.peer)?.conn.open&&a.state.file===file&&offer()?.id===o.id;
   const reply=m=>{if(authorized())conn.send(m);};
   conn.on('data',async m=>{
     if(!authorized()){conn.close();return;}
     if(m?.type!=='read'||!Number.isSafeInteger(m.id)||!validRange(m.offset,m.length,o.size)||busy)return;
     busy=true;
     try{
       const bytes=new Uint8Array(await file.slice(m.offset,m.offset+m.length).arrayBuffer());
       if(bytes.length!==m.length)throw Error('Short file read');
       for(let pos=0;pos<bytes.length;pos+=PART){
         const started=Date.now();
         while(authorized()&&((conn.dataChannel?.bufferedAmount||0)>512*1024||(conn.bufferSize||0)>32)){
           if(Date.now()-started>20000)throw Error('Range channel congested');
           await delay(12);
         }
         if(!authorized())return;
         reply({type:'part',id:m.id,offset:pos,bytes:bytes.slice(pos,pos+PART)});
       }
       reply({type:'done',id:m.id});
     }catch(e){try{reply({type:'failed',id:m.id});}catch{}}
     finally{busy=false;}
   });
   conn.on('close',()=>hostChannels.delete(conn));
   conn.on('error',()=>{hostChannels.delete(conn);try{conn.close();}catch{}});
   return true;
 }
 function closeHost(){for(const conn of hostChannels)try{conn.close();}catch{}hostChannels.clear();}
 function current(s){const a=bridge();return session===s&&!s.closed&&a?.state.role==='guest'&&a.state.guestConn===s.control&&!a.state.localVerified;}
 function send(s,m){if(s.control.open)try{s.control.send(m);}catch{}}
 function cancel(s){
   s.closed=true;clearInterval(s.timer);clearTimeout(s.kickTimer);
   for(const req of s.requests.values()){clearTimeout(req.timer);req.reject(Error('Buffer session cancelled'));}
   s.requests.clear();s.cache.clear();
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
 function request(s,offset,length){
   if(!current(s)||!s.conn.open||!validRange(offset,length,s.offer.size))return Promise.reject(Error('Invalid or disconnected range'));
   return new Promise((resolve,reject)=>{
     const id=++s.sequence,req={bytes:new Uint8Array(length),received:0,resolve,reject,timer:0};
     req.timer=setTimeout(()=>{s.requests.delete(id);reject(Error('Movie range timed out'));},30000);
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
     req.bytes.set(b,req.received);req.received+=b.length;
   }else if(m.type==='done'){finish(req.received===req.bytes.length?null:Error('Incomplete movie range'));}
   else if(m.type==='failed')finish(Error('Host could not read movie range'));
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
       block=new Uint8Array(await request(s,start,Math.min(BLOCK,s.offer.size-start)));
       if(!current(s))throw Error('Buffer session cancelled');
       s.cache.set(start,block);s.cacheBytes+=block.length;
       while(s.cacheBytes>CACHE_LIMIT){const k=s.cache.keys().next().value;s.cacheBytes-=s.cache.get(k).length;s.cache.delete(k);}
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
   if(!current(s)||!s.buffer||s.running||s.buffer.updating)return;
   const a=bridge(),v=a.media,time=position(s);
   const available=ahead(s.buffer.buffered,time),wanted=Math.min(s.capacity,goal(time,s.duration));
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
     if(revision!==a.state.hostSyncVersion&&Math.abs(latest-time)>2&&!ahead(s.buffer.buffered,latest)){
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
           s.capacity=Math.max(LOW,ahead(s.buffer.buffered,latest)-.25);
           s.cursor=null;kick(s,500);return;
         }
       }
       const ranges=s.buffer.buffered;
       s.cursor=latest+ahead(ranges,latest);
       if(!ahead(ranges,latest)&&ranges.length)s.cursor=ranges.end(ranges.length-1);
       s.emptyReads=0;
       if(!s.ready&&ahead(ranges,latest)>.1){
         s.ready=true;send(s,{type:'buffered-file-active',id:s.offer.id,active:true});
         const call=a.state.guestCall;a.state.guestCall=null;try{call?.close();}catch{}
       }
       a.updateBufferDisplay();a.recoveryCheck();void a.syncSeekablePlayback();
     }else if(++s.emptyReads>6&&goal(latest,s.duration)>.5&&ahead(s.buffer.buffered,latest)<.1){
       throw Error('No playable segments at requested time');
     }
     if(chunk?.finished&&ahead(s.buffer.buffered,latest)<wanted-.5)s.cursor=null;
     kick(s,chunk?.data?.byteLength?0:300);
   }catch(e){if(current(s))stop(true,e.message);}
   finally{s.running=false;}
 }
 async function start(o,control){
   const a=bridge();
   if(!a?.state.peer||!root.MediaSource||!root.MediaSource.isTypeSupported)return;
   const s={offer:o,control,conn:null,requests:new Map(),sequence:0,cache:new Map(),cacheBytes:0,readTail:Promise.resolve(),closed:false,attached:false,ready:false,running:false,cursor:null,capacity:TARGET+5,emptyReads:0};
   session=s;
   try{
     const conn=a.state.peer.connect(control.peer,{label:LABEL,reliable:true,metadata:{id:o.id}});
     s.conn=conn;
     conn.on('data',m=>receive(s,m));
     conn.on('close',()=>{if(current(s))stop(true,'Media transfer disconnected');});
     conn.on('error',()=>{if(current(s))stop(true,'Media transfer failed');});
     await new Promise((resolve,reject)=>{
       const timer=setTimeout(()=>reject(Error('Media transfer connection timed out')),10000);
       conn.on('open',()=>{clearTimeout(timer);resolve();});conn.on('error',e=>{clearTimeout(timer);reject(e);});conn.on('close',()=>{clearTimeout(timer);reject(Error('Media transfer closed'));});
     });
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
     await opened;if(!current(s))return;
     s.buffer=ms.addSourceBuffer(mime);s.buffer.mode='segments';s.buffer.timestampOffset=header.timestampOffset||0;ms.duration=s.duration;
     await update(s.buffer,()=>s.buffer.appendBuffer(header.data));
     if(!current(s))return;
     a.media.currentTime=position(s);
     s.timer=setInterval(()=>kick(s),250);
     kick(s);
   }catch(e){if(current(s))stop(true,e.message);}
 }
 function observe(o){
   const a=bridge(),s=a?.state;
   if(!s||s.role!=='guest'||s.localVerified){stop();return;}
   if(!validOffer(o)){if(session)stop();return;}
   if(session?.offer.id===o.id){kick(session);return;}
   if(session)stop();
   if(failedKey===o.id&&Date.now()<retryAt)return;
   if(s.guestConn?.open)void start(o,s.guestConn);
 }
 if(typeof module!=='undefined'&&module.exports)module.exports={ahead,goal,validRange,TARGET};
 if(!root)return;
 root.MarmaladeRollingBuffer={offer,hostChannel,closeHost,observe,stop,kick:()=>{if(session)kick(session);},getStatus:()=>session?{target:TARGET,capacity:session.capacity,ready:session.ready}:null};
 root.addEventListener('marmalade:media-cleared',()=>{stop();closeHost();});
 const media=bridge()?.media;
 for(const event of ['play','pause','seeking','seeked','waiting','stalled','loadeddata','canplay','progress','timeupdate','suspend','ended'])media?.addEventListener(event,()=>{if(session)kick(session);});
 document.addEventListener('visibilitychange',()=>{if(session)kick(session);});
})(typeof window!=='undefined'?window:null);
