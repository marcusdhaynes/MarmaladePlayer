/* Marmalade movie & TV information — independent of playback and WebRTC streaming.
   APIs: TMDB (primary), OMDb (optional ratings), OpenSubtitles (optional hash match),
   Wikipedia (sourced production background). No AI or media upload. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const ui = {
    toggle: $('mediaInfoToggle'), panel: $('mediaInfoPanel'), close: $('miClose'),
    status: $('miStatus'), form: $('miSearchForm'), search: $('miSearch'),
    matches: $('miMatches'), results: $('miResults'), sources: $('miSources'), kind: $('miKind'),
    tmdb: $('miTmdbToken'), omdb: $('miOmdbKey'), subtitles: $('miSubtitlesKey'),
    save: $('miSave'), forget: $('miForget')
  };
  if (!ui.panel || !ui.toggle) return;
  const STORE = 'marmalade:media-info-keys:v1';
  // Retire the former browser-only rating store; it is not an IMDb vote.
  try{localStorage.removeItem('marmalade:personal-movie-ratings:v1');}catch{}
  let activeFile = null;
  let detected = null;
  let displayed = null;
  let sequence = 0;
  let mediaInfoInstance = null;
  let credentials = {};
  try { credentials = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch {}
  ui.tmdb.value = credentials.tmdb || '';
  ui.omdb.value = credentials.omdb || '';
  ui.subtitles.value = credentials.subtitles || '';
  ui.sources.open = false;
  function node(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = String(text);
    return e;
  }
  function line(parent, tag, cls, text) { const e = node(tag, cls, text); parent.append(e); return e; }
  function link(parent, title, url) {
    if (!/^https:\/\//i.test(url || '')) return;
    const a = node('a', 'mi-link', title);
    a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    parent.append(a);
  }
  function status(value) { ui.status.textContent = value; }
  // IMDb supplies no supported third-party personal-rating write API.
  // All rating changes happen on IMDb, using the person's IMDb session.
  function imdbRatingUrl(data){
    const episode=data.kind==='tv'&&Number(data.season)>0&&Number(data.episode)>0;
    const exactId=episode?(data.imdbEpisodeId||
      (data.imdbRatingIsSeries?data.imdbId:null)):data.imdbId;
    if(/^tt\d{6,10}$/.test(String(exactId||'')))
      return 'https://www.imdb.com/title/'+exactId+'/';
    const parts=[data.title||'',data.year||''];
    if(episode){
      parts.push('S'+String(data.season).padStart(2,'0')+'E'+String(data.episode).padStart(2,'0'));
      if(data.episodeTitle)parts.push(data.episodeTitle);
    }
    return 'https://www.imdb.com/find/?q='+encodeURIComponent(parts.filter(Boolean).join(' '))+'&s=tt';
  }
  function personalRatingCard(parent,data){
    const button=line(parent,'a','mi-user-rating');
    button.href=imdbRatingUrl(data);
    button.target='_blank';
    button.rel='noopener noreferrer';
    button.title='Open IMDb to rate this title using your IMDb account';
    button.setAttribute('aria-label','Rate '+data.title+' on IMDb');
    line(button,'span','mi-user-rating-head','IMDb');
    line(button,'span','mi-user-rating-stars','★★★★★').setAttribute('aria-hidden','true');
    const rating=Number(data.imdbScore);
    const valid=Number.isFinite(rating)&&rating>0&&rating<=10;
    const number=line(button,'span','mi-user-rating-number',
      valid?rating.toFixed(1)+'/10':'Loading…');
    const note=line(button,'span','mi-user-rating-note',
      data.imdbRatingIsSeries?'Series Rating · IMDb ↗':'Rate on IMDb ↗');
    if(!valid && window.MarmaladePublicMovieInfo?.lookupImdbRating){
      void window.MarmaladePublicMovieInfo.lookupImdbRating(data).then(found=>{
        if(displayed!==data||!button.isConnected)return;
        if(!found?.score){number.textContent='N/A';return;}
        data.imdbScore=Number(found.score).toFixed(1);
        data.imdbScoreVia=found.via||'Public IMDb Data';
        data.imdbRatingIsSeries=!!found.isSeriesRating;
        if(/^tt\\d{6,10}$/.test(String(found.id||''))){
          if(data.kind==='tv'&&data.season>0&&data.episode>0&&!found.isSeriesRating)
            data.imdbEpisodeId=found.id;
          else data.imdbId=found.id;
        }
        // A fresh render displays the score in both the compact title box and
        // Ratings & Reception, without affecting video playback or local votes.
        render(data);
        broadcast();
      }).catch(()=>{if(button.isConnected)number.textContent='N/A';});
    }else if(!valid)number.textContent='N/A';
    return button;
  }
  function openPanel(scroll = false) {
    ui.panel.hidden = false;
    ui.toggle.setAttribute('aria-expanded', 'true');
    if (scroll) ui.panel.scrollIntoView({block: 'nearest', behavior: 'smooth'});
  }
  function closePanel() { ui.panel.hidden = true; ui.toggle.setAttribute('aria-expanded', 'false'); }
  ui.toggle.addEventListener('click', () => ui.panel.hidden ? openPanel(true) : closePanel());
  ui.close.addEventListener('click', closePanel);
  function normalize(value) {
    return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function parseFilename(name) {
    const base = String(name || '').replace(/\.[^.]+$/, '').replace(/[._]/g, ' ')
      .replace(/\[[^\]]+\]|\{[^}]+\}/g, ' ').replace(/\s+/g, ' ').trim();
    const episode = base.match(/\bS(\d{1,2})\s*E(\d{1,3})\b/i) ||
      base.match(/\b(\d{1,2})x(\d{1,3})\b/i);
    const marker = /\b(?:2160p|1080p|720p|480p|4K|HDR10?|DV|BluRay|BDRip|WEB[- ]?DL|WEBRip|DVDRip|x26[45]|h26[45]|HEVC|AAC|AC3|DTS|REMUX|PROPER|REPACK|YIFY)\b/i;
    let clean = base.split(marker)[0];
    if (episode) clean = clean.slice(0, episode.index);
    const year = clean.match(/\b(19\d{2}|20\d{2})\b/);
    if (year && !episode) clean = clean.slice(0, year.index);
    clean = clean.replace(/[\s(\[{–-]+$/, '').trim();
    return {
      title: clean || base,
      year: year ? Number(year[1]) : null,
      kind: episode ? 'tv' : 'movie',
      season: episode ? Number(episode[1]) : null,
      episode: episode ? Number(episode[2]) : null
    };
  }
  async function fileMetadata(file) {
    try {
      if (typeof window.MediaInfo !== 'function') return null;
      if (!mediaInfoInstance) mediaInfoInstance = await window.MediaInfo({format:'object', full:false});
      const data = await mediaInfoInstance.analyzeData(file.size,
        async (size, offset) => new Uint8Array(await file.slice(offset, offset + size).arrayBuffer()));
      const tracks = data?.media?.track || [];
      const general = tracks.find(t => t['@type'] === 'General') || {};
      const video = tracks.find(t => t['@type'] === 'Video') || {};
      const audio = tracks.find(t => t['@type'] === 'Audio') || {};
      return {
        title: general.Movie || general.Title || general.Track || '',
        year: null, // Recorded/encoded dates describe the file, not the movie release.
        kind: general.TVShow ? 'tv' : '',
        series: general.TVShow || '',
        season: Number(general.Season) || null, episode: Number(general.Episode) || null,
        format: general.Format || '', codec: video.Format || '',
        resolution: video.Width && video.Height ? video.Width + ' × ' + video.Height : '',
        audio: audio.Format || '', duration: Number(general.Duration) || 0
      };
    } catch (error) {
      console.info('Embedded metadata unavailable; using filename.', error);
      return null;
    }
  }
  async function osHash(file) {
    const size = 65536;
    if (!file || file.size < size * 2) return null;
    const read = async (offset) => new DataView(await file.slice(offset, offset + size).arrayBuffer());
    let hash = BigInt(file.size);
    for (const part of [await read(0), await read(file.size - size)]) {
      for (let i = 0; i < size; i += 8)
        hash = BigInt.asUintN(64, hash + part.getBigUint64(i, true));
    }
    return hash.toString(16).padStart(16, '0');
  }
  async function hashMatch(file) {
    if (!credentials.subtitles || !file) return null;
    try {
      const hash = await osHash(file);
      if (!hash) return null;
      const params = new URLSearchParams({moviehash:hash, query:file.name.toLowerCase()});
      const response = await fetch('https://api.opensubtitles.com/api/v1/subtitles?' + params, {
        headers: {'Api-Key':credentials.subtitles, 'Accept':'application/json'}
      });
      if (!response.ok) return null;
      const payload = await response.json();
      const result = (payload.data || []).find(r => r.attributes?.moviehash_match === true);
      return result?.attributes?.feature_details || null;
    } catch { return null; } // CORS or rate limits must never interrupt playback.
  }
  async function tmdb(path, params = {}) {
    const url = new URL('https://api.themoviedb.org/3/' + path.replace(/^\/+/, ''));
    for (const [key, value] of Object.entries(params))
      if (value !== null && value !== undefined && value !== '') url.searchParams.set(key, value);
    const token = credentials.tmdb.trim();
    const headers = {Accept:'application/json'};
    if (token.startsWith('eyJ')) headers.Authorization = 'Bearer ' + token;
    else url.searchParams.set('api_key', token);
    const response = await fetch(url, {headers});
    if (!response.ok) throw new Error(response.status === 401 ? 'TMDB key/token rejected.' : 'TMDB request failed (' + response.status + ').');
    return response.json();
  }
  function rank(item, parsed) {
    const title = item.title || item.name || '';
    let score = normalize(title) === normalize(parsed.title) ? 100 : 0;
    if (normalize(item.original_title || item.original_name) === normalize(parsed.title)) score += 50;
    if (normalize(title).includes(normalize(parsed.title)) && parsed.title.length >= 3) score += 35;
    const released = (item.release_date || item.first_air_date || '').slice(0, 4);
    if (parsed.year && Number(released) === parsed.year) score += 80;
    else if (parsed.year && Math.abs(Number(released) - parsed.year) === 1) score += 10;
    return score + Math.min(Number(item.popularity) || 0, 100) / 100;
  }
  function showChoices(items, parsed, seq) {
    ui.matches.replaceChildren();
    if (!items.length) return;
    const wrapper = line(ui.matches, 'div', 'mi-match-row');
    line(wrapper, 'span', 'mi-muted', 'Other Matches');
    for (const item of items.slice(0, 5)) {
      const year = (item.release_date || item.first_air_date || '').slice(0,4);
      const button = line(wrapper, 'button', 'mi-choice', (item.title || item.name) + (year ? ' (' + year + ')' : ''));
      button.type = 'button';
      button.addEventListener('click', () => { void loadRecord(parsed.kind, item.id, parsed, seq); });
    }
  }
  function plainMoney(value) {
    return Number(value) > 0 ? new Intl.NumberFormat('en-US', {
      style:'currency', currency:'USD', maximumFractionDigits:0
    }).format(value) : 'Not Reported';
  }
  function share(info) {
    return info ? JSON.parse(JSON.stringify(info)) : null;
  }
  function broadcast() {
    if (typeof window.MarmaladeInfoBroadcast === 'function') window.MarmaladeInfoBroadcast(share(displayed));
  }
  function clearResult(message) {
    displayed = null;
    ui.matches.replaceChildren();
    ui.results.replaceChildren();
    line(ui.results, 'p', 'mi-empty', message);
    broadcast();
  }
  function validOmdbMatch(result,record){
    if(!result||result.Response!=='True')return false;
    const sourceTitle=normalize(result.Title),wanted=normalize(record.title);
    if(!sourceTitle||!wanted||sourceTitle!==wanted)return false;
    const foundYear=Number(String(result.Year||'').match(/^(?:19|20)\d{2}/)?.[0]||0);
    const wantedYear=Number(String(record.year||'').slice(0,4))||0;
    if(wantedYear&&foundYear&&foundYear!==wantedYear)return false;
    if(record.kind==='movie'&&result.Type&&result.Type!=='movie')return false;
    if(record.kind==='tv'&&result.Type&&result.Type!=='series'&&result.Type!=='episode')return false;
    return true;
  }
  async function enhancePublicDisplay(record,parsed,seq){
    const publicInfo=window.MarmaladePublicMovieInfo;
    const [wiki,omdb]=await Promise.allSettled([
      record.source==='wikipedia'&&publicInfo?.enrichFilm?
        publicInfo.enrichFilm(record):Promise.resolve({}),
      credentials.omdb?fetchOmdb(null,{...parsed,title:record.title,
        year:Number(record.year)||null}):Promise.resolve(null)
    ]);
    if(seq!==sequence||displayed!==record)return;
    const details=wiki.status==='fulfilled'&&wiki.value&&typeof wiki.value==='object'?wiki.value:{};
    const next={...record};
    const receivedScores=Array.isArray(details.ratings)?details.ratings:[];
    if(details.budgetText)next.budgetText=details.budgetText;
    if(details.revenueText)next.revenueText=details.revenueText;
    if(details.runtimeText&&!next.runtime)next.runtimeText=details.runtimeText;
    if(details.budget>0&&!next.budget)next.budget=details.budget;
    if(details.revenue>0&&!next.revenue)next.revenue=details.revenue;
    if(details.receptionText)next.receptionText=details.receptionText;
    if(details.imdbId)next.imdbId=details.imdbId;
    const omdbData=omdb.status==='fulfilled'&&validOmdbMatch(omdb.value,next)?omdb.value:null;
    if(omdbData){
      if(/^tt\d{6,10}$/.test(omdbData.imdbID||''))next.imdbId=omdbData.imdbID;
      if(omdbData.imdbRating&&omdbData.imdbRating!=='N/A')next.imdbScore=omdbData.imdbRating;
      if(omdbData.Metascore&&omdbData.Metascore!=='N/A')next.metacritic=omdbData.Metascore;
      if(omdbData.BoxOffice&&omdbData.BoxOffice!=='N/A')next.omdbBoxOffice=omdbData.BoxOffice;
      if(omdbData.Awards&&omdbData.Awards!=='N/A')next.awards=omdbData.Awards;
      next.ratings=(omdbData.Ratings||[]).map(r=>({source:r.Source,value:r.Value}));
      for(const rating of receivedScores){
        if(!next.ratings.some(r=>normalize(r.source)===normalize(rating.source)))
          next.ratings.push(rating);
      }
    }else if(receivedScores.length)next.ratings=receivedScores;
    const hasUpdates=!!(next.budgetText||next.revenueText||next.receptionText||next.imdbId||
      next.ratings.length||next.omdbBoxOffice||next.awards);
    if(!hasUpdates)return;
    displayed=next;
    render(next);
    status('Ratings & Financial Details Loaded');
    broadcast();
  }
  async function publicLookup(parsed,seq,priorError=null){
    if(seq!==sequence)return;
    const source=window.MarmaladePublicMovieInfo;
    if(!source){
      status('Information Source Unavailable');
      clearResult('Could not initialize the public movie-information source.');
      return;
    }
    if(!parsed.title||parsed.title.length<2){
      status('Title Needed');
      clearResult('Enter a Movie or Series Title to find information.');
      return;
    }
    status('Looking Up Movie Information…');
    try{
      const {record,alternatives}=await source.lookup(parsed);
      if(seq!==sequence)return;
      displayed={...record,fileDetails:detected?.metadata||null};
      render(displayed);
      status('Details Loaded Automatically');
      ui.sources.open=false;
      broadcast();
      void enhancePublicDisplay(displayed,parsed,seq);
      if(Array.isArray(alternatives)&&alternatives.length){
        ui.matches.replaceChildren();
        const wrap=line(ui.matches,'div','mi-match-row');
        line(wrap,'span','mi-muted','Other Film Versions');
        for(const title of alternatives){
          const button=line(wrap,'button','mi-choice',title);
          button.type='button';
          button.addEventListener('click',async()=>{
            if(seq!==sequence)return;
            status('Loading Selected Version…');
            try{
              const selected=await source.article(title,parsed);
              if(seq!==sequence)return;
              displayed={...selected,fileDetails:detected?.metadata||null};
              render(displayed);
              status('Details Loaded Automatically');
              broadcast();
              void enhancePublicDisplay(displayed,parsed,seq);
            }catch(error){if(seq===sequence)status('Version Unavailable');}
          });
        }
      }
    }catch(error){
      if(seq!==sequence)return;
      status('Information Unavailable');
      clearResult('Automatic movie-information lookup failed. '+
        (error?.message||'Try a more specific title or release year.')+
        (priorError?' The optional TMDB source also failed.':''));
      ui.sources.open=false;
    }
  }
  async function findMovie(parsed, seq, feature = null) {
    if (seq !== sequence) return;
    if (!credentials.tmdb) {
      await publicLookup(parsed,seq);
      return;
    }
    status('Looking Up Filmography…');
    try {
      if (feature?.parent_tmdb_id && parsed.kind === 'tv') {
        await loadRecord('tv', feature.parent_tmdb_id, parsed, seq); return;
      }
      if (feature?.tmdb_id && parsed.kind === 'movie') {
        await loadRecord('movie', feature.tmdb_id, parsed, seq); return;
      }
      if (feature?.imdb_id && parsed.kind === 'movie') {
        const imdb = 'tt' + String(feature.imdb_id).padStart(7, '0');
        const found = await tmdb('find/' + imdb, {external_source:'imdb_id'});
        const match = found.movie_results?.[0];
        if (match) { await loadRecord('movie', match.id, parsed, seq); return; }
      }
      if (!parsed.title || parsed.title.length < 2) {
        clearResult('Enter a movie or show title to search.');
        status('Title Needed'); return;
      }
      const data = await tmdb('search/' + parsed.kind, {
        query:parsed.title, include_adult:'false', language:'en-US'
      });
      if (seq !== sequence) return;
      const items = (data.results || []).filter(x => x.id).sort((a,b) => rank(b,parsed)-rank(a,parsed));
      if (!items.length) {
        clearResult('No matching title found. Try a different title or release year.');
        status('No Match'); return;
      }
      showChoices(items.slice(1), parsed, seq);
      if (rank(items[0], parsed) < 36) {
        showChoices(items, parsed, seq);
        status('Choose a Matching Title');
        ui.results.replaceChildren();
        line(ui.results, 'p', 'mi-empty', 'More than one title may match this file. Select the correct one above.');
        return;
      }
      await loadRecord(parsed.kind, items[0].id, parsed, seq);
    } catch (error) {
      if (seq !== sequence) return;
      await publicLookup(parsed,seq,error);
    }
  }
  async function fetchOmdb(imdbId, parsed) {
    if (!credentials.omdb) return null;
    const params = new URLSearchParams({apikey:credentials.omdb, plot:'full'});
    if (imdbId) params.set('i', imdbId);
    else {
      params.set('t', parsed.title);
      if (parsed.year) params.set('y', parsed.year);
    }
    const response = await fetch('https://www.omdbapi.com/?' + params);
    if (!response.ok) return null;
    const result = await response.json();
    return result.Response === 'True' ? result : null;
  }
  async function productionNotes(title, year, kind) {
    try {
      const query = title + ' ' + (year || '') + (kind === 'movie' ? ' film' : ' television series');
      const url = new URL('https://en.wikipedia.org/w/api.php');
      url.search = new URLSearchParams({
        action:'query', generator:'search', gsrsearch:query, gsrlimit:'3',
        prop:'extracts', explaintext:'1', redirects:'1', format:'json', origin:'*'
      }).toString();
      const response = await fetch(url);
      if (!response.ok) return null;
      const json = await response.json();
      const pages = Object.values(json.query?.pages || {});
      const page = pages.find(p => normalize(p.title).includes(normalize(title))) || null;
      if (!page) return null;
      const content = String(page.extract || '');
      const match = content.match(/(?:^|\n)(Production|Development|Filming|Casting)\s*\n([\s\S]*?)(?=\n[A-Z][A-Za-z ]{3,35}\n|$)/i);
      if (!match) return null;
      const text = match[2].replace(/\s+/g, ' ').trim().slice(0, 900);
      if (!text) return null;
      return {text, title:page.title, url:'https://en.wikipedia.org/?curid=' + page.pageid};
    } catch { return null; }
  }
  async function enhanceMissingTmdbFields(record,parsed,seq){
    if(record.kind!=='movie'||!window.MarmaladePublicMovieInfo||
        (record.budget>0&&record.revenue>0&&record.score>0))return;
    try{
      const source=window.MarmaladePublicMovieInfo;
      const {record:wiki}=await source.lookup({kind:'movie',title:record.title,
        year:Number(record.year)||null,season:null,episode:null});
      if(!wiki||wiki.source!=='wikipedia'||normalize(wiki.title)!==normalize(record.title))return;
      if(wiki.year&&record.year&&Number(wiki.year)!==Number(record.year))return;
      const details=await source.enrichFilm(wiki);
      if(seq!==sequence||displayed!==record)return;
      const next={...record};
      let updated=false;
      if(!record.budget&&details.budgetText){
        next.budgetText=details.budgetText;next.budget=details.budget||0;updated=true;
      }
      if(!record.revenue&&details.revenueText){
        next.revenueText=details.revenueText;next.revenue=details.revenue||0;updated=true;
      }
      if(!record.imdbId&&details.imdbId){next.imdbId=details.imdbId;updated=true;}
      if(details.receptionText){next.receptionText=details.receptionText;updated=true;}
      const wikiRatings=Array.isArray(details.ratings)?details.ratings:[];
      if(wikiRatings.length){
        next.ratings=[...(next.ratings||[])];
        for(const rating of wikiRatings)if(!next.ratings.some(r=>
          normalize(r.source)===normalize(rating.source))){
          next.ratings.push(rating);updated=true;
        }
      }
      if(!updated)return;
      next.financeSourceUrl=wiki.wiki?.url||'';
      next.receptionSourceUrl=wiki.wiki?.url||'';
      displayed=next;render(next);broadcast();
    }catch{} // Never let an optional source alter existing TMDB results.
  }
  async function loadRecord(kind, id, parsed, seq) {
    if (seq !== sequence) return;
    ui.results.replaceChildren();
    status('Loading Details…');
    try {
      const extra = kind === 'movie'
        ? 'credits,external_ids,keywords,videos'
        : 'aggregate_credits,external_ids,keywords,videos';
      const record = await tmdb(kind + '/' + encodeURIComponent(id), {append_to_response:extra});
      if (seq !== sequence) return;
      let episode = null;
      if (kind === 'tv' && parsed.season !== null && parsed.episode !== null) {
        episode = await tmdb('tv/' + id + '/season/' + parsed.season + '/episode/' + parsed.episode,
          {append_to_response:'credits,external_ids'}).catch(() => null);
      }
      if (seq !== sequence) return;
      const cast = kind === 'movie' ? record.credits?.cast || [] : record.aggregate_credits?.cast || [];
      const crew = kind === 'movie' ? record.credits?.crew || [] : record.aggregate_credits?.crew || [];
      const imdbId = episode?.external_ids?.imdb_id || record.external_ids?.imdb_id || record.imdb_id || null;
      const year = (record.release_date || record.first_air_date || '').slice(0, 4);
      const [omdbResult, wikipedia] = await Promise.all([
        fetchOmdb(imdbId, parsed).catch(() => null),
        productionNotes(record.title || record.name, year, kind).catch(() => null)
      ]);
      if (seq !== sequence) return;
      const primaryCrew = crew.filter(x => ['Director','Writer','Screenplay','Creator'].includes(x.job) ||
        ['Directing','Writing'].includes(x.department)).slice(0,12);
      displayed = {
        source:'tmdb',kind,id,imdbId,
        imdbEpisodeId:episode?.external_ids?.imdb_id||null,
        title:record.title || record.name,
        year, tagline:record.tagline || '', overview:record.overview || '',
        poster:record.poster_path ? 'https://image.tmdb.org/t/p/w342' + record.poster_path : '',
        backdrop:record.backdrop_path ? 'https://image.tmdb.org/t/p/w780' + record.backdrop_path : '',
        genres:(record.genres || []).map(x=>x.name).slice(0,8),
        release:record.release_date || record.first_air_date || '',
        runtime:record.runtime || (record.episode_run_time || [])[0] || null,
        status:record.status || '', language:record.original_language || '',
        countries:(record.production_countries || record.origin_country || []).map(x=>typeof x==='string'?x:(x.name||'')),
        companies:(record.production_companies || []).map(x=>x.name).slice(0,8),
        networks:(record.networks || []).map(x=>x.name).slice(0,6),
        seasons:record.number_of_seasons || null, episodes:record.number_of_episodes || null,
        season:parsed.season, episode:parsed.episode,
        episodeTitle:episode?.name || '', episodeOverview:episode?.overview || '',
        airDate:episode?.air_date || '',
        budget:Number(record.budget)||0, revenue:Number(record.revenue)||0,
        score:Number(record.vote_average)||0, votes:Number(record.vote_count)||0,
        cast:cast.slice(0,24).map(x=>({name:x.name,character:x.character || (x.roles||[]).map(r=>r.character).filter(Boolean).join(', '),
          picture:x.profile_path?'https://image.tmdb.org/t/p/w185'+x.profile_path:''})),
        crew:primaryCrew.map(x=>({name:x.name,job:x.job || x.department})),
        awards:omdbResult?.Awards && omdbResult.Awards!=='N/A'?omdbResult.Awards:'',
        ratings:(omdbResult?.Ratings || []).map(x=>({source:x.Source, value:x.Value})),
        imdbScore:omdbResult?.imdbRating && omdbResult.imdbRating!=='N/A'?omdbResult.imdbRating:'',
        metacritic:omdbResult?.Metascore && omdbResult.Metascore!=='N/A'?omdbResult.Metascore:'',
        omdbBoxOffice:omdbResult?.BoxOffice && omdbResult.BoxOffice!=='N/A'?omdbResult.BoxOffice:'',
        wiki:wikipedia,
        fileDetails:detected?.metadata || null
      };
      render(displayed);
      status('Details Loaded');
      broadcast();
      void enhanceMissingTmdbFields(displayed,parsed,seq);
    } catch (error) {
      if (seq !== sequence) return;
      await publicLookup(parsed,seq,error);
    }
  }
  function labeled(parent, title, value) {
    const item = line(parent,'div','mi-stat');
    line(item,'small','mi-muted',title);
    line(item,'strong','',value ?? 'Not Reported');
  }
  function section(parent, heading) {
    const sec = line(parent,'section','mi-section');
    line(sec,'h3','',heading);
    return sec;
  }
  function render(data) {
    ui.results.replaceChildren();
    const hero = line(ui.results,'div','mi-hero');
    if (data.poster) {
      const img = node('img','mi-poster');
      img.src = data.poster; img.alt = 'Poster for ' + data.title; img.loading = 'lazy';
      hero.append(img);
    }
    const copy = line(hero,'div','mi-hero-copy');
    const titleRow=line(copy,'div','mi-title-line');
    line(titleRow,'h2','',data.title + (data.year ? ' (' + data.year + ')' : ''));
    personalRatingCard(titleRow,data);
    if (data.episodeTitle) line(copy,'p','mi-kicker',
      'Season ' + data.season + ', Episode ' + data.episode + ' — ' + data.episodeTitle);
    if (data.tagline) line(copy,'p','mi-tagline',data.tagline);
    line(copy,'p','mi-overview',data.episodeOverview || data.overview || 'No synopsis reported.');
    line(copy,'p','mi-muted',data.genres.join(' · '));
    const refs = line(copy,'div','mi-link-row');
    if(data.source==='tvmaze'&&/^https:\/\//.test(data.sourceUrl||''))
      link(refs,'TVmaze',data.sourceUrl);
    else if(data.source==='wikipedia'&&/^https:\/\//.test(data.sourceUrl||''))
      link(refs,'Wikipedia',data.sourceUrl);
    else if(!data.source||data.source==='tmdb')
      link(refs,'TMDB', 'https://www.themoviedb.org/' + data.kind + '/' + data.id);
    // The compact IMDb card beside the title opens its official rating flow.
    const score = section(ui.results,'Ratings & Reception');
    const scoreGrid = line(score,'div','mi-stats');
    let listed=0;
    if(Number(data.score)>0){
      labeled(scoreGrid,data.source==='tvmaze'?'TVmaze Viewers':'TMDB Community',
        Number(data.score).toFixed(1)+'/10'+(data.votes?' · '+Number(data.votes).toLocaleString()+' Votes':''));
      listed++;
    }
    if(data.imdbScore){
      const via=data.imdbScoreVia||'OMDb';
      const suffix=data.imdbRatingIsSeries?' · Series':'';
      labeled(scoreGrid,'IMDb'+suffix+' (via '+via+')',data.imdbScore+'/10');
      listed++;
    }
    if(data.metacritic){labeled(scoreGrid,'Metacritic (via OMDb)',data.metacritic+'/100');listed++;}
    for(const rating of data.ratings||[]){
      if(!rating?.source||!rating.value)continue;
      if(/Internet Movie Database/i.test(rating.source)||
          (/Metacritic/i.test(rating.source)&&data.metacritic))continue;
      labeled(scoreGrid,rating.source+(rating.via?' (via '+rating.via+')':''),rating.value);
      listed++;
    }
    if(!listed)labeled(scoreGrid,'Public Ratings','Not Available From Connected Sources');
    if(data.receptionText){
      const text=line(score,'p','mi-reception-text',data.receptionText);
      text.title='Source: '+(data.wiki?.title||'Wikipedia');
      if(data.receptionSourceUrl||data.wiki?.url)
        link(score,'Reception Source · Wikipedia',data.receptionSourceUrl||data.wiki.url);
    }
    const production = section(ui.results,'Production & Finances');
    const financial = line(production,'div','mi-stats');
    labeled(financial,'Budget',data.kind==='movie'
      ?(data.budgetText||plainMoney(data.budget)):'Not Consistently Reported for TV');
    labeled(financial,'Worldwide Revenue',data.kind==='movie'
      ?(data.revenueText||plainMoney(data.revenue)):'Not Consistently Reported for TV');
    if((data.budgetText||data.revenueText)&&(data.financeSourceUrl||data.wiki?.url))
      link(production,'Financial Figures · Wikipedia',data.financeSourceUrl||data.wiki.url);
    if (data.omdbBoxOffice) labeled(financial,'Box Office (OMDb)',data.omdbBoxOffice);
    if(data.runtime||data.runtimeText)
      labeled(financial,'Runtime',data.runtimeText||String(data.runtime)+' min');
    if (data.release) labeled(financial,'Release / Premiere',data.release);
    if (data.status) labeled(financial,'Status',data.status);
    if (data.seasons !== null && data.seasons !== undefined) labeled(financial,'Seasons',data.seasons);
    if (data.episodes !== null && data.episodes !== undefined) labeled(financial,'Episodes',data.episodes);
    if (data.airDate) labeled(financial,'Episode Aired',data.airDate);
    if (data.companies.length) labeled(financial,'Studios',data.companies.join(', '));
    if (data.networks.length) labeled(financial,'Networks',data.networks.join(', '));
    if (data.countries.length) labeled(financial,'Countries',data.countries.join(', '));
    if (data.awards) {
      const awards = section(ui.results,'Awards');
      line(awards,'p','mi-overview',data.awards);
    }
    if (data.cast.length) {
      const actors = section(ui.results,'Cast');
      const grid = line(actors,'div','mi-cast-grid');
      for (const person of data.cast) {
        const member = line(grid,'div','mi-person');
        if (person.picture) {
          const img = node('img','mi-headshot');
          img.src=person.picture; img.alt=''; img.loading='lazy'; member.append(img);
        }
        const labels = line(member,'div','mi-person-label');
        line(labels,'strong','',person.name);
        if (person.character) line(labels,'small','mi-muted',person.character);
      }
    }
    if (data.crew.length) {
      const crew = section(ui.results,'Creators & Crew');
      const names = line(crew,'div','mi-credit-grid');
      for (const person of data.crew) labeled(names,person.job,person.name);
    }
    const facts = section(ui.results,'Trivia & Behind the Scenes');
    if (data.wiki?.text) {
      line(facts,'p','mi-overview',data.wiki.text);
      link(facts,'Read Production Background on Wikipedia',data.wiki.url);
    } else {
      line(facts,'p','mi-muted','No verified production anecdotes found in the linked public sources.');
    }
    if (data.imdbId && /^tt\d+$/.test(data.imdbId))
      link(facts,'IMDb User-Contributed Trivia ↗','https://www.imdb.com/title/' + data.imdbId + '/trivia/');
    if (data.fileDetails) {
      const technical = section(ui.results,'Local Video File');
      const stats = line(technical,'div','mi-stats');
      for (const [key,value] of Object.entries({
        Container:data.fileDetails.format,Video:data.fileDetails.codec,
        Resolution:data.fileDetails.resolution,Audio:data.fileDetails.audio
      })) if (value) labeled(stats,key,value);
    }
    const disclaimer = line(ui.results,'p','mi-footnote',
      'Rate on IMDb opens IMDb itself, where your vote is saved to your IMDb account. MarmaladePlayer does not read or store personal IMDb ratings. Public scores and financial figures depend on available sourced data.');
    disclaimer.setAttribute('role','note');
  }
  async function start(file) {
    activeFile = file;
    displayed = null;
    const seq = ++sequence;
    const parsed = parseFilename(file.name);
    detected = {parsed, metadata:null};
    ui.search.value = parsed.title;
    ui.kind.value = parsed.kind;
    openPanel();
    status('Identifying ' + file.name + '…');
    clearResult('Reading local file information…');
    const limited = (task, timeout = 6500) => Promise.race([
      task.catch(() => null), new Promise(resolve => setTimeout(() => resolve(null), timeout))
    ]);
    // Automatic title-first lookup; media parsing and optional file-hash lookup
    // refine the result later without holding up the initial information panel.
    const initial={...parsed};
    void findMovie(initial,seq);
    const [metadata, match] = await Promise.all([
      limited(fileMetadata(file),3500), limited(hashMatch(file),2500)
    ]);
    if (seq !== sequence) return;
    detected.metadata = metadata;
    if (metadata?.series) { parsed.title = metadata.series; parsed.kind = 'tv'; }
    else if (metadata?.title && metadata.title.length > 2 && !/^\w{6,15}\d+$/.test(metadata.title))
      parsed.title = metadata.title;
    if (metadata?.season) { parsed.season = metadata.season; parsed.kind = 'tv'; }
    if (metadata?.episode) { parsed.episode = metadata.episode; parsed.kind = 'tv'; }
    if (!parsed.year && metadata?.year) parsed.year = metadata.year;
    if (match?.parent_title) {parsed.title = match.parent_title; parsed.kind = 'tv';}
    else if (match?.title && match.feature_type === 'Movie') {parsed.title = match.title; parsed.kind = 'movie';}
    if (match?.season_number) parsed.season=Number(match.season_number);
    if (match?.episode_number) parsed.episode=Number(match.episode_number);
    ui.search.value = parsed.title;
    ui.kind.value = parsed.kind;
    if(normalize(initial.title)!==normalize(parsed.title)||initial.kind!==parsed.kind||
      initial.year!==parsed.year||initial.season!==parsed.season||
      initial.episode!==parsed.episode||match?.tmdb_id||
      match?.parent_tmdb_id||match?.imdb_id){
      await findMovie(parsed,++sequence,match);
    }
  }
  ui.form.addEventListener('submit', event => {
    event.preventDefault();
    const title = ui.search.value.trim().slice(0,160);
    if (!title) return;
    const original = detected?.parsed || {kind:'movie',season:null,episode:null,year:null};
    const parsed = {...original,title,kind:ui.kind.value,year:null};
    detected = {...(detected||{}),parsed};
    void findMovie(parsed,++sequence);
  });
  ui.save.addEventListener('click', () => {
    credentials = {
      tmdb:ui.tmdb.value.trim(),omdb:ui.omdb.value.trim(),subtitles:ui.subtitles.value.trim()
    };
    try {localStorage.setItem(STORE,JSON.stringify(credentials));} catch {}
    ui.sources.open = false;
    status('Sources Saved in This Browser');
    if(activeFile)void start(activeFile);
    else if(ui.search.value.trim()){
      const parsed={...(detected?.parsed||{season:null,episode:null,year:null}),
        title:ui.search.value.trim(),kind:ui.kind.value};
      void findMovie(parsed,++sequence);
    }
  });
  ui.forget.addEventListener('click', () => {
    credentials = {};
    ui.tmdb.value = ui.omdb.value = ui.subtitles.value = '';
    try {localStorage.removeItem(STORE);} catch {}
    ui.sources.open = true;
    status('Source Keys Cleared');
  });
  window.addEventListener('marmalade:video-selected', event => {
    if (event.detail?.file) void start(event.detail.file);
  });
  window.addEventListener('marmalade:media-cleared', () => {
    ++sequence;activeFile=null;detected=null;displayed=null;
    ui.matches.replaceChildren();ui.results.replaceChildren();
    status('No Video Selected');closePanel();
  });
  window.MarmaladeInfoShare = () => share(displayed);
  window.MarmaladeInfoReceive = payload => {
    if (payload === null) {
      displayed = null; detected = null;
      ui.matches.replaceChildren();ui.results.replaceChildren();
      status('Host Is Identifying the Video');
      closePanel(); return;
    }
    if (!payload || typeof payload !== 'object' || typeof payload.title !== 'string' ||
      payload.title.length > 250 || !['movie','tv'].includes(payload.kind) ||
      !Array.isArray(payload.cast) || payload.cast.length > 40) return;
    // Peer messages are not trusted; accept only compact source-generated fields.
    try {
      const valid = JSON.stringify(payload);
      if (valid.length > 40000) return;
      displayed = JSON.parse(valid);
      detected = null;
      render(displayed);
      status('Shared by Host');
      openPanel();
    } catch {status('Movie Information Unavailable');}
  };
})();
