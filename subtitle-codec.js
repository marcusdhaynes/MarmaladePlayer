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
  // WebVTT has block-level metadata, comments and optional arbitrary cue
  // identifiers. Treat them as structure, never as spoken dialogue.
  function parseVtt(source,cues){
    const blocks=source.trimStart().split(/\n[ \t]*\n(?:[ \t]*\n)*/);
    for(let i=0;i<blocks.length;i++){
      const lines=blocks[i].split('\n');
      const first=lines[0].trim();
      if(i===0&&/^WEBVTT(?:[ \t]|$)/.test(first))continue;
      if(/^(?:NOTE(?:[ \t]|$)|STYLE$|REGION$)/.test(first))continue;
      const timing=lines.findIndex((line,index)=>index<2&&line.includes('-->'));
      if(timing<0)continue;
      // The normal block has one timing row; retain tolerant parsing of
      // consecutive timing rows if a release omitted separating blank lines.
      parseArrow(lines.slice(timing).join('\n'),cues);
    }
  }
  function parseSubViewer(source,cues){
    const lines=source.split('\n');
    let active=null;
    const flush=()=>{if(active)cue(cues,active.start,active.end,active.body.join('\n'));};
    for(const line of lines){
      const m=line.match(/^\s*\[(\d{1,2}:\d{2}:\d{2}[.,]\d+)\]\s*\[(\d{1,2}:\d{2}:\d{2}[.,]\d+)\]/)||
        line.match(/^\s*(\d{1,2}:\d{2}:\d{2}\.\d+)\s*,\s*(\d{1,2}:\d{2}:\d{2}\.\d+)\s*$/);
      if(m){flush();active={start:time(m[1]),end:time(m[2]),body:[]};}
      else if(active&&!/^\s*\[(?:INFORMATION|TITLE|AUTHOR|SOURCE|END)\]/i.test(line))active.body.push(line);
    }
    flush();
  }
  function parseSbv(source,cues){
    let active=null;
    const flush=()=>{if(active)cue(cues,active.start,active.end,active.body.join('\n'));};
    for(const line of source.split('\n')){
      const match=line.match(/^\s*(\d{1,3}:\d{2}:\d{2}\.\d+)\s*,\s*(\d{1,3}:\d{2}:\d{2}\.\d+)\s*$/);
      if(match){flush();active={start:time(match[1]),end:time(match[2]),body:[]};}
      else if(active)active.body.push(line);
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
    const isSubViewer=/^\s*\[\d{1,2}:\d{2}:\d{2}[.,]\d+\]\s*\[/m.test(source)||
      /^\s*\d{1,2}:\d{2}:\d{2}\.\d+\s*,\s*\d{1,2}:\d{2}:\d{2}\.\d+\s*$/m.test(source);
    let format='srt',fps=null,warning='';
    if(isAss||ext==='ass'||ext==='ssa'){format='ass';parseAss(source,cues);}
    else if(isMicroDVD){format='microdvd';const data=parseMicroDVD(source,cues,{...options,filename});
      fps=data.fps;
      if(data.assumed)warning='MicroDVD file has no frame-rate header. Using 23.976 FPS; adjust or choose a matching release if timing drifts.';}
    else if(ext==='sbv'){format='sbv';parseSbv(source,cues);}
    else if(isSubViewer){format='subviewer';parseSubViewer(source,cues);}
    else{format=/^\s*WEBVTT/i.test(source)||ext==='vtt'?'vtt':'srt';
      if(format==='vtt')parseVtt(source,cues);else parseArrow(source,cues);}
    cues.sort((a,b)=>a.start-b.start);
    return {cues,format,fps,warning,error:cues.length?'':'No readable text subtitle cues found.'};
  }
  // Decode bytes before parsing. Do not interpret isolated Western accents
  // as Arabic: Windows-1256 maps many of the same high bytes to Arabic.
  const encodings=Object.freeze([
    ['auto','Automatic'],['utf-8','UTF-8'],['utf-16le','UTF-16 LE'],['utf-16be','UTF-16 BE'],
    ['windows-1256','Arabic (Windows-1256)'],['windows-1252','Western European (Windows-1252)'],
    ['windows-1250','Central European (Windows-1250)'],['windows-1251','Cyrillic (Windows-1251)'],
    ['windows-1253','Greek (Windows-1253)'],['windows-1254','Turkish (Windows-1254)'],
    ['windows-1255','Hebrew (Windows-1255)'],['windows-1257','Baltic (Windows-1257)'],
    ['windows-1258','Vietnamese (Windows-1258)'],['windows-874','Thai (Windows-874)'],
    ['shift_jis','Japanese (Shift JIS)'],['euc-kr','Korean (EUC-KR)'],
    ['gb18030','Chinese Simplified (GB18030)'],['big5','Chinese Traditional (Big5)']
  ].map(Object.freeze));
  function decodeBytes(input,encoding='auto'){
    const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
    if(bytes.byteLength>5*1024*1024)throw Error('Subtitle File Too Large');
    const strict=encoding=>new TextDecoder(encoding,{fatal:true}).decode(bytes);
    if(encoding!=='auto'){
      if(!encodings.some(([key])=>key===encoding))throw Error('Unsupported Subtitle Encoding');
      try{return strict(encoding);}catch{throw Error('Subtitle Cannot Be Decoded With The Selected Encoding');}
    }
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
  // Immutable, sorted cue arrays are replaced as a whole on each file load.
  // Cache an end-time interval tree by array identity. A lookup prunes every
  // subtree whose latest end is already expired; no arbitrary 32-cue window.
  const cueIndexes=new WeakMap();
  function activeText(cues,at){
    if(!Array.isArray(cues)||!cues.length||!Number.isFinite(at))return '';
    let low=0,high=cues.length;
    while(low<high){const mid=(low+high)>>1;if(cues[mid].start<=at)low=mid+1;else high=mid;}
    if(!low)return '';
    let index=cueIndexes.get(cues);
    if(!index||index.length!==cues.length){
      let size=1;while(size<cues.length)size*=2;
      const ends=new Float64Array(size*2);ends.fill(-Infinity);
      for(let i=0;i<cues.length;i++)ends[size+i]=Number(cues[i].end)||-Infinity;
      for(let i=size-1;i>0;i--)ends[i]=Math.max(ends[i*2],ends[i*2+1]);
      index={size,ends,length:cues.length};cueIndexes.set(cues,index);
    }
    const active=[],{size,ends}=index;
    // Protect the overlay against malicious thousands of overlapping lines.
    // Prefer the latest eight distinct cues, then display in timeline order.
    const seen=new Set();
    function visit(node,left,right){
      if(left>=low||ends[node]<=at||active.length>=8)return;
      if(right-left===1){
        const text=cues[left]?.text;
        if(text&&!seen.has(text)){seen.add(text);active.push(text);}
        return;
      }
      const mid=(left+right)>>1;
      visit(node*2+1,mid,right);visit(node*2,left,mid);
    }
    visit(1,0,size);
    return active.reverse().join('\n');
  }
  function fitTiming(first,second){
    const values=[first?.cue,first?.movie,second?.cue,second?.movie];
    if(values.some(v=>!Number.isFinite(v)||v<0))return null;
    const span=second.cue-first.cue;
    if(span<30||second.movie<=first.movie)return null;
    const scale=(second.movie-first.movie)/span;
    const seconds=first.movie-first.cue*scale;
    if(scale<.8||scale>1.25||Math.abs(seconds)>3600)return null;
    return {scale,seconds};
  }
  // Estimate only from unique dialogue shared by both subtitle files.
  function referenceAlignment(source,reference){
    if(!Array.isArray(source)||!Array.isArray(reference))return null;
    const key=text=>String(text||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu,' ').trim();
    function unique(cues){
      const map=new Map();
      for(const cue of cues.slice(0,10000)){
        if(!Number.isFinite(cue.start)||cue.start<0)continue;
        const text=key(cue.text);
        if(text.length>=16&&text.length<=500)map.set(text,map.has(text)?null:cue.start);
      }
      return map;
    }
    const left=unique(source),right=unique(reference),pairs=[];
    for(const [text,cue] of left){const movie=right.get(text);if(Number.isFinite(cue)&&Number.isFinite(movie))pairs.push({cue,movie});}
    pairs.sort((a,b)=>a.cue-b.cue);
    if(pairs.length<5||pairs.at(-1).cue-pairs[0].cue<60)return null;
    const n=Math.min(24,pairs.length),sample=Array.from({length:n},(_,i)=>pairs[Math.round(i*(pairs.length-1)/(n-1))]);
    const inliers=fit=>pairs.filter(p=>Math.abs(p.cue*fit.scale+fit.seconds-p.movie)<=.65);
    let best=null;
    for(let i=0;i<n;i++)for(let j=i+1;j<n;j++){
      const fit=fitTiming(sample[i],sample[j]);if(!fit)continue;
      const hits=inliers(fit),error=hits.reduce((sum,p)=>sum+Math.abs(p.cue*fit.scale+fit.seconds-p.movie),0);
      if(!best||hits.length>best.hits.length||(hits.length===best.hits.length&&error<best.error))best={fit,hits,error};
    }
    const required=Math.max(5,Math.ceil(pairs.length*.85));
    if(!best||best.hits.length<required)return null;
    const hits=best.hits,span=hits.at(-1).cue-hits[0].cue;
    if(span<60||span<(pairs.at(-1).cue-pairs[0].cue)*.8)return null;
    const x=hits.reduce((sum,p)=>sum+p.cue,0)/hits.length,y=hits.reduce((sum,p)=>sum+p.movie,0)/hits.length;
    const scale=hits.reduce((sum,p)=>sum+(p.cue-x)*(p.movie-y),0)/hits.reduce((sum,p)=>sum+(p.cue-x)**2,0);
    const seconds=y-x*scale;
    if(!Number.isFinite(scale)||scale<.8||scale>1.25||Math.abs(seconds)>3600)return null;
    const confirmed=inliers({scale,seconds});
    if(confirmed.length<required)return null;
    return {scale,seconds,matched:confirmed.length,total:pairs.length,span};
  }
  const api={time,plain,decode,decodeBytes,activeText,encodings,fitTiming,referenceAlignment};
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.MarmaladeSubtitleCodec=api;
})(typeof window!=='undefined'?window:globalThis);
