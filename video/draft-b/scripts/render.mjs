import {bundle} from '@remotion/bundler';
import {selectComposition,renderMedia,renderStill} from '@remotion/renderer';
import {mkdir,readFile,copyFile,cp} from 'node:fs/promises';
import {resolve} from 'node:path';
const mode=process.argv[2]??'stills';
const edition=process.argv[3]??'v2';
const editions={
 product:{id:'PoseTekProductV1',audio:'audio-product-v1',name:'PoseTek-Product-Demonstration-V1',frames:[180,525,725,1050,1245,1400,1560,1670,1830,2015,2190,2430,2630,2800,2980,3180,3280,3410,3590,3850,4290],proof:[[630,1379],[1530,2009],[3210,3689]]},
 v2:{id:'PoseTekDraftBV2',audio:'audio-v2',name:'PoseTek-Draft-B-V2-Clubs-and-Coaches',frames:[60,155,183,290,410,535,635,695,810,920,1030,1090,1220,1430,1570],proof:[[120,359],[510,719],[810,1139]]},
 v3:{id:'PoseTekCoachesV3',audio:'audio-v3',name:'PoseTek-Coaches-V3',frames:[60,145,202,245,320,445,545,720,830,940,1000,1130,1340,1480],proof:[[120,299],[1410,1559]]},
 investor:{id:'PoseTekInvestorV1',audio:'audio-investor-v1',name:'PoseTek-Investor-V1',frames:[90,190,355,540,720,905,1130,1420,1700,2100,2390,2600],proof:[[210,299],[510,689],[810,989],[2010,2189],[2520,2699]]}
};
const config=editions[edition];if(!config)throw new Error('Unknown edition '+edition);
const out=resolve('output',edition); await mkdir(out,{recursive:true});
let publicDir=resolve('public');
if(edition==='product') {
 publicDir=resolve(out,'render-assets');
 await mkdir(publicDir,{recursive:true});
 await cp(resolve('public/fonts'),resolve(publicDir,'fonts'),{recursive:true});
 for(const file of ['figure-8.mp4','wall-pass.mp4','product/poses.json','product/profile.json','product/screen-demo.mp4','product/field-demo.mp4','product/demo-audio.wav','audio-product-v1/master.wav']) {
  const target=resolve(publicDir,file);await mkdir(resolve(target,'..'),{recursive:true});await copyFile(resolve('public',file),target);
 }
}
const serveUrl=await bundle({entryPoint:resolve('src/index.ts'),publicDir});
let captions=[];
try {captions=JSON.parse(await readFile(resolve('public',config.audio,'captions.json'),'utf8'));} catch {if(mode!=='stills')throw new Error('Build the edition audio before rendering');}
const inputProps={audioEnabled:mode!=='stills',captions};
const composition=await selectComposition({serveUrl,id:config.id,inputProps});
if(mode==='stills') {
 const frames=process.argv[4]?process.argv[4].split(',').map(Number):config.frames;
 for(const frame of frames) {
  if(!Number.isInteger(frame)||frame<0||frame>=composition.durationInFrames)throw new Error('Invalid still frame '+frame);
  await renderStill({serveUrl,composition,inputProps,frame,output:resolve(out,`frame-${frame}.png`),scale:0.5});
  console.log(`Still ${frame}`);
 }
} else {
 let last=-1;
 await renderMedia({serveUrl,composition,inputProps,codec:'h264',outputLocation:resolve(out,config.name+(mode==='proof'?'-motion-proof':'')+'.mp4'),
  ...(mode==='proof'?{frameRange:config.proof,scale:0.5}:{}),
  crf:18,x264Preset:'medium',audioCodec:'aac',audioBitrate:'192k',pixelFormat:'yuv420p',concurrency:4,
  onProgress:({progress})=>{const p=Math.floor(progress*20)*5;if(p!==last){console.log(`Render ${p}%`);last=p;}}
 });
 if(edition==='product'&&mode==='final'){const {finalizeProduct}=await import('./finalize-product.mjs');await finalizeProduct(resolve(out,config.name+'.mp4'));}
}
