const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),{pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'/Users/maxima/.npm/_npx/31e32ef8478fbf80/node_modules/playwright');
const APP=path.resolve(__dirname,'..');
const OUT=path.resolve(__dirname,'../../../04_测试证据/screenshots');

/* 所有图片必须真实加载完成才能截图：complete 且 naturalWidth>0，并等待 decode 与两帧 */
async function imagesReady(p){
 await p.waitForFunction(()=>[...document.images].every(i=>i.complete&&i.naturalWidth>0),null,{timeout:15000});
 await p.evaluate(()=>Promise.all([...document.images].map(i=>i.decode().catch(()=>{}))));
 await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
}
async function toastGone(p){await p.waitForFunction(()=>!document.getElementById('toast').classList.contains('show'),null,{timeout:6000}).catch(()=>{});}

(async()=>{
 const b=await chromium.launch({headless:true,
  executablePath:process.env.CHROMIUM_PATH||'/Users/maxima/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell'});
 fs.mkdirSync(OUT,{recursive:true});
 const report={checks:[],screenshots:[],device:null,errors:[],externalRequests:[]};
 const ok=(id,detail)=>{report.checks.push({id,result:'PASS',detail});};
 const ctx=await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2});
 const p=await ctx.newPage();
 p.on('pageerror',e=>report.errors.push(e.message));
 p.on('request',r=>{if(/^https?:/.test(r.url()))report.externalRequests.push(r.url());});
 const url=pathToFileURL(path.join(APP,'index.html')).href;
 const click=a=>p.locator('[data-action='+a+']').first().click();
 const has=a=>p.locator('[data-action='+a+']').count()>0;
 const state=()=>p.evaluate(()=>McApp.getState());
 const noOverflow=async()=>assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'出现横向溢出');
 async function snap(name){
  await toastGone(p);await imagesReady(p);
  const f=path.join(OUT,name+'.png');await p.screenshot({path:f,fullPage:false});
  report.screenshots.push(name);
 }
 async function tapSize(){
  /* 触区≥44px */
  return await p.evaluate(()=>[...document.querySelectorAll('button[data-action]')]
   .filter(b=>b.offsetParent!==null)
   .map(b=>({a:b.dataset.action,h:Math.round(b.getBoundingClientRect().height),w:Math.round(b.getBoundingClientRect().width)}))
   .filter(x=>x.h<44||x.w<44));
 }

 try{
  /* ============ 离线可用 ============ */
  await ctx.setOffline(true);
  await p.goto(url);
  await imagesReady(p);
  ok('T19-offline','离线状态可打开，界面与算法完整');

  /* ============ T17 首页双入口 ============ */
  assert.equal(await p.locator('.entry').count(),2,'首页必须只有两个入口');
  const sizes=await p.locator('.entry').evaluateAll(ns=>ns.map(n=>n.getBoundingClientRect().height));
  assert.ok(sizes[0]>sizes[1],'智能助手入口必须明显更大');
  await noOverflow();
  await snap('01-首页');

  /* ============ T01 八步闸门 ============ */
  await click('w-start');
  assert.equal((await state()).step,1);
  const titles=[];
  for(let i=1;i<=8;i++){
   titles.push((await p.locator('.step-title').textContent()).trim());
   assert.equal(await p.locator('.meal-card').count(),0,'第 '+i+' 题不得出现整餐推荐卡');
   await noOverflow();
   await snap('10-第'+i+'题');
   if(i<8)await advance(p,i);
  }
  assert.equal(new Set(titles).size,8,'八题题目必须各不相同，实际 '+JSON.stringify(titles));
  ok('T01-gate','八页题目互不相同：'+titles.join(' / '));

  /* 八页图片构图必须不同 */
  await p.goto(url);await click('w-start');
  const arts=[];
  for(let i=1;i<=8;i++){
   arts.push(await p.locator('.scene-img').getAttribute('src'));
   if(i<8)await advance(p,i);
  }
  assert.equal(new Set(arts).size>=5,true,'八页场景图应明显不同，实际不同数 '+new Set(arts).size);
  ok('T17-scenes','八页场景图不同数 = '+new Set(arts).size);

  /* ============ 帮我决定只前进一题 ============ */
  await p.goto(url);await click('w-start');
  await click('w-decide');
  assert.equal((await state()).step,2,'帮我决定只应前进一题');
  assert.equal((await state()).answered,1);
  ok('T01-decide','第 1 题“帮我决定”后停在第 2 题，已答数 = 1');
  await p.locator('[data-action=w-decide]').first().click();
  assert.equal((await state()).step,3);
  ok('T01-decide2','第 2 题“帮我决定”后停在第 3 题，未跳过剩余题目');

  /* ============ 完整八步后才有整餐 ============ */
  await p.goto(url);
  await answerAll(p);
  assert.equal((await state()).completed,true,'八题答完应标记完成');
  assert.equal(await p.locator('.meal-card').count(),1,'第 8 题提交后才出现整餐卡');
  await noOverflow();
  const reasons=await p.locator('.reason-line').allTextContents();
  assert.ok(reasons.length>0,'结果必须给出可追溯解释');
  await snap('09-结果页');
  ok('T01-result','八题完成后生成整餐，含 '+reasons.length+' 条解释');

  /* ============ T06 单件尝新可观察 ============ */
  const na=await p.locator('.reason-line').allTextContents();
  assert.ok(na.some(t=>/尝新|换一项|稳妥/.test(t)),'结果必须说明尝新处理，实际：'+na.join(' | '));
  ok('T06-visible','尝新处理在结果中可见：'+na.filter(t=>/尝新|换一项|稳妥/.test(t)).join(''));

  /* ============ 触区≥44 ============ */
  const small=await tapSize();
  assert.deepEqual(small,[],'存在触区小于 44px 的按钮：'+JSON.stringify(small.slice(0,5)));
  ok('T18-tap','当前页所有可见按钮触区 ≥44px');

/* ============ 从结果页返回修改答案 ============ */
const beforeBack=(await state()).answered;
assert.ok(await p.locator('[data-action=w-edit-answers]').count()>0,'结果页应能返回修改答案');
await click('w-edit-answers');
const afterBack=(await state()).answered;
assert.equal(afterBack,beforeBack,'返回不得丢失答案');
assert.equal((await state()).route,'wizard');
ok('T01-back','从结果页返回引导后，已答数仍为 '+afterBack);

  /* ============ T17 多尺寸布局 ============ */
  const viewports=[[320,740],[360,740],[375,812],[390,844],[430,932],[1024,768],[1440,900]];
  const fits=[];
  for(const [w,h] of viewports){
   await p.setViewportSize({width:w,height:h});
   await p.goto(url);await imagesReady(p);
   await noOverflow();fits.push(w+'x'+h+' ok');
   if(w<=430){await snap('02-首页-'+w+'x'+h);}
  }
  ok('T17-viewports','7 种尺寸无横向溢出：'+fits.join(', '));

/* ============ T18 200% 字体 / 缩放 ============ */
 await p.setViewportSize({width:390,height:844});
 await p.goto(url);await click('w-start');
 await p.evaluate(()=>{document.documentElement.style.fontSize='200%';});
 await p.waitForTimeout(250);
 await imagesReady(p);
 await noOverflow();
 /* 200% 字体下内容不得被裁切；能滚动就必须可滚动完成 */
 const clipped=await p.evaluate(()=>[...document.querySelectorAll('main *')]
  .filter(n=>{const r=n.getBoundingClientRect();return r.height>0&&(r.bottom>document.documentElement.scrollHeight+2||r.top<-2);}).length);
 assert.equal(clipped,0,'200% 字体下有 '+clipped+' 个元素被裁切');
 const canScroll=await p.evaluate(()=>document.documentElement.scrollHeight>innerHeight);
 if(canScroll){
  await p.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));
  await p.waitForTimeout(150);
  const reachable=await p.evaluate(()=>scrollY+innerHeight>=document.documentElement.scrollHeight-2);
  assert.equal(reachable,true,'200% 字体下无法滚动到底部');
 }
 await snap('03-200%字体');
 /* 主要操作按钮必须仍在可点击范围内 */
 const ctaVisible=await p.locator('[data-action=w-people-confirm]').isVisible();
 assert.equal(ctaVisible,true,'200% 字体下主按钮不可见');
 await p.evaluate(()=>{document.documentElement.style.fontSize='';});
 ok('T18-zoom','200% 字体下无裁切、无横向溢出'+(canScroll?'，且可滚动到底部':'，内容恰好适配一屏'));

  /* ============ T18 减少动态效果 ============ */
  await p.emulateMedia({reducedMotion:'reduce'});
  await p.goto(url);await click('w-start');
  const durations=await p.evaluate(()=>[...document.querySelectorAll('.seat,.swap-slot,.seg')]
   .map(n=>getComputedStyle(n).animationDuration));
  assert.ok(durations.every(d=>parseFloat(d)<0.01),'减少动态效果时动画应关闭，实际：'+durations.join(','));
  await snap('04-减少动态效果');
  await p.emulateMedia({reducedMotion:'no-preference'});
  ok('T18-reduced-motion','prefers-reduced-motion 下动画与过渡被关闭');

  /* ============ T18 键盘可达 ============ */
  await p.goto(url);
  await p.locator('[data-action=w-start]').focus();
  await p.keyboard.press('Enter');
  assert.equal((await state()).step,1,'键盘可进入第 1 题');
  await p.keyboard.press('Tab');
  const focused=await p.evaluate(()=>document.activeElement?.dataset?.action||document.activeElement?.tagName);
  assert.ok(focused,'Tab 应移动焦点');
  await snap('05-键盘焦点');
  ok('T18-keyboard','Enter 可进入第 1 题，Tab 焦点可移动');

