/* Subtitle decoders for text-based SRT, WebVTT, MicroDVD .sub, SubViewer .sub and ASS.
   Browser and Node compatible. Bitmap VobSub .sub requires an image/IDX decoder. */
(function(root){
  'use strict';
  function time(value){
    const parts=String(value||'').trim().replace(',','.').split(':');
    if(!parts.length||parts.length>3||parts.some(v=>!/^\d+(?:\.\d+)?$/.test(v)))return NaN;
    return parts.reduce((n,part)=>n*60+Number(part),0);
  }
  const entities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',lrm:'',rlm:'',hellip:'…',mdash:'—',ndash:'–'};
  function plain(value){
    return String(value||'').replace(/\r/g,'')
      .replace(/\\[Nn]/g,'\n').replace(/\\h/g,' ')
      .replace(/\[br\]/gi,'\n')
      .replace(/\{\\[^}]*\}/g,'')
      .replace(/<\d{1,2}:\d\d:\d\d(?:[.,]\d+)?>/g,'')
      .replace(/<[^>\n]{1,180}>/g,'')
      .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(_,entity)=>{
        if(entity[0]==='#'){
          const hex=/^#x/i.test(entity);
          const num=parseInt(entity.slice(hex?2:1),hex?16:10);
          return Number.isInteger(num)&&num>=32&&num<=0x10ffff&&!(num>=0xd800&&num<=0xdfff)
            ?String.fromCodePoint(num):'';
        }
        return entities[entity.toLowerCase()]??'&'+entity+';';
      })
      .replace(/[\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,'')
      .split('\n').map(x=>x.trim()).join('\n').replace(/\n{3,}/g,'\n\n').trim()
      .normalize('NFC').slice(0,1000);
  }
  function cue(cues,start,end,body){
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>180)return;
    const text=plain(body);
    if(text&&cues.length<10000)cues.push({start,end,text});
  }
  function parseArrow(source,cues){
    const cleaned=source.replace(/^WEBVTT[^\n]*\n/i,'');
    for(const block of cleaned.split(/\n\s*\n/)){
      const lines=block.trim().split('\n');
      const index=lines.findIndex(line=>line.includes('-->'));
      if(index<0)continue;
      const pair=lines[index].split(/\s*-->\s*/);
      const end=String(pair[1]||'').split(/\s+/)[0];
      const body=lines.slice(index+1).join('\n');
      cue(cues,time(pair[0]),time(end),body);
    }
  }
  function parseSubViewer(source,cues){
    const lines=source.split('\n');
    let active=null;
    const flush=()=>{if(active)cue(cues,active.start,active.end,active.body.join('\n'));};
    for(const line of lines){
      const m=line.match(/^\s*\[(\d{1,2}:\d{2}:\d{2}[.,]\d+)\]\s*\[(\d{1,2}:\d{2}:\d{2}[.,]\d+)\]/);
      if(m){flush();active={start:time(m[1]),end:time(m[2]),body:[]};}
      else if(active&&!/^\s*\[(?:INFORMATION|TITLE|AUTHOR|SOURCE|END)\]/i.test(line))active.body.push(line);
    }
    flush();
  }
  function parseMicroDVD(source,cues,options){
    const lines=source.split('\n');
    let fps=Number(options?.fps)||0;
    const head=lines.find(x=>/^\s*\{(?:0|1)\}\{(?:0|1)\}\s*\d+(?:\.\d+)?/.test(x));
    if(head){
      const hit=head.match(/^\s*\{(?:0|1)\}\{(?:0|1)\}\s*(\d+(?:\.\d+)?)/);
      if(hit&&Number(hit[1])>=15&&Number(hit[1])<=120)fps=Number(hit[1]);
    }
    const filename=String(options?.filename||'');
    if(!fps){const hit=filename.match(/(?:^|[^0-9])(23[.,]976|24|25|29[.,]97|30)(?:\s*fps|\s*hz)/i);
      if(hit)fps=Number(hit[1].replace(',','.'));}
    const assumed=!fps;
    if(!fps)fps=23.976;
    for(const line of lines){
      const m=line.match(/^\s*\{(\d+)\}\{(\d+)\}(.*)$/);
      if(!m)continue;
      const start=Number(m[1]),end=Number(m[2]),body=m[3];
      if(start===end&&/^\s*\d+(?:\.\d+)?\s*$/.test(body))continue;
      cue(cues,start/fps,end/fps,body.replace(/\|/g,'\n').replace(/\{[yY]:[^}]*\}/g,''));
    }
    return {fps,assumed};
  }
  function parseAss(source,cues){
    const lines=source.split('\n');
    let inEvents=false,keys=['layer','start','end','style','name','marginl','marginr','marginv','effect','text'];
    for(const line of lines){
      if(/^\s*\[events\]/i.test(line)){inEvents=true;continue;}
      if(/^\s*\[[^\]]+\]/.test(line)){inEvents=false;continue;}
      if(!inEvents)continue;
      if(/^\s*Format\s*:/i.test(line)){
        keys=line.replace(/^\s*Format\s*:/i,'').split(',').map(s=>s.trim().toLowerCase());continue;
      }
      if(!/^\s*Dialogue\s*:/i.test(line))continue;
      const raw=line.replace(/^\s*Dialogue\s*:/i,'');
      const cols=raw.split(',');
      if(cols.length<keys.length)continue;
      const parsed=cols.slice(0,keys.length-1).concat(cols.slice(keys.length-1).join(','));
      cue(cues,time(parsed[keys.indexOf('start')]),time(parsed[keys.indexOf('end')]),
        parsed[keys.indexOf('text')]);
    }
  }
  function decode(raw,filename='',options={}){
    const source=String(raw||'').replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
    if(source.includes('\0')||/^# VobSub index file/i.test(source))
      return {cues:[],format:'bitmap',error:'Bitmap VobSub .sub requires the paired .idx file and an image decoder.'};
    const cues=[];
    const ext=String(filename).toLowerCase().split('.').pop();
    const isAss=/^\s*\[Script Info\]/mi.test(source)&&/^\s*\[Events\]/mi.test(source);
    const isMicroDVD=/^\s*\{\d+\}\{\d+\}/m.test(source);
    const isSubViewer=/^\s*\[\d{1,2}:\d{2}:\d{2}[.,]\d+\]\s*\[/m.test(source);
    let format='srt',fps=null,warning='';
    if(isAss||ext==='ass'||ext==='ssa'){format='ass';parseAss(source,cues);}
    else if(isMicroDVD){format='microdvd';const data=parseMicroDVD(source,cues,{...options,filename});
      fps=data.fps;
      if(data.assumed)warning='MicroDVD file has no frame-rate header. Using 23.976 FPS; adjust or choose a matching release if timing drifts.';}
    else if(isSubViewer){format='subviewer';parseSubViewer(source,cues);}
    else{format=/^\s*WEBVTT/i.test(source)||ext==='vtt'?'vtt':'srt';parseArrow(source,cues);}
    cues.sort((a,b)=>a.start-b.start);
    return {cues,format,fps,warning,error:cues.length?'':'No readable text subtitle cues found.'};
  }
  const api={time,plain,decode};
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.MarmaladeSubtitleCodec=api;
})(typeof window!=='undefined'?window:globalThis);
