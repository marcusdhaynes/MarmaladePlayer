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

test('reference alignment recovers offset and drift despite an outlier',()=>{
 const source=Array.from({length:12},(_,i)=>({start:i*20,end:i*20+2,text:'A distinctive phrase number '+i}));
 const fit=codec.referenceAlignment(source,source.map((c,i)=>({...c,start:c.start*1.04+2+(i===5?4:0)})));
 assert.ok(fit);assert.equal(fit.matched,11);assert.equal(fit.total,12);
 assert.ok(Math.abs(fit.scale-1.04)<1e-9);assert.ok(Math.abs(fit.seconds-2)<1e-9);
});
test('reference alignment refuses ambiguous and nonlinear dialogue matches',()=>{
 const source=Array.from({length:12},(_,i)=>({start:i*20,end:i*20+2,text:'A distinctive phrase number '+i}));
 assert.equal(codec.referenceAlignment(source,source.map(c=>({...c,text:'Unrelated dialogue'}))),null);
 assert.equal(codec.referenceAlignment(source.map(c=>({...c,text:'A repeated dialogue line'})),source),null);
 assert.equal(codec.referenceAlignment(source,source.map((c,i)=>({...c,start:c.start+(i<6?0:25)}))),null);
 assert.equal(codec.referenceAlignment(source.slice(0,3),source),null);
});

test('dialogue search tolerates Latin accents and Arabic vowel marks without altering captions',()=>{
 const cues=[{text:'Café déjà vu'},{text:'مَرْحَبًا بِالْعَالَمِ'},{text:'カガ'},{text:'कला'},{text:'Another dialogue'}];
 assert.deepEqual(codec.searchDialogue(cues,'CAFE deja'),[0]);
 assert.deepEqual(codec.searchDialogue(cues,'مرحبا بالعالم'),[1]);
 assert.deepEqual(codec.searchDialogue(cues,'カカ'),[]);
 assert.notEqual(codec.dialogueKey('कला'),codec.dialogueKey('कल'));
 assert.deepEqual(codec.searchDialogue(cues,'another'),[4]);
 assert.deepEqual(codec.searchDialogue(cues,''),[0,1,2,3,4]);
 assert.equal(cues[0].text,'Café déjà vu');
 assert.deepEqual(codec.searchDialogue([{text:'New file'}],'cafe'),[]);
});

test('WebVTT inline timing retains exact valid boundaries without leaking markup',()=>{
 const source='WEBVTT\n\n00:01.000 --> 00:05.000\nHello <00:02.200><b>world</b> <00:04.100>again';
 assert.deepEqual(codec.decode(source,'timed.vtt').cues,[{start:1,end:5,text:'Hello world again',markers:[{index:6,start:2.2},{index:12,start:4.1}]}]);
});
test('invalid or non-monotonic inline timestamps are not trusted',()=>{
 const source='WEBVTT\n\n00:01.000 --> 00:05.000\nOne <00:03.000>two <00:02.000>three';
 assert.deepEqual(codec.decode(source,'timed.vtt').cues,[{start:1,end:5,text:'One two three'}]);
});
test('dialogue beginning NOTE or STYLE is not discarded as metadata',()=>{
 const source='WEBVTT\n\n00:01.000 --> 00:05.000\nNOTE this is dialogue\nSTYLE matters';
 assert.equal(codec.decode(source,'timed.vtt').cues[0].text,'NOTE this is dialogue\nSTYLE matters');
});

test('player track snapshot preserves text and timing and cannot inject new cues',()=>{
 const raw=codec.snapshotTextTrack([{startTime:1,endTime:3,text:'<b>مرحبا</b> &amp; hello'},
 {startTime:4,endTime:8,text:'00:00:09.000 --> 00:00:10.000\nNot a timing row'},
 {startTime:10,endTime:11,text:null}]);
 const cues=codec.decode(raw,'track.vtt').cues;
 assert.deepEqual(cues,[{start:1,end:3,text:'مرحبا & hello'},{start:4,end:8,text:'00:00:09.000 --> 00:00:10.000\nNot a timing row'}]);
 assert.throws(()=>codec.snapshotTextTrack([]),/No readable/);
});

