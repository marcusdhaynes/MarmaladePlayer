const test=require('node:test');
const assert=require('node:assert/strict');
const match=require('../subtitle-match.js');

const movies={
  status:true,
  results:[
    {name:'Beauty and the Beast',year:2017,type:'movie',sd_id:2017,imdb_id:'tt2771200'},
    {name:'Beauty and the Beast',year:1991,type:'movie',sd_id:1991,imdb_id:'tt0101414'}
  ],
  subtitles:[{release_name:'Beauty.and.the.Beast.2017.1080p'}]
};

test('1991 title selects the animated 1991 edition, not 2017',()=>{
  const selected=match.selectTitle(movies,'Beauty and the Beast','1991','movie');
  assert.equal(selected.index,1);
  assert.equal(selected.title.year,1991);
  const query=match.lookupParams(match.searchParams({
    title:'Beauty and the Beast',year:'1991',language:'en',type:'movie'}),selected.title);
  assert.equal(query.get('sd_id'),'1991');
  assert.equal(query.get('year'),'1991');
  assert.equal(query.get('film_name'),null);
  assert.equal(query.get('languages'),'EN');
});
test('2017 title selects 2017 and does not redirect',()=>{
  assert.equal(match.selectTitle(movies,'Beauty and the Beast',2017,'movie').index,0);
});
test('wrong years or wrong title never use the first response subtitles',()=>{
  assert.equal(match.selectTitle({results:[movies.results[0]],subtitles:movies.subtitles},
    'Beauty and the Beast',1991,'movie'),null);
  assert.equal(match.selectTitle({subtitles:movies.subtitles},
    'Beauty and the Beast',1991,'movie'),null);
  assert.equal(match.selectTitle(movies,'Cinderella',1991,'movie'),null);
});
test('a matching year in release_date or first_air_date is recognized',()=>{
  assert.equal(match.resultYear({release_date:'1991-11-22'}),1991);
  assert.equal(match.resultYear({first_air_date:'2017-03-17'}),2017);
});
test('movie and TV types are not interchanged',()=>{
  assert.equal(match.selectTitle({results:[{name:'Beauty and the Beast',year:1991,type:'tv'}]},
    'Beauty and the Beast',1991,'movie'),null);
});
test('all filters become the documented SubDL parameter names',()=>{
  const p=match.searchParams({title:'Example Show',year:'2001',language:'ar',type:'tv',
    season:'3',episode:'6'});
  assert.equal(p.get('film_name'),'Example Show');
  assert.equal(p.get('year'),'2001');
  assert.equal(p.get('languages'),'AR');
  assert.equal(p.get('type'),'tv');
  assert.equal(p.get('season_number'),'3');
  assert.equal(p.get('episode_number'),'6');
  assert.equal(p.get('season'),null);
  assert.equal(p.get('episode'),null);
  assert.equal(p.get('subs_per_page'),'30');
  assert.equal(p.get('unpack'),'1');
  const film=match.searchParams({title:'Beauty and the Beast',year:'1991',
    language:'en',type:'movie',season:'5',episode:'2'});
  assert.equal(film.get('season_number'),null);
  assert.equal(film.get('episode_number'),null);
});
test('quality filters retain strict matching',()=>{
  assert.ok(match.matchesQuality('Movie.1080p.BluRay','1080p'));
  assert.ok(!match.matchesQuality('Movie.720p.BluRay','1080p'));
  assert.ok(match.matchesQuality('Movie.WEB-DL','WEB'));
  assert.ok(!match.matchesQuality('Movie.BluRay','WEB'));
  assert.ok(match.matchesQuality('Movie.BDRip','BluRay'));
  assert.ok(match.matchesQuality('Movie.2160p','2160p'));
});
test('language filters are case-insensitive',()=>{
  assert.ok(match.matchesLanguage('EN','en'));
  assert.ok(match.matchesLanguage('en-US','en'));
  assert.ok(!match.matchesLanguage('FR','en'));
  assert.ok(match.matchesLanguage('FR',''));
});
test('season/episode metadata filters out mismatches',()=>{
  assert.ok(match.matchesEpisode({season:2,episode:5},{},'tv','2','5'));
  assert.ok(!match.matchesEpisode({season:3,episode:5},{},'tv','2','5'));
  assert.ok(!match.matchesEpisode({season:2,episode:6},{},'tv','2','5'));
  assert.ok(match.matchesEpisode({}, {season:2,episode_from:1,episode_end:8},'tv','2','5'));
  assert.ok(!match.matchesEpisode({}, {season:2,episode_from:6,episode_end:8},'tv','2','5'));
});
