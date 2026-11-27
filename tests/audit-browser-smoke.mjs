import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const routeSource=html.slice(html.indexOf('  const personalAudioRoutes=new WeakMap();'),html.indexOf('  function quantizeVolume('));
import {chromium,firefox,webkit} from 'playwright';
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
  await page.locator('#settingsBtn').click({force:true});
  await page.locator('#settingsSearch').fill('maximum volume');
  await page.locator('#settingsSearchResults button').filter({hasText:'Maximum Volume'}).click();
  assert.equal(await page.locator('#settingsTabControls').getAttribute('aria-selected'),'true');
  assert.equal(await page.locator('#settingsSearch').inputValue(),'');
  await page.locator('#settingsSearch').fill('original-file buffering');
  await page.locator('#settingsSearchResults button').filter({hasText:'Original-File Buffering'}).click();
  assert.equal(await page.locator('#settingsTabParty').getAttribute('aria-selected'),'true');
  await page.locator('#settingsAdvanced > summary').click();
  await page.locator('#diagnosticsToggle').click();
  await page.waitForFunction(()=>document.querySelectorAll('#diagnosticGrid output').length===13);
  assert.equal(await page.locator('[data-metric=fps]').textContent(),'—');
  assert.equal(await page.locator('[data-metric=mode]').textContent(),'No Movie');
  assert.equal(await page.locator('[data-metric=decoder]').textContent(),'Not Reported');
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
  // Render actual Web Audio samples through the production routing function.
  // Test relative speech-band emphasis rather than claiming vocal separation.
  const response=await page.evaluate(async source=>{
    const Offline=window.OfflineAudioContext||window.webkitOfflineAudioContext;
    const settings={checked:false},dialogue={value:'off'};
    const route=new Function('audioProtection','audioNightMode','audioDialogue',source+';return routePersonalAudio;')(settings,{checked:false},dialogue);
    async function measure(level,frequency){
      const ctx=new Offline(1,24000,48000),osc=ctx.createOscillator(),gain=ctx.createGain();
      dialogue.value=level;osc.frequency.value=frequency;gain.gain.value=.2;osc.connect(gain);route(gain,ctx);
      osc.start();const buffer=await ctx.startRendering();const samples=buffer.getChannelData(0).subarray(4800);
      return Math.sqrt(samples.reduce((sum,v)=>sum+v*v,0)/samples.length);
    }
    const offBass=await measure('off',120),offSpeech=await measure('off',2300);
    const mildBass=await measure('mild',120),mildSpeech=await measure('mild',2300);
    const strongBass=await measure('strong',120),strongSpeech=await measure('strong',2300);
    return {off:offSpeech/offBass,mild:mildSpeech/mildBass,strong:strongSpeech/strongBass,speech:strongSpeech/offSpeech};
  },routeSource);
  assert(response.off>.95&&response.off<1.05,'Off mode is transparent');
  assert(response.mild>response.off*1.4&&response.strong>response.mild*1.4,'Dialogue levels progressively emphasize speech');
  assert(response.speech>.85&&response.speech<1.15,'Headroom keeps speech near original peak gain');
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
  await page.locator('#secondarySubtitleFile').setInputFiles({name:'secondary.srt',mimeType:'text/plain',buffer:Buffer.from('1\n00:00:00,000 --> 00:00:04,000\nمرحبا بالعالم\n')});
  await page.waitForFunction(()=>document.querySelector('#subtitleOverlay').textContent.includes('مرحبا بالعالم'));
  assert.equal(await page.locator('#subtitleOverlay').textContent(),'Primary captions\nمرحبا بالعالم');
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
