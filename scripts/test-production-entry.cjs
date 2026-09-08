const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH || require.resolve('playwright',{paths:[path.resolve(__dirname,'../app')]}));
const root=path.resolve(__dirname,'..'),dist=path.join(root,'production-dist');
const out=path.join(root,'app/node_modules/.cache/planner-entry-tests');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const {usesRefreshedAdmin}=await import('data:text/javascript,'+encodeURIComponent(fs.readFileSync(path.join(root,'deployment/admin-routes.js'),'utf8')));
 const cases=[
 ['/admin',true],['/admin/',true],['/admin/programs',true],['/admin/programs/personalized?orgId=club&players=p',true],
 ['/admin/organizations',true],['/admin/accounts',true],['/admin/accounts/coach/c',true],['/admin/accounts/player/p',true],
 ['/admin/accounts/player/p/plan/a/workout/w',true],['/admin/drills',true],['/admin/drills/d/edit',true],
 ['/admin/analysis',false],['/admin/analysis/',false],['/admin/accounts/player/p/results',false],
 ['/admin/accounts/player/p/results/kick',false],['/admin/accounts/player/p/results/kick/r',false],
 ['/organization',false],['/athlete',false],['/administrator',false]
 ];
 const rules=fs.readFileSync(path.join(root,'netlify.toml'),'utf8').split('[[redirects]]').slice(1).map(block=>{
  const from=block.match(/from = "([^"]+)"/)[1],to=block.match(/to = "([^"]+)"/)[1];
  return {match:new RegExp('^'+from.replace(/[.]/g,'\\.').replace(/:[^/]+/g,'[^/]+').replace(/\*/g,'.*')+'$'),to};
 });
 for(const [url,expected] of cases){
  const pathname=new URL(url,'http://local').pathname;
  assert.equal(usesRefreshedAdmin(pathname),expected,url);
  assert.equal(rules.find(r=>r.match.test(pathname)).to,expected?'/personalized-app/index.html':'/index.html','Netlify route '+url);
 }
 let server,base=process.argv[2];
 if(!base){
  server=http.createServer((req,res)=>{
   const pathname=new URL(req.url,'http://local').pathname;
   let file=path.join(dist,pathname);if(!file.startsWith(dist+path.sep)){res.writeHead(400);res.end();return}
   if(!fs.existsSync(file)||!fs.statSync(file).isFile())file=path.join(dist,rules.find(r=>r.match.test(pathname)).to);
   const type={'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.png':'image/png'}[path.extname(file)]||'application/octet-stream';
   res.setHeader('Content-Type',type);res.end(fs.readFileSync(file));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
 }
 const browser=await chromium.launch({channel:'chrome',headless:true}),results=[];
 try{
  // Verify actual server rewrites and entry assets for every route, not just the planner URL.
  for(const [url,expected]of cases){
   const response=await fetch(base+url),html=await response.text();assert.equal(response.status,200,url);
   const appScript=html.match(/<script type="module" crossorigin src="([^"]+)"/)?.[1];
   assert.equal(appScript?.startsWith('/personalized-app/'),expected,'Serving entry '+url);
  }
  for(const width of [1440,820,390]){
   const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'}),errors=[],failures=[];
   page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().startsWith(base)&&r.status()>=400)failures.push(r.url())});
   await page.goto(base+'/admin/programs/personalized?orgId=club&players=p',{waitUntil:'networkidle'});
   await page.getByText('Sign in with your PoseTek account',{exact:true}).waitFor();
   assert.equal(await page.locator('script[data-planner-shell]').getAttribute('data-planner-shell'),'personalized');
   await page.locator('.portal-brand').click();await page.waitForURL('**/admin');
   assert.equal(await page.locator('script[data-planner-shell]').getAttribute('data-planner-shell'),'personalized');
   await page.goto(base+'/admin/analysis',{waitUntil:'networkidle'});
   await page.getByText('Sign in with your PoseTek account',{exact:true}).waitFor();
   // Presentation fixture in the real preserved app. No authentication or data requests are forged.
   await page.evaluate(()=>{
    const nav=document.createElement('nav');nav.className='admin-nav';nav.setAttribute('aria-label','Admin sections');
    for(const [route,icon,label]of [['drills','library_books','Drill library'],['organizations','groups','Organizations'],['accounts','supervisor_account','Monitor accounts'],['programs','auto_awesome','Generate programs'],['analysis','edit_note','Technique review']]){
     const a=document.createElement('a');a.className='quiet-button admin-nav-link'+(route==='analysis'?' active':'');a.href='/admin/'+route;
     const i=document.createElement('span');i.className='material-symbols-outlined';i.textContent=icon;
     const s=document.createElement('span');s.textContent=label;a.append(i,s);nav.append(a);
    }
    document.querySelector('.admin-header').insertBefore(nav,document.querySelector('.admin-header-right'));
   });
   await page.locator('#pt-admin-technique-shortcut').waitFor({state:'attached'});
   const metrics=await page.evaluate(()=>{
    const n=document.querySelector('.admin-nav'),s=document.querySelector('.admin-shell'),c=getComputedStyle(document.querySelector('.pt-admin'));
    return {overflow:document.documentElement.scrollWidth>innerWidth,accent:c.getPropertyValue('--admin-accent').trim(),radius:c.getPropertyValue('--admin-card-radius').trim(),nav:getComputedStyle(n).position,visibleTabs:[...n.querySelectorAll('a')].filter(a=>getComputedStyle(a).display!=='none').length,bottomPadding:parseFloat(getComputedStyle(s).paddingBottom)};
   });
   assert.equal(metrics.overflow,false,`Preserved admin overflow at ${width}px`);assert.equal(metrics.accent.toLowerCase(),'#7cff18');assert.equal(metrics.radius,'18px');
   if(width<=760){assert.equal(metrics.nav,'fixed');assert.equal(metrics.visibleTabs,4);assert.ok(metrics.bottomPadding>=116);assert.ok(await page.locator('#pt-admin-technique-shortcut').isVisible());}
   else {assert.notEqual(metrics.nav,'fixed');assert.equal(metrics.visibleTabs,5);}
   await page.screenshot({path:path.join(out,'preserved-admin-'+width+'.png'),fullPage:true});
   const programs=page.locator('.admin-nav a[href="/admin/programs"]');
   await Promise.all([page.waitForNavigation({waitUntil:'networkidle'}),programs.click()]);
   assert.equal(await page.locator('script[data-planner-shell]').getAttribute('data-planner-shell'),'personalized');
   await page.goBack({waitUntil:'networkidle'});
   assert.equal(await page.locator('script[data-planner-shell]').getAttribute('data-planner-shell'),'main');
   await page.goto(base+'/organization',{waitUntil:'networkidle'});
   assert.equal(await page.locator('#pt-admin-technique-shortcut').count(),0);
   const before=await page.locator('body').evaluate(e=>{const s=getComputedStyle(e);return [s.background,s.color,s.fontSize]});
   await page.locator('link[href*="/admin-theme-"]').evaluateAll(es=>es.forEach(e=>e.remove()));
   assert.deepEqual(await page.locator('body').evaluate(e=>{const s=getComputedStyle(e);return [s.background,s.color,s.fontSize]}),before);
   assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);
   results.push({width,...metrics,crossEntryNavigation:true,backNavigation:true,publicStylesUnchanged:true,errors});await page.close();
  }
  fs.writeFileSync(path.join(out,'production-entry-test-report.json'),JSON.stringify({base,routes:cases.length,results},null,2));console.log({base,routes:cases.length,results});
 }finally{await browser.close();server?.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
