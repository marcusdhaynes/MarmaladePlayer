import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const mkv = readFileSync(new URL('../auto-mkv-audio.js', import.meta.url), 'utf8');
const captions = readFileSync(new URL('../watch-sync-subtitles.js', import.meta.url), 'utf8');
function section(text, from, until) {
  const begin = text.indexOf(from);
  assert(begin >= 0, 'Function not found: ' + from);
  const end = text.indexOf(until, begin + from.length);
  assert(end > begin, 'Function end not found: ' + until);
  return text.slice(begin, end);
}

// Regression: a 53-minute FILE must stay 53 minutes after MSE reports 26
// minutes, including when the playing element swaps to the remuxed blob.
{
  const state = {role:'host',source:'file',fileUrl:'blob:original'};
  const media = {duration:3180,src:'blob:original',currentSrc:'blob:original'};
  const window = {MarmaladeMkvAudio:{getDuration:()=>3180}};
  const ctx = {state,media,window,Number,Math,durationResourceKey:'',durationHighWater:0};
  const stable = vm.runInNewContext(
    section(index,'  function stableMovieDuration() {',
      '  window.MarmaladeStableDuration = stableMovieDuration;')+
    '\n stableMovieDuration;',ctx);
  assert.equal(stable(),3180);
  media.duration=1560;
  media.currentSrc='blob:remuxed';
  assert.equal(stable(),3180,'MSE source swap or transient duration must not halve playback');
  window.MarmaladeMkvAudio.getDuration=()=>0;
  assert.equal(stable(),3180,'Earlier full runtime must remain authoritative for same file');
  state.fileUrl='blob:new-movie';
  media.duration=900;
  assert.equal(stable(),900,'A different selected movie must reset the remembered runtime');
  state.source='hosted';
  media.duration=1200;
  assert.equal(stable(),1200);
  media.duration=1080;
  assert.equal(stable(),1080,'Live/hosted stream durations must be allowed to change');
  console.log('PASS stable runtime, remux source swap, new movie and hosted stream');
}

// Regression: endOfStream() is NOT safe at a seek point halfway through a
// movie. It may actually truncate HTMLMediaElement.duration to 26 minutes.
{
  let bufferedEnd=1560, calls=0, ends=0, seeks=[];
  const mediaSource = {readyState:'open',duration:3180,endOfStream(){
    ends++;
    this.readyState='ended';
    this.duration=bufferedEnd; // Standard MSE EOF duration adjustment.
  }};
  const session = {
    file:{},closed:false,running:false,finished:false,seekTo:1550,
    declaredDuration:3180,mediaSource,
    video:{currentTime:1550},
    buffer:{updating:false,buffered:{
      get length(){return 1;},start(){return 0;},end(){return bufferedEnd;}
    }},
    remuxer:{
      async seek(time){seeks.push(time);return {data:new Uint8Array([1]),finished:time===1550||time===3170};},
      async read(){calls++;return {data:new Uint8Array([1]),finished:false};}
    }
  };
  const context={
    isCurrent:s=>s===session,bufferedAhead:()=>0,
    append:async(_session,bytes)=>{assert(bytes.byteLength>0);},
    discardOld:async()=>{},bridge:()=>null,
    console,Number,Math
  };
  const nextChunk=vm.runInNewContext(
    section(mkv,'  async function nextChunk(session) {',
      '  async function handleSource(source, file=null) {')+'\n nextChunk;',context);
  await nextChunk(session);
  assert.equal(session.finished,true);
  assert.equal(ends,0,'The first half of the movie is not the end of the whole movie');
  assert.equal(mediaSource.duration,3180);
  // The earlier EOF cannot block future seeking, even when the first remux
  // pass returned finished=true.
  session.seekTo=2200;session.video.currentTime=2200;
  mediaSource.duration=1560;bufferedEnd=2230;
  await nextChunk(session);
  assert.deepEqual(seeks,[1550,2200]);
  assert.equal(mediaSource.duration,3180,'Source duration must be restored');
  assert.equal(ends,0);
  session.seekTo=3170;bufferedEnd=3180;session.video.currentTime=3170;
  await nextChunk(session);
  assert.equal(ends,1,'True EOF near the declared runtime may finalize');
  assert.equal(mediaSource.duration,3180,'Full movie remains seekable at EOF');
  console.log('PASS MKV source cannot truncate timeline at a mid-movie seek');
}

// Regression: a delayed host monitor must seek immediately with the actual
// frame after a forward/backward jump, including when main playback is paused.
{
  const state = {hostSyncActive:true,fileUrl:'blob:movie'};
  const media = {currentTime:2500,paused:true};
  const preview = {currentTime:1200,duration:3180};
  let refreshed=0;
  const window = {MarmaladeSubtitleRefresh:()=>refreshed++};
  const context={state,media,preview,previewSource:'blob:movie',
    monitorDelaySeconds:2,lastPreviewSeek:0,window,
    clamp:(v,min,max)=>Math.max(min,Math.min(max,v)),
    performance:{now:()=>1234},console,Number,Math};
  const follow=vm.runInNewContext(
    section(captions,'  function followExplicitSeek(){',
      "  media.addEventListener('seeking',followExplicitSeek);")+
    '\n followExplicitSeek;',context);
  follow();
  assert.equal(preview.currentTime,2498,'Forward seek must move the presented preview');
  assert(refreshed>0,'Captions must be refreshed immediately');
  media.currentTime=400;
  follow();
  assert.equal(preview.currentTime,398,'Rewind must move the preview backward');
  state.hostSyncActive=false;
  media.currentTime=1000;
  follow();
  assert.equal(preview.currentTime,398,'Inactive monitor cannot alter its playback');
  console.log('PASS paused/playing host monitor seeks preserve subtitle alignment');
}
assert.match(index,/duration:\s*\['file','native','hosted'\].*stableMovieDuration\(\)/,
  'Host should broadcast stable movie duration');
assert.match(index,/const seekTime = .*stableMovieDuration\(\)/,
  'Slider calculations should use stable movie duration');
console.log('All media timeline and subtitle seeking regressions passed.');
