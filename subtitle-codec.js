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
  function snapshotTextTrack(input){
    const rows=['WEBVTT'];let count=0,size=6;
    const stamp=seconds=>{
      const ms=Math.round(seconds*1000),h=Math.floor(ms/3600000),m=Math.floor(ms/60000)%60,s=Math.floor(ms/1000)%60;
      return [h,m,s].map(n=>String(n).padStart(2,'0')).join(':')+'.'+String(ms%1000).padStart(3,'0');
    };
    for(const item of input||[]){
      const start=Number(item.startTime),end=Number(item.endTime);
      if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>3599999||end<=start||end-start>180||typeof item.text!=='string')continue;
      const text=plain(item.text).replace(/\n\s*\n/g,'\n');
      if(!text||text.length>10000)continue;
      const escaped=text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const row=stamp(start)+' --> '+stamp(end)+'\n'+escaped;
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
    if(!file||typeof file.slice!=='function'||!Number.isSafeInteger(file.size))throw Error('Choose a local MKV/WebM file');
    const id={EBML:0x1a45dfa3,SEG:0x18538067,INFO:0x1549a966,TRACKS:0x1654ae6b,CLUSTER:0x1f43b675,
      ENTRY:0xae,NUMBER:0xd7,TYPE:0x83,CODEC:0x86,NAME:0x536e,LANG:0x22b59c,IETF:0x22b59d,
      SCALE:0x2ad7b1,TIME:0xe7,GROUP:0xa0,BLOCK:0xa1,SIMPLE:0xa3,DURATION:0x9b,
      ENCODINGS:0x6d80,TRACKSCALE:0x23314f,DEFAULTDURATION:0x23e383};
    const levelOne=new Set([id.INFO,id.TRACKS,id.CLUSTER,0x114d9b74,0x1c53bb6b,0x1941a469,0x1043a770,0x1254c367]);
    let windowStart=-1,windowBytes=new Uint8Array(),steps=0,scale=1000000;
    const check=()=>{if(signal?.aborted)throw Error('Subtitle extraction cancelled');};
    async function read(at,n){
      check();
      if(!Number.isSafeInteger(at)||!Number.isSafeInteger(n)||at<0||n<0||at+n>file.size||n>1024*1024)throw Error('Invalid Matroska element bounds');
      if(at<windowStart||at+n>windowStart+windowBytes.length){
        windowStart=at;
        windowBytes=new Uint8Array(await file.slice(at,Math.min(file.size,at+Math.max(n,1024*1024))).arrayBuffer());
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
      if(steps%4096===0){onProgress?.(Math.min(100,at/file.size*100));await new Promise(resolve=>setTimeout(resolve,0));check();}
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
    const supported=new Set(['S_TEXT/UTF8','S_TEXT/ASS','S_TEXT/SSA']);
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
          }
        });
        if(track.type===17&&track.number>0){
          if(tracks.length>=128||tracks.some(t=>t.number===track.number))throw Error('Invalid Matroska subtitle track table');
          track.supported=supported.has(track.codec)&&!track.encoded&&!track.nonstandard;
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
      if(length>65536||packetBytes+length>5*1024*1024||packets.length>=10000)throw Error('Embedded subtitle track exceeds caption limits');
      const raw=new TextDecoder('utf-8',{fatal:true}).decode(await read(e.start+offset+3,length));
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
    const header=await element(0,file.size);
    if(header.type!==id.EBML||header.unknown)throw Error('Not a supported Matroska/WebM file');
    let pos=header.end,segment=null;
    while(pos<file.size){
      const e=await element(pos,file.size);
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
        if(!selected?.supported)throw Error('Selected embedded track is not supported text');
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
    if(!track?.supported)throw Error('Selected embedded track is not supported text');
    const factor=scale/1e9,rows=[];let inferred=0;
    packets.sort((a,b)=>a.ticks-b.ticks);
    for(let i=0;i<packets.length;i++){
      const packet=packets[i],start=packet.ticks*factor;
      let duration=packet.duration===null?track.defaultDuration:packet.duration*factor;
      if(!(duration>0)){
        const next=packets[i+1]?.ticks*factor;
        duration=Math.min(3,next>start?next-start:3);inferred++;
      }
      let text=packet.raw;
      if(track.codec!=='S_TEXT/UTF8'){
        const parts=text.split(',');if(parts.length<9)continue;
        text=parts.slice(8).join(',');
        // ASS vector drawings are not dialogue.
        if(/\{[^}]*\\p[1-9]/.test(text))continue;
      }
      rows.push({startTime:start,endTime:start+duration,text});
    }
    check();onProgress?.(100);
    return {tracks,track,raw:snapshotTextTrack(rows),inferred};
  }
  const api={time,plain,decode,decodeBytes,activeText,encodings,fitTiming,referenceAlignment,dialogueKey,searchDialogue,snapshotTextTrack,matroskaText};
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.MarmaladeSubtitleCodec=api;
})(typeof window!=='undefined'?window:globalThis);
