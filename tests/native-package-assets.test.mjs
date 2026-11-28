import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,mkdtempSync,cpSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {verifyNativeRuntime} from '../scripts/stamp-native-runtime.mjs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const html=readFileSync(resolve(root,'index.html'),'utf8');
const assets=[...new Set([...html.matchAll(/\b(?:src|href)=["']\.\/([^"'?#]+)(?:\?[^"']*)?["']/g)].map(m=>m[1]))];
for(const dir of ['desktop/web','mobile/www'])test(dir+' contains all shared HTML assets and runtime support',()=>{
  assert.ok(assets.length>20);
  for(const asset of [...assets,'sw.js','relay-config.json','mkv-asyncify-worker.js','vendor/libav-wasm/libav.wasm'])assert.ok(existsSync(resolve(root,dir,asset)),dir+' missing '+asset);
  assert.ok(existsSync(resolve(root,dir,dir==='desktop/web'?'desktop-native-window.js':'native-entry.js')));
});

const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
for(const [dir,shell,script] of [['desktop/web','desktop','desktop/scripts/prepare-web.mjs'],['mobile/www','mobile','mobile/scripts/prepare-web.mjs']])test(shell+' runtime has reproducible identity, complete hashes and tamper rejection',()=>{
 const dest=resolve(root,dir),manifest=resolve(dest,'native-build-info.json');
 const first=readFileSync(manifest);
 const info=verifyNativeRuntime(dest,commit,shell);
 assert.ok(Object.keys(info.files).length>30);
 assert.ok(info.files['vendor/libav-wasm/libav-jspi.wasm']);
 execFileSync(process.execPath,[resolve(root,script)],{cwd:root,stdio:'pipe',timeout:180000});
 assert.deepEqual(readFileSync(manifest),first,'Independent staging must produce identical manifest bytes');
 verifyNativeRuntime(dest,commit,shell);
 const temp=mkdtempSync(resolve(tmpdir(),'marmalade-native-'));
 try{
  cpSync(dest,temp,{recursive:true});
  verifyNativeRuntime(temp,commit,shell);
  writeFileSync(resolve(temp,'settings-layout.js'),'corrupt');
  assert.throws(()=>verifyNativeRuntime(temp,commit,shell),/asset hash mismatch/);
  assert.throws(()=>verifyNativeRuntime(dest,'0'.repeat(40),shell),/identity mismatch/);
 }finally{rmSync(temp,{recursive:true,force:true});}
});
