import {bundle} from '@remotion/bundler';
import {selectComposition,renderMedia,renderStill} from '@remotion/renderer';
import {mkdir,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const mode=process.argv[2]??'stills';
const out=resolve('output/v2'); await mkdir(out,{recursive:true});
const serveUrl=await bundle({entryPoint:resolve('src/index.ts'),publicDir:resolve('public')});
let captions=[];
try {captions=JSON.parse(await readFile(resolve('public/audio-v2/captions.json'),'utf8'));} catch {}
const inputProps={audioEnabled:mode!=='stills',captions};
const composition=await selectComposition({serveUrl,id:'PoseTekDraftBV2',inputProps});
if(mode==='stills') {
 for(const frame of [60,155,183,290,410,535,635,695,810,920,1030,1090,1220,1430,1570]) {
  await renderStill({serveUrl,composition,inputProps,frame,output:resolve(out,`frame-${frame}.png`),scale:0.5});
  console.log(`Still ${frame}`);
 }
} else {
 let last=-1;
 await renderMedia({serveUrl,composition,inputProps,codec:'h264',outputLocation:resolve(out,mode==='proof'?'PoseTek-Draft-B-V2-motion-proof.mp4':'PoseTek-Draft-B-V2-Clubs-and-Coaches.mp4'),
  ...(mode==='proof'?{frameRange:[[120,359],[510,719],[810,1139]],scale:0.5}:{}),
  crf:18,x264Preset:'medium',audioCodec:'aac',audioBitrate:'192k',pixelFormat:'yuv420p',concurrency:4,
  onProgress:({progress})=>{const p=Math.floor(progress*20)*5;if(p!==last){console.log(`Render ${p}%`);last=p;}}
 });
}
