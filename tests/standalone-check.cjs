const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),{pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'/Users/maxima/.npm/_npx/31e32ef8478fbf80/node_modules/playwright');
const STANDALONE=path.resolve(__dirname,'..','..','..','06_GitHub待提交包','standalone','index.html');
const REPORT=path.resolve(__dirname,'..','..','..','04_测试证据','standalone-report.json');

/* 单文件版验收：必须完全离线可用、图片真实加载、走完八步、无外部请求、无凭据 */
(async()=>{
 const report={checkedAt:new Date().toISOString(),checks:[],errors:[],externalRequests:[]};
 const ok=(id,detail)=>report.checks.push({id,result:'PASS',detail});
 const b=await chromium.launch({headless:true,
  executablePath:process.env.CHROMIUM_PATH||'/Users/maxima/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell'});
 const ctx=await b.newContext({viewport:{width:390,height:844},offline:true});
 const p=await ctx.newPage();
 p.on('pageerror',e=>report.errors.push(e.message));
 p.on('request',r=>{if(/^https?:/.test(r.url()))report.externalRequests.push(r.url());});
 try{
  assert.ok(fs.existsSync(STANDALONE),'单文件不存在：'+STANDALONE);
  await p.goto(pathToFileURL(STANDALONE).href);
  await p.waitForFunction(()=>[...document.images].every(i=>i.complete&&i.naturalWidth>0),null,{timeout:15000});
  ok('SA-offline','离线上下文可打开单文件');
  const imgs=await p.evaluate(()=>[...document.images].map(i=>({w:i.naturalWidth,isData:i.src.slice(0,5)==='data:'})));
  assert.ok(imgs.length>0&&imgs.every(i=>i.w>0&&i.isData),'图片未全部以 data URI 加载：'+JSON.stringify(imgs));
  ok('SA-images','首页 '+imgs.length+' 张图片全部内联且 naturalWidth>0');
  assert.equal(await p.locator('.entry').count(),2,'首页应有两个入口');
  /* 走完八步 */
  const c=async a=>{await p.locator('[data-action='+a+']').first().click();await p.waitForTimeout(80);};
  await c('w-start');
  await p.locator('[data-action=w-people][data-value="2"]').click();await c('w-people-confirm');
  await p.locator('[data-action=w-budget-mode][data-value="total"]').click();
  await p.locator('[data-action=w-budget-amount][data-value="8000"]').click();await c('w-budget-confirm');
  await c('w-ext-confirm');
  await p.locator('[data-action=w-taste][data-value="香脆"]').click();await c('w-taste-confirm');
  if(await p.locator('[data-action=w-dir]').count())await p.locator('[data-action=w-dir]').first().click();else await c('w-dir-any');
  await p.locator('[data-action=w-novelty][data-value="swap"]').click();await c('w-novelty-confirm');
  await p.locator('[data-action=w-plan][data-value="3"]').click();await c('w-plan-confirm');
  await c('w-submit');
  const st=await p.evaluate(()=>McApp.getState());
  assert.equal(st.completed,true,'单文件版应能走完八步');
  assert.equal(await p.locator('.meal-card').count(),1,'应生成整餐卡');
  const reasons=await p.locator('.reason-line').count();
  assert.ok(reasons>0,'应给出可追溯解释');
  ok('SA-flow','离线走完八步并生成整餐，含 '+reasons+' 条解释');
  /* 每一页场景图都必须真实加载 */
  const perPage=[];
  for(let step=1;step<=8;step++){
   await p.goto(pathToFileURL(STANDALONE).href);
   await c('w-start');
   const seq=[['w-people','2'],['w-people-confirm',null],['w-budget-mode','total'],['w-budget-amount','8000'],
    ['w-budget-confirm',null],['w-ext-confirm',null],['w-taste','香脆'],['w-taste-confirm',null],
    ['w-dir',null],['w-novelty','swap'],['w-novelty-confirm',null],['w-plan','1'],['w-plan-confirm',null]];
   for(let i=0;i<step-1;i++){
    const [act,val]=seq[i];
    if(val!==null&&await p.locator(`[data-action=${act}][data-value="${val}"]`).count())
     await p.locator(`[data-action=${act}][data-value="${val}"]`).click();
    else if(act==='w-dir'&&await p.locator('[data-action=w-dir]').count())
     await p.locator('[data-action=w-dir]').first().click();
    else await c(act);
    await p.waitForTimeout(70);
   }
   await p.waitForFunction(()=>[...document.images].every(i=>i.complete&&i.naturalWidth>0),null,{timeout:10000});
   const w=await p.evaluate(()=>[...document.images].map(i=>i.naturalWidth));
   assert.ok(w.length>0&&w.every(x=>x>0),'第 '+step+' 题图片未加载：'+JSON.stringify(w));
   perPage.push(step+':'+w.join('/'));
  }
  ok('SA-perpage','八页场景图均真实加载 → '+perPage.join('  '));
  assert.deepEqual(report.externalRequests,[],'单文件版不应发起任何外部请求');
  ok('SA-selfcontained','零外部网络请求');
  assert.deepEqual(report.errors,[],'存在 JS 错误：'+report.errors.join(' | '));
  ok('SA-noerror','无 JS 运行时错误');
  report.status='PASS';
 }catch(e){report.status='FAIL';report.failure=e.message;}
 finally{
  fs.writeFileSync(REPORT,JSON.stringify(report,null,2));
  console.log(JSON.stringify({status:report.status,checks:report.checks.length,failure:report.failure||null},null,2));
  if(report.failure)console.error(report.failure);
  await b.close();
  process.exitCode=report.status==='PASS'?0:1;
 }
})();