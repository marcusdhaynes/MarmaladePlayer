import {copyFileSync, mkdirSync, readFileSync, writeFileSync, rmSync, cpSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve, join} from 'node:path';
const root=resolve(import.meta.dirname,'../..');
const dest=resolve(root,'mobile/www');
execFileSync(process.execPath,[join(root,'scripts/install-mkv-decoder.mjs')],{stdio:'inherit'});
const files=['index.html','favicon.svg','favicon.ico','favicon-32.png','assets/marmalade-icon.webp','assets/marmalade-transparent.png','assets/marmalade-maskable.png','assets/cosmic-02.svg','assets/apple-touch-icon.png','manifest.webmanifest','movie-info.css','movie-info.js','media-library.css','media-library.js','games.css','games.js','assets/onlyframes-official-poster.png',
  'public-movie-info.js','subtitle-codec.js','subtitle-archive.js','settings-layout.css','settings-layout.js','rapid-controls.css','rapid-controls.js','adaptive-brightness.js','standalone-pip.js','subtitle-compact.js','seek-preview.js','subtitle-match.js','subtitle-search.js','sw.js','relay-config.json','watch-sync-subtitles.js','mkv-decoder-io.js','mkv-asyncify-worker.js','auto-mkv-audio.js','rolling-buffer.js'];
// Include every local script, stylesheet and image referenced by the shared HTML.
const sourceHtml=readFileSync(join(root,'index.html'),'utf8');
for(const match of sourceHtml.matchAll(/\b(?:src|href)=["']\.\/([^"'?#]+)(?:\?[^"']*)?["']/g)){
  const name=match[1];
  if(!/^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+$/.test(name)||name.split('/').some(part=>part==='.'||part==='..'))throw Error('Invalid shared asset: '+name);
  if(!files.includes(name))files.push(name);
}
rmSync(dest,{recursive:true,force:true});
mkdirSync(dest,{recursive:true});
for(const file of files){mkdirSync(resolve(dest,file,'..'),{recursive:true});copyFileSync(join(root,file),join(dest,file));}
cpSync(join(root,'vendor/libav-wasm'),join(dest,'vendor/libav-wasm'),{recursive:true});
// No service-worker cache can outlive the installed APK: native resources are
// versioned by the app itself. Preserve the website SW unchanged at the root.
let html=readFileSync(join(dest,'index.html'),'utf8');
html=html.replace('<head>','<head>\n  <script defer src="./native-entry.js"></script>');
html=html.replace(/if \('serviceWorker' in navigator && location\.protocol === 'https:'\)/,
  "if (!window.Capacitor?.isNativePlatform?.() && 'serviceWorker' in navigator && location.protocol === 'https:')");
writeFileSync(join(dest,'index.html'),html);
copyFileSync(join(root,'mobile/native-entry.js'),join(dest,'native-entry.js'));
console.log('Prepared',files.length+1,'shared MarmaladePlayer assets for native mobile packaging.');
