import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('../media-library.js',import.meta.url),'utf8');
const start=code.indexOf('  function reconcileFolder('),end=code.indexOf('  function scanPreview(',start);
assert(start>=0&&end>start,'Reconciliation function must remain testable');
const reconcile=new Function(code.slice(start,end)+'\nreturn reconcileFolder;')();
const base={id:'f|a.mp4',path:'a.mp4',folderId:'f',name:'a.mp4',size:10,lastModified:20,favorite:true,poster:'custom',addedAt:5};
test('unique moved file retains title metadata and identity is updated',()=>{
 const item={...base,id:'f|b.mp4',path:'b.mp4',name:'b.mp4',favorite:false,poster:''};
 const hidden=reconcile([base],[item],[base.id]);
 assert.equal(item.favorite,true);assert.equal(item.poster,'custom');assert.equal(item.id,'f|b.mp4');assert.deepEqual(hidden,['f|b.mp4']);
});
test('ambiguous move never transfers favorites',()=>{
 const item={...base,id:'f|b.mp4',favorite:false};
 reconcile([base,{...base,id:'f|c.mp4'}],[item]);assert.equal(item.favorite,false);
});
test('replacement file at existing path does not inherit previous metadata',()=>{
 const item={...base,size:99,lastModified:100,favorite:false};
 reconcile([base],[item]);assert.equal(item.favorite,false);
});
test('temporarily unreadable metadata retains previous known size and preferences',()=>{
 const item={...base,size:0,lastModified:0,metadataPending:true,favorite:false};
 reconcile([base],[item]);assert.equal(item.size,10);assert.equal(item.favorite,true);
});
test('timestamp-only changes preserve favorites',()=>{
 const item={...base,lastModified:21,favorite:false};
 reconcile([base],[item]);assert.equal(item.favorite,true);assert.equal(item.lastModified,21);
});
const groupStart=code.indexOf('  function groupItemsByFolder('),groupEnd=code.indexOf('  async function scanLibrary(',groupStart);
assert(groupStart>=0&&groupEnd>groupStart);
const groupItems=new Function(code.slice(groupStart,groupEnd)+'\nreturn groupItemsByFolder;')();
test('50,000 catalog entries grouped without spread limits or item mutation',()=>{
 const items=Array.from({length:50000},(_,i)=>({id:'item'+i,folderId:'f'+(i%100),favorite:i%2===0}));
 const groups=groupItems(items);
 assert.equal(groups.size,100);
 assert.equal(groups.get('f0').length,500);
 assert.equal([...groups.values()].flat().length,50000);
 assert.equal(groups.get('f0')[0],items[0]);
 assert.equal(groups.get('f0')[1],items[100]);
});
test('folder grouping safely preserves special identifiers and empty catalog',()=>{
 assert.equal(groupItems([]).size,0);
 const item={folderId:'__proto__',id:'x'};
 assert.equal(groupItems([item]).get('__proto__')[0],item);
});
