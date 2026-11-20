// Verify the pinned FFmpeg/WASM decoder is really staged in the build
// instead of shipping HTML/404 placeholders that fail after the user clicks Play.
import {readFileSync,statSync} from 'node:fs';
import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'..','vendor/libav-wasm');
const expected=[
  ['index.js',1000],['worker.js',1000],
  ['libav.wasm',100000],['libav-jspi.wasm',100000]
];
for(const [name,minimum] of expected){
  const location=join(root,name);
  const size=statSync(location).size;
  if(size<minimum)throw new Error(`Invalid decoder asset ${name} (${size} bytes)`);
  if(name.endsWith('.wasm')){
    const contents=readFileSync(location);
    if(contents.subarray(0,4).toString('hex')!=='0061736d')
      throw new Error(`MKV decoder ${name} is not a WebAssembly binary`);
  }
  console.log('MKV decoder verified:',name,size,'bytes');
}
