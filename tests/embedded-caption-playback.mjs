import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=new URL('../',import.meta.url);
const dir=mkdtempSync(join(tmpdir(),'marmalade-webvtt-'));
function makeMatroska(file,captions){
  const {Muxer,ArrayBufferTarget,SubtitleEncoder}=require(process.env.WEBM_MUXER_MODULE||'webm-muxer');
  const target=new ArrayBufferTarget();
  const mux=new Muxer({target,type:'matroska',video:{codec:'V_VP8',width:160,height:90},
    subtitles:{codec:'S_TEXT/WEBVTT'}});
  const encoder=new SubtitleEncoder({output:(chunk,meta)=>mux.addSubtitleChunk(chunk,meta),error:e=>{throw e;}});
  encoder.configure({codec:'webvtt'});
  encoder.encode(readFileSync(captions,'utf8'));
  const ivf=execFileSync(process.env.FFMPEG_PATH||'ffmpeg',['-v','error','-f','lavfi','-i',
    'color=size=160x90:rate=12:duration=6','-c:v','libvpx','-f','ivf','pipe:1']);
  let frame=0;
  for(let pos=32;pos<ivf.length;frame++){
    const size=ivf.readUInt32LE(pos),data=ivf.subarray(pos+12,pos+12+size);
    mux.addVideoChunkRaw(data,(data[0]&1)?'delta':'key',Math.round(frame*1e6/12));
    pos+=12+size;
  }
  mux.finalize();
  writeFileSync(file,new Uint8Array(target.buffer));
}
let browser;
try{
  const captions=join(dir,'captions.vtt');
  writeFileSync(captions,'WEBVTT\n\nopening\n00:00:00.500 --> 00:00:02.000\nFirst line\nمرحبا\n\nclosing\n00:00:03.000 --> 00:00:05.500\nSecond scene\n');
  const origin='http://marmalade.test';
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined});
  for(const variant of ['ffmpeg-mkv','ffmpeg-webm','matroska-vtt']){
    const ext=variant==='ffmpeg-webm'?'webm':'mkv';
    const file=join(dir,variant+'.'+ext);
    if(variant==='matroska-vtt')makeMatroska(file,captions);
    else
    execFileSync(process.env.FFMPEG_PATH||'ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i',
      'color=size=160x90:rate=12:duration=6','-i',captions,'-map','0:v','-map','1:s','-c:v','libvpx',
      '-c:s','webvtt','-metadata:s:s:0','language=eng',file],{timeout:30000});
    const page=await browser.newPage();
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.origin!==origin)return route.abort();
      const path=url.pathname==='/'?'/index.html':url.pathname;
      if(!/^\/[\w./-]*$/.test(path)||path.includes('..'))return route.abort();
      try{
        const body=readFileSync(new URL('.'+path,root));
        await route.fulfill({body,contentType:path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html'});
      }catch{await route.fulfill({status:404,body:''});}
    });
    await page.goto(origin);
    await page.locator('#fileInput').setInputFiles(file);
    await page.waitForFunction(()=>window.MarmaladeEmbeddedSubtitles?.available()&&document.querySelector('#player').readyState>=1);
    await page.locator('#subtitlesBtn').click();
    await page.locator('#subFindTab').click();
    await page.getByText('Embedded MKV / WebM Subtitles',{exact:true}).click();
    await page.locator('#subMkvScan').click();
    const track=page.locator('#subMkvTrack option:enabled').first();
    await track.waitFor({state:'attached'});
    const label=await track.textContent();
    const expectedCodecs=variant==='matroska-vtt'?['S_TEXT/WEBVTT']:
      ext==='webm'?['D_WEBVTT/SUBTITLES']:['D_WEBVTT/SUBTITLES','S_TEXT/WEBVTT'];
    assert.ok(expectedCodecs.some(codec=>label.includes(codec)),label);
    await page.locator('#subMkvTrack').selectOption(await track.getAttribute('value'));
    await page.locator('#subMkvLoad').click();
    await page.waitForFunction(()=>document.querySelector('#subMkvStatus').textContent.startsWith('Embedded subtitles loaded.'));
    await page.locator('#closeSubtitlePanel').click();
    for(const [at,expected] of [[1,'First line'],[4,'Second scene'],[2.5,''],[1,'مرحبا']]){
      await page.locator('#player').evaluate((v,at)=>{v.pause();v.currentTime=at;},at);
      await page.waitForFunction(({at,expected})=>{
        const v=document.querySelector('#player'),el=document.querySelector('#subtitleOverlay');
        const text=el.innerText.trim();
        const visible=!!el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden';
        return !v.seeking&&Math.abs(v.currentTime-at)<.1&&(expected?visible&&text.includes(expected):!visible||!text);
      },{at,expected},{timeout:8000});
    }
    console.log('PASS',variant,label,'English and Arabic, forward seek, empty interval and backward seek');
    await page.close();
  }
}finally{
  await browser?.close();
  rmSync(dir,{recursive:true,force:true});
}
