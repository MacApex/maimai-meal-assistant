/* 视觉走查：从首页到每个角落，逐屏截图供人工与自动检查。
   覆盖首页、八步（含交互后的状态变化）、结果页、经典选餐、餐单、偏好、弹层。
   所有截图前都等待图片真实加载完成（complete && naturalWidth>0 并 await decode）。
   用法：node tests/visual-audit.cjs [输出目录]
*/
const path=require('node:path'),fs=require('node:fs'),{pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'/Users/maxima/.npm/_npx/31e32ef8478fbf80/node_modules/playwright');
const APP=path.resolve(__dirname,'..');
const OUT=path.resolve(process.argv[2]||path.resolve(__dirname,'..','..','..','04_测试证据','visual-audit'));
fs.mkdirSync(OUT,{recursive:true});

(async()=>{
const b=await chromium.launch({headless:true,
 executablePath:process.env.CHROMIUM_PATH||'/Users/maxima/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell'});
const ctx=await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2});
const p=await ctx.newPage();
const errs=[];const warnings=[];
p.on('pageerror',e=>errs.push(e.message));
p.on('console',m=>{if(m.type()==='warning')warnings.push(m.text());});
const url=pathToFileURL(path.join(APP,'index.html')).href;

const ready=async()=>{
 await p.waitForFunction(()=>[...document.images].every(i=>i.complete&&i.naturalWidth>0),null,{timeout:15000});
 await p.evaluate(()=>Promise.all([...document.images].map(i=>i.decode().catch(()=>{}))));
 await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
};
const c=async a=>{await p.locator('[data-action='+a+']').first().click();await p.waitForTimeout(130);};
const shot=async n=>{await ready();await p.screenshot({path:path.join(OUT,n+'.png')});console.log('  '+n);};
const full=async n=>{await ready();await p.screenshot({path:path.join(OUT,n+'.png'),fullPage:true});};

/* 渲染卫生：不得出现 [object Xxx] 或空容器 */
async function renderCheck(p,label){
 const bad=await p.evaluate(()=>{
  const out=[];
  const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
  let n;while(n=w.nextNode()){
   if(/\[object [A-Za-z]+\]/.test(n.nodeValue||''))out.push({kind:'objectString',text:(n.nodeValue||'').trim().slice(0,50)});
  }
  for(const sel of ['.home-footer','.meal-card','.step-body','.consent-row','.plan-section','.sheet']){
   for(const el of document.querySelectorAll(sel))
    if(!el.children.length&&!el.textContent.trim())out.push({kind:'emptyContainer',sel});
  }
  return out;
 });
 if(bad.length)throw new Error(label+' 渲染异常：'+JSON.stringify(bad));
}


console.log('== 首页 ==');
await p.goto(url);await shot('01-home');await full('01-home-full');

console.log('== 八步 ==');
await c('w-start');
await shot('10-step1-people');
await p.locator('[data-action=w-people][data-value="3"]').click();await p.waitForTimeout(180);
await full('10b-step1-picked3-full');
await c('w-people-confirm');
await shot('11-step2-budget');
await p.locator('[data-action=w-budget-mode][data-value="person"]').click();await p.waitForTimeout(150);
await p.locator('[data-action=w-budget-amount][data-value="3000"]').click();await p.waitForTimeout(180);
await full('11b-step2-person30-full');
await c('w-budget-confirm');
await shot('12-step3-external');
await p.locator('[data-action=w-ext-inc][data-key="coffee"]').click();await p.waitForTimeout(130);
await p.locator('[data-action=w-ext-inc][data-key="coffee"]').click();await p.waitForTimeout(180);
await full('12b-step3-coffee2-full');
await c('w-ext-confirm');
await shot('13-step4-taste');
await p.locator('[data-action=w-taste][data-value="香脆"]').click();await p.waitForTimeout(130);
await p.locator('[data-action=w-taste][data-value="微辣"]').click();await p.waitForTimeout(180);
await full('13b-step4-picked-full');
await c('w-taste-confirm');
await shot('14-step5-direction');
await p.locator('[data-action=w-dir]').first().click();await p.waitForTimeout(220);
await shot('15-step6-novelty');
await p.locator('[data-action=w-novelty][data-value="swap"]').click();await p.waitForTimeout(220);
await full('15b-step6-swap-full');
await c('w-novelty-confirm');
await shot('16-step7-plan');
await p.locator('[data-action=w-plan][data-value="5"]').click();await p.waitForTimeout(220);
await full('16b-step7-plan5-full');
await c('w-plan-confirm');
await shot('17-step8-memory');await full('17-step8-memory-full');
await p.locator('[data-action=w-consent][data-value="saveExplicitTaste"]').click();await p.waitForTimeout(180);
await shot('17b-step8-consent-on');
await c('w-submit');
await shot('18-result');await full('18-result-full');

