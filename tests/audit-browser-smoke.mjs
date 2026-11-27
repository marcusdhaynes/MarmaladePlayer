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
  const stage=await page.locator('#dropZone').boundingBox();
  assert.ok(stage&&stage.x>=-1&&stage.x+stage.width<=viewport.width+1,'Video stage exceeds viewport');
  assert.deepEqual(errors,[],'Unexpected browser JavaScript errors');
  await context.close();
  console.log(engine,viewport.width,'settings persistence and stage layout passed');
 }
}finally{await browser.close();}
