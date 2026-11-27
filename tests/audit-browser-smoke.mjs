import assert from 'node:assert/strict';
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
  await page.locator('#closeSettingsPanel').click();
  const settings=await page.evaluate(()=>{
   const maximum=document.querySelector('#volumeMaximum'),step=document.querySelector('#volumeIncrement'),snap=document.querySelector('#volumeSnap'),buffer=document.querySelector('#allowOriginalBuffer');
   maximum.value='400';maximum.dispatchEvent(new Event('change',{bubbles:true}));
   step.value='5';step.dispatchEvent(new Event('change',{bubbles:true}));
   snap.checked=false;snap.dispatchEvent(new Event('change',{bubbles:true}));
   buffer.checked=false;buffer.dispatchEvent(new Event('change',{bubbles:true}));
   return {max:document.querySelector('#volume').max,step:document.querySelector('#volume').step,allow:window.MarmaladeAddonBridge.state.allowOriginalBuffer};
  });
  assert.deepEqual(settings,{max:'400',step:'5',allow:false});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.MarmaladeAddonBridge&&document.querySelector('#allowOriginalBuffer').closest('.settings-row'));
  assert.equal(await page.locator('#volumeMaximum').inputValue(),'400');
  assert.equal(await page.locator('#volumeIncrement').inputValue(),'5');
  assert.equal(await page.locator('#volumeSnap').isChecked(),false);
  assert.equal(await page.locator('#allowOriginalBuffer').isChecked(),false);
  await page.waitForFunction(()=>window.MarmaladeMediaLibrary?.ready);
  const backup={format:'marmaladeum-library-backup',version:1,libraries:[{id:'audit-catalog',name:'Audit Recovery',kind:'movie',folders:[{id:'audit-folder',name:'Films'}],items:[{folderId:'audit-folder',path:'Example.mp4',title:'Example',favorite:true,watched:true,collections:['Test']}]}]};
  const file={name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))};
  await page.locator('#mlCatalogBackupInput').setInputFiles(file);
  await page.waitForFunction(()=>window.MarmaladeMediaLibrary.getLibraries().some(l=>l.id==='audit-catalog'&&l.count===1));
  await page.locator('#mlCatalogBackupInput').setInputFiles(file);
  await page.waitForFunction(()=>document.querySelector('#mlStatus').textContent.includes('No new libraries'));
  assert.equal(await page.evaluate(()=>window.MarmaladeMediaLibrary.getLibraries().filter(l=>l.id==='audit-catalog').length),1);
  backup.libraries[0].id='invalid-audit-catalog';backup.libraries[0].items[0].path='../outside.mp4';
  await page.locator('#mlCatalogBackupInput').setInputFiles({...file,buffer:Buffer.from(JSON.stringify(backup))});
  await page.waitForFunction(()=>document.querySelector('#mlStatus').textContent.includes('Invalid media path'));
  assert.equal(await page.evaluate(()=>window.MarmaladeMediaLibrary.getLibraries().some(l=>l.id==='invalid-audit-catalog')),false);
  const stage=await page.locator('#dropZone').boundingBox();
  assert.ok(stage&&stage.x>=-1&&stage.x+stage.width<=viewport.width+1,'Video stage exceeds viewport');
  assert.deepEqual(errors,[],'Unexpected browser JavaScript errors');
  await context.close();
  console.log(engine,viewport.width,'settings persistence and stage layout passed');
 }
}finally{await browser.close();}
