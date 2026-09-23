import {bundle} from '@remotion/bundler';
import {selectComposition,renderMedia,renderStill} from '@remotion/renderer';
import {mkdir,readFile,copyFile,cp,writeFile,rename,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

// Separate proof edition. A full-resolution master is intentionally a later,
// user-approved production step, not a side effect of this default command.
const timing=JSON.parse(await readFile('src/investor-exact-v2-timing.json','utf8'));
const mode=process.argv[2]??'stills';
if(!['stills','proof'].includes(mode))throw Error('Use stills or proof. Final production requires proof approval.');
const out=resolve('output/investor-exact-v2');await mkdir(out,{recursive:true});
const publicDir=resolve(out,'render-assets');await mkdir(publicDir,{recursive:true});
await cp(resolve('public/fonts'),resolve(publicDir,'fonts'),{recursive:true,dereference:true});
await rm(resolve(publicDir,'product/poses.json'),{force:true}); // Retire the earlier private preview staging file.
const files=['figure-8.mp4','wall-pass.mp4','investor-exact-v2/preview-poses.json','product/screen-demo.mp4','product/demo-audio.wav','investor-exact-v2/broadjump.json','investor-exact/profile.json','investor-exact/field-readiness.mp4','investor-exact/field-jump.mp4','investor-exact/processing.mp4','investor-exact/technique.json','investor-exact/sprint/poses.json','audio-investor-exact-v2/master.wav'];
for(const file of files){const dest=resolve(publicDir,file);await mkdir(resolve(dest,'..'),{recursive:true});await copyFile(resolve('public',file),dest);}
const captions=JSON.parse(await readFile('public/audio-investor-exact-v2/captions.json','utf8'));
const inputProps={audioEnabled:false,captions};
const serveUrl=await bundle({entryPoint:resolve('src/index.ts'),publicDir});
const composition=await selectComposition({serveUrl,id:'PoseTekInvestorExactV2',inputProps});
if(mode==='stills'){
 const frames=process.argv[3]?process.argv[3].split(',').map(Number):[440,535,625,650,1096,1295,1345,1410,1530,1685,1970,2090,2165,2305,2440,2605,2735,2905,2995,3100,3250,3400,3550];
 for(const frame of frames){await renderStill({serveUrl,composition,inputProps,frame,output:resolve(out,`frame-${frame}.png`),scale:process.env.V2_STILL_SCALE?Number(process.env.V2_STILL_SCALE):2/3});console.log('Still '+frame);}
}else{
 let last=-1;const render=resolve(out,'PoseTek-Investor-Exact-V2-Proof-picture.mp4');
 await renderMedia({serveUrl,composition,inputProps,codec:'h264',outputLocation:render,scale:2/3,crf:20,x264Preset:'fast',pixelFormat:'yuv420p',concurrency:4,
 onProgress:({progress})=>{const n=Math.floor(progress*20)*5;if(n!==last){console.log('Proof '+n+'%');last=n;}}});
 // Single AAC encode from original PCM keeps app countdown sample timing intact.
 const target=resolve(out,'PoseTek-Investor-Exact-V2-Timed-Proof.mp4');
 const r=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',render,'-i','public/audio-investor-exact-v2/master.wav','-i','public/product/demo-audio.wav','-filter_complex',`[2:a]adelay=${timing.original_demo.start*48000}S:all=1[native];[1:a][native]amix=inputs=2:duration=first:normalize=0,atrim=duration=${timing.duration}[a]`,'-map','0:v:0','-map','[a]','-c:v','copy','-c:a','aac','-b:a','192k','-ar','48000','-t',String(timing.duration),'-movflags','+faststart',target],{encoding:'utf8',maxBuffer:8e6});
 if(r.error||r.status!==0)throw Error(r.error?.message??r.stderr);
 await writeFile(resolve(out,'proof-mux.json'),JSON.stringify({duration:timing.duration,fps:30,width:1280,height:720,nativeStartSample:timing.original_demo.start*48000,nativeStartSeconds:timing.original_demo.start,sourceAudioUnchanged:true,method:'Silent picture + single AAC encode from sample-exact PCM inputs'},null,2)+'\n');
 console.log(target);
}
