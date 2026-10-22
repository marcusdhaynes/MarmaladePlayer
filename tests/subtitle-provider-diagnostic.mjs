const probes = [
  ['proxy title+1991', 'https://marmalade-subdl-proxy-somnielsynchreaua-4637.vercel.app/api/subtitles?film_name=Beauty+and+the+Beast&year=1991&type=movie&languages=EN&unpack=1&subs_per_page=30', true],
  ['proxy title without year', 'https://marmalade-subdl-proxy-somnielsynchreaua-4637.vercel.app/api/subtitles?film_name=Beauty+and+the+Beast&type=movie&languages=EN', true],
  ['proxy year in name', 'https://marmalade-subdl-proxy-somnielsynchreaua-4637.vercel.app/api/subtitles?film_name=Beauty+and+the+Beast+1991&type=movie&languages=EN', true],
  ['proxy sd_id', 'https://marmalade-subdl-proxy-somnielsynchreaua-4637.vercel.app/api/subtitles?sd_id=27133&type=movie&languages=EN', true],
  ['Cinemeta title resolution', 'https://v3-cinemeta.strem.io/catalog/movie/top/search=Beauty%20and%20the%20Beast.json', false],
  ['OpenSubtitles v3 1991', 'https://opensubtitles-v3.strem.io/subtitles/movie/tt0101414.json', false]
];
for (const [name, url, proxy] of probes) {
  try {
    const r = await fetch(url,{headers:proxy ? {Origin:'https://marcusdhaynes.github.io',Accept:'application/json'} : {Accept:'application/json'},signal:AbortSignal.timeout(16000)});
    const str=await r.text();
    let payload;try{payload=JSON.parse(str);}catch{payload=null;}
    console.log(name,JSON.stringify({
      code:r.status,cors:r.headers.get('access-control-allow-origin'),
      ok:payload?.status,err:payload?.error,
      results:payload?.results?.slice(0,6).map(x=>({name:x.name,year:x.year,type:x.type,sd_id:x.sd_id,imdb_id:x.imdb_id})),
      subtitleCount:payload?.subtitles?.length,
      sampleSubtitle:payload?.subtitles?.[0]&&{release_name:payload.subtitles[0].release_name,language:payload.subtitles[0].language},
      metas:payload?.metas?.filter(x=>/beauty and the beast/i.test(x.name||'')).slice(0,8).map(x=>({name:x.name,id:x.id,year:x.releaseInfo})),
      preview:!payload?str.slice(0,170):undefined
    }));
  }catch(e){console.log(name,'ERROR',e.message)}
}
