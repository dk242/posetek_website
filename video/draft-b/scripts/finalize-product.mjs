import {spawnSync} from 'node:child_process';
import {access,copyFile,rename,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// Remotion's AAC path introduced two AAC frames of delay in this environment.
// Preserve the encoded picture and mux one fresh encode from the original PCM.
// The music/narration master is sample-exactly silent during the native demo.
export async function finalizeProduct(file=resolve('output/product/PoseTek-Product-Demonstration-V1.mp4')) {
 const target=resolve(file),directory=dirname(target);
 const temporary=resolve(directory,'product-finalized.mp4');
 const original=target.replace(/\.mp4$/,'-render.mp4');
 const master=resolve('public/audio-product-v1/master.wav');
 const native=resolve('public/product/demo-audio.wav');
 const args=['-hide_banner','-loglevel','error','-y','-i',target,'-i',master,'-i',native,
  '-filter_complex','[2:a]adelay=1008000S:all=1[native];[1:a][native]amix=inputs=2:duration=first:normalize=0,atrim=duration=150[a]',
  '-map','0:v:0','-map','[a]','-c:v','copy','-c:a','aac','-b:a','192k','-ar','48000','-t','150','-movflags','+faststart',temporary];
 const result=spawnSync('ffmpeg',args,{encoding:'utf8',maxBuffer:8*1024*1024});
 if(result.error||result.status!==0)throw new Error(result.error?.message??result.stderr);
 try {await access(original);} catch {await copyFile(target,original);}
 await rename(temporary,target);
 await writeFile(resolve(directory,'final-mux.json'),JSON.stringify({
  createdAt:new Date().toISOString(),method:'Video stream copy; single AAC encode from original PCM inputs',
  durationSeconds:150,videoReencoded:false,nativeStartSample:1008000,sampleRate:48000,normalization:false,
  nativeStartSeconds:21,masterSilentInterval:[21,46],originalRender:original.split(/[\\/]/).at(-1),
 },null,2)+'\n');
 console.log('Finalized product soundtrack from original PCM; picture unchanged.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await finalizeProduct();
