/* Marmalade movie & TV information — independent of playback and WebRTC streaming.
   APIs: TMDB (primary), OMDb (optional ratings), OpenSubtitles (optional hash match),
   Wikipedia (sourced production background). No AI or media upload. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const ui = {
    toggle: $('mediaInfoToggle'), panel: $('mediaInfoPanel'), close: $('miClose'),
    status: $('miStatus'), form: $('miSearchForm'), search: $('miSearch'),
    matches: $('miMatches'), results: $('miResults'), sources: $('miSources'),
    tmdb: $('miTmdbToken'), omdb: $('miOmdbKey'), subtitles: $('miSubtitlesKey'),
    save: $('miSave'), forget: $('miForget')
  };
  if (!ui.panel || !ui.toggle) return;
  const STORE = 'marmalade:media-info-keys:v1';
  const MAX_TEXT = 1200;
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
  ui.sources.open = !credentials.tmdb;
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
  function openPanel() {
    ui.panel.hidden = false;
    ui.toggle.setAttribute('aria-expanded', 'true');
    ui.panel.scrollIntoView({block: 'nearest', behavior: 'smooth'});
  }
  function closePanel() { ui.panel.hidden = true; ui.toggle.setAttribute('aria-expanded', 'false'); }
  ui.toggle.addEventListener('click', () => ui.panel.hidden ? openPanel() : closePanel());
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
    clean = clean.replace(/\s*[-–]\s*$/, '').trim();
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
        year: Number(String(general.Recorded_Date || general.Encoded_Date || '').slice(0,4)) || null,
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
    line(wrapper, 'span', 'mi-muted', 'Other matches');
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
    }).format(value) : 'Not reported';
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
  async function findMovie(parsed, seq, feature = null) {
    if (seq !== sequence) return;
    if (!credentials.tmdb) {
      status('Source setup needed');
      clearResult('Add a TMDB API key or read-access token in Sources to load cast, scores, budgets and more.');
      ui.sources.open = true;
      return;
    }
    status('Looking up filmography…');
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
        status('Title needed'); return;
      }
      const data = await tmdb('search/' + parsed.kind, {
        query:parsed.title, include_adult:'false', language:'en-US'
      });
      if (seq !== sequence) return;
      const items = (data.results || []).filter(x => x.id).sort((a,b) => rank(b,parsed)-rank(a,parsed));
      if (!items.length) {
        clearResult('No matching title found. Try a different title or release year.');
        status('No match'); return;
      }
      showChoices(items.slice(1), parsed, seq);
      if (rank(items[0], parsed) < 36 && items.length > 1) {
        showChoices(items, parsed, seq);
        status('Choose a matching title');
        ui.results.replaceChildren();
        line(ui.results, 'p', 'mi-empty', 'More than one title may match this file. Select the correct one above.');
        return;
      }
      await loadRecord(parsed.kind, items[0].id, parsed, seq);
    } catch (error) {
      if (seq !== sequence) return;
      status('Lookup unavailable');
      clearResult(error.message || 'Could not reach the movie database. Playback is unaffected.');
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
  async function loadRecord(kind, id, parsed, seq) {
    if (seq !== sequence) return;
    ui.results.replaceChildren();
    status('Loading details…');
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
        kind, id, imdbId, title:record.title || record.name,
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
      status('Details loaded');
      broadcast();
    } catch (error) {
      if (seq !== sequence) return;
      status('Lookup unavailable');
      clearResult(error.message || 'Could not load details.');
    }
  }
  function labeled(parent, title, value) {
    const item = line(parent,'div','mi-stat');
    line(item,'small','mi-muted',title);
    line(item,'strong','',value ?? 'Not reported');
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
    line(copy,'h2','',data.title + (data.year ? ' (' + data.year + ')' : ''));
    if (data.episodeTitle) line(copy,'p','mi-kicker',
      'Season ' + data.season + ', Episode ' + data.episode + ' — ' + data.episodeTitle);
    if (data.tagline) line(copy,'p','mi-tagline',data.tagline);
    line(copy,'p','mi-overview',data.episodeOverview || data.overview || 'No synopsis reported.');
    line(copy,'p','mi-muted',data.genres.join(' · '));
    const refs = line(copy,'div','mi-link-row');
    link(refs,'TMDB', 'https://www.themoviedb.org/' + data.kind + '/' + data.id);
    if (data.imdbId && /^tt\d+$/.test(data.imdbId))
      link(refs,'IMDb','https://www.imdb.com/title/' + data.imdbId + '/');
    const score = section(ui.results,'Ratings & reception');
    const scoreGrid = line(score,'div','mi-stats');
    labeled(scoreGrid,'TMDB community',data.score ? data.score.toFixed(1) + '/10' + (data.votes ? ' · ' + data.votes.toLocaleString() + ' votes' : '') : 'Not rated');
    if (data.imdbScore) labeled(scoreGrid,'IMDb via OMDb',data.imdbScore + '/10');
    if (data.metacritic) labeled(scoreGrid,'Metacritic via OMDb',data.metacritic + '/100');
    for (const rating of data.ratings || []) labeled(scoreGrid,rating.source,rating.value);
    const production = section(ui.results,'Production & finances');
    const financial = line(production,'div','mi-stats');
    labeled(financial,'Budget',data.kind === 'movie' ? plainMoney(data.budget) : 'Not consistently reported for TV');
    labeled(financial,'Worldwide revenue',data.kind === 'movie' ? plainMoney(data.revenue) : 'Not consistently reported for TV');
    if (data.omdbBoxOffice) labeled(financial,'Box office (OMDb)',data.omdbBoxOffice);
    if (data.runtime) labeled(financial,'Runtime',String(data.runtime) + ' min');
    if (data.release) labeled(financial,'Release / premiere',data.release);
    if (data.status) labeled(financial,'Status',data.status);
    if (data.seasons !== null && data.seasons !== undefined) labeled(financial,'Seasons',data.seasons);
    if (data.episodes !== null && data.episodes !== undefined) labeled(financial,'Episodes',data.episodes);
    if (data.airDate) labeled(financial,'Episode aired',data.airDate);
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
      const crew = section(ui.results,'Creators & crew');
      const names = line(crew,'div','mi-credit-grid');
      for (const person of data.crew) labeled(names,person.job,person.name);
    }
    const facts = section(ui.results,'Trivia & behind the scenes');
    if (data.wiki?.text) {
      line(facts,'p','mi-overview',data.wiki.text);
      link(facts,'Read production background on Wikipedia',data.wiki.url);
    } else {
      line(facts,'p','mi-muted','No verified production anecdotes found in the linked public sources.');
    }
    if (data.imdbId && /^tt\d+$/.test(data.imdbId))
      link(facts,'IMDb user-contributed trivia ↗','https://www.imdb.com/title/' + data.imdbId + '/trivia/');
    if (data.fileDetails) {
      const technical = section(ui.results,'Local video file');
      const stats = line(technical,'div','mi-stats');
      for (const [key,value] of Object.entries({
        Container:data.fileDetails.format,Video:data.fileDetails.codec,
        Resolution:data.fileDetails.resolution,Audio:data.fileDetails.audio
      })) if (value) labeled(stats,key,value);
    }
    const disclaimer = line(ui.results,'p','mi-footnote',
      'Scores are source-specific. Budgets/revenue can be incomplete or estimated; unavailable amounts are never treated as zero. Production notes are sourced, not AI-generated.');
    disclaimer.setAttribute('role','note');
  }
  async function start(file) {
    activeFile = file;
    displayed = null;
    const seq = ++sequence;
    const parsed = parseFilename(file.name);
    detected = {parsed, metadata:null};
    ui.search.value = parsed.title;
    openPanel();
    status('Identifying ' + file.name + '…');
    clearResult('Reading local file information…');
    const [metadata, match] = await Promise.all([
      fileMetadata(file), hashMatch(file)
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
    await findMovie(parsed,seq,match);
  }
  ui.form.addEventListener('submit', event => {
    event.preventDefault();
    const title = ui.search.value.trim().slice(0,160);
    if (!title) return;
    const original = detected?.parsed || {kind:'movie',season:null,episode:null,year:null};
    const parsed = {...original,title,year:null};
    detected = {...(detected||{}),parsed};
    void findMovie(parsed,++sequence);
  });
  ui.save.addEventListener('click', () => {
    credentials = {
      tmdb:ui.tmdb.value.trim(),omdb:ui.omdb.value.trim(),subtitles:ui.subtitles.value.trim()
    };
    try {localStorage.setItem(STORE,JSON.stringify(credentials));} catch {}
    ui.sources.open = false;
    status('Sources saved in this browser');
    if (activeFile) void start(activeFile);
  });
  ui.forget.addEventListener('click', () => {
    credentials = {};
    ui.tmdb.value = ui.omdb.value = ui.subtitles.value = '';
    try {localStorage.removeItem(STORE);} catch {}
    ui.sources.open = true;
    status('Source keys cleared');
  });
  window.addEventListener('marmalade:video-selected', event => {
    if (event.detail?.file) void start(event.detail.file);
  });
  window.addEventListener('marmalade:media-cleared', () => {
    ++sequence;activeFile=null;detected=null;displayed=null;
    ui.matches.replaceChildren();ui.results.replaceChildren();
    status('No video selected');closePanel();
  });
  window.MarmaladeInfoShare = () => share(displayed);
  window.MarmaladeInfoReceive = payload => {
    if (!payload || typeof payload !== 'object' || typeof payload.title !== 'string' ||
      payload.title.length > 250 || !['movie','tv'].includes(payload.kind) ||
      !Array.isArray(payload.cast) || payload.cast.length > 40) return;
    // Peer messages are not trusted; accept only compact source-generated fields.
    const valid = JSON.stringify(payload);
    if (valid.length > 40000) return;
    try {
      displayed = JSON.parse(valid);
      detected = null;
      render(displayed);
      status('Shared by host');
      openPanel();
    } catch {status('Movie information unavailable');}
  };
})();