function pgsSegment(type,pts,payload){
 const h=Buffer.alloc(13);h.write('PG');h.writeUInt32BE(pts,2);h[10]=type;h.writeUInt16BE(payload.length,11);
 return Buffer.concat([h,Buffer.from(payload)]);
}
function pgsFixture(){
 const pcs=[0,4,0,2,0,0,1,0x80,0,0,1,0,1,0,0,0,1,0,0];
 const palette=[0,0,0,16,128,128,0,1,235,128,128,255];
 // 2x2 bitmap: opaque white, transparent; transparent, opaque white.
 const rle=[1,0,1,0,0,0,1,1,0,0];
 const object=[0,1,0,0xc0,0,0,rle.length+4,0,2,0,2,...rle];
 const clear=[0,4,0,2,0,0,2,0,0,0,0];
 return Buffer.concat([pgsSegment(0x16,90000,pcs),pgsSegment(0x14,90000,palette),
 pgsSegment(0x15,90000,object),pgsSegment(0x80,90000,[]),
 pgsSegment(0x16,270000,clear),pgsSegment(0x80,270000,[])]);
}
test('PGS decodes actual segment bytes, position, transparency and clear display set',()=>{
 const frames=codec.decodePgs(pgsFixture());
 assert.equal(frames.length,2);
 const f=codec.pgsFrameAt(frames,1.5);
 assert.equal(f.layers[0].x,1);assert.equal(f.width,4);
 assert.deepEqual(Array.from(codec.pgsPixels(f.layers[0])),[255,255,255,255,0,0,0,0,0,0,0,0,255,255,255,255]);
 assert.equal(codec.pgsFrameAt(frames,.9),null);assert.equal(codec.pgsFrameAt(frames,3),null);
 assert.equal(codec.pgsFrameAt(frames,2),f);
});
test('PGS rejects truncated and corrupted data before display',()=>{
 const data=pgsFixture();
 assert.throws(()=>codec.decodePgs(data.subarray(0,data.length-1)),/Invalid PGS/);
 const bad=Buffer.from(data);bad[0]=0;assert.throws(()=>codec.decodePgs(bad),/Invalid PGS/);
});

