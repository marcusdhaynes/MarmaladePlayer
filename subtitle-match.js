/* Exact-title subtitle matching and filter helpers; shared by the browser and Node tests. */
(function(root) {
  'use strict';
  function normalizeTitle(value) {
    return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
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
  function releaseYear(value) {
    const candidates=String(value||'').match(/(?:18|19|20|21)\d{2}/g)||[];
    return candidates.length?Number(candidates[0]):null;
  }
  function matchesEpisode(file, subtitle, type, season, episode) {
    if (type !== 'tv') return true;
    const specifiedSeason = Number(season || 0), specifiedEpisode = Number(episode || 0);
    const fileSeason = Number(file?.season || subtitle?.season || 0);
    if (specifiedSeason && fileSeason && specifiedSeason !== fileSeason) return false;
    if (specifiedEpisode) {
      const fileEpisode = Number(file?.episode || subtitle?.episode || 0);
      const from = Number(subtitle?.episode_from || 0);
      const to = Number(subtitle?.episode_end || 0);
      if (fileEpisode && fileEpisode !== specifiedEpisode &&
          !(from && to && specifiedEpisode >= from && specifiedEpisode <= to)) return false;
      if (!fileEpisode && from && to && (specifiedEpisode < from || specifiedEpisode > to))
        return false;
    }
    return true;
  }
  const api = {normalizeTitle,resultYear,matchesTitle,selectTitle,lookupParams,searchParams,
    matchesQuality,matchesLanguage,canonicalLanguage,matchesEpisode,selectCatalogTitle,releaseYear};
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MarmaladeSubtitleMatch = api;
})(typeof window !== 'undefined' ? window : globalThis);
