import {mkdir,readFile,writeFile,copyFile,access} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const project=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const root=resolve(project,'../..');
const pub=resolve(project,'public');
await mkdir(resolve(pub,'fonts'),{recursive:true});
const receipts=[];
for(const [name,original,expected] of [
 ['figure-8','figure-8-1788831834526194.mp4','d20f8dd70a97e23cb461809977ac19e9cdfb4708acf442fc219a033cf52eac05'],
 ['wall-pass','wall-pass-1788468661750095.mov','cf5857cc05906e8421bb2caab164941bb6e5666e98e8888869d25ea8566628f5']
]) {
 const source=resolve(root,'.netlify/drill-demo-source',original);
 let input=source,quality='original';
 try {await access(source);} catch {input=resolve(root,'app/src/pages/home/product/media',name+'.mp4');quality='website derivative';}
 const sha=createHash('sha256').update(await readFile(input)).digest('hex');
 if(quality==='original'&&sha!==expected) throw new Error('Original video hash changed: '+name);
 const r=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',input,'-an','-vf','scale=1080:1920:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1,fps=30','-c:v','libx264','-crf','18','-preset','medium','-movflags','+faststart',resolve(pub,name+'.mp4')],{stdio:'inherit'});
 if(r.status!==0) throw new Error('Video normalization failed: '+name);
 receipts.push({sourceQuality:quality,normalizedVideo:name+'.mp4',sourceSha256:sha});
}
await copyFile(resolve(root,'app/src/pages/home/product/media/figure-8.jpg'),resolve(pub,'figure-8.jpg'));
for(const [family,weight,file] of [['Barlow Condensed','700','barlow-700.woff2'],['Inter','400','inter-400.woff2'],['Inter','600','inter-600.woff2'],['IBM Plex Mono','400','plex-400.woff2']]) {
 const css=await fetch(`https://fonts.googleapis.com/css2?family=${family.replaceAll(' ','+')}:wght@${weight}&display=swap`,{headers:{'User-Agent':'Mozilla/5.0 Chrome/130.0.0.0 Safari/537.36'}}).then(r=>r.text());
 const urls=[...css.matchAll(/url\((https:[^)]+)\)/g)];
 if(!urls.length) throw new Error(`Font unavailable: ${family}`);
 const url=urls.at(-1)[1];
 const response=await fetch(url); if(!response.ok) throw new Error('Font fetch failed');
 await writeFile(resolve(pub,'fonts',file),Buffer.from(await response.arrayBuffer()));
}
await writeFile(resolve(pub,'asset-receipt.json'),JSON.stringify(receipts,null,2));
console.log('Prepared both approved drill videos and local brand fonts.');
