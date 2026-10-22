import assert from 'node:assert/strict';
import match from '../subtitle-match.js';
const fetchJson=async url=>{
  const response=await fetch(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(16000)});
  assert.equal(response.status,200, 'Subtitle provider request failed');
  return response.json();
};
const title='Beauty and the Beast';
const year=1991;
const catalog=await fetchJson('https://v3-cinemeta.strem.io/catalog/movie/top/search='+encodeURIComponent(title)+'.json');
const media=match.selectCatalogTitle(catalog.metas,title,year,'movie');
assert.ok(media,'Cinemeta must identify the 1991 movie');
assert.equal(media.id,'tt0101414','Must never select 2017 remake');
const result=await fetchJson('https://opensubtitles-v3.strem.io/subtitles/movie/'+media.id+'.json');
const subtitles=Array.isArray(result.subtitles)?result.subtitles:[];
const english=subtitles.filter(s=>match.matchesLanguage(s.lang,'en')&&
  /^https:\/\/[a-z0-9.-]+\.strem\.io\//i.test(s.url||''));
assert.ok(english.length>0,'The 1991 movie should have usable English subtitle URLs');
console.log('PASS: 1991 IMDb tt0101414 has',english.length,'English subtitle results (',subtitles.length,'total).');
