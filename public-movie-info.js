/* Automatic, key-free film and television lookup.
   Only public metadata requests; personal files and playback are not sent. */
(() => {
  'use strict';
  const norm=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const strip=s=>String(s||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
  async function json(url){
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),9000);
    try{
      const response=await fetch(url,{credentials:'omit',signal:controller.signal});
      if(!response.ok)throw Error('Public source returned '+response.status);
      return await response.json();
    }catch(error){
      if(error?.name==='AbortError')throw Error('Information source timed out. Try again.');
      throw error;
    }finally{clearTimeout(timeout);}
  }
  function empty(parsed,more={}){
    return {kind:parsed.kind,id:null,imdbId:null,title:parsed.title,year:parsed.year||'',
      tagline:'',overview:'',poster:'',backdrop:'',genres:[],release:'',
      runtime:null,status:'',language:'',countries:[],companies:[],networks:[],
      seasons:null,episodes:null,season:parsed.season,episode:parsed.episode,
      episodeTitle:'',episodeOverview:'',airDate:'',budget:0,revenue:0,score:0,votes:0,
      cast:[],crew:[],awards:'',ratings:[],imdbScore:'',metacritic:'',
      omdbBoxOffice:'',wiki:null,fileDetails:null,...more};
  }
  function titleScore(candidate,requested){
    const a=norm(candidate),b=norm(requested);
    if(!a||!b)return -1;
    if(a===b)return 100;
    if(a.startsWith(b+' '))return 75;
    if(b.startsWith(a+' '))return 40;
    return -1;
  }
  async function television(parsed){
    const candidates=await json('https://api.tvmaze.com/search/shows?q='+encodeURIComponent(parsed.title));
    const options=(Array.isArray(candidates)?candidates:[])
      .map(x=>x.show).filter(Boolean)
      .map(show=>({show,score:titleScore(show.name,parsed.title)+
        (parsed.year&&String(show.premiered||'').startsWith(String(parsed.year))?80:0)}))
      .filter(x=>x.score>=0).sort((a,b)=>b.score-a.score);
    if(!options.length)throw Error('Series not found in TVmaze.');
    const best=options[0].show;
    const show=await json('https://api.tvmaze.com/shows/'+encodeURIComponent(best.id)+'?embed=cast');
    let episode=null;
    if(parsed.season>0&&parsed.episode>0)try{
      episode=await json('https://api.tvmaze.com/shows/'+encodeURIComponent(best.id)+
        '/episodebynumber?season='+encodeURIComponent(parsed.season)+
        '&number='+encodeURIComponent(parsed.episode));
    }catch{}
    const cast=Array.isArray(show._embedded?.cast)?show._embedded.cast:[];
    return {record:empty(parsed,{
      source:'tvmaze',id:show.id,sourceUrl:show.url,
      title:show.name||parsed.title,year:(show.premiered||'').slice(0,4),
      overview:strip(show.summary),poster:show.image?.medium||show.image?.original||'',
      genres:Array.isArray(show.genres)?show.genres:[],release:show.premiered||'',
      runtime:show.averageRuntime||show.runtime||null,status:show.status||'',
      language:show.language||'',networks:[show.network?.name||show.webChannel?.name].filter(Boolean),
      score:Number(show.rating?.average)||0,
      cast:cast.slice(0,24).map(x=>({name:x.person?.name||'',
        character:x.character?.name||'',picture:x.person?.image?.medium||''})).filter(x=>x.name),
      episodeTitle:episode?.name||'',episodeOverview:strip(episode?.summary),
      airDate:episode?.airdate||''
    }),alternatives:[]};
  }
  async function article(title,parsed){
    const info=await json('https://en.wikipedia.org/api/rest_v1/page/summary/'+encodeURIComponent(title));
    if(info.type==='disambiguation')throw Error('This title has multiple editions.');
    if(!/film|movie/i.test(info.description||'')&&!/film|movie/i.test(info.title||''))
      throw Error('This article could not be verified as a film.');
    const year=parsed.year||Number((info.title||'').match(/\b(?:19|20)\d{2}\b/)?.[0]||0)||'';
    const page=info.content_urls?.desktop?.page||
      'https://en.wikipedia.org/wiki/'+encodeURIComponent(title.replace(/ /g,'_'));
    return empty(parsed,{source:'wikipedia',id:info.pageid||null,sourceUrl:page,
      title:parsed.title,year,overview:info.extract||'',
      poster:info.thumbnail?.source||'',wiki:{title:info.title,url:page,text:info.extract||''}});
  }
  async function movie(parsed){
    const term=[parsed.title,parsed.year||'','film'].filter(Boolean).join(' ');
    const u=new URL('https://en.wikipedia.org/w/api.php');
    u.search=new URLSearchParams({action:'query',list:'search',srsearch:term,
      srnamespace:'0',srlimit:'8',format:'json',origin:'*'}).toString();
    const payload=await json(u.toString());
    const matches=(payload.query?.search||[]).map(x=>{
      const title=String(x.title||'');
      const simplified=title.replace(/\s*\((?:19|20)\d{2}\s*(?:film|movie)\)/ig,'')
        .replace(/\s*\((?:film|movie)\)/ig,'').trim();
      return {title,score:titleScore(simplified,parsed.title)+
        (parsed.year&&title.includes(String(parsed.year))?100:0)};
    }).filter(x=>x.score>=0&&/\bfilm\b|\bmovie\b/i.test(x.title))
      .sort((a,b)=>b.score-a.score);
    if(!matches.length)throw Error('No confidently matching film article.');
    const primary=matches[0].title;
    return {record:await article(primary,parsed),
      alternatives:matches.slice(1,6).map(x=>x.title)};
  }
  window.MarmaladePublicMovieInfo={
    async lookup(parsed){return parsed.kind==='tv'?television(parsed):movie(parsed);},
    article
  };
})();