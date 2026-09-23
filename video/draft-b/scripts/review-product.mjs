import {spawnSync} from 'node:child_process';
import {stat} from 'node:fs/promises';
import {resolve} from 'node:path';

// Small email review copy. The 1080p master remains the primary deliverable.
const directory=resolve('output/product');
const source=resolve(directory,'PoseTek-Product-Demonstration-V1.mp4');
const target=resolve(directory,'PoseTek-Product-Demonstration-V1-Review.mp4');
const execute=(program,args)=>{
 const r=spawnSync(program,args,{encoding:'utf8',maxBuffer:8*1024*1024});
 if(r.error||r.status!==0)throw new Error(r.error?.message??r.stderr);
 return r.stdout;
};
const probe=JSON.parse(execute('ffprobe',['-v','error','-show_format','-of','json',source]));
if(Math.abs(Number(probe.format.duration)-150)>.05)throw new Error('Expected complete 150-second master');
const common=['-hide_banner','-loglevel','error','-y','-i',source,'-map','0:v:0','-vf','scale=640:360:flags=lanczos,fps=15','-c:v','libx264','-preset','slow','-b:v','100k','-pix_fmt','yuv420p','-passlogfile',resolve(directory,'review-pass')];
execute('ffmpeg',[...common,'-pass','1','-an','-f','null','-']);
execute('ffmpeg',[...common,'-pass','2','-map','0:a:0','-ac','1','-ar','24000','-c:a','aac','-b:a','40k','-movflags','+faststart',target]);
const bytes=(await stat(target)).size;
if(bytes>=3000000)throw new Error('Review copy exceeds the direct email attachment limit');
execute('ffmpeg',['-hide_banner','-loglevel','error','-i',target,'-f','null','-']);
console.log(JSON.stringify({file:target,bytes,decoded:true}));
