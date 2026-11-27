import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('../games.js',import.meta.url),'utf8');
const start=code.indexOf('  function refillDrawBag('),end=code.indexOf('  // The playable catalog is fetched',start);
assert(start>=0&&end>start);
const {refillDrawBag,randomFrameTime}=new Function(code.slice(start,end)+'\nreturn {refillDrawBag,randomFrameTime};')();
const first=()=>0,last=count=>count-1;
test('complete shuffled cycle contains every video exactly once',()=>{
 const bag=refillDrawBag(500,-1,first);
 assert.equal(bag.length,500);assert.equal(new Set(bag).size,500);
 assert.deepEqual([...bag].sort((a,b)=>a-b),Array.from({length:500},(_,i)=>i));
});
test('a new cycle cannot repeat its previous draw when other videos exist',()=>{
 for(let previous=0;previous<20;previous++){
   const bag=refillDrawBag(20,previous,last);
   assert.notEqual(bag.pop(),previous);
 }
 assert.deepEqual(refillDrawBag(1,0,first),[0]);
});
test('long movies avoid likely opening and closing credits; short clips retain full range',()=>{
 assert.equal(randomFrameTime(7200,first),90);
 assert.equal(randomFrameTime(7200,last),7109);
 assert.equal(randomFrameTime(600,first),36);
 assert.equal(randomFrameTime(30,first),0);
 assert.equal(randomFrameTime(30,last),29);
 assert.equal(randomFrameTime(.03,first),0);
});