console.log('== 经典选餐 ==');
await c('classic');await shot('20-classic');await full('20-classic-full');
for(const id of ['c3','c6','c9']){
 await p.locator('[data-action=w-category][data-id="'+id+'"]').click();await p.waitForTimeout(160);
 await shot('20b-classic-'+id);
}

console.log('== 餐单 ==');
/* 无规格商品直接进餐单 */
await p.locator('[data-action=w-category][data-id="c9"]').click();await p.waitForTimeout(160);
await p.locator('[data-action=w-add-product][data-id="fries"]').click();await p.waitForTimeout(240);
await c('cart');await shot('21-cart');await full('21-cart-full');

console.log('== 规格弹层 ==');
await c('classic');
await p.locator('[data-action=w-category][data-id="c11"]').click();await p.waitForTimeout(160);
await p.locator('[data-action=w-add-product][data-id="tea"]').click();await p.waitForTimeout(260);
await shot('22-specs-dialog');
const specBtns=await p.locator('[data-action=w-spec]').count();
console.log('  规格选项数:',specBtns);
if(specBtns){
 for(const g of ['size','temp']){await p.locator('[data-action=w-spec][data-group='+g+']').first().click();await p.waitForTimeout(130);}
 await shot('22b-specs-filled');
 await c('w-spec-confirm');await p.waitForTimeout(220);
}
await p.keyboard.press('Escape');await p.waitForTimeout(200);

console.log('== 偏好 ==');
await c('w-home');await p.waitForTimeout(200);
await c('preferences');await shot('23-preferences');await full('23-preferences-full');

console.log('== 子页顶栏（回到首页出口）==');
for(const act of ['classic','cart','preferences']){
 await p.goto(url);await p.waitForTimeout(200);
 if(act==='cart'){                       /* 餐单入口需先有商品才出现 */
  await c('classic');await p.waitForTimeout(150);
  await p.locator('[data-action=w-category][data-id="c9"]').click();await p.waitForTimeout(150);
  await p.locator('[data-action=w-add-product][data-id="fries"]').click();await p.waitForTimeout(240);
 }
 await c(act);await p.waitForTimeout(220);
 const hasHome=await p.locator('[data-action=w-home]').count();
 const hasAssist=await p.locator('[data-action=w-start]').count();
 if(!hasHome)throw new Error(act+' 页缺少回到首页出口');
 if(!hasAssist)throw new Error(act+' 页缺少返回智能助手的出口');
 await shot('24-subheader-'+act);
 await renderCheck(p,act+' 页');
}
console.log('  子页顶栏检查通过');

console.log('== 省钱弹层 ==');
await p.goto(url);await p.waitForTimeout(150);await c('w-start');
await p.locator('[data-action=w-decide]').first().click();await p.waitForTimeout(150);
await p.locator('[data-action=w-decide]').first().click();await p.waitForTimeout(150);
await p.locator('[data-action=w-decide]').first().click();await p.waitForTimeout(150);
await p.locator('[data-action=w-decide]').first().click();await p.waitForTimeout(150);
await p.locator('[data-action=w-decide]').first().click();await p.waitForTimeout(150);
await p.locator('[data-action=w-decide]').first().click();await p.waitForTimeout(150);
await p.locator('[data-action=w-decide]').first().click();await p.waitForTimeout(150);
await c('w-submit');
await c('w-savings');await shot('25-savings-dialog');

console.log('\n错误: '+(errs.length?errs.join(' | '):'无'));
if(warnings.length)console.log('警告: '+warnings.slice(0,3).join(' | '));
await b.close();
})();