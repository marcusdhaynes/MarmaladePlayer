import {copyFileSync, mkdirSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {resolve, join} from 'node:path';
const root=resolve(import.meta.dirname,'../..');
const dest=resolve(root,'mobile/www');
const files=['index.html','favicon.svg','favicon.ico','favicon-32.png','assets/marmalade-icon.webp','assets/marmalade-transparent.png','assets/marmalade-maskable.png','assets/cosmic-02.svg','assets/apple-touch-icon.png','manifest.webmanifest','movie-info.css','movie-info.js',
  'public-movie-info.js','subtitle-match.js','subtitle-search.js','sw.js','watch-sync-subtitles.js'];
rmSync(dest,{recursive:true,force:true});
mkdirSync(dest,{recursive:true});
for(const file of files){mkdirSync(resolve(dest,file,'..'),{recursive:true});copyFileSync(join(root,file),join(dest,file));}
// No service-worker cache can outlive the installed APK: native resources are
// versioned by the app itself. Preserve the website SW unchanged at the root.
let html=readFileSync(join(dest,'index.html'),'utf8');
html=html.replace('<head>','<head>\n  <script defer src="./native-entry.js"></script>');
html=html.replace(/if \('serviceWorker' in navigator && location\.protocol === 'https:'\)/,
  "if (!window.Capacitor?.isNativePlatform?.() && 'serviceWorker' in navigator && location.protocol === 'https:')");
writeFileSync(join(dest,'index.html'),html);
copyFileSync(join(root,'mobile/native-entry.js'),join(dest,'native-entry.js'));
console.log('Prepared',files.length+1,'shared MarmaladePlayer assets for native mobile packaging.');
