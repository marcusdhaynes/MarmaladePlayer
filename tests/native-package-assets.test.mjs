import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const html=readFileSync(resolve(root,'index.html'),'utf8');
const assets=[...new Set([...html.matchAll(/\b(?:src|href)=["']\.\/([^"'?#]+)(?:\?[^"']*)?["']/g)].map(m=>m[1]))];
for(const dir of ['desktop/web','mobile/www'])test(dir+' contains all shared HTML assets and runtime support',()=>{
  assert.ok(assets.length>20);
  for(const asset of [...assets,'sw.js','relay-config.json','mkv-asyncify-worker.js','vendor/libav-wasm/libav.wasm'])assert.ok(existsSync(resolve(root,dir,asset)),dir+' missing '+asset);
  assert.ok(existsSync(resolve(root,dir,dir==='desktop/web'?'desktop-native-window.js':'native-entry.js')));
});
