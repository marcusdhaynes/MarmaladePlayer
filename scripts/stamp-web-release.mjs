// Shared static web release identity and integrity verification.
// Run from the staged web root, never from a user's browser.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,relative,isAbsolute} from 'node:path';
const hash=data=>createHash('sha256').update(data).digest('hex');
const root=process.cwd();
const assetPath=raw=>{
  if(!raw||/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(raw))return null;
  const u=new URL(raw,'https://release.invalid/');
  if(u.origin!=='https://release.invalid'||u.hash)return null;
  const path=decodeURIComponent(u.pathname.slice(1));
  if(!/^[a-z0-9_./-]+\.(?:js|css|webmanifest|svg|ico|png|webp|jpg|jpeg)$/i.test(path))return null;
  const absolute=resolve(root,path),rel=relative(root,absolute);
  if(!rel||rel.startsWith('..')||isAbsolute(rel))throw Error('Unsafe asset path: '+raw);
  return path;
};
async function stamp(commit){
  if(!/^[a-f0-9]{40}$/.test(commit))throw Error('Expected complete Git commit SHA');
  const files={};
  let html=await readFile('index.html','utf8');
  const replacements=new Map();
  for(const m of html.matchAll(/\b(?:src|href)\s*=\s*(['"])([^'"]+)\1/gi)){
    const path=assetPath(m[2]);if(!path)continue;
    const digest=files[path]??=hash(await readFile(path));
    replacements.set(m[0],m[0].replace(m[2],(m[2].startsWith('./')?'./':'')+path+'?v='+digest.slice(0,16)));
  }
  html=html.replace(/\b(?:src|href)\s*=\s*(['"])([^'"]+)\1/gi,m=>replacements.get(m)||m);
  const original=await readFile('sw.js','utf8');
  const sw=original.replace(/const CACHE\s*=\s*['"]marmalade-shell-[^'"]+['"]\s*;/,"const CACHE = 'marmalade-shell-"+commit+"';");
  if(!sw.includes("const CACHE = 'marmalade-shell-"+commit+"';"))throw Error('Unknown cache declaration');
  await writeFile('index.html',html);await writeFile('sw.js',sw);
  files['index.html']=hash(html);files['sw.js']=hash(sw);
  const info={commit,files:Object.fromEntries(Object.entries(files).sort(([a],[b])=>a.localeCompare(b,'en')))};
  await writeFile('build-info.json',JSON.stringify(info,null,2)+'\n');
  console.log('Stamped '+commit+' with '+Object.keys(files).length+' hashed assets');
}
// Validate a restored archive before allowing it to be used for recovery.
async function verifyLocal(expected){
  const manifest=JSON.parse(await readFile('build-info.json','utf8'));
  if(!/^[a-f0-9]{40}$/.test(manifest.commit)||expected&&manifest.commit!==expected)
    throw Error('Restored commit identity mismatch');
  const entries=Object.entries(manifest.files||{});
  if(!entries.length||!manifest.files['index.html']||!manifest.files['sw.js'])throw Error('Incomplete release manifest');
  for(const [path,digest] of entries){
    const absolute=resolve(root,path),rel=relative(root,absolute);
    if(!rel||rel.startsWith('..')||isAbsolute(rel)||! /^[a-f0-9]{64}$/.test(digest))throw Error('Invalid manifest entry: '+path);
    if(hash(await readFile(absolute))!==digest)throw Error('Restored asset mismatch: '+path);
  }
  const html=await readFile('index.html','utf8');
  for(const match of html.matchAll(/\b(?:src|href)\s*=\s*(['"])([^'"]+)\1/gi)){
    const path=assetPath(match[2]);if(!path)continue;
    if(!manifest.files[path]||new URL(match[2],'https://release.invalid/').searchParams.get('v')!==manifest.files[path].slice(0,16))
      throw Error('Incorrect versioned reference: '+path);
  }
  const sw=await readFile('sw.js','utf8');
  if(!sw.includes("const CACHE = 'marmalade-shell-"+manifest.commit+"';"))throw Error('Incorrect restored cache identity');
  console.log('Verified local release '+manifest.commit+' and '+entries.length+' asset hashes');
  return manifest;
}
async function verify(raw){
  const base=new URL(raw.endsWith('/')?raw:raw+'/');
  if(base.protocol!=='https:')throw Error('HTTPS deployment required');
  const local=await verifyLocal();
  const fetchBytes=async path=>{
    const url=new URL(path,base);url.searchParams.set('v',path==='index.html'||path==='sw.js'||path==='build-info.json'?local.commit:local.files[path].slice(0,16));
    const r=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(15000)});
    if(!r.ok)throw Error(path+' HTTP '+r.status);
    return Buffer.from(await r.arrayBuffer());
  };
  for(let attempt=1;attempt<=8;attempt++){
    try{
      const live=JSON.parse((await fetchBytes('build-info.json')).toString('utf8'));
      if(live.commit!==local.commit||JSON.stringify(live.files)!==JSON.stringify(local.files))throw Error('Live manifest differs from staged manifest');
      const entries=Object.entries(local.files);
      for(let i=0;i<entries.length;i+=6)await Promise.all(entries.slice(i,i+6).map(async([path,digest])=>{
        if(hash(await fetchBytes(path))!==digest)throw Error('Live asset mismatch: '+path);
      }));
      console.log('Verified '+local.commit+' and '+entries.length+' live asset hashes at '+base.href);return;
    }catch(error){
      console.error('Verification attempt '+attempt+': '+error.message);
      if(attempt===8)throw error;
      await new Promise(r=>setTimeout(r,5000));
    }
  }
}
const [mode,value]=process.argv.slice(2);
if(mode==='stamp')await stamp(value||'');
else if(mode==='verify')await verify(value||'');
else if(mode==='verify-local')await verifyLocal(value||'');
else throw Error('Usage: stamp-web-release.mjs stamp COMMIT | verify-local [COMMIT] | verify HTTPS_URL');
