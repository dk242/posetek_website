import {bundle} from '@remotion/bundler';
import {selectComposition,renderMedia,renderStill} from '@remotion/renderer';
import {mkdir,readFile,copyFile,cp,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const timing=JSON.parse(await readFile('src/investor-exact-v3-timing.json','utf8'));
const mode=process.argv[2]??'stills';
if(!['stills','proof'].includes(mode))throw Error('Use stills or proof. Master follows creative approval.');
const out=resolve('output/investor-exact-v3');await mkdir(out,{recursive:true});
const publicDir=resolve(out,'render-assets');await mkdir(publicDir,{recursive:true});
await cp(resolve('public/fonts'),resolve(publicDir,'fonts'),{recursive:true,dereference:true});
// Sanitized render allowlist excludes private audit records, movies and IDs.
const files=['figure-8.mp4','wall-pass.mp4','investor-exact-v2/preview-poses.json','product/screen-demo.mp4','investor-exact-v2/broadjump.json','investor-exact/profile.json','investor-exact/field-readiness.mp4','investor-exact/field-jump.mp4','investor-exact/technique.json','investor-exact-v3/cod.json'];
for(const file of files){const dest=resolve(publicDir,file);await mkdir(resolve(dest,'..'),{recursive:true});await copyFile(resolve('public',file),dest);}
const captions=JSON.parse(await readFile('public/audio-investor-exact-v3/captions.json','utf8'));
const inputProps={audioEnabled:false,captions};
const serveUrl=await bundle({entryPoint:resolve('src/index.ts'),publicDir});
const composition=await selectComposition({serveUrl,id:'PoseTekInvestorExactV3',inputProps});
if(mode==='stills'){
 const frames=process.argv[3]?process.argv[3].split(',').map(Number):[350,364,374,375,620,634,644,645,1096,1190,1203,1215,1273,1280,1287,1340,1394,1395,1437,1446,1455,1575,1606,1614,1668,1757,1848,2019,2100,2348,2382,2390,2600,2730,2900,3100,3370,3548,3558];
 const scale=Number(process.env.V3_STILL_SCALE??2/3);
 for(const frame of frames){await renderStill({serveUrl,composition,inputProps,frame,output:resolve(out,`frame-${frame}${scale===1?'-1080':''}.png`),scale});console.log('Still '+frame);}
}else{
 let last=-1;const picture=resolve(out,'PoseTek-Investor-Exact-V3-Proof-picture.mp4');
 await renderMedia({serveUrl,composition,inputProps,codec:'h264',outputLocation:picture,scale:2/3,crf:20,x264Preset:'fast',pixelFormat:'yuv420p',concurrency:4,
  onProgress:({progress})=>{const n=Math.floor(progress*20)*5;if(n!==last){console.log('Proof '+n+'%');last=n;}}});
 const target=resolve(out,'PoseTek-Investor-Exact-V3-Timed-Proof.mp4');
 const r=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',picture,'-i','public/audio-investor-exact-v3/master.wav','-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','192k','-ar','48000','-t',String(timing.duration),'-movflags','+faststart',target],{encoding:'utf8',maxBuffer:8e6});
 if(r.error||r.status!==0)throw Error(r.error?.message??r.stderr);
 await writeFile(resolve(out,'proof-mux.json'),JSON.stringify({duration:119,fps:30,width:1280,height:720,nativeStartSample:timing.music.native_start_sample,method:'Silent picture + one AAC encode of fully mixed original PCM stems',musicContinuous:true},null,2)+'\n');
 console.log(target);
}
