'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const codec=require('../subtitle-codec.js');
const matcher=require('../subtitle-match.js');

test('SRT and WebVTT are decoded with cue styling removed but joined text preserved',()=>{
  const srt=codec.decode('1\r\n00:00:01,100 --> 00:00:02,300\r\n<b>مرحبا</b> &amp; hello\r\n','example.srt');
  assert.equal(srt.cues.length,1);
  assert.equal(srt.cues[0].start,1.1);
  assert.equal(srt.cues[0].text,'مرحبا & hello');
  const vtt=codec.decode('WEBVTT\n\n00:00:01.000 --> 00:00:02.000 align:start position:30%\n<c.red>One</c>','example.vtt');
  assert.equal(vtt.cues[0].text,'One');
  assert.equal(vtt.cues[0].start,1);
});

test('MicroDVD .sub uses embedded FPS and multiline pipes',()=>{
  const parsed=codec.decode('{1}{1}25.0\n{25}{75}{y:i}Hello|world','test.sub');
  assert.equal(parsed.format,'microdvd');
  assert.equal(parsed.fps,25);
  assert.deepEqual(parsed.cues,[{start:1,end:3,text:'Hello\nworld'}]);
  assert.equal(parsed.warning,'');
});

test('MicroDVD without a header warns about assumed FPS rather than promising exact sync',()=>{
  const parsed=codec.decode('{24}{48}Hi','unknown.sub');
  assert.ok(parsed.warning.includes('23.976'));
  assert.equal(parsed.cues.length,1);
});

test('SubViewer .sub, ASS dialogue, and HTML entities display cleanly',()=>{
  const viewer=codec.decode('[00:00:01.00][00:00:02.00]\nHi[br]there','hello.sub');
  assert.equal(viewer.cues[0].text,'Hi\nthere');
  const ass=codec.decode('[Script Info]\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:02.00,0:00:04.00,Default,,0,0,0,,{\\i1}Hello\\Nworld','test.ass');
  assert.equal(ass.cues[0].text,'Hello\nworld');
  assert.equal(codec.plain('&#x627;&#x644;&#x633;&#x644;&#x627;&#x645;'),'السلام');
});

test('Bitmap .sub and invalid text are rejected instead of showing gibberish',()=>{
  assert.equal(codec.decode('\0\0\0random','test.sub').format,'bitmap');
  assert.equal(codec.decode('this is not subtitles','test.sub').cues.length,0);
});

test('TV release metadata excludes other episodes, including filename-only metadata',()=>{
  assert.equal(matcher.matchesEpisode({name:'Show.S01E02.1080p.srt'},{},'tv','1','1'),false);
  assert.equal(matcher.matchesEpisode({name:'Show.S01E01.1080p.srt'},{},'tv','1','1'),true);
});

test('Exact video release ranks ahead of a generic or mismatched release',()=>{
  const video='Show.S01E01.1080p.WEB.x265-Group.mkv';
  assert.ok(matcher.scoreRelease(video,'Show.S01E01.1080p.WEB.x265-Group.srt')>
    matcher.scoreRelease(video,'Show.S01E01.BluRay.srt'));
  assert.ok(matcher.scoreRelease(video,'Show.S01E01.srt')>
    matcher.scoreRelease(video,'Show.S01E02.srt'));
});
