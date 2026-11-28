'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const zlib=require('node:zlib');
const zip=require('../subtitle-archive.js');
const codec=require('../subtitle-codec.js');
// Independent reference CRC implementation for real ZIP fixtures.
function crc32(bytes){
 let crc=0xffffffff;
 for(const byte of bytes){
  crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);
 }
 return (crc^0xffffffff)>>>0;
}
function archive(files,method=8){
  const locals=[],central=[];let at=0;
  for(const [name,body] of files){
    const label=Buffer.from(name),raw=Buffer.from(body,'utf8');
    const packed=method===8?zlib.deflateRawSync(raw):raw;
    const local=Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50,0);
    local.writeUInt16LE(method,8);local.writeUInt32LE(crc32(raw),14);local.writeUInt32LE(packed.length,18);
    local.writeUInt32LE(raw.length,22);local.writeUInt16LE(label.length,26);
    locals.push(local,label,packed);
    const dir=Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50,0);dir.writeUInt16LE(method,10);
    dir.writeUInt32LE(crc32(raw),16);dir.writeUInt32LE(packed.length,20);dir.writeUInt32LE(raw.length,24);
    dir.writeUInt16LE(label.length,28);dir.writeUInt32LE(at,42);
    central.push(dir,label);at+=30+label.length+packed.length;
  }
  const directory=Buffer.concat(central);
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);
  end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);
  end.writeUInt32LE(directory.length,12);end.writeUInt32LE(at,16);
  return Buffer.concat([...locals,directory,end]);
}
test('SubDL ZIP deflate: extract the real .srt, never compressed bytes',async()=>{
  const body='1\n00:00:01,000 --> 00:00:03,000\n<b>مرحبا</b> world\n';
  const packed=archive([['Movie.2026.1080p.srt',body]]);
  assert.equal(zip.isZip(packed),true);
  const result=await zip.extract(packed,{filename:'Movie.2026.1080p.srt'});
  assert.equal(result.name,'Movie.2026.1080p.srt');
  const decoded=codec.decode(new TextDecoder().decode(result.bytes),result.name);
  assert.equal(decoded.cues.length,1);
  assert.equal(decoded.cues[0].text,'مرحبا world');
});
test('Stored ZIP and .sub MicroDVD subtitles decode and retain frame timing',async()=>{
  const content='{1}{1}25\n{25}{75}{y:i}Hello|world';
  const packed=archive([['Film.sub',content]],0);
  const file=await zip.extract(packed,{filename:'Film.sub'});
  const decoded=codec.decode(new TextDecoder().decode(file.bytes),file.name);
  assert.equal(decoded.format,'microdvd');
  assert.equal(decoded.cues[0].start,1);
  assert.equal(decoded.cues[0].end,3);
  assert.equal(decoded.cues[0].text,'Hello\nworld');
});
test('Multi-episode ZIP selects the correct episode and refuses a wrong one',async()=>{
  const packed=archive([
    ['TV.Show.S01E01.srt','1\n00:00:01,000 --> 00:00:02,000\nFirst'],
    ['TV.Show.S01E02.srt','1\n00:00:01,000 --> 00:00:02,000\nSecond']
  ]);
  const picked=await zip.extract(packed,{video:'TV.Show.S01E02.1080p.mkv'});
  assert.equal(new TextDecoder().decode(picked.bytes).includes('Second'),true);
  await assert.rejects(()=>zip.extract(packed,{video:'TV.Show.S01E03.mkv'}),/no subtitle/i);
});
test('SubDL .srt with missing blank separators still displays readable dialogue',()=>{
  const raw='1\n00:00:01,000 --> 00:00:02,000\nOne\n2\n00:00:03,000 --> 00:00:04,000\n<font color="red">Two</font>';
  const cues=codec.decode(raw,'release.srt').cues;
  assert.equal(cues.length,2);
  assert.deepEqual(cues.map(c=>c.text),['One','Two']);
  assert.equal(codec.decode('1\n00:00:01,000 --> 00:00:02,000\n1234','numbers.srt').cues[0].text,'1234');
});
test('Do not display ZIP or HTML download response as subtitle text',()=>{
  assert.equal(codec.decode('PK\u0003\u0004BAD','download.srt').format,'archive');
  assert.equal(codec.decode('<html>Unavailable</html>','file.sub').format,'response');
});

test('single wrong episode and explicit wrong requested file are refused',async()=>{
 const packed=archive([['Show.S02E06.srt','Wrong episode']],0);
 await assert.rejects(()=>zip.extract(packed,{video:'Show.S02E05.mkv'}),/no subtitle/i);
 await assert.rejects(()=>zip.extract(packed,{video:'Show.S02E05.mkv',filename:'Show.S02E06.srt'}),/different episode/i);
});
test('ambiguous same-name files and wrong-episode regular captions never win selection',async()=>{
 const packed=archive([['a/Show.S01E02.srt','A'],['b/Show.S01E02.srt','B']],0);
 await assert.rejects(()=>zip.extract(packed,{filename:'Show.S01E02.srt'}),/duplicate/i);
 const episodes=archive([['Show.S01E02.SDH.srt','Correct SDH'],['Show.S01E02.HI.srt','Correct HI'],['Show.S01E03.srt','Wrong']],0);
 await assert.rejects(()=>zip.extract(episodes,{video:'Show.S01E02.mkv'}),/several subtitle/i);
});
test('ZIP validates CRC, local headers and exact central directory',async()=>{
 const original=archive([['film.srt','hello']],0);
 const damaged=Buffer.from(original);damaged[30+'film.srt'.length]^=1;
 await assert.rejects(()=>zip.extract(damaged),/checksum/i);
 const wrongHeader=Buffer.from(original);wrongHeader[30]=0x78;
 await assert.rejects(()=>zip.extract(wrongHeader),/local header/i);
 const wrongDirectory=Buffer.from(original);wrongDirectory.writeUInt32LE(1,wrongDirectory.length-22+12);
 await assert.rejects(()=>zip.extract(wrongDirectory),/directory/i);
});
test('ZIP path traversal and absolute paths are not valid subtitle candidates',()=>{
 const packed=archive([['../bad.srt','bad'],['..\\bad.srt','bad'],['/bad.srt','bad'],['C:\\bad.srt','bad'],['good.srt','ok']],0);
 assert.deepEqual(zip.list(packed).map(e=>e.name),['good.srt']);
});
