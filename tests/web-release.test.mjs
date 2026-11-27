import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,mkdirSync,cpSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const tool=fileURLToPath(new URL('../scripts/stamp-web-release.mjs',import.meta.url));
const old='a'.repeat(40),next='b'.repeat(40);
const run=(dir,...args)=>spawnSync(process.execPath,[tool,...args],{cwd:dir,encoding:'utf8'});
const ok=(dir,...args)=>{const r=run(dir,...args);assert.equal(r.status,0,r.stderr);return r.stdout;};
test('reproducible web stamping, independent recovery and tamper detection',()=>{
 const root=mkdtempSync(join(tmpdir(),'marmalade-release-'));
 try{
  const original=join(root,'original');mkdirSync(original);
  writeFileSync(join(original,'index.html'),'<html><head><script src="./runtime.js?v=obsolete"></script><link href="style.css"><script src="https://cdn.example.test/x.js"></script></head></html>');
  writeFileSync(join(original,'runtime.js'),'window.version=1;');
  writeFileSync(join(original,'style.css'),'body{color:white}');
  writeFileSync(join(original,'sw.js'),"const CACHE = 'marmalade-shell-legacy';");
  const first=join(root,'first'),second=join(root,'second');
  cpSync(original,first,{recursive:true});cpSync(original,second,{recursive:true});
  ok(first,'stamp',old);ok(second,'stamp',old);
  for(const name of ['index.html','sw.js','build-info.json'])assert.deepEqual(readFileSync(join(first,name)),readFileSync(join(second,name)));
  const manifest=readFileSync(join(first,'build-info.json'),'utf8');
  ok(first,'stamp',old);assert.equal(readFileSync(join(first,'build-info.json'),'utf8'),manifest);
  ok(first,'verify-local',old);
  assert(readFileSync(join(first,'index.html'),'utf8').includes('<meta name="marmalade-build" content="'+old+'">'));
  assert.notEqual(run(first,'verify-local',next).status,0);
  const recovered=join(root,'recovered');cpSync(first,recovered,{recursive:true});
  ok(recovered,'verify-local',old);
  writeFileSync(join(second,'runtime.js'),'window.version=2;');
  ok(second,'stamp',next);ok(second,'verify-local',next);
  assert.notEqual(readFileSync(join(second,'build-info.json'),'utf8'),manifest);
  ok(recovered,'verify-local',old);
  writeFileSync(join(recovered,'runtime.js'),'corrupted');
  const failure=run(recovered,'verify-local',old);
  assert.notEqual(failure.status,0);assert.match(failure.stderr,/Restored asset mismatch/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