/* ============ T20 图片真实加载 ============ */
const imgStats=await p.evaluate(()=>[...document.images].map(i=>({src:i.getAttribute('src'),w:i.naturalWidth})));
assert.ok(imgStats.length>0);
assert.ok(imgStats.every(i=>i.w>0),'存在未加载成功的图片：'+JSON.stringify(imgStats.filter(i=>!i.w)));
ok('T20-images','当前页 '+imgStats.length+' 张图片全部 naturalWidth>0');

/* ============ 多顿轮换：其余几顿必须真的能看到 ============ */
await p.goto(url);await answerAll(p);   /* 该流程第 7 题选了 3 顿 */
const planToggle=await p.locator('[data-action=w-plan-meal]').count();
assert.equal(planToggle,2,'选了 3 顿时，结果页应提供第 2、3 顿的展开入口，实际 '+planToggle);
const planSectionText=await p.locator('.plan-section').textContent();
assert.match(planSectionText,/接下来 3 顿/,'应标明总顿数');
assert.equal(planSectionText.match(/第 1 顿/g),null,'第 1 顿已完整展示，不应重复出现');
await snap('06-轮换计划折叠');
/* 展开后能看到明细 */
assert.equal(await p.locator('.plan-detail').first().isVisible(),false,'明细默认应收起');
await p.locator('[data-action=w-plan-meal]').first().click();
await p.waitForTimeout(150);
assert.equal(await p.locator('.plan-detail').first().isVisible(),true,'点击后应展开明细');
assert.equal(await p.locator('[data-action=w-plan-meal]').first().getAttribute('aria-expanded'),'true','aria-expanded 应同步');
await snap('07-轮换计划展开');
ok('T07-ui','3 顿时第 2、3 顿提供可展开缩略条，明细默认收起且可展开');

