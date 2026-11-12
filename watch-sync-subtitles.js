/* Marmalade personal subtitles + host-only synchronized monitor.
   Existing media capture, WebRTC quality and transport are never modified. */
(() => {
  'use strict';
  const bridge=window.MarmaladeAddonBridge;
  if(!bridge)return;
  const {state,media,el,ensureAudioPlayback}=bridge;
  const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
  // Load purpose-built Arabic fonts where internet access permits. Native
  // shaping-safe system fallbacks remain available offline/on installed apps.
  const arabicFontLink=document.createElement('link');
  arabicFontLink.rel='stylesheet';
  arabicFontLink.href='https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic:wght@400;600;700&family=Noto+Sans+Arabic:wght@400;600;700&display=swap';
  document.head.appendChild(arabicFontLink);
  const style=document.createElement('style');
  style.textContent=[
    '#dropZone .host-sync-preview{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:transparent;z-index:2;pointer-events:none;display:none}',
    '#dropZone.host-sync-active .host-sync-preview{display:block}',
    '.subtitle-popover{width:min(344px,calc(100% - 24px));max-height:min(75%,560px)}',
    '.subtitle-style{border-top:1px solid #ffffff24;padding-top:7px;display:flex;flex-direction:column;gap:5px}',
    '.subtitle-style h3{font-size:10px;color:#ffd4a2;margin:4px 0 2px}',
    '.subtitle-style .subtitle-style-row{display:grid;grid-template-columns:minmax(0,1fr) 26px minmax(80px,102px) 45px;gap:5px;align-items:center;min-height:25px}',
    '.subtitle-style-row span,.subtitle-style-row label{font-size:10px;color:#d5ccd0;line-height:1.2}',
    '.subtitle-style-row label{display:block}',
    '.subtitle-style-row input[type=color]{width:26px;height:26px;min-width:26px;padding:1px;border:1px solid #655656;border-radius:3px;background:transparent;aspect-ratio:1;justify-self:center}',
    '.subtitle-style-row input[type=range]{width:100%;min-width:0;margin:0;accent-color:#ffaf63}',
    '.subtitle-style-row .sub-swatch-spacer{display:block;width:26px;height:1px}',
    '.subtitle-style-row .sub-setting-value{width:45px;min-width:45px;justify-self:end;text-align:right;font-size:9px;color:#ffd8ac;font-variant-numeric:tabular-nums;white-space:nowrap}',
    '.subtitle-style>label{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,160px);gap:6px;align-items:center;min-height:28px}',
    '.subtitle-style>label select{min-width:0;width:100%;max-width:160px;padding:4px 6px}',
    '.subtitle-style-row select{max-width:175px}',
    '.subtitle-style-row.subtitle-timing-row{grid-template-columns:minmax(0,1fr) auto!important}',
    '.subtitle-timing-control{display:flex;align-items:center;gap:4px;justify-content:flex-end}',
    '.subtitle-timing-control button{width:28px;min-width:28px;height:28px;border:1px solid #755848;border-radius:5px;background:#31272a;color:#ffd6ab;font-size:16px;font-weight:700;touch-action:none}',
    '.subtitle-timing-control button:active{background:#634332}',
    '.subtitle-timing-control input{width:65px;min-width:0;box-sizing:border-box;text-align:right;border:1px solid #755848;border-radius:5px;background:#252229;color:#fff2df;padding:5px 4px;font:inherit;font-size:11px;font-variant-numeric:tabular-nums}',
    '.subtitle-timing-control .timing-unit{font-size:10px;color:#e5c3a7}',
    '.subtitle-position-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:5px;width:135px;align-self:center}',
    '.subtitle-position-grid button{min-width:36px;min-height:25px;padding:3px;background:#302831;color:#e7d4c4}',
    '.subtitle-position-grid button[aria-pressed=true]{border-color:#ffb874;background:#624331;color:white}',
    '.subtitle-settings-note{font-size:9px;color:#a9a0a9}',
    '.host-sync-settings{display:flex;flex-direction:column;gap:5px;padding:9px 0;border-top:1px solid #ffffff24}',
    '.host-sync-settings[hidden]{display:none!important}',
    '.host-sync-settings label{font-size:11px}',
    '.host-sync-settings small{color:#aaa0a5;line-height:1.4}',
    '.host-sync-settings input[type=range]{accent-color:#ffad60}',
    '#subtitleOverlay{max-width:92%;box-sizing:border-box;pointer-events:none;overflow-wrap:anywhere}',
    '@media(max-width:450px){.subtitle-popover{max-height:67%}.subtitle-style .subtitle-style-row{grid-template-columns:minmax(0,1fr) 24px minmax(70px,92px) 43px;gap:4px}.subtitle-style-row input[type=color]{width:24px;height:24px;min-width:24px}}'
  ].join('\n');
  document.head.appendChild(style);
  const preview=document.createElement('video');
  preview.id='hostSyncPreview';
  preview.className='host-sync-preview';
  preview.playsInline=true;
  preview.preload='auto';
  preview.setAttribute('aria-hidden','true');
  preview.tabIndex=-1;
  media.insertAdjacentElement('afterend',preview);

  // The original source remains the *sole* input to video capture and guest
  // audio. The local monitor is a second playback head, never a sender.
  let previewNode=null,previewAudioActive=false,previewBusy=false;
  let previewSource='',lastPreviewSeek=0,lastAutoDelay=0;
  let manualSeconds=2;
  // Default to the original decoded picture. Delayed monitoring is opt-in.
  let syncMode='off';
  const syncSettings=document.createElement('section');
  syncSettings.className='host-sync-settings';
  syncSettings.id='hostSyncSettings';
  syncSettings.hidden=true;
  syncSettings.innerHTML=
    '<strong>Host / Guest A/V Alignment</strong>'+
    '<label for="hostSyncMode">Alignment <select id="hostSyncMode"><option value="auto">Auto (Guest Timing)</option><option value="manual">Manual</option><option value="off">Off</option></select></label>'+
    '<label for="hostSyncSeconds">Manual Host Delay <output id="hostSyncSecondsValue">2.00s</output></label>'+
    '<input type="range" id="hostSyncSeconds" min="0" max="8" value="2" step="0.05">'+
    '<small id="hostSyncInfo" role="status">Waiting for guest video timing. Auto mode leaves the original player unchanged until accurate timing is available.</small>';
  el.settingsPanel.insertBefore(syncSettings,el.settingsPanel.querySelector('.settings-tools'));
  const modeInput=syncSettings.querySelector('#hostSyncMode');
  modeInput.value='off';
  const delayInput=syncSettings.querySelector('#hostSyncSeconds');
  const delayOutput=syncSettings.querySelector('#hostSyncSecondsValue');
  const info=syncSettings.querySelector('#hostSyncInfo');
  function disconnectMonitorAudio(){
    if(!previewAudioActive)return;
    try{previewNode?.disconnect(state.speakerGain);}catch{}
    try{state.audioSourceNode?.connect(state.speakerGain);}catch{}
    previewAudioActive=false;
  }
  function connectMonitorAudio(){
    if(!state.speakerGain||!state.audioContext||!state.audioSourceNode)return false;
    try{
      if(!previewNode)previewNode=state.audioContext.createMediaElementSource(preview);
      if(previewAudioActive)return true;
      previewNode.connect(state.speakerGain);
      state.audioSourceNode.disconnect(state.speakerGain);
      previewAudioActive=true;
      return true;
    }catch(error){console.debug('Local monitor sound unavailable',error);disconnectMonitorAudio();return false;}
  }
  function stopMonitor(){
    el.stage.classList.remove('host-sync-active');
    state.hostSyncActive=false;
    disconnectMonitorAudio();
    if(!preview.paused)preview.pause();
    preview.playbackRate=1;
    if(previewSource){preview.removeAttribute('src');preview.load();previewSource='';}
    lastAutoDelay=0;
  }
  window.MarmaladeHostSyncCleanup=stopMonitor;
  function measuredDelay(){
    const now=performance.now();
    const values=[...state.connections.values()]
      .filter(e=>e.conn?.open && e.call && Number.isFinite(e.hostPresentationDelayMs)
        && now-e.hostPresentationReportAt<9000)
      .map(e=>e.hostPresentationDelayMs/1000)
      .filter(v=>v>=0.035&&v<=8);
    if(!values.length)return null;
    // For multiple guests, follow the slowest receiving playback. Each
    // guest still receives precisely the same unchanged WebRTC media.
    return Math.max(...values);
  }
  async function startMonitor(delay){
    if(previewBusy||!state.fileUrl)return;
    previewBusy=true;
    try{
      if(previewSource!==state.fileUrl){
        if(previewSource)stopMonitor();
        previewSource=state.fileUrl;preview.src=state.fileUrl;preview.load();
        await new Promise((resolve,reject)=>{
          if(preview.readyState>=1){resolve();return;}
          const timer=setTimeout(()=>reject(Error('Monitor metadata timeout')),4500);
          preview.addEventListener('loadedmetadata',()=>{clearTimeout(timer);resolve();},{once:true});
          preview.addEventListener('error',()=>{clearTimeout(timer);reject(Error('Monitor media error'));},{once:true});
        });
      }
      preview.currentTime=clamp(media.currentTime-delay,0,Number.isFinite(preview.duration)?preview.duration:media.currentTime);
      // A delayed preview must not run before the source reaches its delay.
      if(!media.paused && media.currentTime>delay+0.05)await preview.play();
      const audioReady=await ensureAudioPlayback();
      if(!audioReady||!connectMonitorAudio())throw Error('Monitor audio unavailable');
      // Do not cover the host picture with a secondary playback head until
      // this browser has actually decoded a frame into the preview.
      if (preview.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !preview.videoWidth)
        throw Error('Delayed preview has no decoded video frame');
      state.hostSyncActive=true;
      el.stage.classList.add('host-sync-active');
      lastPreviewSeek=performance.now();
    }catch(error){
      stopMonitor();
      info.textContent='Host monitor unavailable on this browser; original playback preserved.';
      console.debug('Host A/V alignment monitor unavailable',error);
    }finally{previewBusy=false;}
  }
  function updateMonitor(){
    const host=state.role==='host';
    syncSettings.hidden=!host;
    modeInput.disabled=!host;
    delayInput.disabled=!host;
    if(!host||state.source!=='file'||!state.broadcasting||
       !state.fileUrl||media.error||syncMode==='off'){
      if(state.hostSyncActive||previewSource)stopMonitor();
      return;
    }
    const reported=measuredDelay();
    if(reported!==null)lastAutoDelay=lastAutoDelay?lastAutoDelay*.8+reported*.2:reported;
    const seconds=syncMode==='manual'?manualSeconds:(reported===null?null:lastAutoDelay);
    if(seconds===null){
      info.textContent='Waiting for guest presentation timing · switch to Manual if your browser does not report it.';
      if(state.hostSyncActive)stopMonitor();
      return;
    }
    const delay=clamp(seconds,0,8);
    info.textContent=(syncMode==='manual'?'Manual':'Guest-measured')+
      ' host video + sound delay: '+delay.toFixed(2)+'s';
    if(delay<0.05){
      if(state.hostSyncActive)stopMonitor();
      return;
    }
    if(!state.hostSyncActive){void startMonitor(delay);return;}
    if(previewSource!==state.fileUrl){stopMonitor();void startMonitor(delay);return;}
    const target=clamp(media.currentTime-delay,0,Number.isFinite(preview.duration)?preview.duration:media.currentTime);
    const drift=target-preview.currentTime;
    if(media.paused){
      // Let the local picture and audio play through exactly the frames
      // still in the guest's receiving queue, then stop on the same frame.
      preview.playbackRate=1;
      if(preview.currentTime>=media.currentTime-.07){
        if(!preview.paused)preview.pause();
      }else if(preview.paused){
        void preview.play().catch(()=>{stopMonitor();});
      }
      return;
    }
    if(drift < -.13){
      // After a shared pause/resume, hold the local monitor until the guest's
      // delayed movie catches up. Never seek backward and repeat a scene.
      if(!preview.paused)preview.pause();
      preview.playbackRate=1;
    }else{
      if(drift>.18 && performance.now()-lastPreviewSeek>400){
        try{preview.currentTime=target;lastPreviewSeek=performance.now();}catch{}
        preview.playbackRate=1;
      }else{
        preview.playbackRate=Math.abs(drift)<.055?1:drift>0?1.02:.98;
      }
      if(preview.paused && target>0.05)
        void preview.play().catch(()=>{stopMonitor();});
    }
    if(!previewAudioActive)connectMonitorAudio();
  }
  modeInput.addEventListener('change',()=>{
    if(state.role!=='host'){modeInput.value='off';syncMode='off';return;}
    syncMode=modeInput.value;stopMonitor();updateMonitor();
  });
  delayInput.addEventListener('input',()=>{
    if(state.role!=='host')return;
    manualSeconds=Number(delayInput.value);
    delayOutput.textContent=manualSeconds.toFixed(2)+'s';
    if(syncMode==='manual')updateMonitor();
  });
  window.setInterval(updateMonitor,300);
  window.addEventListener('pagehide',stopMonitor);

  const presets={
    font:'Arial, Helvetica, sans-serif',textColor:'#ffffff',textSize:24,textAlpha:100,
    outlineColor:'#000000',outlineSize:1,outlineAlpha:95,
    glowColor:'#000000',glowSize:5,glowAlpha:70,
    shadowColor:'#000000',shadowSize:3,shadowAlpha:90,
    position:'bottom-center',alignment:'center',timing:0
  };
  let saved={};
  try{saved=JSON.parse(localStorage.getItem('marmalade-subtitle-style-v1')||'{}')||{};}catch{}
  const prefs={...presets};
  for(const [key,value] of Object.entries(presets))
    if(typeof saved[key]===typeof value)prefs[key]=saved[key];
  function colorRow(label,key){
    const maximum=key==='text'?64:key==='outline'?8:key==='glow'?36:30;
    return '<div class="subtitle-style-row"><span>'+(key==='text'?'Font Size':label+' Size')+'</span>'+
      '<input type="color" data-sub-key="'+key+'Color" aria-label="'+label+' Color">'+
      '<input type="range" data-sub-key="'+key+'Size" aria-label="'+(key==='text'?'Font Size':label+' Size')+'" min="'+(key==='text'?12:0)+'" max="'+maximum+'" step="1">'+
      '<output class="sub-setting-value" data-sub-value="'+key+'Size"></output></div>'+
      '<label class="subtitle-style-row" for="sub-'+key+'-alpha"><span>'+label+' Transparency</span>'+
      '<i class="sub-swatch-spacer" aria-hidden="true"></i>'+
      '<input id="sub-'+key+'-alpha" type="range" data-sub-key="'+key+'Alpha" min="0" max="100" step="1" aria-label="'+label+' Transparency">'+
      '<output class="sub-setting-value" data-sub-value="'+key+'Alpha"></output></label>';
  }
  const subStyle=document.createElement('section');
  subStyle.className='subtitle-style';
  subStyle.setAttribute('aria-label','My subtitle appearance');
  subStyle.innerHTML=
    '<h3>Subtitle Appearance · Only For Me</h3>'+
    '<label for="subtitleFont">Subtitle Font <select id="subtitleFont" data-sub-key="font">'+
    '<option value="Arial, Helvetica, sans-serif">Arial (Classic)</option>'+
    '<option value="Verdana, Geneva, sans-serif">Verdana (Clear)</option>'+
    '<option value="Tahoma, Geneva, sans-serif">Tahoma (Compact)</option>'+
    '<option value="Georgia, serif">Georgia (Serif)</option>'+
    '<option value="Times New Roman, serif">Times New Roman</option>'+
    '<option value="Trebuchet MS, sans-serif">Trebuchet MS</option>'+
    '<option value="Courier New, monospace">Courier New</option>'+
    '<option value="system-ui, sans-serif">System (Device Default)</option>'+ 
    '<option value="Noto Sans, Noto Sans Arabic, Noto Sans Devanagari, Noto Sans Thai, Noto Sans CJK SC, Arial, sans-serif">Noto Sans (Multilingual)</option>'+ 
    '<option value="Noto Naskh Arabic, Noto Sans Arabic, Tahoma, Arial, sans-serif">Arabic (Naskh)</option>'+ 
    '<option value="Noto Sans Arabic, Tahoma, Arial, sans-serif">Arabic (Modern)</option></select></label>'+
    colorRow('Font','text')+colorRow('Outline','outline')+
    colorRow('Glow','glow')+colorRow('Shadow','shadow')+
    '<h3>Subtitle Position</h3>'+
    '<div class="subtitle-position-grid" id="subtitlePositionGrid" role="group" aria-label="Subtitle position, three by three grid">'+
    ['top-left','top-center','top-right','middle-left','middle-center','middle-right','bottom-left','bottom-center','bottom-right']
      .map((p,i)=>'<button type="button" data-sub-position="'+p+'" aria-label="'+p.replace('-',' ')+'" aria-pressed="false">'+
        (i===7?'●':'·')+'</button>').join('')+'</div>'+
    '<label for="subtitleAlign">Text Alignment <select id="subtitleAlign" data-sub-key="alignment">'+
    '<option value="left">Left</option><option value="center">Center</option>'+
    '<option value="right">Right</option><option value="justify">Justified</option></select></label>'+
    '<div class="subtitle-style-row subtitle-timing-row"><label for="subtitleTiming">Subtitle Timing</label>'+
    '<div class="subtitle-timing-control"><button type="button" id="subtitleTimingMinus" aria-label="Subtract 0.1 seconds; hold for 1 second steps">−</button>'+
    '<input id="subtitleTiming" type="text" inputmode="decimal" pattern="[+-]?[0-9]*[.,]?[0-9]*" value="0.0" autocomplete="off" spellcheck="false" aria-label="Subtitle timing in seconds, to tenths of a second">'+
    '<span class="timing-unit" aria-hidden="true">s</span>'+
    '<button type="button" id="subtitleTimingPlus" aria-label="Add 0.1 seconds; hold for 1 second steps">+</button></div></div>'+
    '<small class="subtitle-settings-note">Tap + or − for 0.1s. Hold for 0.25s to change by 1s.</small>'+
    '<small class="subtitle-settings-note">Font Size, Colors, Position, And Timing Are Saved On This Device. Scripts Such As Arabic Use Native Text Shaping.</small>';
  el.subtitlePanel.appendChild(subStyle);
  const fields=[...subStyle.querySelectorAll('[data-sub-key]')];
  for(const field of fields){
    const key=field.dataset.subKey;
    if(key==='font'&&!Array.from(field.options).some(x=>x.value===prefs[key]))prefs[key]=presets.font;
    if(key.endsWith('Color')&&!/^#[0-9a-f]{6}$/i.test(prefs[key]))prefs[key]=presets[key];
    if(field.type==='range')prefs[key]=clamp(Number(prefs[key])||0,Number(field.min),Number(field.max));
    field.value=String(key.endsWith('Alpha')?100-prefs[key]:prefs[key]);
  }
  function rgba(hex,alpha){
    const v=hex.replace('#','');
    const r=parseInt(v.slice(0,2),16),g=parseInt(v.slice(2,4),16),b=parseInt(v.slice(4,6),16);
    return 'rgba('+r+','+g+','+b+','+clamp(Number(alpha),0,100)/100+')';
  }
  function applySubtitleStyle(){
    const overlay=el.subtitleOverlay;
    const isArabic=/[\u0600-\u08ff]/u.test(overlay.textContent||'');
    overlay.style.fontFamily=isArabic ?
      '"Noto Naskh Arabic", "Noto Sans Arabic", Tahoma, Arial, sans-serif, '+prefs.font : prefs.font;
    // Browser-native Unicode shaping keeps Arabic letters joined and preserves
    // Indic, Thai and mixed-direction captions without splitting glyph runs.
    overlay.style.fontKerning='normal';
    overlay.style.fontFeatureSettings='"rlig" 1, "calt" 1, "liga" 1';
    overlay.style.textTransform='none';
    overlay.style.fontVariantLigatures='normal';
    overlay.style.unicodeBidi='plaintext';
    // Direction is determined per caption line by dir=auto and plaintext bidi.
    overlay.style.direction='';
    overlay.style.wordBreak='normal';
    overlay.style.overflowWrap='break-word';
    overlay.style.whiteSpace='pre-line';
    overlay.style.letterSpacing='normal';
    const miniature=el.stage.classList.contains('mini-pip-visible') ||
      document.body.classList.contains('floating-overlay-active') ||
      document.body.classList.contains('native-pip-active');
    const actualHeight=Math.max(100,el.stage.clientHeight||100);
    const normalSize=clamp(Number(prefs.textSize)||24,12,40);
    const adjustedSize=miniature?clamp(Math.min(normalSize,actualHeight*.091),9,16):
      Math.min(normalSize,Math.max(14,actualHeight*.055));
    overlay.style.fontSize=adjustedSize+'px';
    overlay.style.lineHeight='1.22';
    overlay.style.boxSizing='border-box';
    overlay.style.color=rgba(prefs.textColor,prefs.textAlpha);
    overlay.style.webkitTextStroke=Math.min(miniature?0.65:1.5,Number(prefs.outlineSize)||0)+'px '+rgba(prefs.outlineColor,prefs.outlineAlpha);
    overlay.style.textShadow=[
      '0 0 '+(Number(prefs.glowSize)||0)+'px '+rgba(prefs.glowColor,prefs.glowAlpha),
      '0 '+(Number(prefs.shadowSize)||0)+'px '+(Number(prefs.shadowSize)||0)+'px '+rgba(prefs.shadowColor,prefs.shadowAlpha)
    ].join(',');
    overlay.style.background='transparent';
    overlay.style.padding=miniature?'2px 4px':'3px 6px';
    overlay.style.width='max-content';
    overlay.style.textAlign=prefs.alignment;
    overlay.setAttribute('dir','auto');
    overlay.setAttribute('lang',isArabic?'ar':'');
    const parts=prefs.position.split('-');
    const y=parts[0],x=parts[1];
    // Anchor each grid cell to the actual picture, excluding letterbox bars.
    const stageWidth=Math.max(1,el.stage.clientWidth);
    const stageHeight=Math.max(1,el.stage.clientHeight);
    const videoWidth=media.videoWidth||stageWidth;
    const videoHeight=media.videoHeight||stageHeight;
    const scale=Math.min(stageWidth/videoWidth,stageHeight/videoHeight);
    const pictureWidth=Math.min(stageWidth,videoWidth*scale);
    const pictureHeight=Math.min(stageHeight,videoHeight*scale);
    const edgeX=(stageWidth-pictureWidth)/2;
    const edgeY=(stageHeight-pictureHeight)/2;
    const padX=clamp(Math.round(pictureWidth*.04),7,24);
    const padY=clamp(Math.round(pictureHeight*.08),7,40);
    overlay.style.maxWidth=Math.max(24,Math.round(pictureWidth-2*padX))+'px';
    overlay.style.left=x==='left'?Math.round(edgeX+padX)+'px':
      x==='center'?'50%':'auto';
    overlay.style.right=x==='right'?Math.round(edgeX+padX)+'px':'auto';
    overlay.style.top=y==='top'?Math.round(edgeY+padY)+'px':
      y==='middle'?'50%':'auto';
    overlay.style.bottom=y==='bottom'?Math.round(edgeY+padY)+'px':'auto';
    overlay.style.transform='translate('+(x==='center'?'-50%':'0')+','+
      (y==='middle'?'-50%':'0')+')';
    if(miniature){
      overlay.style.left='50%';overlay.style.right='auto';
      overlay.style.top='auto';overlay.style.bottom='11%';
      overlay.style.transform='translateX(-50%)';overlay.style.textAlign='center';
      overlay.style.maxWidth='92%';
    }
    subStyle.querySelectorAll('[data-sub-position]').forEach(button=>
      button.setAttribute('aria-pressed',String(button.dataset.subPosition===prefs.position)));
    for(const output of subStyle.querySelectorAll('[data-sub-value]')){
      const key=output.dataset.subValue;
      const number=key.endsWith('Alpha')?100-Number(prefs[key]):Number(prefs[key]);
      output.textContent=Math.round(number)+(key.endsWith('Alpha')?'%':'px');
    }
    // The timing text field is managed independently to preserve cursor position
    // while a user enters a signed decimal value.
  }
  function saveStyle(){
    try{localStorage.setItem('marmalade-subtitle-style-v1',JSON.stringify(prefs));}catch{}
  }
  for(const field of fields)field.addEventListener('input',()=>{
    const key=field.dataset.subKey;
    prefs[key]=field.type==='range'?(key.endsWith('Alpha')?100-Number(field.value):Number(field.value)):field.value;
    applySubtitleStyle();saveStyle();
    window.MarmaladeSubtitleRefresh?.();
  });
  subStyle.querySelectorAll('[data-sub-position]').forEach(button=>button.addEventListener('click',()=>{
    prefs.position=button.dataset.subPosition;applySubtitleStyle();saveStyle();
    window.MarmaladeSubtitleRefresh?.();
  }));
  // A subtitle offset belongs to a specific subtitle AND video, never globally.
  // Only offsets (not subtitle text or movie bytes) are kept in localStorage.
  const timingStoreKey='marmalade:subtitle-offsets:v2';
  let timingOffsets={};
  try{
    const records=JSON.parse(localStorage.getItem(timingStoreKey)||'{}');
    if(records&&typeof records==='object'&&!Array.isArray(records))timingOffsets=records;
  }catch{}
  let timingMedia='',timingSubtitle='';
  const timingText=subStyle.querySelector('#subtitleTiming');
  const tenths=value=>clamp(Math.round(Number(value)*10)/10,-3600,3600);
  function formatTiming(){
    if(document.activeElement!==timingText)
      timingText.value=Number(prefs.timing).toFixed(1);
  }
  function writeTimingOffset(){
    if(!timingMedia||!timingSubtitle)return;
    timingOffsets[timingMedia+'\u0000'+timingSubtitle]={
      seconds:Number(prefs.timing),updated:Date.now()
    };
    const latest=Object.entries(timingOffsets)
      .filter(([,entry])=>Number.isFinite(entry?.seconds))
      .sort((a,b)=>(b[1].updated||0)-(a[1].updated||0)).slice(0,500);
    timingOffsets=Object.fromEntries(latest);
    try{localStorage.setItem(timingStoreKey,JSON.stringify(timingOffsets));}catch{}
  }
  function setTiming(seconds){
    if(!Number.isFinite(Number(seconds)))return false;
    prefs.timing=tenths(seconds);
    state.subtitleOffsetSeconds=prefs.timing;
    writeTimingOffset();saveStyle();formatTiming();
    window.MarmaladeSubtitleRefresh?.();
    return true;
  }
  function commitTiming(){
    const raw=timingText.value.trim().replace(/s$/i,'').trim().replace(',','.');
    if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)||!setTiming(Number(raw))){
      timingText.value=Number(prefs.timing).toFixed(1);
      return;
    }
    timingText.value=Number(prefs.timing).toFixed(1);
  }
  timingText.addEventListener('change',commitTiming);
  timingText.addEventListener('blur',commitTiming);
  timingText.addEventListener('keydown',event=>{
    if(event.key==='Enter'){event.preventDefault();commitTiming();timingText.blur();}
    if(event.key==='ArrowUp'||event.key==='ArrowDown'){
      event.preventDefault();setTiming(Number(prefs.timing)+(event.key==='ArrowUp'?.1:-.1));
      timingText.value=Number(prefs.timing).toFixed(1);
    }
  });
  function timingButton(id,direction){
    const button=subStyle.querySelector(id);
    let timer=null,interval=null,held=false;
    const clear=()=>{clearTimeout(timer);clearInterval(interval);timer=null;interval=null;};
    const change=step=>{
      setTiming(Number(prefs.timing)+direction*step);
      timingText.value=Number(prefs.timing).toFixed(1);
    };
    button.addEventListener('pointerdown',event=>{
      if(event.button!==0)return;
      clear();held=false;
      try{button.setPointerCapture(event.pointerId);}catch{}
      timer=setTimeout(()=>{
        held=true;change(1);
        interval=setInterval(()=>change(1),250);
      },250);
    });
    button.addEventListener('pointerup',clear);
    button.addEventListener('pointercancel',()=>{clear();held=false;});
    button.addEventListener('lostpointercapture',clear);
    button.addEventListener('pointerleave',event=>{
      if(event.pointerType==='mouse'&&!event.buttons)clear();
    });
    button.addEventListener('click',()=>{
      if(held){held=false;return;}
      change(.1);
    });
    button.addEventListener('blur',clear);
    window.addEventListener('pagehide',clear);
  }
  timingButton('#subtitleTimingMinus',-1);
  timingButton('#subtitleTimingPlus',1);
  window.MarmaladeSubtitleTiming={
    activate(mediaKey,subtitleId){
      timingMedia=String(mediaKey||'');
      timingSubtitle=String(subtitleId||'');
      const entry=timingOffsets[timingMedia+'\u0000'+timingSubtitle];
      const previous=entry&&Number.isFinite(Number(entry.seconds))?entry.seconds:0;
      prefs.timing=tenths(previous);
      state.subtitleOffsetSeconds=prefs.timing;
      timingText.value=prefs.timing.toFixed(1);
      window.MarmaladeSubtitleRefresh?.();
    },
    get:()=>Number(prefs.timing)
  };
  prefs.timing=0;
  timingText.value='0.0';
  window.MarmaladeSubtitleReposition=applySubtitleStyle;
  addEventListener('resize',applySubtitleStyle,{passive:true});
  addEventListener('orientationchange',applySubtitleStyle,{passive:true});
  document.addEventListener('fullscreenchange',applySubtitleStyle);
  for(const event of ['loadedmetadata','resize'])
    media.addEventListener(event,applySubtitleStyle);
  state.subtitleOffsetSeconds=Number(prefs.timing);
  // Read existing local cues only. Never transmit subtitle bytes or settings.
  window.MarmaladeSubtitleClock=(time)=>{
    const base=state.role==='host'&&state.hostSyncActive?
      (Number.isFinite(preview.currentTime)?preview.currentTime:time):time;
    // Only live WebRTC requires presentation-delay correction. Local files
    // and buffered streams use the actual decoded media.currentTime already.
    const fresh=performance.now()-(state.lastFrameLatencyReportAt||0)<5000;
    const remoteCorrection=state.role==='guest'&&state.source==='remote'&&fresh?
      clamp((state.guestPresentationMs||0)/1000,0,8):0;
    return Math.max(0,base-remoteCorrection+Number(prefs.timing||0));
  };
  applySubtitleStyle();
})();

