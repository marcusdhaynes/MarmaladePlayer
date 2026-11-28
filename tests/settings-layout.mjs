import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,mkdirSync} from 'node:fs';
import {extname,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const capture=resolve(root,'test-artifacts/settings-layout');
mkdirSync(capture,{recursive:true});
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css',
 '.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'};
const server=createServer((req,res)=>{
 const name=new URL(req.url,'http://local').pathname.slice(1)||'index.html';
 const path=resolve(root,decodeURIComponent(name));
 if(path!==root&&!path.startsWith(root+sep)){res.writeHead(403);res.end();return;}
 try{const data=readFileSync(path);res.writeHead(200,{'content-type':mime[extname(path)]||'application/octet-stream'});res.end(data);}catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
 for(const viewport of [{width:1366,height:900},{width:390,height:844},{width:320,height:568},{width:768,height:540}]){
  const page=await browser.newPage({viewport});
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.route('**/npm/peerjs@*/**',route=>
    route.fulfill({status:200,contentType:'application/javascript',body:'window.Peer=class {on(){} destroy(){}};'}));
  await page.route('**/mediainfo.js@*',route=>
    route.fulfill({status:200,contentType:'application/javascript',body:'window.MediaInfo=async()=>({analyzeData:async()=>({media:{track:[]}})});'}));
  await page.goto('http://127.0.0.1:'+server.address().port+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.MarmaladeSettingsLayout?.panes.length===3);
  await page.locator('#dropZone').evaluate(el=>el.classList.add('has-video'));
  await page.locator('#settingsBtn').click({force:true});
  await page.waitForFunction(()=>!document.getElementById('settingsPanel').hidden);
  assert.deepEqual(await page.locator('.settings-tab').evaluateAll(
    els=>els.map(el=>[el.dataset.settingsTab,el.textContent.trim()])),
    [['video','Video'],['controls','Controls'],['party','Party']]);
  // Every existing settings input remains unique and in the appropriate pane.
  const groups={
    video:['qualitySelect','qualityHint','backgroundTheme','settingsSubtitleShortcut'],
    controls:['skipInterval','controlFadeDelay'],
    party:['stabilityMode','strictSync','hostMatchTiming','peerAssist',
      'hostMatchStatus','hostSyncSettings','diagnosticsToggle','stabilityInfo','screenShareBtn']
  };
  for(const [key,ids] of Object.entries(groups))for(const id of ids)
    assert.equal(await page.locator('#'+id).count(),1,'Existing setting '+id+' retained');
  for(const [key,ids] of Object.entries(groups))for(const id of ids)
    assert.equal(await page.locator('#settingsPage'+key[0].toUpperCase()+key.slice(1)+' #'+id).count(),
      1,'Setting '+id+' belongs to '+key);

  async function layout(which,variant=''){
    await page.locator('#settingsTab'+which[0].toUpperCase()+which.slice(1)).click();
    await page.waitForTimeout(60);
    const boxes=await page.evaluate(()=>{
      const p=document.getElementById('settingsPanel'),r=p.getBoundingClientRect();
      const vis=[...p.querySelectorAll('.settings-page')].filter(el=>!el.hidden);
      const rows=[...vis[0].querySelectorAll('.settings-row,.settings-action-row')].filter(el=>
        !el.hidden&&getComputedStyle(el).display!=='none');
      const positions=rows.map(el=>{const q=el.getBoundingClientRect();return {top:q.top,bottom:q.bottom,left:q.left,right:q.right};});
      return {panel:{top:r.top,left:r.left,right:r.right,bottom:r.bottom,width:r.width,height:r.height},
        viewport:{width:innerWidth,height:innerHeight},visible:vis.map(el=>el.dataset.settingsPage),
        positions,scrollHeight:p.scrollHeight,clientHeight:p.clientHeight,
        background:getComputedStyle(p).backgroundImage,tabCount:p.querySelectorAll('[role=tab]').length,docked:p.classList.contains('player-docked'),dockWidth:p.parentElement.clientWidth};
    });
    const {panel,viewport:vp,positions}=boxes;
    assert(panel.left>=-1&&panel.right<=vp.width+1,'Settings must not be horizontally clipped');
    assert.equal(boxes.docked,vp.height>vp.width,'Only portrait view docks settings');
    if(boxes.docked){
      assert(Math.abs(panel.width-boxes.dockWidth)<=2,'Docked settings fill the player column');
      // In normal viewing mode the panel is intentionally below the video.
      // Verify the bottommost content is actually reachable, not cropped.
      const footer=page.locator('#settingsPanel .settings-footer');
      await footer.scrollIntoViewIfNeeded();
      const end=await footer.boundingBox();
      assert(end&&end.y>=-1&&end.y+end.height<=vp.height+1,'Docked settings footer is reachable');
      await page.locator('#settingsPanel .settings-heading').scrollIntoViewIfNeeded();
    }else{
      assert(panel.top>=-1&&panel.bottom<=vp.height+1,'Floating settings remain inside viewport');
      assert(panel.width<=350&&panel.width>=280,'Compact floating palette width');
      assert.equal(await page.locator('#settingsPanel').evaluate(p=>getComputedStyle(p).position),'fixed');
      assert.equal(await page.locator('#playerPanelDock').isVisible(),false,'Landscape reserves no dock space');
    }
    assert.deepEqual(boxes.visible,[which]);
    assert.equal(boxes.tabCount,3);
    assert(boxes.background.includes('linear-gradient'),'Dark Marmalade glass gradient retained');
    for(let j=1;j<positions.length;j++){
      assert(positions[j].top>=positions[j-1].bottom-1,
        'Settings rows must never overlap: '+which+' '+j);
    }
    const filename='settings-'+viewport.width+'x'+viewport.height+'-'+which+(variant?'-'+variant:'')+'.png';
    await page.screenshot({path:resolve(capture,filename),animations:'disabled'});
    return boxes;
  }
  await layout('video');
  // Every original audit category can be reached directly without changing
  // the compact three-tab architecture or duplicating actual inputs.
  const jumpTargets={video:'qualitySelect',audio:'volumeIncrement',subtitles:'preferredSubtitleLanguage',party:'stabilityMode',buffering:'allowOriginalBuffer',library:'mlVisibilityToggle',games:'gamesVisibilityToggle',controls:'skipInterval',miniPlayer:'miniPlayerFadeDelay',appearance:'backgroundTheme',privacy:'rememberLastRoom',performance:'diagnosticsToggle',updates:'automaticUpdateChecks'};
  await page.waitForFunction(()=>document.querySelector('#mlVisibilityToggle')&&document.querySelector('#gamesVisibilityToggle'));
  assert.deepEqual(await page.locator('#settingsCategoryJump option').evaluateAll(options=>options.slice(1).map(o=>o.value)),Object.keys(jumpTargets));
  for(const [category,id] of Object.entries(jumpTargets)){
    await page.locator('#settingsCategoryJump').selectOption(category);
    await page.waitForFunction(id=>{const target=document.getElementById(id),active=document.activeElement;return active===target||(target.disabled&&active?.dataset.categoryFocus===id);},id);
    assert.equal(await page.locator('#'+id).isVisible(),true,category+' target is visible');
    assert.equal(await page.locator('#'+id).count(),1,category+' target remains unique');
    console.log('PASS category navigation '+category);
  }
  await page.locator('#settingsSearch').fill('automatic update checks');
  await page.locator('#settingsSearchResults button').filter({hasText:'Automatic Update Checks'}).click();
  assert.equal(await page.locator('#automaticUpdateChecks').isVisible(),true);
  await page.locator('#settingsSearch').fill('export settings');
  await page.locator('#settingsSearchResults button').filter({hasText:'Export Settings'}).click();
  assert.equal(await page.locator('#settingsBackup').getAttribute('open'),'');
  await page.locator('#settingsBackup > summary').click();
  // Restore the baseline state for the original layout assertions.
  await page.locator('#settingsTabParty').click();
  await page.locator('#settingsAdvanced > summary').click();
  await layout('video');
  assert.equal(await page.locator('#settingsTabVideo').getAttribute('aria-selected'),'true');
  await page.locator('#settingsTabVideo').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(()=>window.MarmaladeSettingsLayout.active()),'controls',
    'Arrow keys cycle settings tabs instead of seeking video');
  await layout('controls');
  if(viewport.width===1366){
    await page.locator('#skipInterval').selectOption('30');
    assert.equal(await page.evaluate(()=>localStorage.getItem('marmalade:skip-interval-seconds')),'30');
    await page.locator('#controlFadeDelay').selectOption('8');
    assert.equal(await page.evaluate(()=>localStorage.getItem('marmalade:control-fade-seconds')),'8');
  }
  await layout('party');
  const activeHost=await page.evaluate(()=>window.MarmaladeAddonBridge.state.role==='host');
  assert.equal(await page.locator('#hostMatchRow').isVisible(),activeHost,
    'Host-only Match timing must follow the current role');
  assert.equal(await page.locator('#settingsAdvanced').getAttribute('open'),null);
  await page.locator('#settingsAdvanced > summary').click();
  assert.equal(await page.locator('#screenShareBtn').isVisible(),true);
  await layout('party','advanced');
  if(viewport.width===1366){
    const prior=await page.locator('#strictSync').isChecked();
    await page.locator('#strictSync').click();
    assert.equal(await page.locator('#strictSync').isChecked(),!prior);
    assert.equal(await page.evaluate(()=>localStorage.getItem('marmalade:strict-sync')),String(!prior));
  }
  await page.locator('#settingsTabVideo').click();
  await page.locator('#settingsSubtitleShortcut').click();
  assert.equal(await page.locator('#settingsPanel').isVisible(),false);
  assert.equal(await page.locator('#subtitlePanel').isVisible(),true,
    'Subtitles shortcut opens the original specialized subtitle studio');
  assert.equal(await page.locator('#subtitlePanel').evaluate(p=>p.classList.contains('player-docked')),viewport.height>viewport.width,'Only portrait view docks subtitles');
  if(viewport.width>viewport.height){
    const r=await page.locator('#subtitlePanel').boundingBox();
    assert(r&&r.x>=-1&&r.y>=-1&&r.x+r.width<=viewport.width+1&&r.y+r.height<=viewport.height+1,'Floating subtitles fit the viewport');
    assert.equal(await page.locator('#subtitlePanel').evaluate(p=>getComputedStyle(p).position),'fixed');
  }
  // Rotate an already-open panel. Preserve the current tab and ensure the
  // window moves between the document dock and the fixed overlay.
  if(viewport.width===1366){
    await page.setViewportSize({width:390,height:844});
    await page.waitForFunction(()=>document.querySelector('#subtitlePanel').classList.contains('player-docked'));
    await page.setViewportSize({width:844,height:390});
    await page.waitForFunction(()=>!document.querySelector('#subtitlePanel').classList.contains('player-docked')&&document.querySelector('#subtitlePanel').parentElement===document.body);
    await page.setViewportSize(viewport);
  }
  await page.locator('#closeSubtitlePanel').click();
  await page.locator('#settingsBtn').click({force:true});
  await page.waitForFunction(()=>!document.getElementById('settingsPanel').hidden);
  assert.equal(await page.locator('#settingsTabVideo').getAttribute('aria-selected'),'true');
  if(viewport.width===1366){
    await page.setViewportSize({width:390,height:844});
    await page.waitForFunction(()=>document.querySelector('#settingsPanel').classList.contains('player-docked'));
    await page.setViewportSize({width:844,height:390});
    await page.waitForFunction(()=>!document.querySelector('#settingsPanel').classList.contains('player-docked')&&document.querySelector('#settingsPanel').parentElement===document.body);
    assert.equal(await page.locator('#settingsTabVideo').getAttribute('aria-selected'),'true');
    await page.setViewportSize(viewport);
  }
  if(viewport.width===1366){
    // Exercise all thirteen real reset actions with a non-default preference
    // in every category. Reload after each reset; check independent values
    // and actual controls, not just the existence of dropdown options.
    const fixtures=[
      ['video','mobile:match-video-aspect','true','false','mobileMatchVideoAspect','checkbox'],
      ['audio','volume-maximum','400','200','volumeMaximum','select'],
      ['subtitles','preferred-subtitle-language','ar','en','preferredSubtitleLanguage','select'],
      ['party','strict-sync','false','true','strictSync','checkbox'],
      ['buffering','original-file-buffer','false','true','allowOriginalBuffer','checkbox'],
      ['library','media-library:auto-next','true','false','mlAutoNext','checkbox'],
      ['games','games:visible:v1','true','false','gamesVisibilityToggle','checkbox'],
      ['controls','skip-interval-seconds','30','10','skipInterval','select'],
      ['miniPlayer','mini-player-fade','8','follow','miniPlayerFadeDelay','select'],
      ['appearance','window-theme','glass','classic','windowTheme','select'],
      ['privacy','remember-last-room','false','true','rememberLastRoom','checkbox'],
      ['performance','playback-diagnostics','true','false','diagnosticsToggle','expanded'],
      ['updates','auto-update-checks','false','true','automaticUpdateChecks','checkbox']
    ];
    // Cover every currently allowlisted portable preference, not just one
    // representative per category. The legacy subtitle style key is distinct
    // from per-movie subtitle offsets and must remain independently resettable.
    const extras={
      video:{'fullscreen-orientation':'landscape','guest-quality':'360','adaptive-video-brightness:v1':'35'},
      audio:{'volume-increment':'5','volume-snap':'false','volume-level':'175','audio-peak-protection':'true',
        'audio-night-mode':'true','audio-dialogue':'strong','audio-normalize':'true','personal-audio-delay':'150',
        'preferred-audio-language':'ar','audio-eq-preset':'custom','audio-eq-bands':'[1,2,3,4,5,6,7]'},
      subtitles:{'marmalade-subtitle-style-v1':JSON.stringify({font:'Georgia, serif',textColor:'#ffccee',
        textSize:32,textAlpha:80,outlineColor:'#123456',outlineSize:3,outlineAlpha:70,glowColor:'#112233',
        glowSize:8,glowAlpha:50,shadowColor:'#222222',shadowSize:4,shadowAlpha:65,position:'top-right',alignment:'right'})},
      party:{'stability-mode':'smooth'},buffering:{'peer-assist':'false'},
      library:{'media-library:visible':'true','media-library:auto-posters':'false','media-library:poster-columns':'7','media-library:list':'true'},
      controls:{'control-fade-seconds':'8','tap-video-playback':'false'},
      appearance:{'background-theme':'cosmic02','cosmic-background':'false'}
    };
    const storageKey=k=>k==='marmalade-subtitle-style-v1'?k:'marmalade:'+k;
    const groups=Object.fromEntries(fixtures.map(([category,key,value])=>
      [category,Object.fromEntries(Object.entries({[key]:value,...extras[category]}).map(([k,v])=>[storageKey(k),v]))]));
    const preferences=Object.assign({},...Object.values(groups));
    const keys=Object.keys(preferences);
    assert.equal(keys.length,36,'Explicit fixture for each portable preference');
    // Guard against schema drift: a new portable setting must get a fixture.
    const schemaSource=readFileSync(resolve(root,'settings-layout.js'),'utf8');
    const schemaText=schemaSource.slice(schemaSource.indexOf(' const schema={'),schemaSource.indexOf(' const validators='));
    const schemaKeys=[...schemaText.matchAll(/'([^']+)'\s*:/g)].map(match=>storageKey(match[1]));
    schemaKeys.push('marmalade-subtitle-style-v1');
    assert.deepEqual([...new Set(schemaKeys)].sort(),keys.slice().sort(),'Every allowlisted setting has a round-trip fixture');
    // Establish clean defaults, including keys the app automatically writes
    // on startup. Preserve unrelated private and per-movie data.
    await page.evaluate(keys=>{
      for(const key of keys)localStorage.removeItem(key);
      localStorage.setItem('marmalade:watch-progress:v1','{}');
      localStorage.setItem('marmalade:subtitle-offsets:v2','{}');
    },keys);
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.MarmaladeSettingsLayout&&document.getElementById('mlAutoNext')&&document.getElementById('gamesVisibilityToggle'));
    const baseline=await page.evaluate(keys=>Object.fromEntries(keys.map(k=>[k,localStorage.getItem(k)])),keys);
    await page.locator('#settingsBtn').click({force:true});
    await page.locator('#settingsBackup > summary').click();
    await page.locator('#settingsImportFile').setInputFiles({name:'complete-settings.json',mimeType:'application/json',
      buffer:Buffer.from(JSON.stringify({format:'marmaladeum-settings',version:1,mode:'snapshot',preferences}))});
    await page.waitForFunction(()=>!document.querySelector('#settingsApplyBackup').hidden);
    await Promise.all([page.waitForEvent('load'),page.locator('#settingsApplyBackup').click()]);
    await page.waitForFunction(()=>window.MarmaladeSettingsLayout&&document.getElementById('mlAutoNext')&&document.getElementById('gamesVisibilityToggle'));
    await page.locator('#settingsBtn').click({force:true});
    await page.locator('#settingsBackup > summary').click();
    const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#settingsExport').click()]);
    const exported=JSON.parse(readFileSync(await download.path(),'utf8'));
    assert.deepEqual(exported.preferences,preferences,'Every portable key round-trips through actual import, reload and download');
    await page.locator('#closeSettingsPanel').click();
    async function verifyFixtures(done){
      await page.waitForFunction(()=>window.MarmaladeSettingsLayout&&document.getElementById('mlAutoNext')&&document.getElementById('gamesVisibilityToggle'));
      const actual=await page.evaluate(fixtures=>fixtures.map(([,key,,,id,type])=>{
        const el=document.getElementById(id);
        return {stored:localStorage.getItem('marmalade:'+key),value:type==='checkbox'?String(el.checked):type==='expanded'?el.getAttribute('aria-expanded'):el.value};
      }),fixtures);
      for(let i=0;i<fixtures.length;i++){
        const [category,,chosen,reset]=fixtures[i];
        const expected=i<done?reset:chosen;
        assert.equal(actual[i].value,expected,category+' live value after '+done+' resets');
        assert(actual[i].stored===expected||(i<done&&actual[i].stored===null),category+' persisted value '+JSON.stringify(actual[i]));
      }
      const stored=await page.evaluate(keys=>Object.fromEntries(keys.map(k=>[k,localStorage.getItem(k)])),keys);
      for(let i=0;i<fixtures.length;i++){
        for(const [key,value] of Object.entries(groups[fixtures[i][0]])){
          if(i<done)assert.equal(stored[key],baseline[key],key+' restored to startup default after scoped reset');
          else assert.equal(stored[key],value,key+' preserved by other categories');
        }
      }
      assert.equal(await page.evaluate(()=>localStorage.getItem('marmalade:watch-progress:v1')),'{}','Viewing history storage must not be reset');
      assert.equal(await page.evaluate(()=>localStorage.getItem('marmalade:subtitle-offsets:v2')),'{}','Per-movie subtitle timing must not be reset');
    }
    await verifyFixtures(0);
    for(let i=0;i<fixtures.length;i++){
      const category=fixtures[i][0];
      await page.locator('#settingsBtn').click({force:true});
      await page.locator('#settingsBackup > summary').click();
      await page.locator('#settingsResetCategory').selectOption(category);
      await page.locator('#settingsReset').click();
      await Promise.all([page.waitForEvent('load'),page.locator('#settingsApplyBackup').click()]);
      await verifyFixtures(i+1);
      console.log('PASS independent reset, reload and all other categories preserved: '+category);
    }
  }
  assert.deepEqual(errors,[], 'No runtime exceptions during settings interactions');
  await page.close();
  console.log('PASS settings desktop/mobile layout '+viewport.width+'×'+viewport.height);
 }
}finally{
 await browser.close();
 await new Promise(resolve=>server.close(resolve));
}
