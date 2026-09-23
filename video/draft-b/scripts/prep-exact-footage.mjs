import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

// This edition deliberately leaves every source and previous derivative intact.
const out=resolve('public/investor-exact');
await mkdir(out,{recursive:true});
const run=(args)=>{const r=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y',...args],{encoding:'utf8',maxBuffer:8e6});if(r.status!==0)throw Error(r.stderr);};
const sha=async(file)=>{const h=createHash('sha256');for await(const b of createReadStream(file))h.update(b);return h.digest('hex');};
const source=resolve('public/product/field-original.mov');
const sourceHash=await sha(source);
if(sourceHash!=='07562cc5ce9a5b65d8e7a61db42e7889efba55ef18d103f0a7c03521c3828775')throw Error('Original field recording changed');
const oneOnset=35.526,screenStart=21.5,airborne=25.328333;
const targetTakeoff=oneOnset-screenStart+1;
const correctedStart=airborne-targetTakeoff;
const transition=10;
const filter='scale=1080:1920:flags=lanczos,zscale=t=linear:npl=1000,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=mobius:desat=0.5,zscale=t=bt709:m=bt709:r=tv,format=yuv420p,eq=gamma=1.05,setsar=1,fps=30';
for(const [file,start,duration] of [['field-readiness.mp4',11.75,transition],['field-jump.mp4',correctedStart+transition,9]]){
 run(['-ss',String(start),'-i',source,'-t',String(duration),'-map','0:v:0','-an','-vf',filter,'-c:v','libx264','-crf','18','-preset','fast','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709','-map_metadata','-1','-movflags','+faststart',resolve(out,file)]);
 console.log('Prepared '+file);
}
const profile=JSON.parse(await readFile('public/product/profile.json','utf8'));
run(['-ss','40','-i',resolve('public/product/screen.mp4'),'-t','3','-map','0:v:0','-an','-c:v','libx264','-crf','18','-preset','fast','-movflags','+faststart',resolve(out,'processing.mp4')]);
profile.displayName='Example player';
delete profile.coaching;
await writeFile(resolve(out,'profile.json'),JSON.stringify(profile,null,2)+'\n');
await writeFile(resolve(out,'footage-timing.json'),JSON.stringify({
 schema:1,sourceSha256:sourceHash,screenStart,oneOnsetSeconds:oneOnset,
 firstClearAirborneSourceSeconds:airborne,correctedFieldSourceStart:correctedStart,
 takeoffDemoSeconds:targetTakeoff,expectedOutputFrame:Math.round(targetTakeoff*30),
 toleranceSeconds:1/30,normalSpeed:1,frameRate:30,
 editorialTransition:{demoSeconds:transition,sourceScreenSeconds:screenStart+transition,reason:'Scheduled Recording screen transition. The new field shot is separately timed to the countdown; the earlier readiness alignment is not represented as continuous synchronization.'},
 cuts:[{file:'field-readiness.mp4',start:11.75,end:21.75},{file:'field-jump.mp4',start:correctedStart+transition,end:correctedStart+19}],
 audio:'Unchanged product/demo-audio.wav; original prompts/countdown/result. No music or narrator during the entire 25-second demonstration.',
 validation:'Source event times measured from native video and countdown waveform; first airborne derivative/output frame must also be visually checked.'
},null,2)+'\n');
