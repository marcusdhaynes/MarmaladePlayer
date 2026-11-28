/* Subtitle decoders for text-based SRT, WebVTT, MicroDVD .sub, SubViewer .sub and ASS.
   Browser and Node compatible. Bitmap VobSub .sub requires an image/IDX decoder. */
(function(root){
  'use strict';
  function time(value){
    const parts=String(value||'').trim().replace(',','.').split(':');
    if(!parts.length||parts.length>3||parts.some(v=>!/^\d+(?:\.\d+)?$/.test(v)))return NaN;
    return parts.reduce((n,part)=>n*60+Number(part),0);
  }
  const entities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',lrm:'\u200e',rlm:'\u200f',zwj:'\u200d',zwnj:'\u200c',hellip:'…',mdash:'—',ndash:'–'};
  function plain(value){
    return String(value||'').replace(/\r/g,'')
      .replace(/\\[Nn]/g,'\n').replace(/\\h/g,' ')
      .replace(/\[br\]/gi,'\n')
      .replace(/\{(?:y|c|f|s|h|o|p):[^}]*\}/gi,'')
      .replace(/\{\\[^}]*\}/g,'')
      .replace(/<\d{1,2}:\d\d:\d\d(?:[.,]\d+)?>/g,'')
      .replace(/<br\s*\/?>/gi,'\n')
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
      // Preserve bidi marks, joiners and script-specific break opportunities.
      // They are meaningful in mixed-direction, Indic, Persian and Thai text.
      .split('\n').map(x=>x.trim()).join('\n').replace(/\n{3,}/g,'\n\n').trim()
      .normalize('NFC');
  }
  function cue(cues,start,end,body){
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>180)return;
    const text=plain(body);
    // Reject unusually large cues rather than cutting a grapheme cluster in half.
    if(text&&text.length<=10000&&cues.length<10000)cues.push({start,end,text});
  }
  // Handle timestamped cues even if a SubDL release lacks blank lines.
  function parseArrow(source,cues){
    const lines=source.replace(/^\s*WEBVTT[^\n]*\n/i,'').split('\n');
    let active=null;
    const flush=()=>{if(active)cue(cues,active.start,active.end,active.body.join('\n'));};
    for(let i=0;i<lines.length;i++){
      const line=lines[i];
      if(line.includes('-->')){
        const m=line.match(/^\s*(\d{1,3}:\d{2}:\d{2}[.,]\d+|\d{1,3}:\d{2}[.,]\d+|\d{1,3}:\d{2}:\d{2})\s*-->\s*(\d{1,3}:\d{2}:\d{2}[.,]\d+|\d{1,3}:\d{2}[.,]\d+|\d{1,3}:\d{2}:\d{2})(?:\s|$)/);
        if(m){flush();active={start:time(m[1]),end:time(m[2]),body:[]};continue;}
      }
      if(!active||/^\s*(?:NOTE|STYLE|REGION)(?:\s|$)/i.test(line))continue;
      if(/^\s*\d{1,7}\s*$/.test(line)&&lines[i+1]?.includes('-->'))continue;
      if(!line.trim()&&!active.body.length)continue;
      active.body.push(line);
    }
    flush();
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
    if(/^PK\u0003\u0004/.test(source))
      return {cues:[],format:'archive',error:'Subtitle ZIP was not extracted before decoding.'};
    if(/^\s*<!doctype html|^\s*<html|^\s*\{\s*"(?:error|status)"\s*:/i.test(source))
      return {cues:[],format:'response',error:'Subtitle URL returned a web page or API error, not captions.'};
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
  // Decode bytes before parsing. Do not interpret isolated Western accents
  // as Arabic: Windows-1256 maps many of the same high bytes to Arabic.
  function decodeBytes(input){
    const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
    if(bytes.byteLength>5*1024*1024)throw Error('Subtitle File Too Large');
    const strict=encoding=>new TextDecoder(encoding,{fatal:true}).decode(bytes);
    if(bytes[0]===0xff&&bytes[1]===0xfe)return strict('utf-16le');
    if(bytes[0]===0xfe&&bytes[1]===0xff)return strict('utf-16be');
    // BOM-less UTF-16: require a strong, asymmetric alternating NUL pattern
    // and actual subtitle timing syntax, not merely arbitrary binary data.
    if(bytes.length%2===0&&bytes.length>=16){
      let even=0,odd=0;
      const pairs=Math.min(bytes.length/2,2048);
      for(let i=0;i<pairs;i++){if(bytes[i*2]===0)even++;if(bytes[i*2+1]===0)odd++;}
      const guess=odd/pairs>.22&&even/pairs<.04?'utf-16le':
        even/pairs>.22&&odd/pairs<.04?'utf-16be':'';
      if(guess)try{
        const decoded=strict(guess);
        if(!decoded.includes('\0')&&(/\d:\d{2}(?::\d{2})?[.,]\d+\s*-->/.test(decoded)||
          /\{\d+\}\{\d+\}/.test(decoded)||/\[Events\]/i.test(decoded)||
          /\[\d{1,2}:\d{2}:\d{2}[.,]\d+\]\s*\[/.test(decoded)))return decoded;
      }catch{}
    }
    try{return strict('utf-8');}catch{}
    const arabic=new TextDecoder('windows-1256').decode(bytes);
    const western=new TextDecoder('windows-1252').decode(bytes);
    // Multiple Arabic letters in actual words are stronger evidence than
    // the old total-character count. Keep mixed Latin/Arabic lines intact.
    const arabicWords=arabic.match(/[\u0621-\u064a\u0671-\u06d3]{3,}/g)||[];
    const arabicLetters=arabicWords.reduce((sum,word)=>sum+word.length,0);
    return arabicLetters>=4?arabic:western;
  }
  const api={time,plain,decode,decodeBytes};
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.MarmaladeSubtitleCodec=api;
})(typeof window!=='undefined'?window:globalThis);
