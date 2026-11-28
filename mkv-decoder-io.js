/*
 * Stream-safe random access adapter for Marmaladeum's optional MKV remuxer.
 *
 * The browser File API and Minternet's native, loopback HTTP media server both
 * implement the same read(offset, size) contract expected by libav-wasm.
 * This module deliberately does not fetch or cache the entire movie.
 */
(function (root) {
  'use strict';
  function checkLength(value) {
    const length=Number(value);
    if (!Number.isSafeInteger(length)||length<=0)
      throw new Error('The media source did not provide a valid file size.');
    return length;
  }
  function checkRead(offset,size,length) {
    if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(size)||offset<0||size<0)
      throw new Error('Invalid media byte range requested by MKV decoder.');
    if(offset>=length||size===0)return null;
    const end=Math.min(length-1,offset+Math.min(size,length-offset)-1);
    return {start:offset,end,length:end-offset+1};
  }
  function fromFile(file) {
    if(!file||typeof file.slice!=='function')throw new Error('Missing video File.');
    const length=checkLength(file.size);
    return {
      name:String(file.name||'Video'), length,kind:'file',
      read:async(offset,size)=>{
        const range=checkRead(offset,size,length);
        return range?file.slice(range.start,range.end+1).arrayBuffer():new ArrayBuffer(0);
      }
    };
  }
  function fromNativeStream(options) {
    const {url,name,size,fetchImpl=fetch}=options||{};
    const length=checkLength(size);
    const address=new URL(String(url||''));
    // This API is specifically for the user-installed Minternet add-on,
    // not a general-purpose proxy for arbitrary Internet media URLs.
    if(address.protocol!=='http:'||address.hostname!=='127.0.0.1'||
      address.port!=='18761'||!/^\/video\/\d+$/.test(address.pathname)||
      !/^[a-f0-9]{64}$/.test(address.searchParams.get('key')||'')){
      throw new Error('The source is not a verified Minternet local media stream.');
    }
    if(typeof fetchImpl!=='function')throw new Error('Media fetch is unavailable.');
    return {
      name:String(name||'Video'),length,kind:'native',url:address.href,
      read:async(offset,size,options)=>{
        const signal=options?.signal;
        if(signal?.aborted)throw new Error('Media read cancelled.');
        const range=checkRead(offset,size,length);
        if(!range)return new ArrayBuffer(0);
        const response=await fetchImpl(address.href,{
          method:'GET',headers:{Range:`bytes=${range.start}-${range.end}`},
          credentials:'omit',cache:'no-store',mode:'cors',redirect:'error',signal
        });
        if(response.status!==206){
          throw new Error(`Minternet media server returned HTTP ${response.status}, expected 206 Partial Content.`);
        }
        const declared=response.headers?.get?.('Content-Range')||'';
        const match=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(declared);
        if(!match||Number(match[1])!==range.start||
          Number(match[2])!==range.end||Number(match[3])!==length){
          throw new Error('Minternet returned a mismatched media byte range.');
        }
        // A misbehaving server must not make us buffer an entire movie.
        if(response.body?.getReader){
          const reader=response.body.getReader(),bytes=new Uint8Array(range.length);
          let offset=0;
          try{
            while(true){
              if(signal?.aborted)throw new Error('Media read cancelled.');
              const {done,value}=await reader.read();
              if(done)break;
              if(offset+value.byteLength>bytes.length)throw new Error('The media server exceeded the requested range.');
              bytes.set(value,offset);offset+=value.byteLength;
            }
            if(offset!==bytes.length)throw new Error('The media server returned a truncated video chunk.');
            return bytes.buffer;
          }catch(error){await reader.cancel().catch(()=>{});throw error;}
          finally{reader.releaseLock();}
        }
        const bytes=await response.arrayBuffer();
        if(signal?.aborted)throw new Error('Media read cancelled.');
        if(bytes.byteLength!==range.length)
          throw new Error('The media server returned a truncated video chunk.');
        return bytes;
      }
    };
  }
  const api=Object.freeze({fromFile,fromNativeStream,checkRead});
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root)root.MarmaladeMkvIO=api;
})(typeof window!=='undefined'?window:undefined);
