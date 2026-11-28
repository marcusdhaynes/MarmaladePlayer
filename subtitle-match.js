/* Exact-title subtitle matching and filter helpers; shared by the browser and Node tests. */
(function(root) {
  'use strict';
  function normalizeTitle(value) {
    return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/&/g, ' and ').replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ').trim();
  }
  function resultYear(result) {
    const direct = String(result?.year ?? '').match(/^(18|19|20|21)\d{2}$/);
    if (direct) return Number(direct[0]);
    const date = String(result?.release_date || result?.first_air_date || result?.air_date || result?.releaseInfo || result?.released || '');
    const match = date.match(/^(18|19|20|21)\d{2}/);
    return match ? Number(match[0]) : null;
  }
  function matchesTitle(value, searched) {
    const a = normalizeTitle(value), b = normalizeTitle(searched);
    return !!a && !!b && (a === b ||
      (a.startsWith(b + ' ') && a.length - b.length <= 19) ||
      (b.startsWith(a + ' ') && b.length - a.length <= 19));
  }
  function selectTitle(data, searched, requestedYear, requestedType) {
    const titles = Array.isArray(data?.results) ? data.results : [];
    const year = requestedYear ? Number(requestedYear) : null;
    if (!titles.length) return year ? null : {index:0, title:null, unverified:true};
    let best = null;
    for (let i = 0; i < titles.length; i++) {
      const candidate = titles[i];
      if (!candidate || !matchesTitle(candidate.name || candidate.title, searched)) continue;
      const candidateType = String(candidate.type || '').toLowerCase();
      if (requestedType && candidateType && candidateType !== requestedType &&
          !(requestedType === 'tv' && ['series', 'show'].includes(candidateType))) continue;
      if (year !== null && resultYear(candidate) !== year) continue;
      const score = normalizeTitle(candidate.name || candidate.title) === normalizeTitle(searched) ? 2 : 1;
      if (!best || score > best.score) best = {index:i, title:candidate, score};
    }
    return best;
  }
  function lookupParams(original, title) {
    const params = new URLSearchParams(original);
    for (const key of ['film_name', 'file_name', 'sd_id', 'imdb_id', 'tmdb_id'])
      params.delete(key);
    if (title?.sd_id !== undefined && title?.sd_id !== null && /^\d+$/.test(String(title.sd_id)))
      params.set('sd_id', String(title.sd_id));
    else if (/^tt\d{5,12}$/.test(String(title?.imdb_id || '')))
      params.set('imdb_id', String(title.imdb_id));
    else if (/^\d+$/.test(String(title?.tmdb_id || '')))
      params.set('tmdb_id', String(title.tmdb_id));
    return [...params.keys()].some(key=>['sd_id','imdb_id','tmdb_id'].includes(key)) ? params : null;
  }
  function searchParams({title, year, language, type, season, episode}) {
    const params = new URLSearchParams({
      film_name:String(title || '').trim(), type:type === 'tv' ? 'tv' : 'movie',
      unpack:'1', subs_per_page:'30'
    });
    if (year) params.set('year', String(year));
    if (language) params.set('languages', String(language).toUpperCase());
    if (type === 'tv' && season) params.set('season_number', String(season));
    if (type === 'tv' && episode) params.set('episode_number', String(episode));
    return params;
  }
  function matchesQuality(value, selected) {
    if (!selected) return true;
    const text = String(value || '');
    if (selected === 'WEB') return /\bWEB[- .]?DL\b|\bWEBRip\b/i.test(text);
    if (selected === 'BluRay') return /\bBlu[- .]?Ray\b|\bBDRip\b|\bBRRip\b/i.test(text);
    return new RegExp('(?:^|\\D)' + selected + '(?:\\D|$)', 'i').test(text);
  }
  const iso3={eng:'en',ara:'ar',ind:'id',spa:'es',fra:'fr',fre:'fr',
    deu:'de',ger:'de',por:'pt',ita:'it',rus:'ru',tur:'tr',
    fas:'fa',per:'fa',hin:'hi',jpn:'ja',kor:'ko',zho:'zh',chi:'zh'};
  function canonicalLanguage(value) {
    const normalized=String(value||'').toLowerCase().split(/[-_]/)[0];
    return iso3[normalized]||normalized;
  }
  function matchesLanguage(value, selected) {
    if (!selected || !value) return true;
    return canonicalLanguage(value) === canonicalLanguage(selected);
  }
  function selectCatalogTitle(metas, searched, requestedYear, requestedType) {
    const expectedType=requestedType==='tv'?'series':'movie';
    const year=requestedYear?Number(requestedYear):null;
    const found=(Array.isArray(metas)?metas:[]).filter(candidate=>{
      if(!/^tt\d{5,12}$/.test(String(candidate?.id||'')))return false;
      if(candidate?.type && candidate.type!==expectedType)return false;
      if(!matchesTitle(candidate?.name,searched))return false;
      if(year!==null && resultYear(candidate)!==year)return false;
      return true;
    });
    found.sort((a,b)=>(normalizeTitle(b.name)===normalizeTitle(searched)?1:0)-
      (normalizeTitle(a.name)===normalizeTitle(searched)?1:0));
    return found[0]||null;
  }
  function releaseYear(value,searched='') {
    let text=normalizeTitle(value),title=normalizeTitle(searched);
    // Numeric film titles are not release years (1917, 2001, etc.).
    if(title&&(text===title||text.startsWith(title+' ')))text=text.slice(title.length).trim();
    const candidates=text.match(/(?:^| )(?:18|19|20|21)\d{2}(?= |$)/g)||[];
    for(const token of candidates){
      const year=Number(token.trim());
      // Exclude common dimension tokens (e.g. 1920 x 1080 or 2160 p).
      if(year===1920&&/\b1920\s*x\s*1080\b/.test(text))continue;
      if(year===2160&&/\b2160\s*p\b/.test(text))continue;
      return year;
    }
    return null;
  }
  function episodeToken(text) {
    const m=String(text||'').match(/(?:^|[._\s-])s(\d{1,3})[._\s-]*e(\d{1,4})(?:\D|$)|(?:^|[._\s-])(\d{1,3})x(\d{1,4})(?:\D|$)/i);
    return m?{season:Number(m[1]||m[3]),episode:Number(m[2]||m[4])}:null;
  }
  function matchesEpisode(file, subtitle, type, season, episode) {
    if(type!=='tv')return true;
    const specifiedSeason=Number(season||0),specifiedEpisode=Number(episode||0);
    const names=[file?.name,file?.release_name,file?.subtitleFileName,file?.movieReleaseName];
    const named=names.map(episodeToken).filter(Boolean);
    const from=Number(subtitle?.episode_from||0),to=Number(subtitle?.episode_end||0);
    const pack=from>0&&to>=from;
    const distinct=file!==subtitle;
    // A pack covering episode 5 cannot make an unpacked S02E06 file
    // compatible. Check every concrete file identity, not the first token.
    if(specifiedSeason&&[Number(file?.season||0),...named.map(x=>x.season)]
      .some(n=>n&&n!==specifiedSeason))return false;
    if(specifiedEpisode&&[Number(file?.episode||0),...named.map(x=>x.episode)]
      .some(n=>n&&n!==specifiedEpisode)&& (distinct||!pack))return false;
    const parent=[subtitle?.name,subtitle?.release_name,subtitle?.subtitleFileName,subtitle?.movieReleaseName].map(episodeToken).filter(Boolean);
    if(specifiedSeason&&[Number(subtitle?.season||0),...parent.map(x=>x.season)]
      .some(n=>n&&n!==specifiedSeason))return false;
    if(specifiedEpisode){
      if(pack&&(specifiedEpisode<from||specifiedEpisode>to))return false;
      if(!pack&&[Number(subtitle?.episode||0),...parent.map(x=>x.episode)]
        .some(n=>n&&n!==specifiedEpisode))return false;
    }
    return true;
  }
  function releaseTraits(value){
    const raw=normalizeTitle(value);
    const text=raw.replace(/\bweb\s+dl\b/g,'webdl').replace(/\bweb\s+rip\b/g,'webrip')
      .replace(/\bblu\s+ray\b/g,'bluray').replace(/\bdirector\s+s\b/g,'directors');
    const source=/\bremux\b/.test(text)?'remux':/\b(?:bluray|bdrip|brrip)\b/.test(text)?'bluray':
      /\bwebdl\b/.test(text)?'webdl':/\bwebrip\b/.test(text)?'webrip':
      /\b(?:dvdrip|dvd)\b/.test(text)?'dvd':/\bhdtv\b/.test(text)?'hdtv':'';
    const edition=/\b(?:directors?|director s)\s+cut\b/.test(text)?'director':
      /\b(?:extended|extended edition)\b/.test(text)?'extended':
      /\btheatrical\b/.test(text)?'theatrical':
      /\b(?:unrated|uncut)\b/.test(text)?'uncut':'';
    return {source,edition};
  }
  function compareRelease(video,release){
    const a=releaseTraits(video),b=releaseTraits(release);
    const editionMismatch=!!a.edition&&!!b.edition&&a.edition!==b.edition;
    const sourceMismatch=!!a.source&&!!b.source&&a.source!==b.source;
    return {editionMismatch,sourceMismatch,editionMatch:!!a.edition&&a.edition===b.edition,
      sourceMatch:!!a.source&&a.source===b.source};
  }
  function scoreRelease(video,release){
    const source=normalizeTitle(video).split(' '),candidate=normalizeTitle(release).split(' ');
    if(!source.length||!candidate.length)return 0;
    const media=new Set(source),subs=new Set(candidate);
    const significant=new Set(['web','webrip','webdl','bluray','bdrip','remux','hdtv',
      'dvdrip','extended','directors','cut','proper','repack','x264','x265','h264','h265',
      'hevc','av1','480p','720p','1080p','2160p','4k','hdr','dv']);
    const traits=compareRelease(video,release);
    let score=(traits.editionMatch?100:0)-(traits.editionMismatch?180:0)+
      (traits.sourceMatch?45:0)-(traits.sourceMismatch?35:0);
    for(const token of media){
      if(token.length<3)continue;
      if(subs.has(token))score+=significant.has(token)?10:3;
      else if(significant.has(token)&&candidate.some(x=>significant.has(x)))score-=8;
    }
    const episodeA=episodeToken(video),episodeB=episodeToken(release);
    if(episodeA&&episodeB)score+=episodeA.season===episodeB.season&&episodeA.episode===episodeB.episode?100:-150;
    const a=normalizeTitle(video),b=normalizeTitle(release);
    if(a===b)score+=120;
    else if(a&&b&&(a.includes(b)||b.includes(a)))score+=35;
    return score;
  }
  const api = {normalizeTitle,resultYear,matchesTitle,selectTitle,lookupParams,searchParams,
    matchesQuality,matchesLanguage,canonicalLanguage,matchesEpisode,episodeToken,scoreRelease,compareRelease,selectCatalogTitle,releaseYear};
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MarmaladeSubtitleMatch = api;
})(typeof window !== 'undefined' ? window : globalThis);