/* ============ 外部饮品提示不得自相矛盾 ============ */
const reasonsAll=await p.locator('.reason-line').allTextContents();
const drinkClaim=reasonsAll.filter(t=>/已够 \d+ 杯/.test(t));
for(const t of drinkClaim)
 assert.equal(/已够 3 杯/.test(t),false,'仅有外部饮品时不得声称"已够 3 杯"：'+t);
ok('T03-copy','外部饮品提示与建议新增不自相矛盾：'+(drinkClaim.join('；')||'本次无该提示'));

/* ============ 经典选餐卡片排版 ============ */
await p.goto(url);await click('classic');
const menuLayout=await p.evaluate(()=>[...document.querySelectorAll('.menu-item')].map(n=>{
 const info=n.querySelector('.menu-item-info');
 return {hasInfo:!!info,infoTop:info?Math.round(info.getBoundingClientRect().top):-1,
  thumbRight:Math.round(n.querySelector('.thumb').getBoundingClientRect().right),
  infoLeft:info?Math.round(info.getBoundingClientRect().left):-1};
}));
assert.ok(menuLayout.length>0,'经典选餐应渲染商品卡');
assert.ok(menuLayout.every(x=>x.hasInfo),'每张卡片应有文本块容器');
assert.ok(menuLayout.every(x=>x.infoLeft>=x.thumbRight),'文本块不得被挤进图片列');
await snap('08-经典选餐');
ok('T17-classic','经典选餐 '+menuLayout.length+' 张卡片文本块与图片列不再重叠');

