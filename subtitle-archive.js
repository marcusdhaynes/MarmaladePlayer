/* Bounded, local ZIP subtitle extraction. No remote processing. */
(function(root){
'use strict';
const MAX_ARCHIVE=20*1024*1024,MAX_TEXT=5*1024*1024;
const supported=/\.(srt|vtt|sub|ass|ssa|sbv|txt)$/i;
const utf8=new TextDecoder('utf-8');
const bytes=v=>v instanceof Uint8Array?v:new Uint8Array(v);
const u16=(b,n)=>b[n]|b[n+1]<<8;
const u32=(b,n)=>(b[n]|b[n+1]<<8|b[n+2]<<16|b[n+3]<<24)>>>0;
const isZip=v=>{const b=bytes(v);return b.length>3&&b[0]===80&&b[1]===75&&b[2]===3&&b[3]===4;};
function list(data){
 const b=bytes(data);
 if(b.byteLength>MAX_ARCHIVE)throw Error('Subtitle ZIP is larger than 20 MB');
 if(!isZip(b))throw Error('Not a ZIP subtitle archive');
 let end=-1;
 for(let i=b.length-22;i>=Math.max(0,b.length-65557);i--)if(u32(b,i)===0x06054b50){end=i;break;}
 if(end<0)throw Error('Subtitle ZIP central directory is missing');
 const total=u16(b,end+10),offset=u32(b,end+16);
 if(total>500||offset>b.length)throw Error('Subtitle ZIP is invalid or too large');
 const items=[];let p=offset;
 for(let i=0;i<total;i++){
   if(p+46>b.length||u32(b,p)!==0x02014b50)throw Error('Invalid ZIP directory entry');
   const flags=u16(b,p+8),method=u16(b,p+10);
   const size=u32(b,p+24),packed=u32(b,p+20),local=u32(b,p+42);
   const nameSize=u16(b,p+28),extra=u16(b,p+30),comment=u16(b,p+32);
   const next=p+46+nameSize+extra+comment;
   if(next>b.length)throw Error('Truncated ZIP entry');
   const name=utf8.decode(b.subarray(p+46,p+46+nameSize));
   if(!(flags&1)&&supported.test(name)&&!name.startsWith('__MACOSX/')&&
      !name.split('/').some(part=>part==='..')&&size>0&&size<=MAX_TEXT&&
      packed<=MAX_ARCHIVE&&(method===0||method===8))items.push({name,size,packed,method,local});
   p=next;
 }
 return items;
}
function pick(entries,requested='',video=''){
 if(!entries.length)throw Error('No text subtitles in ZIP. Bitmap .sub requires paired .idx support.');
 const base=s=>String(s||'').split(/[\\/]/).pop().toLowerCase().replace(/\.[^.]+$/,'');
 const needle=base(requested);
 if(needle){
   const found=entries.find(e=>base(e.name)===needle);
   if(found)return found;
   if(supported.test(requested)&&entries.length>1)throw Error('Requested subtitle is missing from ZIP');
 }
 const getEpisode=s=>{
   const m=String(s||'').replace(/[._-]/g,' ').match(/\b(?:s(\d{1,3})e(\d{1,4})|(\d{1,3})x(\d{1,4}))\b/i);
   return m?[Number(m[1]||m[3]),Number(m[2]||m[4])]:null;
 };
 const target=getEpisode(video);
 if(target){
   const matched=entries.filter(e=>{
     const episode=getEpisode(e.name);
     return episode&&episode[0]===target[0]&&episode[1]===target[1];
   });
   if(matched.length===1)return matched[0];
   if(entries.length>1&&!matched.length)throw Error('ZIP has no subtitle for this episode');
 }
 if(entries.length===1)return entries[0];
 const regular=entries.filter(e=>!/(?:^|[._\s-])(?:sdh|hi|commentary|forced)(?:[._\s-]|$)/i.test(e.name));
 if(regular.length===1)return regular[0];
 throw Error('ZIP contains several subtitle files. Select a specific episode/release.');
}
async function extract(data,{filename='',video=''}={}){
 const b=bytes(data),entry=pick(list(b),filename,video),p=entry.local;
 if(p+30>b.length||u32(b,p)!==0x04034b50)throw Error('Invalid ZIP file header');
 const start=p+30+u16(b,p+26)+u16(b,p+28);
 if(start+entry.packed>b.length)throw Error('Truncated ZIP subtitle');
 const compressed=b.subarray(start,start+entry.packed);
 let content;
 if(entry.method===0)content=compressed.slice();
 else if(typeof module==='object'&&module.exports)
   content=new Uint8Array(require('node:zlib').inflateRawSync(compressed));
 else if(typeof DecompressionStream==='function'){
   let stream;
   try{stream=new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));}
   catch{throw Error('This browser cannot unzip subtitles; extract .srt manually.');}
   content=new Uint8Array(await new Response(stream).arrayBuffer());
 }else throw Error('This browser cannot unzip subtitles; extract .srt manually.');
 if(content.length!==entry.size||content.length>MAX_TEXT)
   throw Error('Subtitle ZIP content exceeds 5 MB or is damaged');
 return {name:entry.name.split('/').pop(),bytes:content};
}
const api={isZip,list,pick,extract};
if(typeof module==='object'&&module.exports)module.exports=api;
root.MarmaladeSubtitleArchive=api;
})(typeof window!=='undefined'?window:globalThis);
