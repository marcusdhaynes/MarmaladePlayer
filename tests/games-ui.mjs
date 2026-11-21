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
 const panelHeights=()=>page.locator('#movieInfoRow').evaluate(row=>{
   const library=row.querySelector('#mediaLibraryPanel').getBoundingClientRect();
   const games=row.querySelector('#gamesPanel').getBoundingClientRect();
   return {library:library.height,games:games.height};
 });
 let heights=await panelHeights();
 assert(Math.abs(heights.games-heights.library)<2,
   'Games and Media Library must be equal height when side by side: '+JSON.stringify(heights));
 await page.locator('#closeSettingsPanel').click();
 const headerAlignment=()=>page.locator('.topbar').evaluate(bar=>{
   const rect=node=>node.getBoundingClientRect();
   const head=rect(bar),icon=rect(bar.querySelector('.logo-mark'));
   const score=rect(bar.querySelector('.game-score-card'));
   const add=rect(bar.querySelector('.game-score-add'));
   const list=rect(bar.querySelector('.game-score-list'));
   return {head:{top:head.top,bottom:head.bottom},
     midpointDiff:Math.abs((icon.top+icon.bottom)/2-(score.top+score.bottom)/2),
     topPadding:score.top-head.top,bottomPadding:head.bottom-score.bottom,
     addHeight:add.height,scoreHeight:score.height,
     listTop:list.top,listBottom:list.bottom};
 });
 let alignment=await headerAlignment();
 assert(alignment.midpointDiff<2,
   'Scores must be vertically centered on the app icon: '+JSON.stringify(alignment));
 assert(Math.abs(alignment.topPadding-alignment.bottomPadding)<3,
   'Score boxes must have symmetrical header space: '+JSON.stringify(alignment));
 assert(alignment.topPadding>=0 && alignment.bottomPadding>=0 &&
   alignment.addHeight===alignment.scoreHeight,
   'Score boxes and add-player icon must fit fully within the header');
 await page.setViewportSize({width:780,height:760});
 alignment=await headerAlignment();
 assert(alignment.topPadding>=0 && alignment.bottomPadding>=0,
   'Scores must not be clipped by the compact header: '+JSON.stringify(alignment));
 await page.setViewportSize({width:390,height:844});
 const mobileAlignment=await headerAlignment();
 assert(mobileAlignment.topPadding>=0&&mobileAlignment.bottomPadding>=0,
   'Mobile score boxes must remain wholly visible: '+JSON.stringify(mobileAlignment));
 for(const width of [780,390,320]){
   await page.setViewportSize({width,height:844});
   const mobile=await page.evaluate(()=>{
     const stage=document.querySelector('#dropZone').getBoundingClientRect();
     const row=document.querySelector('#movieInfoRow');
     const panels=[...row.querySelectorAll(':scope > section:not([hidden])')]
       .map(el=>el.getBoundingClientRect());
     const controlBar=document.querySelector('#gamesControls').getBoundingClientRect();
     const dpad=document.querySelector('.games-dpad').getBoundingClientRect();
     const gamePanel=document.querySelector('#gamesPanel').getBoundingClientRect();
     return {stageWidth:stage.width,leftGutter:stage.left,rightGutter:innerWidth-stage.right,
       panelsInside:panels.every(p=>p.left>=stage.left-1&&p.right<=stage.right+1),
       stacked:panels.every((p,i)=>i===0||p.top>=panels[i-1].bottom-1),
       dpadTop:dpad.top-controlBar.top,dpadBottom:controlBar.bottom-dpad.bottom,
       topDividerGap:dpad.top-controlBar.top,bottomWindowGap:gamePanel.bottom-dpad.bottom};
   });
   assert(Math.abs(mobile.leftGutter-mobile.rightGutter)<=2,
     'The mobile player needs equal screen gutters: '+JSON.stringify({width,...mobile}));
   assert(mobile.stageWidth<=width&&mobile.panelsInside&&mobile.stacked,
     'Mobile panels must fit and stack beneath the player: '+JSON.stringify({width,...mobile}));
   assert(mobile.dpadTop<=6&&mobile.dpadBottom<=6,
     'Game controls must hug the D-Pad vertically: '+JSON.stringify({width,...mobile}));
   assert(Math.abs(mobile.topDividerGap-mobile.bottomWindowGap)<=1,
     'The gap between the divider and D-Pad must equal the gap between D-Pad and panel bottom: '+
     JSON.stringify({width,...mobile}));
 }
 await page.setViewportSize({width:1440,height:850});
 const desktopVerticalSpacing=await page.evaluate(()=>{
   const dpad=document.querySelector('.games-dpad').getBoundingClientRect();
   const divider=document.querySelector('#gamesControls').getBoundingClientRect();
   const windowEnd=document.querySelector('#gamesPanel').getBoundingClientRect();
   return {top:dpad.top-divider.top,bottom:windowEnd.bottom-dpad.bottom};
 });
 assert(Math.abs(desktopVerticalSpacing.top-desktopVerticalSpacing.bottom)<=1,
   'Desktop divider-to-pad and pad-to-bottom vertical spacing must match: '+
   JSON.stringify(desktopVerticalSpacing));
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
 const officialArtwork=await page.evaluate(()=>{
   const card=document.querySelector('#onlyFramesLaunch img');
   const dialog=document.querySelector('#onlyFramesDialog .games-dialog-logo');
   const cardStyle=getComputedStyle(card);
   return {
     cardSource:new URL(card.currentSrc||card.src).pathname,
     dialogSource:new URL(dialog.currentSrc||dialog.src).pathname,
     sameSource:card.src===dialog.src,
     cardDimensions:[card.naturalWidth,card.naturalHeight],
     cardFit:cardStyle.objectFit
   };
 });
 assert(officialArtwork.sameSource,'Game card and dialog use the exact same official image');
 assert.match(officialArtwork.cardSource,/onlyframes-official-poster\.png$/);
 assert.equal(officialArtwork.dialogSource,officialArtwork.cardSource);
 assert.deepEqual(officialArtwork.cardDimensions,[1024,1536],
   'Official poster must retain its full original 1024×1536 resolution');
 assert.equal(officialArtwork.cardFit,'contain',
   'Never crop the official OnlyFrames artwork');
 const posterFit=await page.locator('#onlyFramesLaunch').evaluate(card=>{
   const art=card.querySelector('img');
   const outer=card.getBoundingClientRect(),inner=art.getBoundingClientRect();
   return {leftInset:inner.left-outer.left,rightInset:outer.right-inner.right,
     imageRatio:inner.width/inner.height};
 });
 assert(posterFit.leftInset>=7 && posterFit.rightInset>=7,
   'Poster needs a safe horizontal inset so its outer artwork cannot be cut off: '+
   JSON.stringify(posterFit));
 assert(Math.abs(posterFit.imageRatio-2/3)<.025,
   'Poster must retain its natural 2:3 image ratio');
 const inspectNav=()=>page.locator('.games-split-pill').evaluate(group=>{
   const buttons=[...group.querySelectorAll('button')];
   const outer=group.getBoundingClientRect();
   const footer=group.closest('.games-controls');
   const controls=footer.getBoundingClientRect();
   const dpadLeft=footer.querySelector('#gamesLeft').getBoundingClientRect();
   const dpadRight=footer.querySelector('#gamesRight').getBoundingClientRect();
   const halves=buttons.map(button=>{
     const rect=button.getBoundingClientRect();
     const style=getComputedStyle(button);
     return {left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,
       width:rect.width,height:rect.height,disabled:button.disabled,
       icons:button.querySelectorAll('.games-nav-orb svg path').length,
       label:button.querySelector('.games-nav-label')?.textContent,
       labelFits:(()=>{const label=button.querySelector('.games-nav-label');
         const rect=label.getBoundingClientRect();
         return label.scrollWidth<=label.clientWidth+1 &&
           rect.left>=button.getBoundingClientRect().left-1 &&
           rect.right<=button.getBoundingClientRect().right+1;})(),
       background:style.backgroundColor};
   });
   const style=getComputedStyle(group);
   const divider=getComputedStyle(buttons[1],'::before');
   return {outer:{left:outer.left,right:outer.right,width:outer.width,
       height:outer.height},controls:{left:controls.left,right:controls.right},
     radius:style.borderRadius,gap:style.columnGap,background:style.backgroundImage,
     dividerWidth:divider.width,dpadLeftHeight:dpadLeft.height,
     dpadRightHeight:dpadRight.height,halves};
 });
 let nav=await inspectNav();
 assert.equal(nav.halves.length,2);
 const logSize=()=>page.locator('#gamesLogToggle').evaluate(el=>{
   const r=el.getBoundingClientRect();
   const dpad=document.getElementById('gamesLeft').getBoundingClientRect();
   return {width:r.width,height:r.height,dpadHeight:dpad.height,
     label:el.querySelector('span')?.textContent,svg:!!el.querySelector('svg')};
 });
 let log=await logSize();
 assert(log.width<=42.5&&log.height<=28.5&&log.svg&&log.label==='Log',
   'Log control must be minimal, legible, and similar height to D-pad controls');
 assert(nav.halves.every(x=>x.icons===1&&x.disabled),
   'Both game navigation halves start disabled and use vector chevrons');
 assert.equal(nav.halves[0].label,'PREV');
 assert.equal(nav.halves[1].label,'NEXT');
 assert(Math.abs(nav.halves[0].width-nav.halves[1].width)<1,
   'Previous and Next must have precisely equal widths');
 assert(Math.abs(nav.halves[0].right-nav.halves[1].left)<1 && nav.gap==='0px',
   'Both sides must meet without a gap at the center');
 assert(nav.radius!=='0px'&&nav.dividerWidth==='1px'&&
   nav.background.includes('linear-gradient'),
   'A single rounded glass shell with a subtle center divider is required');
 assert(nav.outer.width<=112.5&&nav.outer.width>=103.5 &&
   nav.outer.left>=nav.controls.left-1&&nav.outer.right<=nav.controls.right+1,
   'Connected toggle must use only enough width for the icons and both labels');
 assert(nav.halves.every(x=>x.labelFits),
   'PREV and NEXT must remain fully readable without truncation');
 assert(nav.halves.every(x=>Math.abs(x.height-nav.dpadLeftHeight)<.75)&&
   Math.abs(nav.dpadLeftHeight-nav.dpadRightHeight)<.75,
   'PREV and NEXT heights must exactly match the D-pad Left/Right buttons');
 for(const width of [780,390]){
   await page.setViewportSize({width,height:800});
   nav=await inspectNav();
   log=await logSize();
   assert(log.width<=40.5&&Math.abs(log.height-nav.dpadLeftHeight)<.75,
     'Log must stay compact and match the D-pad cell height at '+width);
   assert(Math.abs(nav.halves[0].width-nav.halves[1].width)<1 &&
     Math.abs(nav.halves[0].right-nav.halves[1].left)<1 &&
     nav.halves.every(x=>x.labelFits &&
       Math.abs(x.height-nav.dpadLeftHeight)<.75) &&
     nav.outer.width<=108.5 &&
     nav.outer.left>=nav.controls.left-1 &&
     nav.outer.right<=nav.controls.right+1,
     'Compact navigation must fit, match D-pad height and retain labels at '+width+'px: '+
     JSON.stringify(nav));
 }
 await page.setViewportSize({width:1440,height:850});
 await page.locator('#onlyFramesLaunch').click();
 assert.equal(await page.locator('#onlyFramesDialog').isVisible(),true);
 assert.deepEqual(await page.locator('#onlyFramesDialog .games-dialog-logo')
   .evaluate(img=>[img.naturalWidth,img.naturalHeight]),[1024,1536],
   'Game modal must display the full exact uploaded OnlyFrames poster');
 assert.equal(await page.locator('#onlyFramesTimeInput').getAttribute('inputmode'),'numeric',
   'Player Choice provides a numeric HH:MM:SS timestamp input');
 assert.match(await page.locator('#onlyFramesDialog').textContent(),/RULES[\s\S]*WIN \/ LOSE CONDITION/i);
 assert.equal(await page.locator('#onlyFramesDialog').evaluate(el=>el.open&&el.parentElement===document.body),true,
   'Game dialog is modal in the top layer, outside app layout stacking contexts');
 const scrim=await page.locator('#onlyFramesDialog').evaluate(el=>{
   const style=getComputedStyle(el,'::backdrop');
   return {filter:style.backdropFilter,webkitFilter:style.webkitBackdropFilter};
 });
 assert([scrim.filter,scrim.webkitFilter].every(value=>!value||value==='none'),
   'Game dialog backdrop must never blur the player: '+JSON.stringify(scrim));
 assert.equal(await page.locator('#gamesPrevious').isDisabled(),true);
 assert.equal(await page.locator('#gamesNext').isDisabled(),true);
 assert.equal(await page.locator('#gamesLogToggle').isDisabled(),true);
 assert.equal(await page.locator('#gamesUp').isDisabled(),true);
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
