import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

const js=readFileSync(new URL('../media-library.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../media-library.css',import.meta.url),'utf8');
const beginning=js.indexOf("  const AUTO_POSTERS_KEY=");
const ending=js.indexOf("  const video=(name)",beginning);
assert(beginning>=0&&ending>beginning,'Automatic poster implementation is present');

function harness(options={}){
  const storage=new Map();
  const item={id:'movie',title:'Blade Runner (1982)',year:1982,type:'movie',poster:'',
    posterCustomized:false};
  const custom={id:'custom',title:'Blade Runner (1982)',year:1982,type:'movie',
    poster:'data:image/png;base64,kept',posterCustomized:true};
  const requests=[];
  let writes=0,renders=0;
  const deps={
    now:()=>Date.now(),readLocal:(key,fallback)=>storage.get(key)??fallback,
    setLocal:(key,value)=>storage.set(key,String(value)),
    panel:{hidden:false},state:{libraries:[{id:'movies',items:[item,custom]}]},
    window:{MarmaladePublicMovieInfo:{lookup:async input=>{
      requests.push(input);
      return options.lookup?options.lookup(input):{record:{
        title:'Blade Runner',year:1982,poster:'https://art.example/poster.jpg'
      }};
    }}},
    persistNativeItem:async()=>{writes++;},persist:async()=>{writes++;},
    render:()=>{renders++;},console:{debug:()=>{}},
    setTimeout:fn=>queueMicrotask(fn)
  };
  const api=new Function(...Object.keys(deps),
    js.slice(beginning,ending)+'\nreturn {scheduleAutoPoster,posterDisplayTitle,queueLength:()=>posterQueue.length,limit:MAX_POSTER_QUEUE};'
  )(...Object.values(deps));
  return {api,item,custom,storage,requests,panel:deps.panel,get writes(){return writes;},
    get renders(){return renders;}};
}
async function settle(){
  for(let i=0;i<24;i++)await new Promise(resolve=>queueMicrotask(resolve));
}

test('Poster title strips only parenthesized years, preserving stored filenames',()=>{
  const {api}=harness();
  assert.equal(api.posterDisplayTitle('Blade Runner (1982)'),'Blade Runner');
  assert.equal(api.posterDisplayTitle('Arrival (2016)'),'Arrival');
  assert.equal(api.posterDisplayTitle('2001: A Space Odyssey (1968)'),'2001: A Space Odyssey');
  assert.equal(api.posterDisplayTitle('Movie 2001'),'Movie 2001');
  assert.match(js,/append\(copy,'span','ml-card-label',posterDisplayTitle\(/);
  assert.doesNotMatch(js,/append\(art,'span','ml-art-mark'/);
});

test('Missing artwork is looked up automatically and persisted once, without touching custom posters',async()=>{
  const ctx=harness();
  ctx.api.scheduleAutoPoster(ctx.item);
  ctx.api.scheduleAutoPoster(ctx.item);
  await settle();
  assert.deepEqual(ctx.requests,[{
    title:'Blade Runner',year:1982,kind:'movie',season:null,episode:null
  }]);
  assert.equal(ctx.item.poster,'https://art.example/poster.jpg');
  assert.equal(ctx.custom.poster,'data:image/png;base64,kept');
  assert.equal(ctx.writes,2,'Auto artwork persists both to native catalog and browser cache');
  assert(ctx.renders>0);
});

test('Never use a mismatched public poster or automatically query when disabled',async()=>{
  const ctx=harness({lookup:async()=>({record:{
    title:'Another Movie',year:1982,poster:'https://art.example/wrong.jpg'
  }})});
  ctx.api.scheduleAutoPoster(ctx.item);
  await settle();
  assert.equal(ctx.item.poster,'');
  assert.equal(ctx.writes,0);
  ctx.storage.set('marmalade:media-library:auto-posters','false');
  const other={id:'other',title:'Another Movie',year:2001,type:'movie',poster:''};
  ctx.api.scheduleAutoPoster(other);
  await settle();
  assert.equal(ctx.requests.length,1);
});

test('Poster-only cards have no visible outer frames or boxed star/dots',()=>{
  const finalCSS=css.slice(css.lastIndexOf('/* Poster refinements:'));
  assert(finalCSS.length>1000,'Final unboxed poster styling is present');
  assert.match(finalCSS,/\.ml-cards:not\(\.ml-list\) \.ml-card[\s\S]+?padding:0;background:transparent;border:0/);
  assert.match(finalCSS,/\.ml-card-star[\s\S]+?background:transparent!important/);
  assert.match(finalCSS,/\.ml-card-more[\s\S]+?background:transparent!important/);
  assert.match(finalCSS,/font-size:16px!important/);
  assert.match(finalCSS,/\.ml-card \.ml-art-mark\{display:none!important\}/);
  assert.match(css,/aspect-ratio:2 \/ 3/);
});

test('Artwork queue is bounded and does not enqueue while the library is hidden',async()=>{
  let release;
  const pending=new Promise(resolve=>{release=resolve;});
  const ctx=harness({lookup:()=>pending});
  for(let i=0;i<1000;i++)ctx.api.scheduleAutoPoster({title:'Movie '+i,type:'movie'});
  assert.equal(ctx.api.limit,120);
  assert.equal(ctx.api.queueLength(),120);
  assert.equal(ctx.requests.length,1,'Only one request may be in flight');
  ctx.panel.hidden=true;
  release({record:null});
  await settle();
  assert.equal(ctx.api.queueLength(),0,'Hidden panel discards pending jobs');
  ctx.api.scheduleAutoPoster({title:'Another Movie',type:'movie'});
  assert.equal(ctx.requests.length,1,'No new request while hidden');
});