test('Matroska PGS segment conversion preserves container timing and inserts duration clear',()=>{
 const standalone=pgsFixture(),parts=[];
 for(let pos=0;pos<standalone.length;){
   const size=standalone.readUInt16BE(pos+11),type=standalone[pos+10];
   if(standalone.readUInt32BE(pos+2)===90000)
     parts.push(standalone.subarray(pos+10,pos+13+size));
   pos+=13+size;
 }
 const packet=Buffer.concat(parts);
 const raw=codec.matroskaPgsToSup([{ticks:2500,duration:2000,raw:packet}],.001);
 const frames=codec.decodePgs(raw);
 assert.equal(frames[0].start,2.5);assert.equal(frames[0].end,4.5);
 assert.equal(codec.pgsFrameAt(frames,4.5),null);
 assert.equal(codec.pgsFrameAt(frames,3).layers[0].x,1);
 assert.throws(()=>codec.matroskaPgsToSup([{ticks:0,raw:packet.subarray(0,packet.length-1)}],.001),/Truncated/);
});
test('bounded EBML scan actually extracts a binary PGS track from Matroska blocks',async()=>{
 const ebml=(id,body)=>{
   const payload=Buffer.from(body);let width=1;while(payload.length>=2**(7*width)-1)width++;
   const size=Buffer.alloc(width);let n=payload.length;
   for(let i=width-1;i>=0;i--){size[i]=n&255;n=Math.floor(n/256);}
   size[0]|=1<<(8-width);
   return Buffer.concat([Buffer.from(id,'hex'),size,payload]);
 };
 const join=(...parts)=>Buffer.concat(parts);
 const track=ebml('ae',join(ebml('d7',[3]),ebml('83',[17]),ebml('86',Buffer.from('S_HDMV/PGS')),ebml('22b59c',Buffer.from('eng'))));
 const sup=pgsFixture(),packet=[];
 for(let pos=0;pos<sup.length;){
   const size=sup.readUInt16BE(pos+11);
   if(sup.readUInt32BE(pos+2)===90000)packet.push(sup.subarray(pos+10,pos+13+size));
   pos+=13+size;
 }
 const group=ebml('a0',join(ebml('a1',join(Buffer.from([0x83,0,0,0]),...packet)),ebml('9b',[7,208])));
 const mkv=new Blob([ebml('1a45dfa3',[]),ebml('18538067',join(
   ebml('1654ae6b',track),ebml('1f43b675',join(ebml('e7',[3,232]),group))))]);
 const scan=await codec.matroskaText(mkv);
 assert.equal(scan.tracks[0].codec,'S_HDMV/PGS');assert.equal(scan.tracks[0].supported,true);
 const result=await codec.matroskaText(mkv,{trackNumber:3});
 assert.equal(result.format,'pgs');
 const frames=codec.decodePgs(result.raw);
 assert.equal(frames[0].start,1);assert.equal(frames[0].end,3);
 assert.deepEqual(Array.from(codec.pgsPixels(frames[0].layers[0])).slice(0,4),[255,255,255,255]);
});

test('Matroska discovery and extraction use bounded random-access library reads',async()=>{
 const ebml=(id,body)=>{
   const data=Buffer.from(body);if(data.length>=127)throw Error('fixture too large');
   return Buffer.concat([Buffer.from(id,'hex'),Buffer.from([128+data.length]),data]);
 };
 const join=(...parts)=>Buffer.concat(parts);
 const track=ebml('ae',join(ebml('d7',[1]),ebml('83',[17]),ebml('86',Buffer.from('S_TEXT/UTF8'))));
 const group=ebml('a0',join(ebml('a1',join(Buffer.from([0x81,0,0,0]),Buffer.from('Library text'))),ebml('9b',[7,208])));
 const mkv=join(ebml('1a45dfa3',[]),ebml('18538067',join(ebml('1654ae6b',track),ebml('1f43b675',join(ebml('e7',[3,232]),group)))));
 const controller=new AbortController(),calls=[];
 const source={name:'Library.mkv',length:mkv.length,async read(at,size,options){
   assert.equal(options.signal,controller.signal);assert(size<=1024*1024);calls.push([at,size]);
   return mkv.slice(at,at+size);
 }};
 const scan=await codec.matroskaText(source,{signal:controller.signal});
 assert.equal(scan.tracks[0].codec,'S_TEXT/UTF8');
 const result=await codec.matroskaText(source,{trackNumber:1,signal:controller.signal});
 assert.deepEqual(codec.decode(result.raw,'library.vtt').cues,[{start:1,end:3,text:'Library text'}]);
 assert(calls.length>=2);
 await assert.rejects(codec.matroskaText({...source,read:async()=>new Uint8Array(1)}),/Truncated Matroska source range/);
 controller.abort();
 await assert.rejects(codec.matroskaText(source,{signal:controller.signal}),/cancelled/);
});

