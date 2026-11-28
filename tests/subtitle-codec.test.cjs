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

test('byte decoder preserves UTF-8, BOM and BOM-less UTF-16 mixed-direction captions',()=>{
 const text='1\n00:00:01,000 --> 00:00:04,000\nمرحبا — English 123\n';
 const little=Buffer.from(text,'utf16le'),big=Buffer.from(little).swap16();
 for(const bytes of [Buffer.from(text),Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from(text)]),
   little,big,Buffer.concat([Buffer.from([0xff,0xfe]),little]),Buffer.concat([Buffer.from([0xfe,0xff]),big])]){
  assert.equal(codec.decodeBytes(bytes),text);
  assert.equal(codec.decode(codec.decodeBytes(bytes),'movie.srt').cues[0].text,'مرحبا — English 123');
 }
});
test('legacy Western accents are not mistaken for Windows-1256 Arabic',()=>{
 const text='1\n00:00:01,000 --> 00:00:04,000\nCafé déjà vu, été, Español.\n';
 assert.equal(codec.decodeBytes(Buffer.from(text,'latin1')),text);
});
test('legacy Arabic words with mixed Latin digits survive byte decoding',()=>{
 const bytes=Buffer.concat([Buffer.from('1\n00:00:01,000 --> 00:00:04,000\n'),
  Buffer.from([0xe3,0xd1,0xcd,0xc8,0xc7]),Buffer.from(' 123\n')]);
 assert.equal(codec.decode(codec.decodeBytes(bytes),'arabic.srt').cues[0].text,'مرحبا 123');
});
test('binary files remain invalid and oversized input is rejected',()=>{
 const raw=Buffer.from([0,1,0,2,0,3,0,4,0,5,0,6,0,7,0,8]);
 assert.equal(codec.decode(codec.decodeBytes(raw),'bitmap.sub').cues.length,0);
 assert.throws(()=>codec.decodeBytes(new Uint8Array(5*1024*1024+1)),/Too Large/);
});

test('WebVTT identifiers, headers, styles and NOTE blocks never leak into dialogue',()=>{
 const source='WEBVTT - movie\nKind: captions\nLanguage: en\n\nSTYLE\n::cue { color: lime; }\n\nintro-id\n00:01.000 --> 00:03.000\nFirst\n\nNOTE private comment\nNever render this\n00:02.000 --> 00:02.500\nNor this\n\nnext-id\n00:03.000 --> 00:04.000\nSecond\n';
 assert.deepEqual(codec.decode(source,'film.vtt').cues,[{start:1,end:3,text:'First'},{start:3,end:4,text:'Second'}]);
});
test('standard comma-delimited SubViewer timing and line breaks',()=>{
 const source='[INFORMATION]\n[TITLE]Film\n[SUBTITLE]\n00:00:01.00,00:00:02.50\nOne[br]Two\n\n00:00:03.00,00:00:04.00\nNext';
 assert.deepEqual(codec.decode(source,'film.sub').cues,[{start:1,end:2.5,text:'One\nTwo'},{start:3,end:4,text:'Next'}]);
});
test('active intervals survive >32 expired intervening captions and arbitrary seeks',()=>{
 const cues=[{start:0,end:100,text:'Long running sign'},...Array.from({length:64},(_,i)=>({start:i+1,end:i+1.2,text:'Line '+i})),{start:80,end:81,text:'Dialogue'}];
 assert.equal(codec.activeText(cues,80.5),'Long running sign\nDialogue');
 assert.equal(codec.activeText(cues,81),'Long running sign');
 assert.equal(codec.activeText(cues,1.1),'Long running sign\nLine 0');
 assert.equal(codec.activeText(cues,100),'');
 assert.equal(codec.activeText(cues,-1),'');
 assert.equal(codec.activeText([{start:0,end:4,text:'New file'}],1),'New file');
});
test('simultaneous cues are ordered, deduplicated and bounded',()=>{
 const cues=Array.from({length:12},(_,i)=>({start:i,end:20,text:'Line '+i}));
 cues.push({start:12,end:20,text:'Line 11'});
 const shown=codec.activeText(cues,13).split('\n');
 assert.equal(shown.length,8);assert.equal(shown[0],'Line 4');assert.equal(shown[7],'Line 11');
});

test('SBV timestamps, multiline text and three-digit hours are supported',()=>{
 const source='0:00:01.000,0:00:02.500\nHello\nمرحبا\n\n100:00:00.000,100:00:01.500\nLater';
 const parsed=codec.decode(source,'captions.sbv');
 assert.equal(parsed.format,'sbv');
 assert.deepEqual(parsed.cues,[{start:1,end:2.5,text:'Hello\nمرحبا'},{start:360000,end:360001.5,text:'Later'}]);
});
test('manual encodings decode otherwise ambiguous legacy scripts and fail safely',()=>{
 const prefix=Buffer.from('1\n00:00:01,000 --> 00:00:04,000\n');
 const bytes=Buffer.concat([prefix,Buffer.from([0xcf,0xf0,0xe8,0xe2,0xe5,0xf2])]);
 assert.equal(codec.decode(codec.decodeBytes(bytes,'windows-1251'),'film.srt').cues[0].text,'Привет');
 assert.throws(()=>codec.decodeBytes(bytes,'utf-8'),/Selected Encoding/);
 assert.throws(()=>codec.decodeBytes(bytes,'invalid'),/Unsupported/);
 assert.equal(codec.decodeBytes(Buffer.from('مرحبا'),'utf-8'),'مرحبا');
 assert.equal(codec.encodings[0][0],'auto');
});

test('two-point edition alignment computes a bounded affine timeline',()=>{
 const fit=codec.fitTiming({cue:10,movie:12},{cue:110,movie:116});
 assert.ok(Math.abs(fit.scale-1.04)<1e-9);
 assert.ok(Math.abs(fit.seconds-1.6)<1e-9);
 assert.equal(codec.fitTiming({cue:10,movie:12},{cue:20,movie:22}),null);
 assert.equal(codec.fitTiming({cue:10,movie:12},{cue:110,movie:200}),null);
 assert.equal(codec.fitTiming({cue:100,movie:100},{cue:50,movie:50}),null);
});