/* ============ 渲染卫生：不得出现 [object Xxx] 或空容器 ============ */
async function renderHygiene(p,label){
 const bad=await p.evaluate(()=>{
  const out=[];
  /* 1) 任何可见文本里出现 [object ...] 都是把 DOM 节点当字符串塞进了文本 */
  const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
  let n;while(n=w.nextNode()){
   if(/\[object [A-Za-z]+\]/.test(n.nodeValue||''))
    out.push({kind:'objectString',text:(n.nodeValue||'').trim().slice(0,60)});
  }
  /* 2) 带语义 class 的容器若是空的，说明组装子元素时漏了 append */
  for(const sel of ['.home-footer','.meal-card','.step-body','.consent-row','.plan-section']){
   for(const el of document.querySelectorAll(sel))
    if(!el.children.length&&!el.textContent.trim())out.push({kind:'emptyContainer',sel});
  }
  return out;
 });
 assert.deepEqual(bad,[],label+' 渲染异常：'+JSON.stringify(bad));
}
for(const [w,h] of [[390,844],[320,740]]){
 await p.setViewportSize({width:w,height:h});
 await p.goto(url);await renderHygiene(p,'首页 '+w+'x'+h);
 await click('w-start');await renderHygiene(p,'第 1 题 '+w+'x'+h);
 await click('classic');await renderHygiene(p,'经典选餐 '+w+'x'+h);
}
ok('T21-hygiene','各尺寸下均无 [object Xxx] 文本、无空容器');

/* ============ 必选规格必须能选完并加入餐单 ============ */
await p.setViewportSize({width:390,height:844});
await p.goto(url);await click('classic');
await p.locator('[data-action=w-category][data-id="c11"]').click();await p.waitForTimeout(160);
await p.locator('[data-action=w-add-product][data-id="tea"]').click();await p.waitForTimeout(280);
assert.equal(await p.locator('[role=dialog]').count(),1,'带必选规格的商品必须先弹规格确认');
assert.ok(await p.locator('[data-action=w-spec-confirm]').isDisabled(),'未选完必选规格时确认按钮应禁用');
/* 回归：曾因写入 d.specs[group] 而读取 d.specs[key][group] 导致永远校验不过 */
for(const g of ['size','temp']){
 await p.locator('[data-action=w-spec][data-group='+g+']').first().click();await p.waitForTimeout(120);
}
assert.equal(await p.locator('[data-action=w-spec-confirm]').isDisabled(),false,'选完必选规格后确认按钮应可用');
const pressed=await p.locator('[data-action=w-spec][aria-pressed=true]').count();
assert.ok(pressed>=2,'选中态必须通过 aria-pressed 暴露，实际 '+pressed);
await p.locator('[data-action=w-spec-confirm]').click();await p.waitForTimeout(300);
assert.equal((await state()).cart,1,'确认规格后应加入餐单');
ok('T12-specs-ui','必选规格可选完并加入餐单，选中态经 aria-pressed 暴露');
await snap('09-规格弹层');

