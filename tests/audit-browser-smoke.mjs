import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const routeSource=html.slice(html.indexOf('  const personalAudioRoutes=new WeakMap();'),html.indexOf('  function quantizeVolume('));
import {chromium,firefox,webkit} from 'playwright';
// Test the production policy rather than a copy.
const playoutSource=html.slice(html.indexOf('  function nextLowPlayoutTarget('),html.indexOf('  function applyReceiverPlayout()'));
const {nextLowPlayoutTarget:nextTarget,setReceiverPlayout:setTarget}=new Function(playoutSource+';return {nextLowPlayoutTarget,setReceiverPlayout};')();
assert.equal(nextTarget(140,'fast',{freezes:1,fps:12,loss:0,packetJitterMs:1}),140);
assert.equal(nextTarget(140,'fast',{loss:.04}),240);
assert.equal(nextTarget(240,'fast',{packetJitterMs:150}),330);
assert.equal(nextTarget(330,'fast',{loss:.05}),330);
assert.equal(nextTarget(330,'fast',{}),305);
assert.equal(nextTarget(140,'smooth',{}),700);
assert.equal(nextTarget(140,'balanced',{}),280);
let modernWrites=0,legacyWrites=0;
const receiver={set jitterBufferTarget(v){modernWrites++;assert.equal(v,140);},set playoutDelayHint(v){legacyWrites++;}};
setTarget(receiver,140);setTarget(receiver,140);
assert.equal(modernWrites,1);assert.equal(legacyWrites,0);
const legacy={set jitterBufferTarget(v){throw Error('Unsupported');},set playoutDelayHint(v){legacyWrites++;assert.equal(v,.14);}};
setTarget(legacy,140);setTarget(legacy,140);assert.equal(legacyWrites,1);
const engine=process.argv[2]||'chromium',launcher={chromium,firefox,webkit}[engine];
assert.ok(launcher,'Unknown browser');
const browser=await launcher.launch({headless:true});
try{
 for(const viewport of [{width:1366,height:768},{width:390,height:844}]){
  const context=await browser.newContext({viewport});
  const page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8080/index.html',{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>window.MarmaladeAddonBridge&&window.MarmaladeRollingBuffer&&document.querySelector('#allowOriginalBuffer').closest('.settings-row'),{},{timeout:30000});
  assert.equal(await page.locator('#player').count(),1);
  // Verify real file import, explicit apply, reload persistence and scoped reset.
  await page.evaluate(()=>{localStorage.setItem('marmalade:last-joined-room-code','PRIVATE-ROOM');localStorage.setItem('marmalade:window-theme','glass');});
  await page.locator('#settingsBtn').click({force:true});
  await page.locator('#settingsTabVideo').click();
  await page.locator('#preferredSubtitleLanguage').selectOption('ar');
  assert.equal(await page.locator('#subSearchLanguage').inputValue(),'ar');
  await page.locator('#settingsTabControls').click();
  await page.locator('#miniPlayerFadeDelay').selectOption('8');
  await page.locator('#settingsTabParty').click();
  await page.locator('#settingsAdvanced > summary').click();
  await page.locator('#diagnosticsToggle').click();
  assert.equal(await page.locator('#diagnosticsToggle').getAttribute('aria-expanded'),'true');
  await page.locator('#rememberLastRoom').uncheck();
  assert.equal(await page.evaluate(()=>localStorage.getItem('marmalade:last-joined-room-code')),null);
  await page.locator('#rememberLastRoom').check();
  await page.evaluate(()=>localStorage.setItem('marmalade:last-joined-room-code','PRIVATE-ROOM'));
  await page.locator('#automaticUpdateChecks').uncheck();
  await page.waitForFunction(()=>document.querySelector('#updatesSection').textContent.includes('Automatic checks off.'));
  await page.locator('#settingsBackup > summary').click();
  await page.evaluate(()=>{localStorage.setItem('marmalade:volume-maximum','400');localStorage.setItem('marmalade:skip-interval-seconds','30');localStorage.setItem('marmalade-subtitle-style-v1',JSON.stringify({textSize:32,textColor:'#ffcc00',timing:17.5}));});
  const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#settingsExport').click()]);
  assert.equal(download.suggestedFilename(),'Marmaladeum-Settings.json');
  const exported=JSON.parse(readFileSync(await download.path(),'utf8'));
  assert.equal(exported.format,'marmaladeum-settings');
  assert.equal(exported.version,1);
  assert.equal(exported.mode,'snapshot');
  assert.deepEqual(JSON.parse(exported.preferences['marmalade-subtitle-style-v1']),{textSize:32,textColor:'#ffcc00'});
  assert.equal(exported.preferences['marmalade:window-theme'],'glass');
  assert.equal(exported.preferences['marmalade:preferred-subtitle-language'],'ar');
  assert.equal(exported.preferences['marmalade:mini-player-fade'],'8');
  assert.equal(exported.preferences['marmalade:playback-diagnostics'],'true');
  assert.equal(exported.preferences['marmalade:remember-last-room'],'true');
  assert.equal(exported.preferences['marmalade:auto-update-checks'],'false');
  assert.equal(exported.preferences['marmalade:volume-maximum'],'400');
  assert.equal(exported.preferences['marmalade:skip-interval-seconds'],'30');
  assert(!Object.hasOwn(exported.preferences,'marmalade:last-joined-room-code'));
  assert(!JSON.stringify(exported).includes('PRIVATE-ROOM'));
  const upload=data=>page.locator('#settingsImportFile').setInputFiles({name:'settings.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
  const envelope=preferences=>({format:'marmaladeum-settings',version:1,preferences});
  await upload(envelope({'marmalade:last-joined-room-code':'OTHER'}));
  await page.waitForFunction(()=>document.querySelector('#settingsBackupStatus').textContent.includes('Unknown or invalid'));
  assert.equal(await page.locator('#settingsApplyBackup').isVisible(),false);
  assert.equal(await page.evaluate(()=>localStorage.getItem('marmalade:last-joined-room-code')),'PRIVATE-ROOM');
  await upload(envelope({'marmalade:skip-interval-seconds':'20','marmalade:volume-maximum':'999999'}));
  await page.waitForFunction(()=>document.querySelector('#settingsBackupStatus').textContent.includes('Unknown or invalid'));
  assert.equal(await page.evaluate(()=>localStorage.getItem('marmalade:skip-interval-seconds')),'30','Invalid import must be atomic');
  await upload(envelope({'marmalade-subtitle-style-v1':JSON.stringify({textColor:'red',textSize:200})}));
  await page.waitForFunction(()=>document.querySelector('#settingsBackupStatus').textContent.includes('Unknown or invalid'));
  assert.equal(await page.locator('#settingsApplyBackup').isVisible(),false);
  await upload(envelope({'marmalade:skip-interval-seconds':'20'}));
  await page.waitForFunction(()=>!document.querySelector('#settingsApplyBackup').hidden);
  await Promise.all([page.waitForEvent('load'),page.locator('#settingsApplyBackup').click()]);
  await page.waitForFunction(()=>window.MarmaladeSettingsLayout);
  assert.equal(await page.locator('#skipInterval').inputValue(),'20');
  assert.equal(await page.locator('#automaticUpdateChecks').isChecked(),false);
  assert.equal(await page.locator('#rememberLastRoom').isChecked(),true);
  assert.equal(await page.locator('#miniPlayerFadeDelay').inputValue(),'8');
  assert.equal(await page.locator('#diagnosticsToggle').getAttribute('aria-expanded'),'true');
  assert.equal(await page.locator('#preferredSubtitleLanguage').inputValue(),'ar');
  assert.equal(await page.locator('#subSearchLanguage').inputValue(),'ar');
  assert.equal(await page.evaluate(()=>localStorage.getItem('marmalade:window-theme')),'glass');
  await page.locator('#settingsBtn').click({force:true});
  await page.locator('#settingsBackup > summary').click();
  await page.locator('#settingsResetCategory').selectOption('controls');
  await page.locator('#settingsReset').click();
  await Promise.all([page.waitForEvent('load'),page.locator('#settingsApplyBackup').click()]);
  await page.waitForFunction(()=>window.MarmaladeSettingsLayout);
  assert.equal(await page.locator('#skipInterval').inputValue(),'10');
  assert.equal(await page.locator('#miniPlayerFadeDelay').inputValue(),'8');
  assert.equal(await page.locator('#diagnosticsToggle').getAttribute('aria-expanded'),'true');
  assert.equal(await page.locator('#volumeMaximum').inputValue(),'400','Controls reset must preserve independent audio settings');
  assert.equal(await page.locator('#preferredSubtitleLanguage').inputValue(),'ar','Controls reset must preserve subtitle settings');
  assert.equal(await page.evaluate(()=>localStorage.getItem('marmalade:window-theme')),'glass');
  assert.equal(await page.evaluate(()=>localStorage.getItem('marmalade:last-joined-room-code')),'PRIVATE-ROOM');
  // A snapshot restores explicit preferences and removes newer preferences
  // absent from the backup, without resetting history or room credentials.
  await page.evaluate(()=>{
    localStorage.setItem('marmalade:audio-night-mode','true');
    localStorage.setItem('marmalade:subtitle-offsets:v2','{}');
  });
  await page.locator('#settingsBtn').click({force:true});
  await page.locator('#settingsBackup > summary').click();
  await upload(exported);
  await page.waitForFunction(()=>document.querySelector('#settingsBackupStatus').textContent.includes('Validated full restore'));
  await Promise.all([page.waitForEvent('load'),page.locator('#settingsApplyBackup').click()]);
  await page.waitForFunction(()=>window.MarmaladeSettingsLayout);
  assert.equal(await page.locator('#skipInterval').inputValue(),'30');
  assert.equal(await page.evaluate(()=>localStorage.getItem('marmalade:audio-night-mode')),null);
  assert.equal(await page.locator('[data-sub-key="textSize"]').inputValue(),'32');
  assert.equal(await page.locator('[data-sub-key="textColor"]').inputValue(),'#ffcc00');
  assert.equal(await page.evaluate(()=>localStorage.getItem('marmalade:subtitle-offsets:v2')),'{}');
  assert.equal(await page.evaluate(()=>localStorage.getItem('marmalade:last-joined-room-code')),'PRIVATE-ROOM');
  await page.locator('#settingsBtn').click({force:true});
  await page.locator('#settingsBackup > summary').click();
  await page.locator('#settingsResetCategory').selectOption('subtitles');
  await page.locator('#settingsReset').click();
  await Promise.all([page.waitForEvent('load'),page.locator('#settingsApplyBackup').click()]);
  await page.waitForFunction(()=>window.MarmaladeSettingsLayout);
  assert.equal(await page.locator('[data-sub-key="textSize"]').inputValue(),'24');
  assert.equal(await page.locator('[data-sub-key="textColor"]').inputValue(),'#ffffff');
  assert.equal(await page.evaluate(()=>localStorage.getItem('marmalade:subtitle-offsets:v2')),'{}');
  assert.equal(await page.locator('#volumeMaximum').inputValue(),'400');
  await page.evaluate(()=>{localStorage.removeItem('marmalade:skip-interval-seconds');localStorage.removeItem('marmalade:last-joined-room-code');localStorage.removeItem('marmalade:window-theme');localStorage.removeItem('marmalade:volume-maximum');localStorage.removeItem('marmalade:preferred-subtitle-language');localStorage.removeItem('marmalade:mini-player-fade');localStorage.removeItem('marmalade:playback-diagnostics');localStorage.removeItem('marmalade:auto-update-checks');localStorage.removeItem('marmalade:remember-last-room');});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.MarmaladeSettingsLayout&&window.MarmaladeRollingBuffer);
  await page.locator('#settingsBtn').click({force:true});
  await page.locator('#settingsSearch').fill('maximum volume');
  await page.locator('#settingsSearchResults button').filter({hasText:'Maximum Volume'}).click();
  assert.equal(await page.locator('#settingsTabControls').getAttribute('aria-selected'),'true');
  assert.equal(await page.locator('#settingsSearch').inputValue(),'');
  await page.locator('#settingsSearch').fill('original-file buffering');
  // Verify the result is not collapsed or occluded after opening Controls.
  const originalResult=page.locator('#settingsSearchResults button').filter({hasText:'Original-File Buffering'});
  await originalResult.click({trial:true});
  const hit=await originalResult.evaluate(button=>{
    const rect=button.getBoundingClientRect();
    return {height:rect.height,reachable:button.contains(document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2))};
  });
  assert.ok(hit.height>=29&&hit.reachable,JSON.stringify(hit));
  await originalResult.click();
  assert.equal(await page.locator('#settingsTabParty').getAttribute('aria-selected'),'true');
  assert.equal(await page.locator('#settingsSearchResults').isVisible(),false);
  assert.equal(await page.locator('#settingsPanel').evaluate(panel=>panel.classList.contains('player-docked')),viewport.height>viewport.width);
  await page.locator('#settingsAdvanced > summary').click();
  await page.locator('#diagnosticsToggle').click();
  await page.waitForFunction(()=>document.querySelectorAll('#diagnosticGrid output').length===16);
  assert.equal(await page.locator('[data-metric=fps]').textContent(),'—');
  assert.equal(await page.locator('[data-metric=decoded]').textContent(),'—');
  assert.equal(await page.locator('[data-metric=mode]').textContent(),'No Movie');
  assert.equal(await page.locator('[data-metric=decoder]').textContent(),'Not Reported');
  assert.equal(await page.locator('[data-metric=audio]').textContent(),'—');
  assert.equal(await page.locator('[data-metric=encoder]').textContent(),'—');
  const diagnosisSource=html.slice(html.indexOf('  function classifyPlayback('),html.indexOf('  function diagnosticsVisible('));
  const classify=new Function(diagnosisSource+';return classifyPlayback;')();
  assert.match(classify({loss:.04,fps:12},null,12),/bandwidth constrained/);
  assert.match(classify({loss:0,fps:16},{limit:'cpu',fps:16},16),/Host encoder constrained/);
  assert.match(classify({loss:0,fps:16},null,16),/cause unconfirmed/);
  assert.match(classify({loss:0,fps:24},null,12),/Guest rendering/);
  assert.match(classify({fps:0,loss:0},null,null),/Video interruption/);
  assert.match(classify({fps:24,freezes:1},null,24),/Video interruption/);
  assert.equal(classify(null,null,null),'');
  assert.match(await page.locator('#diagnosticAssessment').textContent(),/Load a movie/);
  await page.locator('#diagnosticsToggle').click();
  assert.equal(await page.locator('#stabilityInfo').isVisible(),false);
  await page.locator('#closeSettingsPanel').click();
  const settings=await page.evaluate(()=>{
   const maximum=document.querySelector('#volumeMaximum'),step=document.querySelector('#volumeIncrement'),snap=document.querySelector('#volumeSnap'),buffer=document.querySelector('#allowOriginalBuffer');
   maximum.value='400';maximum.dispatchEvent(new Event('change',{bubbles:true}));
   step.value='5';step.dispatchEvent(new Event('change',{bubbles:true}));
   snap.checked=false;snap.dispatchEvent(new Event('change',{bubbles:true}));
   buffer.checked=false;buffer.dispatchEvent(new Event('change',{bubbles:true}));
   const night=document.querySelector('#audioNightMode');night.checked=true;night.dispatchEvent(new Event('change',{bubbles:true}));
   const dialogue=document.querySelector('#audioDialogue');dialogue.value='strong';dialogue.dispatchEvent(new Event('change',{bubbles:true}));
   const norm=document.querySelector('#audioNormalize');norm.checked=true;norm.dispatchEvent(new Event('change',{bubbles:true}));
   const eq=document.querySelector('#audioEqPreset');eq.value='cinema';eq.dispatchEvent(new Event('change',{bubbles:true}));
   return {max:document.querySelector('#volume').max,step:document.querySelector('#volume').step,allow:window.MarmaladeAddonBridge.state.allowOriginalBuffer};
  });
  assert.deepEqual(settings,{max:'400',step:'5',allow:false});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.MarmaladeAddonBridge&&document.querySelector('#allowOriginalBuffer').closest('.settings-row'));
  assert.equal(await page.locator('#volumeMaximum').inputValue(),'400');
  assert.equal(await page.locator('#volumeIncrement').inputValue(),'5');
  assert.equal(await page.locator('#volumeSnap').isChecked(),false);
  assert.equal(await page.locator('#allowOriginalBuffer').isChecked(),false);
  assert.equal(await page.locator('#settingsPageControls #audioNightMode').count(),1);
  assert.equal(await page.locator('#audioNightMode').isChecked(),true);
  assert.equal(await page.locator('#settingsPageControls #audioDialogue').inputValue(),'strong');
  assert.equal(await page.locator('#settingsPageControls #audioNormalize').isChecked(),true);
  assert.equal(await page.locator('#settingsPageControls #audioEqPreset').inputValue(),'cinema');
  assert.equal(await page.locator('#settingsPageControls #audioOutput').inputValue(),'');
  assert.equal(await page.locator('#settingsPageControls #audioOutput').count(),1);
  await page.evaluate(()=>{const d=document.querySelector('#audioDelay');d.value='150';d.dispatchEvent(new Event('change',{bubbles:true}));});
  assert.equal(await page.evaluate(()=>localStorage.getItem('marmalade:personal-audio-delay')),'150');
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.MarmaladeAddonBridge&&document.querySelector('#audioDelay').closest('.settings-row'));
  assert.equal(await page.locator('#audioDelay').inputValue(),'150');
  await page.evaluate(()=>{const d=document.querySelector('#audioDelay');d.value='0';d.dispatchEvent(new Event('change',{bubbles:true}));});
  // Simulate the optional AudioTrackList interface consistently on every
  // engine. This verifies application logic, not native decoder support.
  const audioTracks=await page.evaluate(async()=>{
   const {state,media}=window.MarmaladeAddonBridge;
   const old={role:state.role,source:state.source,fileReady:state.fileReady,broadcasting:state.broadcasting};
   const descriptor=Object.getOwnPropertyDescriptor(media,'audioTracks');
   const list=new EventTarget(),tracks=[{id:'a',language:'eng',label:'English',enabled:true},{id:'b',language:'ara',label:'Arabic',enabled:false},{id:'c',language:'ara',kind:'commentary',label:'Commentary',enabled:false}];
   tracks.forEach((t,i)=>list[i]=t);list.length=tracks.length;
   const language=document.querySelector('#audioLanguage'),select=document.querySelector('#audioTrack');
   const change=(control,value)=>{control.value=value;control.dispatchEvent(new Event('change',{bubbles:true}));};
   try{
    Object.defineProperty(media,'audioTracks',{configurable:true,value:list});
    Object.assign(state,{role:'host',source:'file',fileReady:true,broadcasting:false});
    change(language,'ar');const preferred=tracks.map(t=>t.enabled);
    change(select,'0');const manual=tracks.map(t=>t.enabled);
    list.dispatchEvent(new Event('change'));await Promise.resolve();
    const retained=tracks.map(t=>t.enabled);
    state.broadcasting=true;change(language,'ar');const blocked=select.disabled&&tracks[0].enabled;
    return {preferred,manual,retained,blocked,saved:localStorage.getItem('marmalade:preferred-audio-language')};
   }finally{
    Object.assign(state,old);
    if(descriptor)Object.defineProperty(media,'audioTracks',descriptor);else delete media.audioTracks;
    change(language,'');
   }
  });
  assert.deepEqual(audioTracks,{preferred:[false,true,false],manual:[true,false,false],retained:[true,false,false],blocked:true,saved:'ar'});
  // Deterministic browser API simulation: verify routing success and rollback
  // without sending sound to a physical device on the CI runner.
  const routing=await page.evaluate(async()=>{
    const media=document.querySelector('#player'),monitor=document.querySelector('#hostMonitor');
    const Context=window.AudioContext||window.webkitAudioContext;
    const original=Object.getOwnPropertyDescriptor(Context.prototype,'setSinkId');
    const originalEnumerate=navigator.mediaDevices?.enumerateDevices;
    const records=[];
    try{
      Object.defineProperty(Context.prototype,'setSinkId',{configurable:true,value:async()=>{}});
      media.setSinkId=async id=>{records.push(['player',id]);};
      monitor.setSinkId=async id=>{records.push(['monitor',id]);if(id==='fail')throw Error('Mock disconnect');};
      if(navigator.mediaDevices)navigator.mediaDevices.enumerateDevices=async()=>[{kind:'audiooutput',deviceId:'speaker',label:'Test Speaker'},{kind:'audiooutput',deviceId:'fail',label:'Unavailable'}];
      const control=document.querySelector('#audioOutput');
      const select=async id=>{
        if(![...control.options].some(o=>o.value===id))control.add(new Option(id,id));
        control.value=id;control.dispatchEvent(new Event('change',{bubbles:true}));
        for(let i=0;i<100&&control.disabled;i++)await new Promise(r=>setTimeout(r,10));
        return control.value;
      };
      const selected=await select('speaker'),afterFailure=await select('fail'),reset=await select('');
      return {selected,afterFailure,reset,records};
    }finally{
      delete media.setSinkId;delete monitor.setSinkId;
      if(original)Object.defineProperty(Context.prototype,'setSinkId',original);else delete Context.prototype.setSinkId;
      if(navigator.mediaDevices&&originalEnumerate)navigator.mediaDevices.enumerateDevices=originalEnumerate;
    }
  });
  assert.equal(routing.selected,'speaker');assert.equal(routing.afterFailure,'speaker');assert.equal(routing.reset,'');
  assert(routing.records.some(([target,id])=>target==='monitor'&&id==='speaker'));
  assert(routing.records.some(([target,id])=>target==='player'&&id===''));
  assert.equal(await page.locator('#audioEq0').inputValue(),'4');
  await page.evaluate(()=>{const s=document.querySelector('#audioEq0');s.value='7';s.dispatchEvent(new Event('input',{bubbles:true}));s.dispatchEvent(new Event('change',{bubbles:true}));});
  assert.equal(await page.locator('#audioEqPreset').inputValue(),'custom');
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('marmalade:audio-eq-bands'))[0]),7);
  await page.evaluate(()=>document.querySelector('#audioEqReset').click());
  assert.equal(await page.locator('#audioEqPreset').inputValue(),'flat');
  assert.equal(await page.locator('#audioEq0').inputValue(),'0');
  await page.evaluate(()=>{const n=document.querySelector('#audioNormalize');n.checked=false;n.dispatchEvent(new Event('change',{bubbles:true}));});
  assert.equal(await page.evaluate(()=>localStorage.getItem('marmalade:audio-normalize')),'false');
  // Render actual Web Audio samples through the production routing function.
  // Test relative speech-band emphasis rather than claiming vocal separation.
  const response=await page.evaluate(async source=>{
    const Offline=window.OfflineAudioContext||window.webkitOfflineAudioContext;
    const settings={checked:false},dialogue={value:'off'};
    const eqBands=[0,0,0,0,0,0,0],freq=[60,150,400,1000,2500,6000,12000];
    const {routePersonalAudio:route,levelingGain,makeBoostCeilingCurve}=new Function('audioProtection','audioNightMode','audioDialogue','audioNormalize','eqBands','EQ_FREQUENCIES',source+';return {routePersonalAudio,levelingGain,makeBoostCeilingCurve};')(settings,{checked:false},dialogue,{checked:false},eqBands,freq);
    async function measure(level,frequency){
      const ctx=new Offline(1,24000,48000),osc=ctx.createOscillator(),gain=ctx.createGain();
      dialogue.value=level;osc.frequency.value=frequency;gain.gain.value=.2;osc.connect(gain);route(gain,ctx);
      osc.start();const buffer=await ctx.startRendering();const samples=buffer.getChannelData(0).subarray(4800);
      return Math.sqrt(samples.reduce((sum,v)=>sum+v*v,0)/samples.length);
    }
    const offBass=await measure('off',120),offSpeech=await measure('off',2300);
    const mildBass=await measure('mild',120),mildSpeech=await measure('mild',2300);
    const strongBass=await measure('strong',120),strongSpeech=await measure('strong',2300);
    eqBands[3]=6;
    const eqCenter=await measure('off',1000),eqRemote=await measure('off',120);
    eqBands[3]=0;
    const eqFlat=await measure('off',1000);
    // Real impulse response: delay must affect only the routed speaker branch.
    const ctx=new Offline(2,24000,48000),input=ctx.createBuffer(1,24000,48000);
    input.getChannelData(0)[0]=.5;
    const pulse=ctx.createBufferSource(),personal=ctx.createGain(),direct=ctx.createGain();
    const merge=ctx.createChannelMerger(2);
    pulse.buffer=input;pulse.connect(personal);pulse.connect(direct);
    // Measure the delayed route separately from the independent direct source.
    route(personal,ctx,undefined,false,100);
    direct.connect(merge,0,1);merge.connect(ctx.destination);
    pulse.start();const rendered=await ctx.startRendering();
    const onset=channel=>rendered.getChannelData(channel).findIndex(v=>Math.abs(v)>.1);
    const delayOnset=onset(0),directOnset=onset(1);
    // Actual rendered samples, not just a settings flag: a 600% personal
    // boost must preserve quiet input while preventing digital hard clipping.
    async function boostResponse(amplitude,boost){
      const c=new Offline(2,4096,48000),buffer=c.createBuffer(1,4096,48000);
      const samples=buffer.getChannelData(0);
      for(let i=0;i<samples.length;i++)samples[i]=amplitude*Math.sin(i*2*Math.PI/48);
      const p=c.createBufferSource(),g=c.createGain(),direct=c.createGain(),m=c.createChannelMerger(2);
      p.buffer=buffer;g.gain.value=6;p.connect(g);p.connect(direct);
      route(g,c,undefined,false,0,boost);direct.connect(m,0,1);m.connect(c.destination);
      p.start();const out=await c.startRendering();
      const peak=channel=>Math.max(...out.getChannelData(channel).map(Math.abs));
      // The personal branch is mono and is upmixed into both output channels;
      // use a separate direct-only context to prove the unprocessed source.
      const solo=new Offline(1,4096,48000),q=solo.createBufferSource(),g2=solo.createGain();
      q.buffer=buffer;g2.gain.value=6;q.connect(g2);route(g2,solo,undefined,false,0,boost);q.start();
      const clean=await solo.startRendering();
      return {personal:Math.max(...clean.getChannelData(0).map(Math.abs)),direct:peak(1)};
    }
    const curve=makeBoostCeilingCurve();
    const boostedQuiet=await boostResponse(.05,true),boostedLoud=await boostResponse(.8,true);
    const tone=amplitude=>Float32Array.from({length:4096},(_,i)=>amplitude*Math.sin(i*2*Math.PI/48));
    return {delayOnset,directOnset,boostedQuiet,boostedLoud,curveMax:Math.max(...curve.map(Math.abs)),off:offSpeech/offBass,mild:mildSpeech/mildBass,strong:strongSpeech/strongBass,speech:strongSpeech/offSpeech,
      equalizer:{center:eqCenter/eqFlat,remote:eqRemote/offBass,relative:eqCenter/eqRemote},
      leveling:{silence:levelingGain(tone(.0001)),quiet:levelingGain(tone(.02)),loud:levelingGain(tone(.8)),normal:levelingGain(tone(.1123)),invalid:levelingGain([NaN])}};
  },routeSource);
  assert(Math.abs(response.delayOnset-4800)<=2,'100 ms personal audio delay measured in actual rendered samples '+JSON.stringify(response));
  assert.equal(response.directOnset,0,'Independent direct audio remains undelayed');
  assert(Math.abs(response.boostedQuiet.personal-.3)<.005,'Quiet 600% boost remains linear');
  assert(response.boostedLoud.personal<1&&response.boostedLoud.personal>.9,'Boosted loud samples have a bounded soft ceiling');
  assert(response.curveMax<1&&response.curveMax>.99,'Ceiling curve never exceeds digital full scale');
  assert(response.off>.95&&response.off<1.05,'Off mode is transparent');
  assert(response.equalizer.center>.9&&response.equalizer.center<1.1,'Equalizer headroom compensates center gain');
  assert(response.equalizer.remote<.65&&response.equalizer.relative>1.6,'Real audio response emphasizes selected band');
  assert(response.mild>response.off*1.4&&response.strong>response.mild*1.4,'Dialogue levels progressively emphasize speech');
  assert(response.speech>.85&&response.speech<1.15,'Headroom keeps speech near original peak gain');
  assert.equal(response.leveling.silence,null,'Do not amplify silence');
  assert.equal(response.leveling.invalid,null);
  assert(response.leveling.quiet>1.9&&response.leveling.quiet<2.01,'Boost is bounded to 6 dB');
  assert(response.leveling.loud>=.25&&response.leveling.loud<.26,'Attenuation is bounded to 12 dB');
  assert(response.leveling.normal>.98&&response.leveling.normal<1.02,'Target-level audio remains unchanged');
  await page.evaluate(()=>{const d=document.querySelector('#audioDialogue');d.value='off';d.dispatchEvent(new Event('change',{bubbles:true}));});
  assert.equal(await page.evaluate(()=>localStorage.getItem('marmalade:audio-dialogue')),'off');
  await page.evaluate(()=>{const n=document.querySelector('#audioNightMode');n.checked=false;n.dispatchEvent(new Event('change',{bubbles:true}));});
  assert.equal(await page.evaluate(()=>localStorage.getItem('marmalade:audio-night-mode')),'false');
  await page.waitForFunction(()=>window.MarmaladeMediaLibrary?.ready);
  const backup={format:'marmaladeum-library-backup',version:1,libraries:[{id:'audit-catalog',name:'Audit Recovery',kind:'mixed',hiddenIds:['audit-folder|Hidden.mp4'],folders:[{id:'audit-folder',name:'Films'}],items:[{folderId:'audit-folder',path:'Example.mp4',title:'Example',size:12345,favorite:true,watched:true,collections:['Test']}]}]};
  const file={name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))};
  await page.locator('#mlCatalogBackupInput').setInputFiles(file);
  await page.waitForFunction(()=>window.MarmaladeMediaLibrary.getLibraries().some(l=>l.id==='audit-catalog'&&l.count===1));
  const persistedBackup=await page.evaluate(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('marmalade:local-library:v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});try{return await new Promise((resolve,reject)=>{const r=db.transaction('libraries','readonly').objectStore('libraries').get('audit-catalog');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}finally{db.close();}});
  assert.equal(persistedBackup.kind,'mixed');assert.deepEqual(persistedBackup.hiddenIds,['audit-folder|Hidden.mp4']);assert.equal(persistedBackup.items[0].favorite,true);
  await page.locator('#mlCatalogBackupInput').setInputFiles(file);
  await page.waitForFunction(()=>document.querySelector('#mlStatus').textContent.includes('No new libraries'));
  assert.equal(await page.evaluate(()=>window.MarmaladeMediaLibrary.getLibraries().filter(l=>l.id==='audit-catalog').length),1);
  backup.libraries[0].id='invalid-audit-catalog';backup.libraries[0].items[0].path='../outside.mp4';
  await page.locator('#mlCatalogBackupInput').setInputFiles({...file,buffer:Buffer.from(JSON.stringify(backup))});
  await page.waitForFunction(()=>document.querySelector('#mlStatus').textContent.includes('Invalid media path'));
  assert.equal(await page.evaluate(()=>window.MarmaladeMediaLibrary.getLibraries().some(l=>l.id==='invalid-audit-catalog')),false);
  await page.evaluate(()=>{
    localStorage.setItem('marmalade:watch-progress:v1',JSON.stringify({'file:example.mp4|12345':{time:60,duration:120,updated:Date.now()}}));
    window.MarmaladeMediaLibrary.show(true);
    window.MarmaladeMediaLibrary.select('audit-catalog');
    const filter=document.querySelector('#mlKindFilter');filter.value='continue';filter.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await page.waitForFunction(()=>document.querySelector('#mlCurrentShelf').textContent==='Continue Watching');
  assert.equal(await page.locator('#mlCards .ml-card-progress').getAttribute('aria-valuenow'),'50');
  assert.equal(await page.locator('#mlCards .ml-card').count(),1);
  await page.evaluate(()=>{
    localStorage.removeItem('marmalade:watch-progress:v1');
    window.dispatchEvent(new Event('marmalade:watch-progress'));
  });
  await page.waitForFunction(()=>document.querySelectorAll('#mlCards .ml-card-progress').length===0);
  await page.evaluate(()=>{const checkbox=document.querySelector('#audioProtection');checkbox.checked=true;checkbox.dispatchEvent(new Event('change',{bubbles:true}));});
  assert.equal(await page.evaluate(()=>localStorage.getItem('marmalade:audio-peak-protection')),'true');
  assert.equal(await page.locator('#settingsPageControls #audioProtection').count(),1);
  await page.waitForFunction(()=>window.MarmaladeSecondarySubtitle&&document.querySelector('#secondarySubtitleFile'));
  await page.evaluate(()=>{
    const {state,el}=window.MarmaladeAddonBridge;
    el.stage.classList.add('has-video');
    state.subtitles=[{start:0,end:4,text:'Primary captions'}];state.subtitlesEnabled=true;
    window.MarmaladeSubtitleTiming.set(0);window.MarmaladeSubtitleRefresh();
  });
  // Real browser file load, BOM-less UTF-16 rather than a UTF-8 string fixture.
  await page.locator('#secondarySubtitleFile').setInputFiles({name:'secondary.srt',mimeType:'text/plain',buffer:Buffer.from('1\n00:00:00,000 --> 00:00:04,000\nمرحبا بالعالم\n','utf16le')});
  await page.waitForFunction(()=>document.querySelector('#subtitleOverlay').textContent.includes('مرحبا بالعالم'));
  assert.equal(await page.locator('#subtitleOverlay').textContent(),'Primary captions\nمرحبا بالعالم');
  await page.evaluate(()=>{
    const {state}=window.MarmaladeAddonBridge;
    state.subtitles=[{start:0,end:4,text:'Primary captions'},{start:0,end:2,text:'Overlapping caption'}];
    window.MarmaladeSubtitleRefresh();
  });
  assert.equal(await page.locator('#subtitleOverlay').textContent(),'Primary captions\nOverlapping caption\nمرحبا بالعالم');
  await page.evaluate(()=>{
    window.MarmaladeAddonBridge.state.subtitles=[{start:0,end:4,text:'Primary captions'}];
    window.MarmaladeSubtitleRefresh();
  });
  assert.equal(await page.locator('#primarySubtitleEncoding').inputValue(),'auto');
  assert.equal(await page.locator('#secondarySubtitleEncoding').inputValue(),'auto');
  await page.locator('#secondarySubtitleEncoding').evaluate(select=>{select.value='windows-1251';});
  const cyrillic=Buffer.concat([Buffer.from('1\n00:00:00,000 --> 00:00:04,000\n'),Buffer.from([0xcf,0xf0,0xe8,0xe2,0xe5,0xf2])]);
  await page.locator('#secondarySubtitleFile').setInputFiles({name:'russian.srt',mimeType:'text/plain',buffer:cyrillic});
  await page.waitForFunction(()=>document.querySelector('#subtitleOverlay').textContent.includes('Привет'));
  assert.equal(await page.locator('#subtitleOverlay').textContent(),'Primary captions\nПривет');
  assert.equal(await page.locator('#primarySubtitleEncoding').inputValue(),'auto');
  await page.locator('#secondarySubtitleEncoding').evaluate(select=>{select.value='auto';});
  await page.locator('#secondarySubtitleFile').setInputFiles({name:'secondary.sbv',mimeType:'text/plain',buffer:Buffer.from('0:00:00.000,0:00:04.000\nمرحبا بالعالم')});
  await page.waitForFunction(()=>document.querySelector('#subtitleOverlay').textContent.includes('مرحبا بالعالم'));
  // Reference-file UI must propose, not silently apply, a correction.
  await page.evaluate(()=>{
    const {state}=window.MarmaladeAddonBridge;
    state.subtitles=Array.from({length:6},(_,i)=>({start:i*20,end:i*20+2,text:'Distinct reference dialogue '+i}));
    window.dispatchEvent(new Event('marmalade:subtitles-loaded'));
  });
  const reference=Array.from({length:6},(_,i)=>{
    const ts=n=>String(Math.floor(n/3600)).padStart(2,'0')+':'+String(Math.floor(n/60)%60).padStart(2,'0')+':'+String(n%60).padStart(2,'0')+',000';
    return (i+1)+'\n'+ts(i*20+2)+' --> '+ts(i*20+4)+'\nDistinct reference dialogue '+i;
  }).join('\n\n');
  await page.locator('#subReferenceFile').setInputFiles({name:'reference.srt',mimeType:'text/plain',buffer:Buffer.from(reference)});
  await page.waitForFunction(()=>!document.querySelector('#subReferenceApply').disabled);
  assert.equal(await page.evaluate(()=>window.MarmaladeSubtitleTiming.get()),0);
  assert.match(await page.locator('#subReferenceStatus').textContent(),/6 of 6/);
  await page.locator('#subReferenceApply').evaluate(button=>button.click());
  assert.equal(await page.evaluate(()=>window.MarmaladeSubtitleTiming.get()),2);
  assert.equal(await page.evaluate(()=>window.MarmaladeAddonBridge.state.secondarySubtitleOffset),0);
  await page.locator('#subReferenceFile').setInputFiles({name:'unrelated.srt',mimeType:'text/plain',buffer:Buffer.from('1\n00:00:01,000 --> 00:00:02,000\nCompletely different dialogue')});
  await page.waitForFunction(()=>document.querySelector('#subReferenceStatus').textContent.includes('Not enough'));
  assert.equal(await page.locator('#subReferenceApply').isDisabled(),true);
  assert.equal(await page.evaluate(()=>window.MarmaladeSubtitleTiming.get()),2);
  await page.evaluate(()=>{
    window.MarmaladeSubtitleTiming.reset();
    window.MarmaladeAddonBridge.state.subtitles=[{start:0,end:4,text:'Café déjà vu'},{start:5,end:8,text:'مَرْحَبًا بِالْعَالَمِ'}];
    window.dispatchEvent(new Event('marmalade:subtitles-loaded'));
  });
  await page.locator('#subTimingCueSearch').evaluate(input=>{input.value='cafe deja';input.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.waitForFunction(()=>document.querySelector('#subTimingCue')?.textContent.includes('Café déjà vu'));
  assert.equal(await page.locator('#subTimingCue .sub-cue-option').count(),1);
  await page.locator('#subTimingCueSearch').evaluate(input=>{input.value='مرحبا بالعالم';input.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.waitForFunction(()=>document.querySelector('#subTimingCue')?.textContent.includes('مَرْحَبًا بِالْعَالَمِ'));
  assert.equal(await page.locator('#subTimingCue .sub-cue-option').count(),1);
  await page.evaluate(()=>{
    window.MarmaladeAddonBridge.state.subtitles=[{start:0,end:4,text:'Primary captions'}];
    window.dispatchEvent(new Event('marmalade:subtitles-loaded'));
    window.MarmaladeSubtitleRefresh();
  });
  const inlineTiming=await page.evaluate(()=>{
    const cue=window.MarmaladeSubtitleCodec.decode('WEBVTT\n\n00:01.000 --> 00:05.000\nHello <00:02.200>world <00:04.100>again','timed.vtt').cues[0];
    const api=window.MarmaladeSubtitleWordAlignment,parts=api.wordParts(cue.text,'en');
    return {text:cue.text,exact:api.exactWordTime(cue,parts,1),estimated:api.estimateWordTime(cue,parts,1),first:api.exactWordTime(cue,parts,0)};
  });
  assert.deepEqual(inlineTiming,{text:'Hello world again',exact:2.2,estimated:2.2,first:null});
  const trackResult=await page.evaluate(async()=>{
    const {state,media}=window.MarmaladeAddonBridge;
    if(typeof VTTCue!=='function')return {unsupported:true};
    const track=media.addTextTrack('captions','Audit embedded captions','en');
    track.mode='hidden';
    track.addCue(new VTTCue(0,4,'<b>Player track dialogue</b>'));
    const selected=window.MarmaladePlayerTextTracks.list().find(t=>t.label==='Audit embedded captions');
    await window.MarmaladePlayerTextTracks.load(selected.index);
    const result={text:state.subtitles[0]?.text,language:state.subtitleLanguage,mode:track.mode,visible:!document.querySelector('#subtitleOverlay').hidden};
    state.subtitles=[{start:0,end:4,text:'Primary captions'}];
    window.MarmaladeSubtitleTiming.reset();
    window.dispatchEvent(new Event('marmalade:subtitles-loaded'));
    window.MarmaladeSubtitleRefresh();
    return result;
  });
  if(!trackResult.unsupported)assert.deepEqual(trackResult,{text:'Player track dialogue',language:'en',mode:'hidden',visible:true});
  // Load a binary PGS .sup through the same file input as text captions.
  const segment=(type,pts,payload)=>{
    const h=Buffer.alloc(13);h.write('PG');h.writeUInt32BE(pts,2);h[10]=type;h.writeUInt16BE(payload.length,11);
    return Buffer.concat([h,Buffer.from(payload)]);
  };
  const pgs=Buffer.concat([
    segment(0x16,0,[0,4,0,2,0,0,1,128,0,0,1,0,1,0,0,0,1,0,0]),
    segment(0x14,0,[0,0,0,16,128,128,0,1,235,128,128,255]),
    segment(0x15,0,[0,1,0,192,0,0,14,0,2,0,2,1,0,1,0,0,0,1,1,0,0]),
    segment(0x80,0,[]),segment(0x16,360000,[0,4,0,2,0,0,2,0,0,0,0]),segment(0x80,360000,[])
  ]);
  await page.locator('#subtitleFile').setInputFiles({name:'audit.sup',mimeType:'application/octet-stream',buffer:pgs});
  await page.waitForFunction(()=>!document.querySelector('#pgsSubtitleOverlay').hidden);
  const bitmap=await page.evaluate(()=>Array.from(document.querySelector('#pgsSubtitleOverlay').getContext('2d').getImageData(1,0,1,1).data));
  assert.deepEqual(bitmap,[255,255,255,255]);
  await page.evaluate(()=>window.MarmaladeSubtitleTiming.set(5));
  assert.equal(await page.locator('#pgsSubtitleOverlay').getAttribute('hidden'),'');
  await page.evaluate(()=>window.MarmaladeSubtitleTiming.reset());
  await page.locator('#subtitleFile').setInputFiles({name:'primary.srt',mimeType:'text/plain',buffer:Buffer.from('1\n00:00:00,000 --> 00:00:04,000\nPrimary captions')});
  await page.waitForFunction(()=>document.querySelector('#subtitleOverlay').textContent.includes('Primary captions'));
  assert.equal(await page.locator('#pgsSubtitleOverlay').getAttribute('hidden'),'');
  const driftCheck=await page.evaluate(()=>{
    const timing=window.MarmaladeSubtitleTiming;
    timing.activate('audit-drift-film','audit-drift-sub');
    const ok=timing.align({cue:10,movie:12},{cue:110,movie:116});
    const mapped=window.MarmaladeSubtitleClock(116);
    const saved=timing.getScale();
    timing.activate('another-film','another-sub');
    const isolated=timing.getScale();
    timing.activate('audit-drift-film','audit-drift-sub');
    const restored=timing.getScale();
    timing.reset();timing.activate('','');
    return {ok,mapped,saved,isolated,restored};
  });
  assert(driftCheck.ok);
  assert(Math.abs(driftCheck.mapped-110)<.1);
  assert(Math.abs(driftCheck.saved-1.04)<1e-9);
  assert.equal(driftCheck.isolated,1);
  assert.equal(driftCheck.restored,driftCheck.saved);
  await page.evaluate(()=>window.MarmaladeSecondarySubtitle.setOffset(5));
  assert.equal(await page.locator('#subtitleOverlay').textContent(),'Primary captions');
  await page.evaluate(()=>{window.MarmaladeSecondarySubtitle.setOffset(0);window.MarmaladeSubtitleTiming.set(5);});
  assert.equal(await page.locator('#subtitleOverlay').textContent(),'مرحبا بالعالم');
  await page.evaluate(()=>{
    window.MarmaladeSecondarySubtitle.clear();window.MarmaladeSubtitleTiming.set(0);
    window.MarmaladeAddonBridge.el.stage.classList.remove('has-video');
  });
  assert.equal(await page.evaluate(()=>window.MarmaladeAddonBridge.state.secondarySubtitles.length),0);
  const savedSubtitle=await page.evaluate(async()=>{
    const {state,el}=window.MarmaladeAddonBridge;
    const api=window.MarmaladeSecondarySubtitle;
    state.role='host';state.source='native';state.nativeMediaKey='audit-secondary-fixture';
    el.stage.classList.add('has-video');state.subtitlesEnabled=true;
    await api.load(new File(['1\n00:00:00,000 --> 00:00:04,000\nSaved secondary\n'],'saved.srt',{type:'text/plain'}));
    api.setOffset(1.5);
    const readSaved=async()=>{
      const db=await new Promise((resolve,reject)=>{
        const req=indexedDB.open('marmalade-local-subtitles',1);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
      });
      try{return await new Promise((resolve,reject)=>{
        const req=db.transaction('handles','readonly').objectStore('handles').get('secondary\u0000library:audit-secondary-fixture');
        req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
      });}finally{db.close();}
    };
    state.secondarySubtitles=[];state.secondarySubtitleOffset=0;
    await api.restore();
    const result={text:state.secondarySubtitles[0]?.text,offset:state.secondarySubtitleOffset,saved:(await readSaved())?.offset};
    await api.clear();
    result.deleted=(await readSaved())===undefined;
    state.source=null;state.nativeMediaKey='';state.subtitlesEnabled=false;el.stage.classList.remove('has-video');
    return result;
  });
  assert.deepEqual(savedSubtitle,{text:'Saved secondary',offset:1.5,saved:1.5,deleted:true});
  // A large catalog never accumulates thousands of card elements.
  await page.evaluate(()=>localStorage.setItem('marmalade:media-library:auto-posters','false'));
  const large={format:'marmaladeum-library-backup',version:1,libraries:[{id:'audit-large',name:'Large Catalog',kind:'mixed',folders:[{id:'large-folder',name:'Movies'}],items:Array.from({length:501},(_,i)=>({folderId:'large-folder',path:'Movie '+String(i).padStart(4,'0')+'.mp4',title:'Movie '+String(i).padStart(4,'0'),size:i+100}))}]};
  await page.locator('#mlCatalogBackupInput').setInputFiles({name:'large.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(large))});
  await page.waitForFunction(()=>window.MarmaladeMediaLibrary.getLibraries().some(l=>l.id==='audit-large'&&l.count===501));
  await page.evaluate(()=>window.MarmaladeMediaLibrary.select('audit-large'));
  assert.equal(await page.locator('#mlCards .ml-card').count(),120);
  await page.locator('.ml-page-nav button').filter({hasText:'Next'}).click();
  assert.equal(await page.locator('#mlCards .ml-card').count(),120);
  assert.match(await page.locator('.ml-page-range').textContent(),/121–240 of 501/);
  const pageNumber=page.locator('.ml-page-nav input');await pageNumber.fill('5');await pageNumber.press('Tab');
  assert.equal(await page.locator('#mlCards .ml-card').count(),21);
  await page.locator('#mlSearch').fill('Movie 0001');
  await page.waitForFunction(()=>document.querySelectorAll('#mlCards .ml-card').length===1);
  assert.equal(await page.locator('.ml-page-nav').count(),0);
  await page.locator('#mlSearch').fill('');
  await page.waitForFunction(()=>document.querySelectorAll('#mlCards .ml-card').length===120);
  await page.locator('#mlSettingsBtn').click();
  await page.locator('#mlSmartEditor > summary').click();
  await page.locator('#mlSmartName').fill('My 000 Movies');
  await page.locator('#mlSmartKind').selectOption('movie');
  await page.locator('#mlSmartText').fill('Movie 000');
  await page.locator('#mlSmartSave').click();
  await page.waitForFunction(()=>document.querySelectorAll('#mlCards .ml-card').length===10);
  assert.equal(await page.locator('#mlCurrentShelf').textContent(),'My 000 Movies');
  const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('marmalade:media-library:smart-collections:v1')));
  assert.equal(stored.length,1);assert.equal(stored[0].text,'Movie 000');
  await page.locator('#mlSmartDelete').click();
  assert.equal(await page.locator('#mlCollectionFilter').inputValue(),'all');
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('marmalade:media-library:smart-collections:v1')).length),0);
  assert.equal(await page.evaluate(()=>window.MarmaladeMediaLibrary.getLibraries().find(l=>l.id==='audit-large').count),501);
  // Importing a rule-only backup must work without altering the catalog.
  const rule={id:'audit-smart-rule',name:'Imported Movies',kind:'movie',status:'all',yearFrom:null,yearTo:null,maxMinutes:null,recentDays:null,text:'Movie 001'};
  const smartBackup={format:'marmaladeum-library-backup',version:1,libraries:[],smartCollections:[rule]};
  const importRules=async(data)=>page.locator('#mlCatalogBackupInput').setInputFiles({name:'rules.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
  await importRules(smartBackup);
  await page.waitForFunction(()=>document.querySelector('#mlStatus').textContent.includes('1 smart collections restored'));
  await page.locator('#mlSmartSelect').selectOption(rule.id);
  assert.equal(await page.locator('#mlSmartName').inputValue(),rule.name);
  await importRules({...smartBackup,smartCollections:[{...rule,name:'Do Not Overwrite'}]});
  await page.waitForFunction(()=>document.querySelector('#mlStatus').textContent.includes('No new libraries'));
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('marmalade:media-library:smart-collections:v1'))[0].name),rule.name);
  await importRules({...smartBackup,smartCollections:[{...rule,id:'bad-rule',maxMinutes:-5}]});
  await page.waitForFunction(()=>document.querySelector('#mlStatus').textContent.includes('Invalid smart collection numeric rule'));
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('marmalade:media-library:smart-collections:v1')).length),1);
  await page.locator('#mlSettingsClose').click();
  await page.locator('#mlCollectionFilter').selectOption('smart:'+rule.id);
  assert.equal(await page.locator('#mlCards .ml-card').count(),10);
  const stage=await page.locator('#dropZone').boundingBox();
  assert.ok(stage&&stage.x>=-1&&stage.x+stage.width<=viewport.width+1,'Video stage exceeds viewport');
  assert.deepEqual(errors,[],'Unexpected browser JavaScript errors');
  await context.close();
  console.log(engine,viewport.width,'settings persistence and stage layout passed');
 }
}finally{await browser.close();}
