const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH || require.resolve('playwright', { paths: [path.resolve(__dirname, '../app')] }));
const repo=path.resolve(__dirname,'..');
const outputDir=path.join(repo,'app/node_modules/.cache/planner-entry-tests');fs.mkdirSync(outputDir,{recursive:true});
const css=fs.readFileSync(path.join(repo,'deployment/planner-entry.css'));
const js=fs.readFileSync(path.join(repo,'deployment/planner-entry.js'));
const html=(url)=>{
 const u=new URL(url,'http://local'),planner=u.pathname==='/admin/programs/personalized';
 const signedOut=u.searchParams.has('signedOut');
 return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/entry.css"><style>body{margin:0;background:#041610;color:#f7fbf9;font-family:Arial,sans-serif}.admin-shell{max-width:1312px;margin:auto;padding:24px;box-sizing:border-box}.admin-heading{margin:20px 0}a{color:#7cff18}select{min-height:44px}label{display:block;padding:8px}.admin-batch-row{padding:16px;border:1px solid #888}</style></head><body><div id="root"><div class="pt-admin">${signedOut?'':'<nav aria-label="Admin sections"><a href="/admin/programs">Programs</a> <a href="/admin/accounts/player/p/results/kick/r">Kick tools</a></nav>'}<main class="admin-shell">${planner?'<h1>Personalized fixture</h1><a id="current" href="/admin/programs?orgId=club&players=player-a&teamId=team">Current planner</a>':`<h1>${signedOut?'Sign in':'Current page'}</h1><section class="admin-heading"><label><span>Organization</span><select><option value="">Choose</option><option value="club">Vacaville United Soccer Club</option><option value="other">Other club</option></select></label></section><div class="admin-batch-row"><input id="batch-player-a" type="checkbox"><label for="batch-player-a">Player with a long name and email@example.test</label></div><div class="admin-batch-row"><input id="batch-player-b" type="checkbox" disabled><label for="batch-player-b">Waiting for evidence</label></div><button id="generate">Generate current program</button>`}</main></div></div><script>window.submissions=0;document.getElementById('generate')?.addEventListener('click',()=>window.submissions++);</script><script defer src="/entry.js" data-planner-shell="${planner?'personalized':'main'}"></script></body></html>`;
};
(async()=>{
const server=http.createServer((req,res)=>{if(req.url==='/entry.js'){res.setHeader('Content-Type','text/javascript');return res.end(js);}if(req.url==='/entry.css'){res.setHeader('Content-Type','text/css');return res.end(css);}res.setHeader('Content-Type','text/html');res.end(html(req.url));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'chrome',headless:true});
const results=[];
try {
for(const width of [1440,820,390]){
 const page=await browser.newPage({viewport:{width,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/admin/programs?orgId=club&players=player-a,player-b&teamId=team');
 const link=page.getByRole('link',{name:'Open personalized planner'});
 await link.waitFor();
 await page.waitForFunction(()=>document.querySelector('select').value==='club'&&document.getElementById('batch-player-a').checked);
 assert.equal(await page.locator('#batch-player-b').isChecked(),false);
 assert.equal(await page.evaluate(()=>window.submissions),0);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert.equal(new URL(await link.getAttribute('href'),base).searchParams.get('teamId'),'team');
 await page.screenshot({path:path.join(outputDir,'main-entry-'+width+'.png'),fullPage:true});
 await Promise.all([page.waitForNavigation(),link.click()]);
 assert.equal(new URL(page.url()).pathname,'/admin/programs/personalized');
 await page.getByRole('heading',{name:'Personalized fixture'}).waitFor();
 assert.equal(await page.locator('#pt-personalized-planner-entry').count(),0);
 await Promise.all([page.waitForNavigation(),page.locator('#current').click()]);
 await page.getByRole('link',{name:'Open personalized planner'}).waitFor();
 assert.equal(await page.locator('#batch-player-a').isChecked(),true);
 await page.locator('select').selectOption('other');
 await page.waitForFunction(()=>new URL(document.querySelector('#pt-personalized-planner-entry a').href).searchParams.get('orgId')==='other');
 await page.goto(base+'/admin/accounts/player/player-a');
 assert.equal(new URL(await page.getByRole('link',{name:'Open personalized planner'}).getAttribute('href'),base).searchParams.get('players'),'player-a');
 await page.goto(base+'/admin/accounts/player/p/results/kick/r');
 assert.equal(await page.locator('#pt-personalized-planner-entry').count(),0);
 await page.goto(base+'/organization');
 assert.equal(await page.locator('#pt-personalized-planner-entry').count(),0);
 await page.goto(base+'/admin/programs?signedOut=1');
 assert.equal(await page.locator('#pt-personalized-planner-entry').count(),0);
 assert.deepEqual(errors,[]);
 results.push({width,launcher:true,selectionRestored:true,documentNavigation:true,nonAdminUnchanged:true,errors});await page.close();
}
fs.writeFileSync(path.join(outputDir,'production-entry-test-report.json'),JSON.stringify(results,null,2));console.log(results);
}finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
