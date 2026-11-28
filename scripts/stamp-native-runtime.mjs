// Deterministic identity and integrity for native web payloads. This is not
// a claim that signed platform installers are byte-for-byte reproducible.
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,readdirSync,lstatSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
const manifestName='native-build-info.json';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function inventory(dir,prefix=''){
 const files={};
 for(const name of readdirSync(dir).sort()){
  const relative=prefix+name,path=join(dir,name),stat=lstatSync(path);
  if(stat.isSymbolicLink())throw Error('Unexpected native payload symlink: '+relative);
  if(stat.isDirectory())Object.assign(files,inventory(path,relative+'/'));
  else if(stat.isFile()&&relative!==manifestName)files[relative]=digest(readFileSync(path));
  else if(!stat.isFile())throw Error('Unexpected native payload entry: '+relative);
 }
 return files;
}
export function stampNativeRuntime(root,dest,shell){
 if(!['desktop','mobile'].includes(shell))throw Error('Unknown native shell');
 let commit='';
 try{commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{}
 if(!/^[a-f0-9]{40}$/.test(commit))throw Error('Native packaging requires a Git checkout for verifiable build identity');
 const index=join(dest,'index.html');
 let html=readFileSync(index,'utf8');
 html=html.replace(/\n<meta name="marmalade-native-build" content="[a-f0-9]{40}">\n/g,'\n')
          .replace(/\n<meta name="marmalade-native-shell" content="(?:desktop|mobile)">\n/g,'\n');
 if(!/<head\b[^>]*>/i.test(html))throw Error('Missing native HTML head');
 html=html.replace(/<head\b[^>]*>/i,tag=>tag+'\n<meta name="marmalade-native-build" content="'+commit+'">\n<meta name="marmalade-native-shell" content="'+shell+'">\n');
 writeFileSync(index,html);
 const info={format:1,commit,shell,files:inventory(dest)};
 writeFileSync(join(dest,manifestName),JSON.stringify(info,null,2)+'\n');
 return verifyNativeRuntime(dest,commit,shell);
}
export function verifyNativeRuntime(dest,expected,shell){
 const info=JSON.parse(readFileSync(join(dest,manifestName),'utf8'));
 if(info.format!==1||! /^[a-f0-9]{40}$/.test(info.commit)||info.commit!==expected||info.shell!==shell)throw Error('Native build identity mismatch');
 const html=readFileSync(join(dest,'index.html'),'utf8');
 if(!html.includes('<meta name="marmalade-native-build" content="'+expected+'">')||!html.includes('<meta name="marmalade-native-shell" content="'+shell+'">'))throw Error('Native HTML identity mismatch');
 const actual=inventory(dest);
 if(JSON.stringify(actual)!==JSON.stringify(info.files))throw Error('Native runtime asset hash mismatch');
 if(!actual['vendor/libav-wasm/libav.wasm']||!actual['index.html'])throw Error('Native runtime missing core files');
 console.log('Verified '+shell+' runtime '+expected+' with '+Object.keys(actual).length+' asset hashes');
 return info;
}