function dvdSpu(){
 const first=Buffer.from([0,0,0,0,1,3,0,16,4,0,240,5,0,16,2,0,0,1,6,0,4,0,5,255]);
 const stop=Buffer.from([0,176,0,0,2,255]);
 const start=6,next=start+first.length;
 first.writeUInt16BE(next,2);stop.writeUInt16BE(next,2);
 const h=Buffer.alloc(4);h.writeUInt16BE(6+first.length+stop.length,0);h.writeUInt16BE(6,2);
 return Buffer.concat([h,Buffer.from([0x90,0x90]),first,stop]);
}
const dvdPrivate='size: 4x2\npalette: 000000, ffffff, 000000, 000000, 000000, 000000, 000000, 000000, 000000, 000000, 000000, 000000, 000000, 000000, 000000, 000000';
test('DVD SPU decoding preserves interlaced pixels, palette, position and stop command',()=>{
 const frames=codec.decodeVobSub(dvdPrivate,[{start:1,duration:5,raw:dvdSpu()}]);
 assert.equal(frames.length,1);const f=frames[0];
 assert.equal(f.start,1);assert.ok(Math.abs(f.end-(1+176*1024/90000))<1e-9);
 assert.equal(f.layers[0].x,1);
 assert.deepEqual(Array.from(codec.pgsPixels(f.layers[0])),Array(16).fill(255));
 assert.equal(codec.pgsFrameAt(frames,4),null);
 assert.throws(()=>codec.decodeVobSub(dvdPrivate,[{start:1,raw:dvdSpu().subarray(0,10)}]),/Invalid VobSub/);
});
test('S_VOBSUB CodecPrivate and binary SPU blocks are extracted from MKV',async()=>{
 const ebml=(id,body)=>{
   const payload=Buffer.from(body);let width=1;while(payload.length>=2**(7*width)-1)width++;
   const size=Buffer.alloc(width);let n=payload.length;
   for(let i=width-1;i>=0;i--){size[i]=n&255;n=Math.floor(n/256);}
   size[0]|=1<<(8-width);return Buffer.concat([Buffer.from(id,'hex'),size,payload]);
 };
 const join=(...parts)=>Buffer.concat(parts);
 const track=ebml('ae',join(ebml('d7',[3]),ebml('83',[17]),ebml('86',Buffer.from('S_VOBSUB')),ebml('63a2',Buffer.from(dvdPrivate))));
 const group=ebml('a0',join(ebml('a1',join(Buffer.from([0x83,0,0,0]),dvdSpu())),ebml('9b',[19,136])));
 const mkv=new Blob([ebml('1a45dfa3',[]),ebml('18538067',join(ebml('1654ae6b',track),ebml('1f43b675',join(ebml('e7',[3,232]),group))))]);
 const scan=await codec.matroskaText(mkv);
 assert.equal(scan.tracks[0].supported,true);
 const result=await codec.matroskaText(mkv,{trackNumber:3});
 assert.equal(result.format,'vobsub');assert.equal(result.frames[0].start,1);
 assert.deepEqual(Array.from(codec.pgsPixels(result.frames[0].layers[0])),Array(16).fill(255));
});

function dvdPack(index,raw){
 const header=Buffer.from([0,0,1,0xba,0x44,0,4,0,4,1,0,0,3,0]);
 const pes=Buffer.from([0,0,1,0xbd,0,0,0x80,0,0,0x20+index]);
 pes.writeUInt16BE(raw.length+4,4);
 return Buffer.concat([header,pes,raw]);
}
test('paired IDX/SUB demux selects language and reassembles fragmented DVD SPU',async()=>{
 const spu=dvdSpu(),parts=[dvdPack(0,spu.subarray(0,12)),dvdPack(1,spu),dvdPack(0,spu.subarray(12))];
 const idx=dvdPrivate+'\nid: en, index: 0\ntimestamp: 00:00:01:000, filepos: 000000000\nid: ar, index: 1\ntimestamp: 00:00:02:000, filepos: '+parts[0].length.toString(16);
 const parsed=codec.parseVobSubIndex(idx);
 assert.deepEqual(parsed.tracks.map(t=>t.language),['en','ar']);
 const file=new Blob(parts),en=await codec.readVobSubPair(idx,file,0),ar=await codec.readVobSubPair(idx,file,1);
 assert.equal(en.frames[0].start,1);assert.equal(ar.frames[0].start,2);
 assert.deepEqual(Array.from(codec.pgsPixels(en.frames[0].layers[0])),Array(16).fill(255));
 assert.throws(()=>codec.extractSpuFromProgramStream(parts[0],0),/incomplete/);
 await assert.rejects(codec.readVobSubPair(idx.replace('000000000','fffffffff'),file,0),/outside/);
 const controller=new AbortController();controller.abort();
 await assert.rejects(codec.readVobSubPair(idx,file,0,{signal:controller.signal}),/cancelled/);
});

