/* Marmalade personal subtitles + host-only synchronized monitor.
   Existing media capture, WebRTC quality and transport are never modified. */
(() => {
  'use strict';
  const bridge=window.MarmaladeAddonBridge;
  if(!bridge)return;
  const {state,media,el,ensureAudioPlayback}=bridge;
  const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
  const style=document.createElement('style');
  style.textContent=[
    '.host-sync-preview{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#050506;z-index:2;pointer-events:none;display:none}',
    '#dropZone.host-sync-active .host-sync-preview{display:block}',
    '.subtitle-popover{width:min(355px,calc(100% - 24px));max-height:min(75%,560px)}',
    '.subtitle-style{border-top:1px solid #ffffff24;padding-top:10px;display:flex;flex-direction:column;gap:9px}',
    '.subtitle-style h3{font-size:11px;color:#ffd4a2;margin:1px 0 4px}',
    '.subtitle-style .subtitle-style-row{display:grid;grid-template-columns:1fr auto auto;gap:7px;align-items:center}',
    '.subtitle-style-row span{font-size:10px;color:#d5ccd0}',
    '.subtitle-style-row input[type=color]{width:35px;height:28px;padding:2px;border:1px solid #655656;border-radius:5px;background:transparent}',
    '.subtitle-style-row input[type=range]{width:89px;accent-color:#ffaf63}',
    '.subtitle-style-row select{max-width:175px}',
    '.subtitle-position-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:5px;width:135px;align-self:center}',
    '.subtitle-position-grid button{min-width:36px;min-height:30px;padding:4px;background:#302831;color:#e7d4c4}',
    '.subtitle-position-grid button[aria-pressed=true]{border-color:#ffb874;background:#624331;color:white}',
    '.subtitle-settings-note{font-size:9px;color:#a9a0a9}',
    '.host-sync-settings{display:flex;flex-direction:column;gap:5px;padding:9px 0;border-top:1px solid #ffffff24}',
    '.host-sync-settings[hidden]{display:none!important}',
    '.host-sync-settings label{font-size:11px}',
    '.host-sync-settings small{color:#aaa0a5;line-height:1.4}',
    '.host-sync-settings input[type=range]{accent-color:#ffad60}',
    '#subtitleOverlay{max-width:92%;box-sizing:border-box;pointer-events:none;overflow-wrap:anywhere}',
    '@media(max-width:450px){.subtitle-popover{max-height:67%}.subtitle-style-row input[type=range]{width:76px}}'
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
  let syncMode='auto';
  const syncSettings=document.createElement('section');
  syncSettings.className='host-sync-settings';
  syncSettings.id='hostSyncSettings';
  syncSettings.innerHTML=
    '<strong>Host / guest A/V alignment</strong>'+
    '<label for="hostSyncMode">Alignment <select id="hostSyncMode"><option value="auto">Auto (guest timing)</option><option value="manual">Manual</option><option value="off">Off</option></select></label>'+
    '<label for="hostSyncSeconds">Manual host delay <output id="hostSyncSecondsValue">2.00s</output></label>'+
    '<input type="range" id="hostSyncSeconds" min="0" max="8" value="2" step="0.05">'+
    '<small id="hostSyncInfo" role="status">Waiting for guest video timing. Auto mode leaves the original player unchanged until accurate timing is available.</small>';
  el.settingsPanel.insertBefore(syncSettings,el.settingsPanel.querySelector('.settings-tools'));
  const modeInput=syncSettings.querySelector('#hostSyncMode');
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
    syncSettings.hidden=state.role!=='host';
    if(state.role!=='host'||state.source!=='file'||!state.broadcasting||
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
  modeInput.addEventListener('change',()=>{syncMode=modeInput.value;stopMonitor();updateMonitor();});
  delayInput.addEventListener('input',()=>{
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
    return '<div class="subtitle-style-row"><span>'+label+'</span>'+
      '<input type="color" data-sub-key="'+key+'Color" aria-label="'+label+' color">'+
      '<input type="range" data-sub-key="'+key+'Size" aria-label="'+label+' size" min="0" max="'+
      (key==='text'?'64':key==='outline'?'8':key==='glow'?'36':'30')+'" step="1"></div>'+
      '<label class="subtitle-style-row" for="sub-'+key+'-alpha"><span>'+label+' transparency</span>'+
      '<input id="sub-'+key+'-alpha" type="range" data-sub-key="'+key+'Alpha" min="0" max="100" step="1" aria-label="'+label+' opacity"></label>';
  }
  const subStyle=document.createElement('section');
  subStyle.className='subtitle-style';
  subStyle.setAttribute('aria-label','My subtitle appearance');
  subStyle.innerHTML=
    '<h3>Subtitle appearance · Only for me</h3>'+
    '<label for="subtitleFont">Font <select id="subtitleFont" data-sub-key="font">'+
    '<option value="Arial, Helvetica, sans-serif">Arial</option>'+
    '<option value="Verdana, Geneva, sans-serif">Verdana</option>'+
    '<option value="Tahoma, Geneva, sans-serif">Tahoma</option>'+
    '<option value="Georgia, serif">Georgia</option>'+
    '<option value="Times New Roman, serif">Times New Roman</option>'+
    '<option value="Trebuchet MS, sans-serif">Trebuchet MS</option>'+
    '<option value="Courier New, monospace">Courier New</option>'+
    '<option value="system-ui, sans-serif">System</option></select></label>'+
    colorRow('Subtitle','text')+colorRow('Outline','outline')+
    colorRow('Glow','glow')+colorRow('Shadow','shadow')+
    '<h3>Position</h3>'+
    '<div class="subtitle-position-grid" id="subtitlePositionGrid" role="group" aria-label="Subtitle position, three by three grid">'+
    ['top-left','top-center','top-right','middle-left','middle-center','middle-right','bottom-left','bottom-center','bottom-right']
      .map((p,i)=>'<button type="button" data-sub-position="'+p+'" aria-label="'+p.replace('-',' ')+'" aria-pressed="false">'+
        (i===7?'●':'·')+'</button>').join('')+'</div>'+
    '<label for="subtitleAlign">Alignment <select id="subtitleAlign" data-sub-key="alignment">'+
    '<option value="left">Left</option><option value="center">Center</option>'+
    '<option value="right">Right</option><option value="justify">Justified</option></select></label>'+
    '<label for="subtitleTiming">Subtitle timing <output id="subtitleTimingValue">0.00s</output></label>'+
    '<input id="subtitleTiming" type="range" data-sub-key="timing" min="-6" max="6" step="0.05">'+
    '<small class="subtitle-settings-note">Each viewer loads and styles their own .srt/.vtt subtitles. Appearance and timing stay on this device.</small>';
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
    overlay.style.fontFamily=prefs.font;
    overlay.style.fontSize=prefs.textSize+'px';
    overlay.style.color=rgba(prefs.textColor,prefs.textAlpha);
    overlay.style.webkitTextStroke=prefs.outlineSize+'px '+rgba(prefs.outlineColor,prefs.outlineAlpha);
    overlay.style.textShadow='0 0 '+prefs.glowSize+'px '+rgba(prefs.glowColor,prefs.glowAlpha)+
      ', 2px 3px '+prefs.shadowSize+'px '+rgba(prefs.shadowColor,prefs.shadowAlpha);
    overlay.style.background='transparent';
    overlay.style.padding='4px 7px';
    overlay.style.width='max-content';
    overlay.style.maxWidth='90%';
    overlay.style.textAlign=prefs.alignment;
    const parts=prefs.position.split('-');
    const y=parts[0],x=parts[1];
    overlay.style.left=x==='left'?'4%':x==='center'?'50%':'auto';
    overlay.style.right=x==='right'?'4%':'auto';
    overlay.style.top=y==='top'?'8%':y==='middle'?'50%':'auto';
    overlay.style.bottom=y==='bottom'?'98px':'auto';
    overlay.style.transform='translate('+(x==='center'?'-50%':'0')+','+(y==='middle'?'-50%':'0')+')';
    subStyle.querySelectorAll('[data-sub-position]').forEach(button=>
      button.setAttribute('aria-pressed',String(button.dataset.subPosition===prefs.position)));
    subStyle.querySelector('#subtitleTimingValue').textContent=(Number(prefs.timing)>0?'+':'')+
      Number(prefs.timing).toFixed(2)+'s';
  }
  function saveStyle(){
    try{localStorage.setItem('marmalade-subtitle-style-v1',JSON.stringify(prefs));}catch{}
  }
  for(const field of fields)field.addEventListener('input',()=>{
    const key=field.dataset.subKey;
    prefs[key]=field.type==='range'?(key.endsWith('Alpha')?100-Number(field.value):Number(field.value)):field.value;
    applySubtitleStyle();saveStyle();
  });
  subStyle.querySelectorAll('[data-sub-position]').forEach(button=>button.addEventListener('click',()=>{
    prefs.position=button.dataset.subPosition;applySubtitleStyle();saveStyle();
  }));
  state.subtitleOffsetSeconds=Number(prefs.timing);
  // Read existing local cues only. Never transmit subtitle bytes or settings.
  window.MarmaladeSubtitleClock=(time)=>{
    const base=state.role==='host'&&state.hostSyncActive?
      preview.currentTime:time;
    const remoteCorrection=state.role==='guest'&&state.source==='remote'?
      clamp((state.guestPresentationMs||0)/1000,0,8):0;
    return Math.max(0,base-remoteCorrection+Number(prefs.timing||0));
  };
  applySubtitleStyle();
})();
