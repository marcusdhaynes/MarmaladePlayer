/* Build tiny standalone browser-extension folders.
 * All browser targets share the same six runtime files, differing only in
 * manifest.json. Never bundle the deprecated Minternet native module. */
import {readFileSync,writeFileSync,mkdirSync,rmSync,copyFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const src=resolve(root,'extension');
const out=resolve(root,'dist','media-extensions');
const shared=['background.js','content.js','library.html','library.js',
  'lib/catalog.mjs','lib/store.mjs'];
const chrome=JSON.parse(readFileSync(resolve(src,'manifest.json'),'utf8'));
const firefox=JSON.parse(readFileSync(resolve(src,'targets/firefox/manifest.json'),'utf8'));
const targets=[
  ['chrome',chrome],['edge',chrome],['brave',chrome],['opera',chrome],
  ['vivaldi',chrome],['firefox',firefox],['safari',chrome]
];
rmSync(out,{recursive:true,force:true});
for(const [name,manifest] of targets){
  const dest=resolve(out,name);
  for(const file of shared){
    mkdirSync(dirname(resolve(dest,file)),{recursive:true});
    copyFileSync(resolve(src,file),resolve(dest,file));
  }
  writeFileSync(resolve(dest,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  const references=[
    manifest.background.service_worker||manifest.background.scripts?.[0],
    manifest.content_scripts[0].js[0],
    'library.html','library.js','lib/catalog.mjs','lib/store.mjs'
  ];
  assert.deepEqual(references.slice(0,2),['background.js','content.js'],
    'Browser manifest must reference only root-relative files');
  assert(!JSON.stringify(manifest).toLowerCase().includes('minternet'),
    'No browser extension may depend on Minternet');
  assert.deepEqual(manifest.permissions.sort(),['storage','unlimitedStorage']);
  assert.equal(new Set(shared).size,shared.length);
  assert.equal(shared.length+1,7);
}
console.log('Built seven standalone 7-file extension targets: '+
  targets.map(x=>x[0]).join(', '));
