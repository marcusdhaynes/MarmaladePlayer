import {copyFileSync,mkdirSync,readFileSync,writeFileSync,rmSync,cpSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'../..');
const dest=resolve(root,'desktop/web');
execFileSync(process.execPath,[join(root,'scripts/install-mkv-decoder.mjs')],{stdio:'inherit'});
const assets=['index.html','favicon.svg','favicon.ico','favicon-32.png','assets/marmalade-icon.webp','assets/marmalade-transparent.png','assets/marmalade-maskable.png','assets/cosmic-02.svg','assets/apple-touch-icon.png','manifest.webmanifest','movie-info.css','movie-info.js',
  'public-movie-info.js','subtitle-codec.js','subtitle-archive.js','settings-layout.css','settings-layout.js','rapid-controls.css','rapid-controls.js','subtitle-compact.js','seek-preview.js','subtitle-match.js','subtitle-search.js','sw.js','watch-sync-subtitles.js','auto-mkv-audio.js'];
rmSync(dest,{recursive:true,force:true});
mkdirSync(dest,{recursive:true});
for(const asset of assets){mkdirSync(resolve(dest,asset,'..'),{recursive:true});copyFileSync(join(root,asset),join(dest,asset));}
cpSync(join(root,'vendor/libav-wasm'),join(dest,'vendor/libav-wasm'),{recursive:true});
let html=readFileSync(join(dest,'index.html'),'utf8');
html=html.replace(/if \('serviceWorker' in navigator && location\.protocol === 'https:'\)/,
  "if (!window.__TAURI_INTERNALS__ && 'serviceWorker' in navigator && location.protocol === 'https:')");
writeFileSync(join(dest,'index.html'),html);
console.log('Bundled',assets.length,'shared MarmaladePlayer files for Windows/macOS/Linux.');
