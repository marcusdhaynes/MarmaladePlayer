import {copyFileSync,mkdirSync,readFileSync,writeFileSync,rmSync,cpSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'../..');
const dest=resolve(root,'desktop/web');
execFileSync(process.execPath,[join(root,'scripts/install-mkv-decoder.mjs')],{stdio:'inherit'});
const assets=['index.html','favicon.svg','favicon.ico','favicon-32.png','assets/marmalade-icon.webp','assets/marmalade-transparent.png','assets/marmalade-maskable.png','assets/cosmic-02.svg','assets/apple-touch-icon.png','manifest.webmanifest','movie-info.css','movie-info.js','media-library.css','media-library.js',
  'public-movie-info.js','subtitle-codec.js','subtitle-archive.js','settings-layout.css','settings-layout.js','rapid-controls.css','rapid-controls.js','adaptive-brightness.js','standalone-pip.js','subtitle-compact.js','seek-preview.js','subtitle-match.js','subtitle-search.js','sw.js','relay-config.json','watch-sync-subtitles.js','mkv-decoder-io.js','mkv-asyncify-worker.js','auto-mkv-audio.js','rolling-buffer.js'];
// Include every local script, stylesheet and image referenced by the shared HTML.
const sourceHtml=readFileSync(join(root,'index.html'),'utf8');
for(const match of sourceHtml.matchAll(/\b(?:src|href)=["']\.\/([^"'?#]+)(?:\?[^"']*)?["']/g)){
  const name=match[1];
  if(!/^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+$/.test(name)||name.split('/').some(part=>part==='.'||part==='..'))throw Error('Invalid shared asset: '+name);
  if(!assets.includes(name))assets.push(name);
}
rmSync(dest,{recursive:true,force:true});
mkdirSync(dest,{recursive:true});
for(const asset of assets){mkdirSync(resolve(dest,asset,'..'),{recursive:true});copyFileSync(join(root,asset),join(dest,asset));}
cpSync(join(root,'vendor/libav-wasm'),join(dest,'vendor/libav-wasm'),{recursive:true});
let html=readFileSync(join(dest,'index.html'),'utf8');
html=html.replace(/if \('serviceWorker' in navigator && location\.protocol === 'https:'\)/,
  "if (!window.__TAURI_INTERNALS__ && 'serviceWorker' in navigator && location.protocol === 'https:')");
// This trusted bridge exists only in the packaged desktop app.
html=html.replace('</head>', '<script src="./desktop-native-window.js" defer></script></head>');
writeFileSync(join(dest,'index.html'),html);
copyFileSync(join(root,'desktop/desktop-native-window.js'),join(dest,'desktop-native-window.js'));
console.log('Bundled',assets.length,'shared MarmaladePlayer files for Windows/macOS/Linux.');
