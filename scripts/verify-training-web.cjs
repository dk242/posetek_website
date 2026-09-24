// Verify the exact built application and preserved marketing at a release URL.
const fs=require('node:fs'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const DIR=process.env.TRAINING_RELEASE_DIRECTORY || '.netlify/training-expansion/release';
const sha=b=>crypto.createHash('sha1').update(b).digest('hex');
async function main(){
 const live=process.argv.includes('--live');
 const preview=JSON.parse(fs.readFileSync(`${DIR}/web-preview.json`));
 const origin=live?'https://posetek.net':preview.deploy_url;
 const build=JSON.parse(fs.readFileSync('.netlify/application-release-build.json'));
 const marketing=JSON.parse(fs.readFileSync('.netlify/vacaville-marketing-snapshot.json'));
 const checks=[];
 async function verify(path,expected,cache){
  const r=await fetch(origin+path,{headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(30000)});assert.equal(r.status,200,path);
  const bytes=Buffer.from(await r.arrayBuffer());assert.equal(sha(bytes),expected,`Release byte mismatch: ${path}`);
  if(cache)assert.ok((r.headers.get('cache-control')||'').includes(cache),`Cache policy: ${path}`);
  checks.push({path,sha1:expected,status:r.status});
 }
 for(const path of ['/application.html','/admin/drills','/admin/programs'])await verify(path,build.application.sha);
 const pending=[...build.added.map(f=>({...f,cache:'immutable'})),...marketing.served];let cursor=0;
 await Promise.all(Array.from({length:6},async()=>{while(cursor<pending.length){const f=pending[cursor++];await verify(f.path,f.sha,f.cache);}}));
 const result={deploymentId:preview.deploy_id,origin,applicationSha:build.application.sha,checks:checks.length,marketingDeploymentId:marketing.deploymentId,allPassed:true,at:new Date().toISOString()};
 fs.writeFileSync(`${DIR}/${live?'web-live':'web-preview'}-verified.json`,JSON.stringify({result,checks},null,2));console.log(JSON.stringify(result));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
