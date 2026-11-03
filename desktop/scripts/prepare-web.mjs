import {copyFileSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'../..');
const dest=resolve(root,'desktop/web');
const assets=['index.html','favicon.svg','assets/marmalade-icon.webp','assets/cosmic-02.svg','assets/apple-touch-icon.png','manifest.webmanifest','movie-info.css','movie-info.js',
  'public-movie-info.js','subtitle-match.js','subtitle-search.js','sw.js','watch-sync-subtitles.js'];
rmSync(dest,{recursive:true,force:true});
mkdirSync(dest,{recursive:true});
for(const asset of assets){mkdirSync(resolve(dest,asset,'..'),{recursive:true});copyFileSync(join(root,asset),join(dest,asset));}
let html=readFileSync(join(dest,'index.html'),'utf8');
html=html.replace(/if \('serviceWorker' in navigator && location\.protocol === 'https:'\)/,
  "if (!window.__TAURI_INTERNALS__ && 'serviceWorker' in navigator && location.protocol === 'https:')");
writeFileSync(join(dest,'index.html'),html);
console.log('Bundled',assets.length,'shared MarmaladePlayer files for Windows/macOS/Linux.');
