import {bundle} from '@remotion/bundler';
import {selectComposition,renderMedia,renderStill} from '@remotion/renderer';
import {mkdir,readFile,copyFile,cp,writeFile,rename} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

// Separate proof edition. A full-resolution master is intentionally a later,
// user-approved production step, not a side effect of this default command.
const mode=process.argv[2]??'stills';
if(!['stills','proof'].includes(mode))throw Error('Use stills or proof. Final production requires proof approval.');
const out=resolve('output/investor-exact');await mkdir(out,{recursive:true});
const publicDir=resolve(out,'render-assets');await mkdir(publicDir,{recursive:true});
await cp(resolve('public/fonts'),resolve(publicDir,'fonts'),{recursive:true,dereference:true});
const files=['figure-8.mp4','wall-pass.mp4','product/poses.json','product/screen-demo.mp4','product/demo-audio.wav','investor-exact/profile.json','investor-exact/field-readiness.mp4','investor-exact/field-jump.mp4','investor-exact/processing.mp4','investor-exact/technique.json','investor-exact/sprint/poses.json','audio-investor-exact-v1/master.wav'];
for(const file of files){const dest=resolve(publicDir,file);await mkdir(resolve(dest,'..'),{recursive:true});await copyFile(resolve('public',file),dest);}
const captions=JSON.parse(await readFile('public/audio-investor-exact-v1/captions.json','utf8'));
const inputProps={audioEnabled:false,captions};
const serveUrl=await bundle({entryPoint:resolve('src/index.ts'),publicDir});
const composition=await selectComposition({serveUrl,id:'PoseTekInvestorExactV1',inputProps});
if(mode==='stills'){
 const frames=process.argv[3]?process.argv[3].split(',').map(Number):[290,450,505,560,590,621,644,659,698,1010,1053,1199,1200,1201,1450,1560,1650,1870,2200,2475,2540,2850,2930,3060,3180,3395,3480,3670,3860,4070,4170,4340,4590,4900,5070,5160];
 for(const frame of frames){await renderStill({serveUrl,composition,inputProps,frame,output:resolve(out,`frame-${frame}.png`),scale:.5});console.log('Still '+frame);}
}else{
 let last=-1;const render=resolve(out,'PoseTek-Investor-Exact-V1-Proof-picture.mp4');
 await renderMedia({serveUrl,composition,inputProps,codec:'h264',outputLocation:render,scale:2/3,crf:20,x264Preset:'fast',pixelFormat:'yuv420p',concurrency:4,
 onProgress:({progress})=>{const n=Math.floor(progress*20)*5;if(n!==last){console.log('Proof '+n+'%');last=n;}}});
 // Single AAC encode from original PCM keeps app countdown sample timing intact.
 const target=resolve(out,'PoseTek-Investor-Exact-V1-Timed-Proof.mp4');
 const r=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',render,'-i','public/audio-investor-exact-v1/master.wav','-i','public/product/demo-audio.wav','-filter_complex','[2:a]adelay=1200000S:all=1[native];[1:a][native]amix=inputs=2:duration=first:normalize=0,atrim=duration=173[a]','-map','0:v:0','-map','[a]','-c:v','copy','-c:a','aac','-b:a','192k','-ar','48000','-t','173','-movflags','+faststart',target],{encoding:'utf8',maxBuffer:8e6});
 if(r.error||r.status!==0)throw Error(r.error?.message??r.stderr);
 await writeFile(resolve(out,'proof-mux.json'),JSON.stringify({duration:173,fps:30,width:1280,height:720,nativeStartSample:1200000,nativeStartSeconds:25,sourceAudioUnchanged:true,method:'Silent picture + single AAC encode from sample-exact PCM inputs'},null,2)+'\n');
 console.log(target);
}
