import {chromium} from 'playwright';
const urls=[
  'https://marcusdhaynes.github.io/MarmaladePlayer/',
  'https://marcusdhaynes.github.io/marmaladeplayer/'
];
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
  for(const url of urls){
    const page=await browser.newPage({viewport:{width:1280,height:800}});
    const errors=[];
    page.on('pageerror',e=>errors.push(String(e)));
    page.on('console',m=>{if(m.type()==='error')errors.push('console: '+m.text());});
    page.on('response',r=>{if(/watch-sync-subtitles|subtitle-search|\/index.html/.test(r.url()))
      console.log('RESOURCE',r.status(),r.url());});
    let response;
    try{response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});}
    catch(e){console.log('NAV ERROR',url,e.message);await page.close();continue;}
    console.log('NAV',url,{status:response?.status(),landed:page.url(),title:await page.title()});
    await page.waitForTimeout(2000);
    const initial=await page.evaluate(()=>({
      stage:!!document.getElementById('dropZone'),buttons:document.querySelectorAll('#subtitlesBtn').length,
      studio:!!document.querySelector('.subtitle-studio'),search:!!document.getElementById('subFindTab'),
      appearance:!!document.getElementById('subStyleTab'),
      addonBridge:!!window.MarmaladeAddonBridge,
      subtitleFinder:!!window.MarmaladeSubtitleFinder,
      subtitleClock:!!window.MarmaladeSubtitleClock,
      sw:navigator.serviceWorker?.controller?.scriptURL
    }));
    console.log('INITIAL',url,JSON.stringify(initial));
    if(initial.buttons){
      // The theater toolbar is intentionally not interactive until media exists.
      // Expose it exactly like the existing functional browser smoke test.
      await page.locator('#dropZone').evaluate(stage=>{
        stage.classList.add('has-video','controls-visible');
      });
      const button=page.locator('#subtitlesBtn');
      console.log('TRIGGER',url,JSON.stringify(await button.evaluate(el=>{
        const r=el.getBoundingClientRect();return {
          visible:getComputedStyle(el).visibility,
          pointerEvents:getComputedStyle(el).pointerEvents,
          rect:r.toJSON(),hit:document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.id
        };
      })));
      await button.click();
      await page.waitForTimeout(200);
      console.log('CLICK',url,JSON.stringify(await page.evaluate(()=>{
        const panel=document.querySelector('#subtitlePanel');
        return {hidden:panel.hidden,text:panel.innerText.slice(0,800),
          rect:JSON.stringify(panel.getBoundingClientRect().toJSON()),
          cssDisplay:getComputedStyle(panel).display,
          tabs:[...panel.querySelectorAll('[role=tab]')].map(el=>el.textContent)};
      })));
    }
    if(initial.buttons){
      await page.locator('#subStyleTab').click();
      console.log('STYLE VISIBLE',url,JSON.stringify(await page.evaluate(()=>({
        styleVisible:!!document.querySelector('#subStyleView')?.offsetParent,
        positionCount:document.querySelectorAll('[data-sub-position]').length
      }))));
    }
    console.log('ERRORS',url,JSON.stringify(errors).slice(0,1500));
    await page.close();
  }
}finally{await browser.close();}
