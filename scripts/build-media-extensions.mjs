/* Package a five-file standalone WebExtension for every browser without
 * duplicating source code. In the repository, catalog/store remain separate
 * testable modules; the build inlines them into the extension UI script.
 * No npm dependencies, Minternet code, native server or duplicated runtime. */
import {readFileSync,writeFileSync,mkdirSync,rmSync,copyFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const src=resolve(root,'extension');
const out=resolve(root,'dist','media-extensions');
const shared=['background.js','content.js','library.html'];
const chrome=JSON.parse(readFileSync(resolve(src,'manifest.json'),'utf8'));
const firefox=JSON.parse(readFileSync(resolve(src,'targets/firefox/manifest.json'),'utf8'));
const targets=[['chrome',chrome],['edge',chrome],['brave',chrome],
  ['opera',chrome],['vivaldi',chrome],['minternet',chrome],
  ['firefox',firefox],['safari',chrome]];
const read=path=>readFileSync(resolve(src,path),'utf8');
const unexport=source=>source.replace(/^export\s+/gm,'');
const library=read('library.js').replace(
  /^import\s*\{[\s\S]*?\}\s*from\s*['"][^'"]+['"];\s*/gm,''
);
assert(!/^import\s/m.test(library),'All library imports must be bundled');
const bundledLibrary=[
  '/* Self-contained Marmalade Library runtime: generated, do not edit. */',
  unexport(read('lib/catalog.mjs')),
  unexport(read('lib/store.mjs')),
  library
].join('\n\n');
rmSync(out,{recursive:true,force:true});
for(const [name,manifest] of targets){
  const dest=resolve(out,name);
  mkdirSync(dest,{recursive:true});
  for(const file of shared)copyFileSync(resolve(src,file),resolve(dest,file));
  writeFileSync(resolve(dest,'library.js'),bundledLibrary);
  writeFileSync(resolve(dest,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  const entry=manifest.background.service_worker||manifest.background.scripts?.[0];
  assert.equal(entry,'background.js');
  assert.deepEqual(manifest.content_scripts[0].js,['content.js']);
  assert(!JSON.stringify(manifest).toLowerCase().includes('minternet'));
  assert.deepEqual([...manifest.permissions].sort(),['storage','unlimitedStorage']);
}
console.log('Built eight independent FIVE-file extensions: '+
  targets.map(x=>x[0]).join(', '));