test('MPEG-1 paired DVD captions render across fragmented timestamped packets',async()=>{
  const pack=Buffer.from([0,0,1,0xba,0x21,0,1,0,1,0x80,0,1]);
  function packet(header,index,data){
    const body=Buffer.from([...header,0x20+index,...data]);
    return Buffer.concat([pack,Buffer.from([0,0,1,0xbd,body.length>>8,body.length&255]),body]);
  }
  const spu=dvdSpu(), pts=[0x21,0,1,0,1], both=[0x31,0,1,0,1,0x11,0,1,0,1];
  const file=new Blob([packet([0xff,0x40,0,...pts],0,spu.subarray(0,1)),
    packet([0x0f],1,spu),packet(both,0,spu.subarray(1))]);
  const idx=dvdPrivate+'\nid: en, index: 0\ntimestamp: 00:00:02:000, filepos: 0';
  const {frames}=await codec.readVobSubPair(idx,file,0);
  assert.equal(frames[0].start,2);
  assert.deepEqual(Array.from(codec.pgsPixels(frames[0].layers[0])),Array(16).fill(255));
  assert.throws(()=>codec.extractSpuFromProgramStream(packet([0x31],0,[]),0),/truncated MPEG-1 timestamp/);
  assert.throws(()=>codec.extractSpuFromProgramStream(packet([0x20,0,1,0,1],0,spu),0),/invalid MPEG-1 PTS/);
});

test('embedded WebVTT separates track metadata and restores timed multiline captions',async()=>{
 const ebml=(id,body)=>{
   const payload=Buffer.from(body);let width=1;while(payload.length>=2**(7*width)-1)width++;
   const size=Buffer.alloc(width);let n=payload.length;
   for(let i=width-1;i>=0;i--){size[i]=n&255;n=Math.floor(n/256);}
   size[0]|=1<<(8-width);
   return Buffer.concat([Buffer.from(id,'hex'),size,payload]);
 };
 const join=(...parts)=>Buffer.concat(parts);

 for(const [codecId,payload] of [
   ['S_TEXT/WEBVTT','First line\n<00:00:01.500>Second line'],
   ['D_WEBVTT/SUBTITLES','cue-id\r\nalign:start\r\nFirst line\n<00:00:03.500>Second line'],
   ['D_WEBVTT/CAPTIONS','\n\nFirst line\n<00:00:03.500>Second line']
 ]){
   const track=ebml('ae',join(ebml('d7',[1]),ebml('83',[17]),ebml('86',Buffer.from(codecId))));
   const group=ebml('a0',join(ebml('a1',join(Buffer.from([0x81,0,0,0]),Buffer.from(payload))),ebml('9b',[15,160])));
   const file=new Blob([ebml('1a45dfa3',[]),ebml('18538067',join(ebml('1654ae6b',track),ebml('1f43b675',join(ebml('e7',[7,208 ]),group))))]);
   assert.equal((await codec.matroskaText(file)).tracks[0].supported,true);
   const result=await codec.matroskaText(file,{trackNumber:1});
   assert.match(result.raw,/00:00:02\.000 --> 00:00:06\.000/);
   assert.match(result.raw,/<00:00:03\.500>Second line/);
   const cue=codec.decode(result.raw,'embedded.vtt').cues[0];
   assert.equal(cue.text,'First line\nSecond line');
 }
});
