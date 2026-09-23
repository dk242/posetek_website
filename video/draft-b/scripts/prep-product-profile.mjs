import {readFile,writeFile,copyFile,access} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';

// Read-only preparation. Run after the exact-source capture. Never calls a live
// service, writes athlete records, or includes identifiers in the display file.
// Usage: node scripts/prep-product-profile.mjs /path/to/posetek-mobile-app
const mobile=process.argv[2];
if(!mobile)throw new Error('Pass the checked native source root for reference data.');
const local=resolve('public/product');
const rawPath=resolve(local,'pose-source/profile-source.json');
try{await access(rawPath);}catch{await copyFile(resolve(local,'profile.json'),rawPath);}
const raw=JSON.parse(await readFile(rawPath,'utf8'));
const sourceBytes=await readFile(resolve(local,'pose-source/current-qualified-results.json'));
const source=JSON.parse(sourceBytes);
const benchmarkBytes=await readFile(resolve(mobile,'KickAI/Stats/Benchmarks/D1Benchmarks.json'));
const references=JSON.parse(benchmarkBytes).cells['senior|unspecified'];
const reps=source.guy.reps.filter(r=>r.resultStatus?.qualified===true&&r.resultStatus?.duplicate!==true);
const valid=v=>typeof v==='number'&&Number.isFinite(v)&&v>0;
const date=r=>new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'America/Los_Angeles'}).format(new Date(r.createdAtMillis));
const matching=(a,b)=>valid(a)&&valid(b)&&Math.abs(a-b)/Math.max(a,b)<=.05;
const best=(type,field,direction=1)=>reps.filter(r=>r.drillType===type&&valid(r[field])).sort((a,b)=>direction*(b[field]-a[field]))[0];
const jump=best('jump','jump_height_m'),broad=best('broadJump','broadJumpDistance'),speed=best('sprint','totalTime',-1),agility=best('changeOfDirection','totalTime',-1),control=best('dribbling','totalTime',-1),striking=best('shooting','velocity');
const ref=id=>references[id]?.median;
const ratio=(r,field,id,lower=false)=>r&&valid(ref(id))?100*(lower?ref(id)/r[field]:r[field]/ref(id)):null;
const mean=v=>{const good=v.filter(x=>x!==null);return good.length?good.reduce((a,b)=>a+b,0)/good.length:null;};
const metric=(r,label,field,unit,scale=1,digits=2)=>r?{label,value:(r[field]*scale).toFixed(digits),unit,date:date(r),status:'Verified result'}:null;
const metrics=(...v)=>v.filter(Boolean);
const codForControl=control?reps.filter(r=>r.drillType==='changeOfDirection'&&valid(r.totalTime)&&matching(r.markerDistance,control.markerDistance)).sort((a,b)=>a.totalTime-b.totalTime)[0]:null;
const controlMultiplier=control&&codForControl?.totalTime?0.8+0.2*Math.min(codForControl.totalTime/control.totalTime,1):1;
const baseControl=ratio(control,'totalTime','dribbleTotalTime',true);
const axes=[
  {id:'power',label:'Power',score:mean([ratio(jump,'jump_height_m','verticalJumpHeight'),ratio(broad,'broadJumpDistance','broadJumpDistance')]),metrics:metrics(metric(jump,'Vertical jump','jump_height_m','cm',100,1),metric(broad,'Broad jump','broadJumpDistance','m'))},
  {id:'speed',label:'Speed',score:ratio(speed,'totalTime','sprintCompletionTime',true),metrics:metrics(metric(speed,'Sprint time','totalTime','sec'),metric(best('sprint','max_velocity'),'Peak sprint speed','max_velocity','m/s'))},
  {id:'agility',label:'Agility',score:ratio(agility,'totalTime','codTotalTime',true),metrics:metrics(metric(agility,'Change of direction','totalTime','sec'))},
  {id:'ballControl',label:'Ball Control',score:baseControl===null?null:baseControl*controlMultiplier,metrics:metrics(metric(control,'Dribbling shuttle','totalTime','sec'))},
  {id:'striking',label:'Striking',score:ratio(striking,'velocity','ballSpeed'),metrics:metrics(metric(striking,'Ball speed · best kick','velocity','mph',2.2369362921,1))},
];
const firstFocus=[...(raw.comparison?.focusAreas??[])].sort((a,b)=>a.rank-b.rank)[0];
const history=[metric(jump,'Vertical jump','jump_height_m','cm',100,1),metric(control,'Dribbling shuttle','totalTime','sec'),metric(striking,'Ball speed','velocity','mph',2.2369362921,1)].filter(Boolean).map(({label,...m})=>({test:label,...m}));
const output={
  displayName:raw.displayName,verifiedAt:source.capturedAt.slice(0,10),axes,history,
  coaching:{cue:firstFocus?.cue,sourceLabel:'Saved left/right review · one recorded pair',question:'How should I practise this cue?',answer:'Try a comfortably larger backswing with your left foot. Keep it controlled. Review the next recorded kick with your coach.'},
  note:'Source-faithful score reconstruction using the native default senior/unspecified projected reference, not an age-specific percentile or a measured D1 population. Qualified results only; best valid rep per metric. Dates are America/Los_Angeles. No longitudinal improvement claimed.',
  provenance:{capturedAt:source.capturedAt,qualifiedResultsSha256:createHash('sha256').update(sourceBytes).digest('hex'),benchmarkSha256:createHash('sha256').update(benchmarkBytes).digest('hex'),scoreModel:'AthleteStatsModels.swift + AthleteBenchmarks.swift at d09151a; default reference; matching-course dribbling multiplier; radar ceiling 130',coaching:'First ranked saved cue; illustrative follow-up response, not a live assistant output'},
};
if(!axes.some(a=>a.metrics.length))throw new Error('No qualified profile measurements available.');
await writeFile(resolve(local,'profile.json'),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({axes:axes.map(a=>({id:a.id,score:a.score,metrics:a.metrics.length})),historyRows:history.length,savedCue:Boolean(firstFocus?.cue)}));
