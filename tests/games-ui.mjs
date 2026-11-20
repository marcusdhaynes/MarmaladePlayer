import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const types={'.html':'text/html','.js':'application/javascript',
 '.css':'text/css','.svg':'image/svg+xml'};
const server=createServer((req,res)=>{
 const file=resolve(root,decodeURIComponent(new URL(req.url,'http://localhost').pathname.slice(1)||'index.html'));
 if(file!==root&&!file.startsWith(root+sep)){res.writeHead(403);res.end();return;}
 try{res.writeHead(200,{'content-type':types[extname(file)]||'application/octet-stream'});
   res.end(readFileSync(file));}catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:850}});
 await page.route('**/peerjs@*/**',route=>route.fulfill({status:200,
   contentType:'application/javascript',body:'window.Peer=class {on(){} destroy(){}};'}));
 await page.goto('http://127.0.0.1:'+server.address().port+'/',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>Boolean(window.MarmaladeGames&&window.MarmaladeMediaLibrary?.ready));
 assert.equal(await page.locator('#gamesPanel').isVisible(),false);
 assert.equal(await page.locator('#gameScoreboard').isVisible(),false);
 await page.locator('#settingsBtn').click();
 await page.locator('#gamesVisibilityToggle').check();
 assert.equal(await page.locator('#settingsPageVideo #gamesVisibilitySetting').count(),1);
 assert.equal(await page.locator('#settingsPageVideo #mlAutomaticPostersSetting').count(),0);
 assert.equal(await page.locator('#settingsPageVideo #mlPosterColumnsSetting').count(),0);
 assert.equal(await page.locator('#movieInfoRow').getAttribute('data-panel-count'),'2');
 await page.locator('#mlVisibilityToggle').check();
 assert.equal(await page.locator('#movieInfoRow').getAttribute('data-panel-count'),'3');
 const three=await page.locator('#movieInfoRow').evaluate(row=>{
   const lib=row.querySelector('#mediaLibraryPanel').getBoundingClientRect();
   const games=row.querySelector('#gamesPanel').getBoundingClientRect();
   const info=row.querySelector('#mediaInfoPanel').getBoundingClientRect();
   return {halves:Math.abs(lib.width-games.width)<4 && Math.abs(lib.top-games.top)<4,
     lower:info.top>lib.bottom,full:info.width>lib.width*1.8};
 });
 assert(three.halves&&three.lower&&three.full,
   'Three panels must show two half-width panels and one full-width information panel');
 await page.locator('#closeSettingsPanel').click();
 assert.equal(await page.locator('#mlSettingsBtn').isVisible(),true);
 await page.locator('#mlSettingsBtn').click();
 assert.equal(await page.locator('#mlSettingsPanel').isVisible(),true);
 await page.locator('#mlPosterColumnsInput').fill('5');
 await page.locator('#mlPosterColumnsInput').dispatchEvent('change');
 assert.equal(await page.locator('#mlCards').evaluate(el=>
   getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length),5);
 await page.locator('#mlSettingsClose').click();
 const filters=await page.locator('#mlKindFilter,#mlCollectionFilter,#mlSort').evaluateAll(items=>
   items.map(el=>({top:el.getBoundingClientRect().top,width:el.getBoundingClientRect().width})));
 assert(filters.every(item=>Math.abs(item.top-filters[0].top)<3 && item.width>0),
   'Sort and filter dropdowns must fit on a single row');
 assert.equal(await page.locator('#onlyFramesLaunch img').evaluate(img=>img.complete&&img.naturalWidth>0),true);
 await page.locator('#onlyFramesLaunch').click();
 assert.equal(await page.locator('#onlyFramesDialog').isVisible(),true);
 assert.match(await page.locator('#onlyFramesDialog').textContent(),/rules.*provided/i);
 await page.locator('#onlyFramesClose').click();
 assert.equal(await page.locator('.game-score-card').count(),1);
 assert.equal(await page.locator('.game-score-value').first().textContent(),'00');
 await page.locator('.game-score-plus').first().click();
 assert.equal(await page.locator('.game-score-value').first().textContent(),'01');
 await page.locator('.game-score-minus').first().click();
 assert.equal(await page.locator('.game-score-value').first().textContent(),'00');
 await page.locator('.game-score-add').click();
 assert.equal(await page.locator('.game-score-card').count(),2);
 page.once('dialog',dialog=>dialog.accept('Taylor'));
 await page.locator('.game-score-name').last().click();
 assert.equal(await page.locator('.game-score-name').last().textContent(),'Taylor');
 const tile=page.locator('.game-score-card').last();
 const bounds=await tile.boundingBox();
 const x=bounds.x+bounds.width/2,y=bounds.y+bounds.height*.70;
 await page.mouse.move(x,y);await page.mouse.down();
 await page.waitForTimeout(950);await page.mouse.up();
 assert.equal(await tile.evaluate(el=>el.classList.contains('delete-armed')),true,
   'First hold arms deletion but cannot remove a player');
 assert.equal(await page.locator('.game-score-card').count(),2);
 await page.mouse.move(x,y);await page.mouse.down();
 await page.waitForTimeout(950);await page.mouse.up();
 await page.waitForFunction(()=>document.querySelectorAll('.game-score-card').length===1);
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>Boolean(window.MarmaladeGames));
 assert.equal(await page.locator('#gamesPanel').isVisible(),true,'Games visibility is saved');
 assert.equal(await page.locator('.game-score-card').count(),1,'Deletion persists on reload');
 console.log('PASS games, scorekeeping, deliberate two-hold deletion, panel layout, library gear');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
