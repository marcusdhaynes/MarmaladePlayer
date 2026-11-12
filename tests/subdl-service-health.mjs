/* No credentials or subtitle text printed. Diagnose public SubDL availability/CORS. */
const query='film_name=Inception&type=movie&languages=EN&unpack=1&subs_per_page=3';
const proxy='https://marmalade-subdl-proxy-somnielsynchreaua-4637.vercel.app/api/subtitles?'+query;
const origin='https://marcusdhaynes.github.io';
try{
  const response=await fetch(proxy,{signal:AbortSignal.timeout(15000),headers:{Origin:origin,Accept:'application/json'}});
  const body=await response.text();
  let json=null;try{json=JSON.parse(body);}catch{}
  const subtitles=Array.isArray(json?.subtitles)?json.subtitles:[];
  console.log(JSON.stringify({provider:'SubDL proxy',status:response.status,
    cors:response.headers.get('access-control-allow-origin')||'none',
    json:!!json,apiStatus:json?.status,
    results:Array.isArray(json?.results)?json.results.length:null,
    subtitles:subtitles.length,
    unpackFiles:subtitles.reduce((n,s)=>n+(s.unpack_files?.length||0),0),
    error:json?.status===false?String(json.error||'').slice(0,140):undefined},null,2));
  const file=subtitles.flatMap(s=>(s.unpack_files?.length?s.unpack_files:[s]))
    .find(s=>typeof s.url==='string'&&s.url.startsWith('/subtitle/'));
  if(file){
    const remote=new URL(file.url,'https://dl.subdl.com');
    const dl=await fetch(remote,{signal:AbortSignal.timeout(15000),headers:{Origin:origin,Range:'bytes=0-50'}});
    const data=new Uint8Array(await dl.arrayBuffer());
    const utf8=new TextDecoder('utf-8');
    const text=utf8.decode(data);
    const codec=(await import('../subtitle-codec.js')).default;
    const decoded=codec.decode(text,String(file.name||'actual.srt'),{fps:Number(file.fps)||0});
    console.log(JSON.stringify({provider:'SubDL direct decode',filename:String(file.name||'').slice(-70),
      validUtf8:!text.includes('\uFFFD'),format:decoded.format,cues:decoded.cues.length,
      error:decoded.error,warning:decoded.warning},null,2));
    console.log(JSON.stringify({provider:'SubDL download',status:dl.status,
      cors:dl.headers.get('access-control-allow-origin')||'none',
      contentType:dl.headers.get('content-type')||'',
      bytes:data.length,zip:data[0]===80&&data[1]===75},null,2));
  }
}catch(error){console.warn('Live SubDL service probe unavailable:',error.message);}
