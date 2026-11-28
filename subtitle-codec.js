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
  function timedMarkers(body,text,start,end){
    // WebVTT timestamps identify the start of a following text segment.
    // Validate monotonic times and retain only boundaries that map cleanly
    // onto the sanitized, normalized caption text.
    const markers=[];let previous=start;
    for(const match of body.matchAll(/<((?:\d{2,}:)?\d{2}:\d{2}\.\d{3})>/g)){
      const at=time(match[1]);
      if(!Number.isFinite(at)||at<=previous||at>=end)return [];
      previous=at;
      const prefix=plain(body.slice(0,match.index));
      if(!text.startsWith(prefix))return [];
      let index=prefix.length;
      while(index<text.length&&/\s/u.test(text[index]))index++;
      if(index>=text.length||markers.some(marker=>marker.index===index))continue;
      // Do not assign an exact word time to a marker inside a word.
      if(index>0&&/[\p{L}\p{N}\p{M}]/u.test(text[index-1])&&/[\p{L}\p{N}\p{M}]/u.test(text[index]))continue;
      markers.push({index,start:at});
    }
    return markers;
  }
  function cue(cues,start,end,body,inlineTiming=false){
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>180)return;
    const text=plain(body);
    // Reject unusually large cues rather than cutting a grapheme cluster in half.
    if(text&&text.length<=10000&&cues.length<10000){
      const item={start,end,text};
      if(inlineTiming){
        const markers=timedMarkers(body,text,start,end);
        if(markers.length)item.markers=markers;
      }
      cues.push(item);
    }
  }
  // Handle timestamped cues even if a SubDL release lacks blank lines.
  function parseArrow(source,cues,inlineTiming=false){
    const lines=source.replace(/^\s*WEBVTT[^\n]*\n/i,'').split('\n');
    let active=null;
    const flush=()=>{if(active)cue(cues,active.start,active.end,active.body.join('\n'),inlineTiming);};
    for(let i=0;i<lines.length;i++){
      const line=lines[i];
      if(line.includes('-->')){
        const m=line.match(/^\s*(\d{1,3}:\d{2}:\d{2}[.,]\d+|\d{1,3}:\d{2}[.,]\d+|\d{1,3}:\d{2}:\d{2})\s*-->\s*(\d{1,3}:\d{2}:\d{2}[.,]\d+|\d{1,3}:\d{2}[.,]\d+|\d{1,3}:\d{2}:\d{2})(?:\s|$)/);
        if(m){flush();active={start:time(m[1]),end:time(m[2]),body:[]};continue;}
      }
      if(!active)continue;
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
      parseArrow(lines.slice(timing).join('\n'),cues,true);
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
  // Search normalization is deliberately separate from rendered dialogue.
  // Remove Latin accents and optional Arabic vowel marks, not Indic vowel
  // signs or Japanese voicing marks that distinguish different words.
  function dialogueKey(value){
    return String(value??'').normalize('NFKC').toLowerCase().normalize('NFD')
      .replace(/(\p{Script=Latin})\p{M}+/gu,'$1')
      .replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g,'')
      .normalize('NFC').replace(/[\p{P}\p{Z}\s]+/gu,' ').trim();
  }
  const dialogueIndexes=new WeakMap();
  function searchDialogue(cues,query){
    if(!Array.isArray(cues))return [];
    const terms=dialogueKey(query).split(' ').filter(Boolean);
    let index=dialogueIndexes.get(cues);
    if(!index||index.length!==cues.length){
      index=cues.map(cue=>dialogueKey(cue.text));
      dialogueIndexes.set(cues,index);
    }
    const results=[];
    for(let i=0;i<index.length;i++)if(terms.every(term=>index[i].includes(term)))results.push(i);
    return results;
  }
  // Convert engine-exposed text cues into a bounded, inert WebVTT snapshot.
  // Re-escape the sanitized text so it cannot create a new timing row.
  function vttStamp(seconds){
    const ms=Math.round(seconds*1000),h=Math.floor(ms/3600000),m=Math.floor(ms/60000)%60,s=Math.floor(ms/1000)%60;
    return [h,m,s].map(n=>String(n).padStart(2,'0')).join(':')+'.'+String(ms%1000).padStart(3,'0');
  }
  function snapshotTextTrack(input,preserveTiming=false){
    const rows=['WEBVTT'];let count=0,size=6;
    for(const item of input||[]){
      const start=Number(item.startTime),end=Number(item.endTime);
      if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>3599999||end<=start||end-start>180||typeof item.text!=='string')continue;
      const text=plain(item.text).replace(/\n\s*\n/g,'\n');
      if(!text||text.length>10000)continue;
      const escape=value=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      let escaped='',cursor=0;
      if(preserveTiming){
        for(const marker of timedMarkers(item.text,text,start,end)){
          escaped+=escape(text.slice(cursor,marker.index))+'<'+vttStamp(marker.start)+'>';
          cursor=marker.index;
        }
      }
      escaped+=escape(text.slice(cursor));
      const row=vttStamp(start)+' --> '+vttStamp(end)+'\n'+escaped;
      size+=new TextEncoder().encode(row).length+2;
      if(++count>10000||size>5*1024*1024)throw Error('Player subtitle track exceeds the supported caption limit');
      rows.push(row);
    }
    if(!count)throw Error('No readable text captions are available from this track yet');
    return rows.join('\n\n')+'\n';
  }
  // Local Matroska text-subtitle demux. Read bounded windows, skip unrelated
  // packet payloads, and never load the entire movie into memory.
  async function matroskaText(file,{trackNumber=null,signal,onProgress}={}){
    const ranged=typeof file?.read==='function',length=ranged?file.length:file?.size;
    if(!file||(!ranged&&typeof file.slice!=='function')||!Number.isSafeInteger(length)||length<=0)
      throw Error('Choose a local MKV/WebM file or supported media-library source');
    const id={EBML:0x1a45dfa3,SEG:0x18538067,INFO:0x1549a966,TRACKS:0x1654ae6b,CLUSTER:0x1f43b675,
      ENTRY:0xae,NUMBER:0xd7,TYPE:0x83,CODEC:0x86,NAME:0x536e,LANG:0x22b59c,IETF:0x22b59d,
      SCALE:0x2ad7b1,TIME:0xe7,GROUP:0xa0,BLOCK:0xa1,SIMPLE:0xa3,DURATION:0x9b,
      ENCODINGS:0x6d80,TRACKSCALE:0x23314f,DEFAULTDURATION:0x23e383,PRIVATE:0x63a2};
    const levelOne=new Set([id.INFO,id.TRACKS,id.CLUSTER,0x114d9b74,0x1c53bb6b,0x1941a469,0x1043a770,0x1254c367]);
    let windowStart=-1,windowBytes=new Uint8Array(),steps=0,scale=1000000;
    const check=()=>{if(signal?.aborted)throw Error('Subtitle extraction cancelled');};
    async function read(at,n){
      check();
      if(!Number.isSafeInteger(at)||!Number.isSafeInteger(n)||at<0||n<0||at+n>length||n>1024*1024)throw Error('Invalid Matroska element bounds');
      if(at<windowStart||at+n>windowStart+windowBytes.length){
        windowStart=at;
        const count=Math.min(length-at,Math.max(n,1024*1024));
        const data=ranged?await file.read(at,count,{signal}):await file.slice(at,at+count).arrayBuffer();
        windowBytes=new Uint8Array(data);
        if(windowBytes.byteLength!==count)throw Error('Truncated Matroska source range');
        check();
      }
      return windowBytes.subarray(at-windowStart,at-windowStart+n);
    }
    function vint(bytes,at,identifier=false){
      const first=bytes[at];if(!first)throw Error('Invalid EBML variable integer');
      let mask=128,width=1;while(!(first&mask)){mask>>=1;width++;}
      if(width>(identifier?4:8)||at+width>bytes.length)throw Error('Truncated EBML variable integer');
      let value=BigInt(identifier?first:first&(mask-1));
      for(let i=1;i<width;i++)value=(value<<8n)|BigInt(bytes[at+i]);
      const unknown=!identifier&&value===(1n<<BigInt(7*width))-1n;
      if(!unknown&&value>BigInt(Number.MAX_SAFE_INTEGER))throw Error('Matroska element exceeds safe size');
      return {width,value:unknown?null:Number(value)};
    }
    async function element(at,limit){
      if(at>=limit)throw Error('Missing Matroska element');
      const b=await read(at,Math.min(12,limit-at));
      const type=vint(b,0,true),size=vint(b,type.width),start=at+type.width+size.width;
      const end=size.value===null?limit:start+size.value;
      if(start>limit||end>limit||!Number.isSafeInteger(end))throw Error('Truncated Matroska element');
      if(++steps>3000000)throw Error('Matroska scan exceeds the supported element count');
      if(steps%4096===0){onProgress?.(Math.min(100,at/length*100));await new Promise(resolve=>setTimeout(resolve,0));check();}
      return {type:type.value,start,end,unknown:size.value===null};
    }
    async function children(start,end,visit){
      for(let pos=start;pos<end;){
        const e=await element(pos,end);
        if(e.unknown)throw Error('Unsupported unknown-size nested Matroska element');
        await visit(e);pos=e.end;
      }
    }
    async function uint(e){
      const n=e.end-e.start;if(n<1||n>8)throw Error('Invalid Matroska integer');
      let value=0;for(const b of await read(e.start,n))value=value*256+b;
      if(!Number.isSafeInteger(value))throw Error('Matroska integer exceeds safe range');return value;
    }
    async function str(e){
      if(e.end-e.start>65536)throw Error('Matroska text metadata too large');
      return new TextDecoder('utf-8',{fatal:true}).decode(await read(e.start,e.end-e.start)).replace(/\0+$/,'');
    }
    const tracks=[],packets=[];let packetBytes=0;
    const supported=new Set(['S_TEXT/UTF8','S_TEXT/WEBVTT','D_WEBVTT/SUBTITLES','D_WEBVTT/CAPTIONS','S_TEXT/ASS','S_TEXT/SSA','S_HDMV/PGS','S_VOBSUB']);
    async function parseTracks(e){
      await children(e.start,e.end,async entry=>{
        if(entry.type!==id.ENTRY)return;
        const track={number:0,type:0,codec:'',name:'',language:'und',encoded:false,nonstandard:false,defaultDuration:0};
        await children(entry.start,entry.end,async field=>{
          switch(field.type){
            case id.NUMBER:track.number=await uint(field);break;
            case id.TYPE:track.type=await uint(field);break;
            case id.CODEC:track.codec=await str(field);break;
            case id.NAME:track.name=await str(field);break;
            case id.LANG:if(!track.ietf)track.language=await str(field);break;
            case id.IETF:track.language=await str(field);track.ietf=true;break;
            case id.ENCODINGS:track.encoded=true;break;
            case id.TRACKSCALE:track.nonstandard=true;break;
            case id.DEFAULTDURATION:track.defaultDuration=await uint(field)/1e9;break;
            case id.PRIVATE:if(field.end-field.start<=65536)track.privateField=field;break;
          }
        });
        if(track.type===17&&track.number>0){
          if(tracks.length>=128||tracks.some(t=>t.number===track.number))throw Error('Invalid Matroska subtitle track table');
          track.supported=supported.has(track.codec)&&!track.encoded&&!track.nonstandard;
          if(track.codec==='S_VOBSUB'){
            try{track.privateText=track.privateField?await str(track.privateField):'';vobSubInfo(track.privateText);}
            catch{track.supported=false;}
          }
          delete track.privateField;
          tracks.push(track);
        }
      });
    }
    async function block(e,clusterTime,duration){
      const n=e.end-e.start;
      if(n<4)return;
      const h=await read(e.start,Math.min(11,n)),v=vint(h,0);
      if(v.value!==trackNumber)return;
      const offset=v.width;if(n<offset+3)throw Error('Truncated subtitle block');
      const relative=(h[offset]<<8|h[offset+1]);const signed=relative>=32768?relative-65536:relative;
      if(h[offset+2]&6)throw Error('Laced subtitle blocks are not supported');
      const length=n-offset-3;
      const bitmap=['S_HDMV/PGS','S_VOBSUB'].includes(tracks.find(t=>t.number===trackNumber)?.codec);
      const limit=bitmap?20*1024*1024:5*1024*1024;
      if(length>(bitmap?1024*1024:65536)||packetBytes+length>limit||packets.length>=(bitmap?100000:10000))throw Error('Embedded subtitle track exceeds caption limits');
      const bytes=await read(e.start+offset+3,length);
      const raw=bitmap?bytes.slice():new TextDecoder('utf-8',{fatal:true}).decode(bytes);
      packetBytes+=length;
      packets.push({ticks:clusterTime+signed,duration,raw});
    }
    async function cluster(e){
      let clock=null,pos=e.start;
      while(pos<e.end){
        const child=await element(pos,e.end);
        if(e.unknown&&levelOne.has(child.type))return pos;
        if(child.unknown)throw Error('Unsupported unknown-size cluster child');
        if(child.type===id.TIME)clock=await uint(child);
        else if(child.type===id.SIMPLE||child.type===id.GROUP){
          if(clock===null)throw Error('Matroska cluster has no preceding timestamp');
          if(child.type===id.SIMPLE)await block(child,clock,null);
          else{
            let packet=null,duration=null;
            await children(child.start,child.end,async field=>{
              if(field.type===id.BLOCK)packet=field;
              else if(field.type===id.DURATION)duration=await uint(field);
            });
            if(packet)await block(packet,clock,duration);
          }
        }
        pos=child.end;
      }
      return pos;
    }
    const header=await element(0,length);
    if(header.type!==id.EBML||header.unknown)throw Error('Not a supported Matroska/WebM file');
    let pos=header.end,segment=null;
    while(pos<length){
      const e=await element(pos,length);
      if(e.type===id.SEG){segment=e;break;}
      if(e.unknown)throw Error('Invalid Matroska segment');pos=e.end;
    }
    if(!segment)throw Error('Matroska segment missing');
    pos=segment.start;
    while(pos<segment.end){
      const e=await element(pos,segment.end);
      if(e.type===id.INFO){
        if(e.unknown)throw Error('Invalid Matroska info');
        await children(e.start,e.end,async field=>{if(field.type===id.SCALE){scale=await uint(field);if(scale<1||scale>1e9)throw Error('Invalid Matroska timestamp scale');}});
      }else if(e.type===id.TRACKS){
        if(e.unknown)throw Error('Invalid Matroska tracks');
        await parseTracks(e);
        if(trackNumber===null)return {tracks};
        const selected=tracks.find(t=>t.number===trackNumber);
        if(!selected?.supported)throw Error('Selected embedded subtitle track is not supported');
      }else if(e.type===id.CLUSTER){
        if(!tracks.length&&trackNumber!==null)throw Error('Matroska tracks must precede media clusters');
        if(trackNumber===null){
          if(e.unknown)throw Error('Cannot enumerate tracks after an unknown-size cluster');
        }else{pos=await cluster(e);continue;}
      }
      if(e.unknown)throw Error('Unsupported unknown-size Matroska element');pos=e.end;
    }
    if(trackNumber===null)return {tracks};
    const track=tracks.find(t=>t.number===trackNumber);
    if(!track?.supported)throw Error('Selected embedded subtitle track is not supported');
    const factor=scale/1e9,rows=[];let inferred=0;
    packets.sort((a,b)=>a.ticks-b.ticks);
    if(track.codec==='S_VOBSUB'){
      const entries=packets.map(p=>({start:p.ticks*factor,duration:p.duration>0?p.duration*factor:0,raw:p.raw}));
      const frames=decodeVobSub(track.privateText,entries);
      check();onProgress?.(100);
      return {tracks,track,entries,frames,format:'vobsub',inferred:0};
    }
    if(track.codec==='S_HDMV/PGS'){
      const raw=matroskaPgsToSup(packets,factor);
      check();onProgress?.(100);
      return {tracks,track,raw,format:'pgs',inferred:0};
    }
    for(let i=0;i<packets.length;i++){
      const packet=packets[i],start=packet.ticks*factor;
      let duration=packet.duration===null?track.defaultDuration:packet.duration*factor;
      if(!(duration>0)){
        const next=packets[i+1]?.ticks*factor;
        duration=Math.min(3,next>start?next-start:3);inferred++;
      }
      let text=packet.raw;
      if(track.codec.startsWith('D_WEBVTT/')){
        // WebM reserves the first two lines for the cue identifier and settings.
        const lines=text.replace(/\r\n?/g,'\n').split('\n');
        if(lines.length<3)throw Error('Missing embedded WebM caption headers');
        text=lines.slice(2).join('\n');
      }else if(track.codec==='S_TEXT/WEBVTT'){
        // Matroska stores inline timestamps relative to this block.
        text=text.replace(/<((?:\d{2,}:)?\d{2}:\d{2}\.\d{3})>/g,
          (_,relative)=>'<'+vttStamp(start+time(relative))+'>');
      }else if(track.codec!=='S_TEXT/UTF8'){
        const parts=text.split(',');if(parts.length<9)continue;
        text=parts.slice(8).join(',');
        // ASS vector drawings are not dialogue.
        if(/\{[^}]*\\p[1-9]/.test(text))continue;
      }
      rows.push({startTime:start,endTime:start+duration,text});
    }
    check();onProgress?.(100);
    return {tracks,track,raw:snapshotTextTrack(rows,track.codec.includes('WEBVTT')),format:'vtt',inferred};
  }
  // Matroska PGS blocks carry type + big-endian 16-bit segment length,
  // without the standalone SUP PG/PTS/DTS headers. Reconstruct those headers
  // from the container timeline. Never interpret image packets as UTF-8.
  function matroskaPgsToSup(packets,factor){
    const sets=[];let active=null,total=0;
    const stamp=at=>{
      if(!Number.isFinite(at)||at<0||at>7*86400)throw Error('Invalid embedded PGS timestamp');
      return Math.round(at*90000)>>>0;
    };
    const makeSegment=(type,at,payload)=>{
      const out=new Uint8Array(13+payload.length),view=new DataView(out.buffer);
      out[0]=0x50;out[1]=0x47;view.setUint32(2,stamp(at));view.setUint32(6,stamp(at));
      out[10]=type;view.setUint16(11,payload.length);out.set(payload,13);
      total+=out.length;if(total>20*1024*1024)throw Error('Embedded PGS output exceeds 20 MB');
      return out;
    };
    for(const packet of packets){
      const at=packet.ticks*factor,bytes=packet.raw;
      if(!(bytes instanceof Uint8Array))throw Error('Invalid PGS packet');
      for(let pos=0;pos<bytes.length;){
        if(pos+3>bytes.length)throw Error('Truncated embedded PGS segment');
        const type=bytes[pos],size=bytes[pos+1]*256+bytes[pos+2];
        if(pos+3+size>bytes.length)throw Error('Truncated embedded PGS payload');
        const payload=bytes.subarray(pos+3,pos+3+size);pos+=3+size;
        if(type===0x16){
          if(active||payload.length<11)throw Error('Invalid embedded PGS composition');
          active={at,pcs:payload.slice(),parts:[],duration:packet.duration>0?packet.duration*factor:0};
        }
        if(!active)throw Error('Embedded PGS segment outside a display set');
        active.parts.push(makeSegment(type,at,payload));
        if(type===0x80){sets.push(active);active=null;}
      }
    }
    if(active||!sets.length)throw Error('Incomplete embedded PGS display sets');
    const chunks=[];
    for(let i=0;i<sets.length;i++){
      const set=sets[i];chunks.push(...set.parts);
      const end=set.at+set.duration,next=sets[i+1]?.at??Infinity;
      // A positive BlockDuration may end a cue before the next display set.
      // Insert an empty composition only in that gap; never overwrite an
      // explicit clear or a newer overlapping composition.
      if(set.pcs[10]&&set.duration>0&&end<next){
        const clear=set.pcs.slice(0,11);clear[7]=0;clear[8]=0;clear[10]=0;
        chunks.push(makeSegment(0x16,end,clear),makeSegment(0x80,end,new Uint8Array()));
      }
    }
    const out=new Uint8Array(total);let offset=0;
    for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.length;}
    return out;
  }
  // Blu-ray Presentation Graphics (.sup): parse display sets, palettes,
  // fragmented bitmap objects, authored coordinates and clear compositions.
  // The decoded pixel budget is global to the import, not just per object.
  function decodePgs(input){
    const b=input instanceof Uint8Array?input:new Uint8Array(input);
    if(!b.length||b.length>20*1024*1024)throw Error('PGS file must be under 20 MB');
    const u16=(v,i)=>v[i]*256+v[i+1],u24=(v,i)=>v[i]*65536+u16(v,i+1);
    const u32=(v,i)=>v[i]*16777216+u24(v,i+1);
    const fail=message=>{throw Error('Invalid PGS: '+message);};
    const clamp=x=>Math.max(0,Math.min(255,Math.round(x)));
    const objects=new Map(),palettes=new Map(),pending=new Map(),frames=[];
    let pos=0,pcs=null,pixels=0,segments=0,lastPts=-1,wrap=0;
    function decodeRle(raw,w,h){
      const bitmap=new Uint8Array(w*h);let at=0,x=0,y=0;
      while(at<raw.length){
        if(y>=h)fail('extra bitmap data');
        let color=raw[at++],run=1;
        if(color===0){
          if(at>=raw.length)fail('truncated run');
          const flags=raw[at++];
          if(flags===0){if(x!==w)fail('incomplete bitmap row');x=0;y++;continue;}
          run=flags&63;
          if(flags&64){if(at>=raw.length)fail('truncated long run');run=run*256+raw[at++];}
          if(flags&128){if(at>=raw.length)fail('truncated color');color=raw[at++];}
        }
        if(!run||x+run>w)fail('bitmap run exceeds row');
        bitmap.fill(color,y*w+x,y*w+x+run);x+=run;
      }
      if(y!==h&&!(y===h-1&&x===w))fail('incomplete bitmap');
      return bitmap;
    }
    while(pos<b.length){
      if(++segments>200000||pos+13>b.length||b[pos]!==0x50||b[pos+1]!==0x47)fail('segment header');
      const pts=u32(b,pos+2),type=b[pos+10],len=u16(b,pos+11);
      if(pos+13+len>b.length)fail('truncated segment');
      const v=b.subarray(pos+13,pos+13+len);pos+=13+len;
      if(type===0x16){
        if(pcs||len<11)fail('composition header');
        if(lastPts>=0&&pts<lastPts&&lastPts-pts>0x80000000)wrap+=0x100000000;
        if(lastPts>=0&&pts<lastPts&&lastPts-pts<=0x80000000)fail('nonmonotonic presentation timestamps');
        lastPts=pts;
        const width=u16(v,0),height=u16(v,2),state=v[7],count=v[10];
        if(!width||!height||width>4096||height>2160||count>64)fail('composition dimensions');
        if(state&0x80){objects.clear();palettes.clear();pending.clear();}
        const placements=[];let at=11;
        for(let i=0;i<count;i++){
          if(at+8>len)fail('truncated object placement');
          const object=u16(v,at),flags=v[at+3],x=u16(v,at+4),y=u16(v,at+6);
          at+=8;let crop=null;
          if(flags&0x80){
            if(at+8>len)fail('truncated crop');
            crop={x:u16(v,at),y:u16(v,at+2),w:u16(v,at+4),h:u16(v,at+6)};at+=8;
          }
          placements.push({object,x,y,crop,forced:!!(flags&0x40)});
        }
        if(at!==len)fail('composition length');
        pcs={start:(wrap+pts)/90000,width,height,palette:v[9],placements};
      }else if(type===0x14){
        if(len<2||(len-2)%5)fail('palette length');
        const palette=palettes.get(v[0])?.slice()||new Uint8ClampedArray(1024);
        for(let i=2;i<len;i+=5){
          const at=v[i]*4,Y=v[i+1]-16,Cr=v[i+2]-128,Cb=v[i+3]-128;
          // BT.709 limited-range YCbCr (HD Blu-ray).
          palette[at]=clamp(1.164383*Y+1.792741*Cr);
          palette[at+1]=clamp(1.164383*Y-.213249*Cb-.532909*Cr);
          palette[at+2]=clamp(1.164383*Y+2.112402*Cb);palette[at+3]=v[i+4];
        }
        palettes.set(v[0],palette);
      }else if(type===0x15){
        if(len<4)fail('object header');
        const id=u16(v,0),version=v[2],flags=v[3];
        let object=pending.get(id),at=4;
        if(flags&0x80){
          if(len<11||object)fail('invalid first object fragment');
          const total=u24(v,4)-4,w=u16(v,7),h=u16(v,9);
          if(total<1||total>20*1024*1024||!w||!h||w>4096||h>2160)fail('object bounds');
          object={version,total,w,h,chunks:[],length:0};pending.set(id,object);at=11;
        }
        if(!object||object.version!==version)fail('missing object fragment');
        const chunk=v.subarray(at);object.chunks.push(chunk);object.length+=chunk.length;
        if(object.length>object.total)fail('object fragment overflow');
        if(flags&0x40){
          if(object.length!==object.total)fail('truncated object');
          pixels+=object.w*object.h;if(pixels>64*1024*1024)throw Error('PGS decoded bitmap budget exceeded (64 MiB)');
          const raw=new Uint8Array(object.length);let offset=0;
          for(const part of object.chunks){raw.set(part,offset);offset+=part.length;}
          objects.set(id,{w:object.w,h:object.h,bitmap:decodeRle(raw,object.w,object.h)});
          pending.delete(id);
        }
      }else if(type===0x80){
        if(len||!pcs)fail('missing composition');
        if(pending.size)fail('unfinished object');
        const palette=palettes.get(pcs.palette);
        const layers=[];
        for(const placement of pcs.placements){
          const object=objects.get(placement.object);
          if(!object||!palette)fail('missing palette or bitmap');
          const crop=placement.crop||{x:0,y:0,w:object.w,h:object.h};
          if(!crop.w||!crop.h||crop.x+crop.w>object.w||crop.y+crop.h>object.h||
             placement.x+crop.w>pcs.width||placement.y+crop.h>pcs.height)fail('object outside composition');
          layers.push({...placement,crop,object,palette});
        }
        const frame={start:pcs.start,width:pcs.width,height:pcs.height,layers};
        if(frames.length&&frames.at(-1).start===frame.start)frames[frames.length-1]=frame;
        else frames.push(frame);
        if(frames.length>10000)throw Error('PGS composition count exceeds limit');
        pcs=null;
      }else if(type!==0x17)fail('unsupported segment type');
    }
    if(pcs||pending.size||!frames.some(f=>f.layers.length))fail('incomplete or empty display sets');
    // A missing final clear is bounded, rather than displaying indefinitely.
    return frames.map((frame,i)=>({...frame,end:frames[i+1]?.start??frame.start+5}));
  }
  // DVD SPU (S_VOBSUB) packets: Matroska stores raw SPUs and the IDX
  // size/palette in CodecPrivate, not the MPEG program-stream wrapper.
  function vobSubInfo(text){
    const source=String(text||'');
    if(source.length>65536)throw Error('VobSub index too large');
    const size=/^\s*size:\s*(\d+)\s*x\s*(\d+)\s*$/mi.exec(source);
    const colors=/^\s*palette:\s*([0-9a-f,\s]+)$/mi.exec(source)?.[1].split(',').map(x=>x.trim());
    const width=Number(size?.[1]),height=Number(size?.[2]);
    if(!width||!height||width>4096||height>2160||colors?.length!==16||colors.some(x=>!/^[0-9a-f]{6}$/i.test(x)))
      throw Error('Invalid VobSub canvas or palette');
    if(/^\s*custom colors:\s*ON\b/mi.test(source))throw Error('VobSub custom palette overrides are unsupported');
    return {width,height,colors:colors.map(x=>parseInt(x,16))};
  }
  function decodeVobSub(privateText,entries){
    const info=vobSubInfo(privateText),frames=[];
    if(!Array.isArray(entries)||!entries.length||entries.length>10000)throw Error('Invalid VobSub packet count');
    let pixels=0,bytes=0;
    const fail=msg=>{throw Error('Invalid VobSub: '+msg);};
    const ordered=entries.slice().sort((a,b)=>a.start-b.start);
    for(let n=0;n<ordered.length;n++){
      const entry=ordered[n],b=entry.raw;
      if(!(b instanceof Uint8Array)||b.length<10||b.length>65535||
        !Number.isFinite(entry.start)||entry.start<0||entry.start>7*86400)fail('packet bounds');
      bytes+=b.length;if(bytes>20*1024*1024)fail('packet budget');
      const u16=i=>b[i]*256+b[i+1],size=u16(0),control=u16(2);
      if(size!==b.length||control<4||control+4>size)fail('packet size');
      let pos=control,previousDate=-1,paletteMap=null,alphaMap=null,area=null,offsets=null,visible=false,forced=false;
      let last=null,cachedBitmap=null,cachedGeometry='',count=0;
      const packetEnd=Math.min(ordered[n+1]?.start??Infinity,entry.start+(entry.duration>0?entry.duration:180));
      function finish(at){
        if(last){last.end=Math.min(at,packetEnd);if(last.end>last.start)frames.push(last);last=null;}
      }
      while(true){
        if(++count>256||pos+4>size)fail('control sequence');
        const date=u16(pos),next=u16(pos+2);
        if(date<previousDate||next<control||next+4>size||(next!==pos&&next<=pos))fail('control sequence order');
        previousDate=date;
        let at=pos+4,terminated=false;
        const limit=next===pos?size:next;
        const need=n=>{if(at+n>limit)fail('truncated control command');};
        while(at<limit){
          const cmd=b[at++];
          if(cmd===0xff){terminated=true;break;}
          if(cmd===0||cmd===1){visible=true;if(cmd===0)forced=true;}
          else if(cmd===2){visible=false;}
          else if(cmd===3||cmd===4){need(2);const value=u16(at);at+=2;if(cmd===3)paletteMap=value;else alphaMap=value;}
          else if(cmd===5){
            need(6);const x=b[at]*16+(b[at+1]>>4),x2=(b[at+1]&15)*256+b[at+2];
            const y=b[at+3]*16+(b[at+4]>>4),y2=(b[at+4]&15)*256+b[at+5];at+=6;
            const w=x2-x+1,h=y2-y+1;
            if(w<=0||h<=0||x+w>info.width||y+h>info.height)fail('bitmap coordinates');
            area={x,y,w,h};
          }else if(cmd===6){need(4);offsets=[u16(at),u16(at+2)];at+=4;}
          else fail('unsupported dynamic control command '+cmd);
        }
        if(!terminated)fail('missing control terminator');
        const when=entry.start+date*1024/90000;
        finish(when);
        if(visible&&when<packetEnd){
          if(!area||!offsets||paletteMap===null||alphaMap===null)fail('missing bitmap controls');
          const {x,y,w,h}=area,geometry=[w,h,...offsets].join(':');
          if(geometry!==cachedGeometry){
            if(offsets.some(o=>o<4||o>=control))fail('pixel offset');
            pixels+=w*h;if(pixels>64*1024*1024)fail('decoded bitmap budget');
            const bitmap=new Uint8Array(w*h);
            for(let field=0;field<2;field++){
              let nibble=offsets[field]*2;
              const other=offsets[1-field],end=(other>offsets[field]?other:control)*2;
              const get=()=>{
                if(nibble>=end)fail('truncated RLE');
                const v=b[nibble>>1],value=(nibble&1)?v&15:v>>4;nibble++;return value;
              };
              for(let row=field;row<h;row+=2){
                let col=0;
                while(col<w){
                  let code=get();
                  if(code<4){code=code*16+get();if(code<16){code=code*16+get();if(code<64)code=code*16+get();}}
                  const run=(code>>2)||w-col,color=code&3;
                  if(run>w-col)fail('RLE exceeds row');
                  bitmap.fill(color,row*w+col,row*w+col+run);col+=run;
                }
                if(nibble&1)nibble++;
              }
            }
            cachedBitmap={w,h,bitmap};cachedGeometry=geometry;
          }
          const palette=new Uint8ClampedArray(16);
          for(let index=0;index<4;index++){
            const rgb=info.colors[(paletteMap>>(index*4))&15],alpha=((alphaMap>>(index*4))&15)*17;
            palette.set([rgb>>16&255,rgb>>8&255,rgb&255,alpha],index*4);
          }
          last={start:when,end:packetEnd,width:info.width,height:info.height,
            layers:[{x,y,crop:{x:0,y:0,w,h},object:cachedBitmap,palette,forced}]};
        }
        if(next===pos){finish(entry.duration>0?packetEnd:Math.min(packetEnd,last?last.start+5:when));break;}
        pos=next;
        if(frames.length>10000)fail('composition count');
      }
    }
    if(!frames.length||frames.length>10000)fail('no usable bitmap compositions');
    return frames;
  }
  // Standalone VobSub IDX/SUB: IDX indexes language-specific DVD SPUs
  // stored in MPEG-2 program-stream private_stream_1 PES packets.
  function parseVobSubIndex(text){
    const source=String(text||'').replace(/^\uFEFF/,'');
    if(source.length>2*1024*1024)throw Error('VobSub IDX exceeds 2 MB');
    const metadata=source.split(/\r?\n/).filter(line=>/^\s*(?:size|palette|custom colors):/i.test(line)).join('\n');
    vobSubInfo(metadata);
    const tracks=[];let active=null,total=0;
    for(const line of source.split(/\r?\n/)){
      const track=/^\s*id:\s*([a-z0-9_-]{1,16})\s*,\s*index:\s*(\d+)\s*$/i.exec(line);
      if(track){
        const index=Number(track[2]);
        if(index>31||tracks.some(t=>t.index===index))throw Error('Invalid or duplicate VobSub language index');
        active={index,language:track[1],entries:[]};tracks.push(active);continue;
      }
      if(/^\s*delay:/i.test(line)&&!/^\s*delay:\s*[+-]?00:00:00:000\s*$/i.test(line))
        throw Error('Nonzero IDX delay directives are unsupported; use the subtitle timing control');
      if(!/^\s*timestamp:/i.test(line))continue;
      const m=/^\s*timestamp:\s*(\d{1,3}):(\d{2}):(\d{2}):(\d{3})\s*,\s*filepos:\s*([0-9a-f]{1,13})\s*$/i.exec(line);
      if(!active||!m||Number(m[2])>=60||Number(m[3])>=60)throw Error('Invalid VobSub IDX timestamp');
      const start=Number(m[1])*3600+Number(m[2])*60+Number(m[3])+Number(m[4])/1000,offset=parseInt(m[5],16);
      const prev=active.entries.at(-1);
      if(start>7*86400||!Number.isSafeInteger(offset)||offset<0||
        (prev&&(start<prev.start||offset<=prev.offset))||++total>100000)throw Error('Invalid VobSub IDX entry order or bounds');
      active.entries.push({start,offset});
    }
    return {metadata,tracks:tracks.filter(t=>t.entries.length)};
  }
  function extractSpuFromProgramStream(bytes,index){
    const b=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes),pieces=[];
    let pos=0,size=null,total=0,first=true;
    const fail=message=>{throw Error('Invalid VobSub SUB: '+message);};
    if(!Number.isInteger(index)||index<0||index>31)fail('language index');
    while(pos+6<=b.length){
      if(b[pos]||b[pos+1]||b[pos+2]!==1)fail('MPEG packet prefix');
      const code=b[pos+3];
      if(first&&code!==0xba)fail('IDX offset does not point to a pack');
      first=false;
      if(code===0xba){
        const header=b[pos+4];
        if((header&0xf0)===0x20){
          if(pos+12>b.length)fail('truncated MPEG-1 pack');
          pos+=12;
        }else if((header&0xc0)===0x40&&pos+14<=b.length){
          pos+=14+(b[pos+13]&7);
        }else fail('unsupported MPEG pack');
        continue;
      }
      if(code===0xb9)break;
      const length=b[pos+4]*256+b[pos+5],end=pos+6+length;
      if(!length||end>b.length)fail('truncated PES packet');
      if(code===0xbd){
        let start=pos+6;
        if((b[start]&0xc0)===0x80){
          if(start+3>end)fail('truncated MPEG-2 PES header');
          start+=3+b[start+2];
        }else{
          // MPEG-1 allows stuffing and an optional STD buffer before PTS/DTS.
          while(start<end&&b[start]===0xff)start++;
          if(start<end&&(b[start]&0xc0)===0x40)start+=2;
          if(start>=end)fail('truncated MPEG-1 PES header');
          const flag=b[start]>>4;
          if(b[start]===0x0f)start++;
          else if(flag===2||flag===3){
            const length=flag===2?5:10;
            if(start+length>end)fail('truncated MPEG-1 timestamp');
            for(const marker of [0,2,4])if(!(b[start+marker]&1))fail('invalid MPEG-1 PTS');
            if(flag===3&&((b[start+5]&0xf1)!==0x11||!(b[start+7]&1)||!(b[start+9]&1)))fail('invalid MPEG-1 DTS');
            start+=length;
          }else fail('unsupported MPEG-1 PES header');
        }
        if(start>=end)fail('missing substream id');
        if(b[start]===0x20+index){
          const payload=b.subarray(start+1,end);
          if(!payload.length)fail('empty subtitle fragment');
          pieces.push(payload);total+=payload.length;
          if(size===null&&total>=2){
            const x=pieces[0],second=x.length>1?x[1]:pieces[1][0];
            size=x[0]*256+second;
            if(size<10||size>65535)fail('SPU size');
          }
          if(size!==null&&total>=size){
            const out=new Uint8Array(size);let at=0;
            for(const piece of pieces){const count=Math.min(piece.length,size-at);out.set(piece.subarray(0,count),at);at+=count;if(at===size)break;}
            return out;
          }
        }
      }
      pos=end;
    }
    fail('selected SPU packet is incomplete or missing');
  }
  async function readVobSubPair(indexText,file,index,{signal,onProgress}={}){
    const parsed=parseVobSubIndex(indexText),track=parsed.tracks.find(t=>t.index===index);
    if(!track||track.entries.length>10000)throw Error('No supported VobSub captions for the selected language');
    if(!file||typeof file.slice!=='function'||!Number.isSafeInteger(file.size)||file.size<=0)
      throw Error('Choose the matching binary .sub file');
    const entries=[];let total=0;
    for(let i=0;i<track.entries.length;i++){
      if(signal?.aborted)throw Error('VobSub import cancelled');
      const {start,offset}=track.entries[i],next=track.entries[i+1]?.offset??file.size;
      if(offset>=file.size||next>file.size)throw Error('VobSub IDX offset is outside the selected SUB file');
      const end=Math.min(file.size,next,offset+1024*1024);
      const data=await file.slice(offset,end).arrayBuffer();
      if(signal?.aborted)throw Error('VobSub import cancelled');
      const raw=extractSpuFromProgramStream(data,index);
      total+=raw.length;if(total>20*1024*1024)throw Error('VobSub selected language exceeds 20 MB');
      entries.push({start,duration:0,raw});
      if(i%32===0){onProgress?.(Math.round((i+1)/track.entries.length*100));await new Promise(resolve=>setTimeout(resolve,0));}
    }
    const frames=decodeVobSub(parsed.metadata,entries);
    if(signal?.aborted)throw Error('VobSub import cancelled');
    onProgress?.(100);
    return {frames,entries,privateText:parsed.metadata,language:track.language};
  }
  function pgsFrameAt(frames,at){
    if(!frames?.length||!Number.isFinite(at))return null;
    let lo=0,hi=frames.length;
    while(lo<hi){const mid=(lo+hi)>>1;if(frames[mid].start<=at)lo=mid+1;else hi=mid;}
    const f=frames[lo-1];return f&&f.end>at&&f.layers.length?f:null;
  }
  function pgsPixels(layer){
    const {object,palette,crop}=layer,rgba=new Uint8ClampedArray(crop.w*crop.h*4);
    for(let y=0;y<crop.h;y++)for(let x=0;x<crop.w;x++){
      const color=object.bitmap[(crop.y+y)*object.w+crop.x+x]*4;
      rgba.set(palette.subarray(color,color+4),(y*crop.w+x)*4);
    }
    return rgba;
  }
  const api={time,plain,decode,decodeBytes,activeText,encodings,fitTiming,referenceAlignment,dialogueKey,searchDialogue,snapshotTextTrack,matroskaText,matroskaPgsToSup,decodePgs,vobSubInfo,decodeVobSub,parseVobSubIndex,extractSpuFromProgramStream,readVobSubPair,pgsFrameAt,pgsPixels};
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.MarmaladeSubtitleCodec=api;
})(typeof window!=='undefined'?window:globalThis);
