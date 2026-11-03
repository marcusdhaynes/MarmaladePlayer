import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../..');
const cfg=JSON.parse(readFileSync(resolve(root,'mobile/capacitor.config.json'),'utf8'));
if(cfg.webDir!=='www'||!cfg.appId)throw Error('Invalid Capacitor native configuration');
const html=readFileSync(resolve(root,'index.html'),'utf8');
for(const name of ['video','localCopyInput','copyLink'])if(!html.includes(name))
  throw Error('Shared player is missing '+name);
const script=readFileSync(resolve(root,'mobile/scripts/patch-native.mjs'),'utf8');
if(!script.includes('RECORD_AUDIO')||!script.includes('NSMicrophoneUsageDescription'))
  throw Error('Missing native media permissions');
const assets=['index.html','movie-info.js','public-movie-info.js','watch-sync-subtitles.js'];
for(const a of assets)if(!existsSync(resolve(root,a)))throw Error('Missing shared asset '+a);
console.log('PASS: Android/iOS use the same source, player controls and media permission setup.');