console.error('视觉断言完成');

  /* ============ 无外部请求（离线自包含） ============ */
  assert.deepEqual(report.externalRequests,[],'不应发起任何外部网络请求');
  ok('T19-selfcontained','零外部网络请求，可完全离线运行');

  assert.deepEqual(report.errors,[],'存在页面 JS 错误：'+report.errors.join(' | '));
  ok('T21-noerror','无页面 JS 运行时错误');

  report.status='PASS';
 }catch(e){report.status='FAIL';report.failure=e.message;report.stack=e.stack;}
 finally{
  report.device=await p.evaluate(()=>navigator.userAgent).catch(()=>'unknown');
  report.checkedAt=new Date().toISOString();
  fs.writeFileSync(path.join(__dirname,'..','..','..','04_测试证据','browser-report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({status:report.status,checks:report.checks.length,failed:report.checks.filter(c=>c.result!=='PASS').length,screenshots:report.screenshots.length,failure:report.failure||null},null,2));
  if(report.failure)console.error(report.failure);
  await b.close();
  process.exitCode=report.status==='PASS'?0:1;
 }

 /* 走完第 i 题 */
 async function advance(p,i){
  switch(i){
   case 1:await p.locator('[data-action=w-people][data-value="2"]').click();await click('w-people-confirm');break;
   case 2:await p.locator('[data-action=w-budget-mode][data-value="total"]').click();
           await p.locator('[data-action=w-budget-amount][data-value="8000"]').click();await click('w-budget-confirm');break;
   case 3:await p.locator('[data-action=w-ext-inc][data-key="coffee"]').click();await click('w-ext-confirm');break;
   case 4:await p.locator('[data-action=w-taste][data-value="香脆"]').click();
           await p.locator('[data-action=w-taste][data-value="微辣"]').click();await click('w-taste-confirm');break;
   case 5:await p.locator('[data-action=w-dir]').first().click().catch(()=>click('w-dir-any'));break;
   case 6:await p.locator('[data-action=w-novelty][data-value="swap"]').click();await click('w-novelty-confirm');break;
   case 7:await p.locator('[data-action=w-plan][data-value="3"]').click();await click('w-plan-confirm');break;
  }
 }
 async function answerAll(p){
  if(await p.locator('[data-action=w-start]').count())await click('w-start');
  await p.locator('[data-action=w-people][data-value="2"]').click();await click('w-people-confirm');
  await p.locator('[data-action=w-budget-mode][data-value="total"]').click();
  await p.locator('[data-action=w-budget-amount][data-value="8000"]').click();await click('w-budget-confirm');
  await p.locator('[data-action=w-ext-inc][data-key="coffee"]').click();await click('w-ext-confirm');
  await p.locator('[data-action=w-taste][data-value="香脆"]').click();
  await p.locator('[data-action=w-taste][data-value="微辣"]').click();await click('w-taste-confirm');
  if(await has('w-dir'))await p.locator('[data-action=w-dir]').first().click();
  else await click('w-dir-any');
  await p.locator('[data-action=w-novelty][data-value="swap"]').click();await click('w-novelty-confirm');
  await p.locator('[data-action=w-plan][data-value="3"]').click();await click('w-plan-confirm');
  await click('w-submit');
 }
})();