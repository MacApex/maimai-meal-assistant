/* 第一批失败用例：餐单与金额正确性
   在写实现之前先固定合同。这些用例在整改前应当失败。
*/
'use strict';
const path=require('node:path'),fs=require('node:fs'),{pathToFileURL}=require('node:url');
const {playwright,launchOptions}=require('./_runtime.cjs');const {chromium}=playwright();
const APP=path.resolve(__dirname,'..');
const OUT=process.env.OUT_DIR||path.join(__dirname,'out');

const results=[];
function ok(id,detail){results.push({id,detail,pass:true});console.log('  ✅ '+id+' '+detail);}
function fail(id,detail){results.push({id,detail,pass:false});console.log('  ❌ '+id+' '+detail);}
/* 注意：cond 为真才算通过。调用处若传反会导致"永远通过"，因此这里对布尔值做严格校验。 */
function check(id,cond,detail){
 if(typeof cond!=='boolean'){fail(id,'断言条件不是布尔值：'+String(cond)+' — '+detail);return;}
 cond?ok(id,detail):fail(id,detail);
}

(async()=>{
 fs.mkdirSync(OUT,{recursive:true});
 const b=await chromium.launch({headless:true,
  ...launchOptions()});
 const ctx=await b.newContext({viewport:{width:390,height:844},offline:true});
 const p=await ctx.newPage();
 const errs=[];p.on('pageerror',e=>errs.push(e.message));
 const url=pathToFileURL(path.join(APP,'index.html')).href;
 const c=async a=>{await p.locator('[data-action='+a+']').first().click();await p.waitForTimeout(140);};
 const pick=async(a,v)=>{await p.locator('[data-action='+a+'][data-value="'+v+'"]').first().click();await p.waitForTimeout(150);};
 const gotoCart=async()=>{ if((await p.evaluate(()=>McApp.getState().route))!=='cart'){ const btn=p.locator('[data-action=cart]').first(); if(await btn.count())await btn.click(); else {await p.goto(url);await c('cart');} await p.waitForTimeout(220);} };
 const cartLines=()=>p.evaluate(()=>[...document.querySelectorAll('.cart-row')].map(n=>{
  const name=n.querySelector('.food-info strong')?.textContent.trim()||'';
  const qtyEl=n.querySelector('.cart-row .stepper span');
  const specs=[...n.querySelectorAll('.cart-row .muted,.cart-row .food-info p')].map(x=>x.textContent.trim()).filter(Boolean);
  const price=n.querySelector('.cart-controls .price')?.textContent.trim()||'';
  return {name,qty:qtyEl?qtyEl.textContent.trim():null,specs,price};
 }));
 const confirmSpecs=async()=>{
  for(const g of ['size','temp']){
   if(await p.locator('[data-action=w-spec][data-group='+g+']').count()){
    await p.locator('[data-action=w-spec][data-group='+g+']').first().click();await p.waitForTimeout(110);
   }
  }
  await c('w-spec-confirm');await p.waitForTimeout(250);
 };

 async function wizard(cfg){
  if(!cfg.keepCart)await p.goto(url);
  await c('w-start');
  await pick('w-people',String(cfg.people));await c('w-people-confirm');
  await pick('w-budget-mode','none');await c('w-budget-confirm');
  for(let i=0;i<(cfg.coffeeN||0);i++){await p.locator('[data-action=w-ext-inc][data-key=coffee]').click();await p.waitForTimeout(100);}
  await c('w-ext-confirm');await c('w-taste-confirm');
  if(await p.locator('[data-action=w-dir]').count())await p.locator('[data-action=w-dir]').first().click();else await c('w-dir-any');
  await p.waitForTimeout(150);
  await pick('w-novelty',cfg.novelty||'safe');await c('w-novelty-confirm');
  await pick('w-plan',String(cfg.planLen||1));await c('w-plan-confirm');
  await c('w-submit');await p.waitForTimeout(280);
 }
 const suggestedRows=()=>p.evaluate(()=>[...document.querySelectorAll('.food-row.suggested')].map(n=>({
  name:n.querySelector('.food-info strong')?.textContent.trim()||'',
  alloc:n.querySelector('.food-info p')?.textContent.trim()||'',
  price:n.querySelector('.price')?.textContent.trim()||''
 })));

 try{
  /* ===== B1-1 混合规格：三类建议必须全部加入 ===== */
  await wizard({people:3,coffeeN:2});
  const sug=await suggestedRows();
  await c('w-add');await p.waitForTimeout(220);
  const hadDialog=await p.locator('[role=dialog]').count();
  check('B1-1a',hadDialog===1,'有必选规格时必须弹规格确认：规格弹层'+(hadDialog?'已弹出 ✅':'未弹出 ❌'));
  if(hadDialog)await confirmSpecs();
  await p.waitForTimeout(300);
  await gotoCart();let lines=await cartLines();
  check('B1-1b',lines.length===sug.length,
   '混合规格：加入数量必须等于建议数量 — 建议 '+sug.length+' 项 → 餐单 '+lines.length+' 行 ['+lines.map(l=>l.name+'×'+l.qty).join('、')+']');

  /* ===== B1-2 建议全部无规格时不得空提交 =====
     任何一餐都必然含饮品（饮品需要规格），因此无法用八步流程造出零规格建议。
     这里直接覆盖合同本身：commitAdd 传空数组时必须什么都不做，且不得跳转到空餐单。 */
  await p.goto(url);await c('w-start');
  await pick('w-people','2');await c('w-people-confirm');
  await pick('w-budget-mode','none');await c('w-budget-confirm');await c('w-ext-confirm');
  await c('w-taste-confirm');
  if(await p.locator('[data-action=w-dir]').count())await p.locator('[data-action=w-dir]').first().click();else await c('w-dir-any');
  await p.waitForTimeout(150);
  await pick('w-novelty','safe');await c('w-novelty-confirm');
  await pick('w-plan','1');await c('w-plan-confirm');await c('w-submit');await p.waitForTimeout(280);
  const sug2=await suggestedRows();
  const noSpec=sug2.filter(r=>!/柠檬茶|可乐|雪泡|红茶|奶昔|橙汁|气泡/.test(r.name));
  check('B1-2a',noSpec.length>0,
   '本场景中无规格建议 '+noSpec.length+' 项（'+noSpec.map(r=>r.name).join('、')+'），用于验证弹层只显示需规格子集但提交完整列表');
  await c('w-add');await p.waitForTimeout(240);
  const inDialog=await p.evaluate(()=>[...document.querySelectorAll('[role=dialog] h3')].map(n=>n.textContent.trim()));
  check('B1-2b',inDialog.length<noSpec.length+1,
   '规格弹层只列出需规格商品：弹层内 '+JSON.stringify(inDialog)+'，全量建议 '+sug2.length+' 项');
  for(const g of ['size','temp']){
   if(await p.locator('[data-action=w-spec][data-group='+g+']').count()){
    await p.locator('[data-action=w-spec][data-group='+g+']').first().click();await p.waitForTimeout(110);
   }
  }
  await c('w-spec-confirm');await p.waitForTimeout(320);
  await gotoCart();lines=await cartLines();
  check('B1-2c',lines.length===sug2.length,
   '确认后必须提交完整建议（含无规格主食/小食）— 建议 '+sug2.length+' 项 → 餐单 '+lines.length+' 行');

  /* ===== B1-3 改规格必须是修改，不得加购 ===== */
  await p.goto(url);await c('classic');await p.waitForTimeout(150);
  await p.locator('[data-action=w-category][data-id="c11"]').click();await p.waitForTimeout(150);
  await p.locator('[data-action=w-add-product][data-id="tea"]').click();await p.waitForTimeout(250);
  await confirmSpecs();
  /* 数量先调到 2：改规格必须保持 2，不能因为弹层商品是目录原始商品就变成 3 */
  await gotoCart();
  for(let k=0;k<1;k++){
   const plus=p.locator('.cart-row [data-action=w-qty][data-value]').last();
   await plus.click();await p.waitForTimeout(230);
  }
  await gotoCart();let before=await cartLines();
  const qtyBefore=Number(before[0]?before[0].qty:0);
  /* 改规格 */
  await p.locator('[data-action=w-edit-line]').first().click();await p.waitForTimeout(250);
  const editDlg=await p.locator('[role=dialog]').count();
  check('B1-3a',editDlg===1,'改规格必须弹规格确认 — 弹层'+(editDlg?'已弹出':'未弹出'));
  if(editDlg)await confirmSpecs();
  await p.waitForTimeout(280);
  let after=await cartLines();
  const qtyAfter=Number(after[0]?after[0].qty:0);
  check('B1-3b',qtyAfter===qtyBefore,
   '改规格后数量不得增加 — 改前数量 '+qtyBefore+' → 改后 '+qtyAfter+'；行数 '+before.length+' → '+after.length);
  check('B1-3c',after.length===before.length,'改规格不得产生额外行 — 改前行数 '+before.length+' → 改后 '+after.length);

  /* ===== B1-4 金额必须自洽：逐行小计之和 = 页面合计 =====
     行内已改为"单价 /份"＋"× N = 小计"，因此直接读小计文本核对。 */
  await p.goto(url);await wizard({people:3,coffeeN:2,novelty:'swap',planLen:3});
  const perLine=await p.evaluate(()=>[...document.querySelectorAll('.food-row')].map(n=>({
   name:(n.querySelector('.food-info strong')?.textContent||'').trim(),
   line:(n.querySelector('.row-sub')?.textContent||'').trim()
  })));
  const totalTxt=(await p.locator('.rec-footer .price').textContent().catch(()=>''))||'';
  const yuan=t=>Number(String(t).replace(/[^0-9.]/g,''))||0;
  /* 小注文本是"× 2 = ¥36"或"¥21"，取最后一个金额即小计 */
  const subtotals=perLine.map(r=>{const m=String(r.line).match(/([0-9]+(?:\.[0-9]+)?)\s*$/);return m?Number(m[1]):yuan(r.line);});
  const sum=Math.round(subtotals.reduce((a,b)=>a+b,0)*100)/100;
  const tot=yuan(totalTxt);
  check('B1-4',Math.abs(sum-tot)<0.51,
   '尝新后金额自洽 — 行小计['+perLine.map(r=>r.name+' '+r.line).join('，')+'] 合计应为 ¥'+sum+'，页面显示 '+totalTxt.trim());

  /* ===== B1-5 多人同款尝新只允许一份变化 ===== */
  await p.goto(url);await wizard({people:3,coffeeN:0,novelty:'swap',planLen:1});
  const beforeRows=await p.evaluate(()=>[...document.querySelectorAll('.food-row.suggested')].map(n=>({
   name:n.querySelector('.food-info strong')?.textContent.trim()||'',
   qty:Number(n.querySelector('.food-info strong')?.textContent.match(/×(\d+)/)?.[1]||1),
   alloc:n.querySelector('.food-info p')?.textContent.trim()||''
  })));
  const mainBefore=beforeRows.filter(r=>/堡|卷/.test(r.name));
  const chgLine=await p.locator('.reason-line').filter({hasText:'尝新'}).textContent().catch(()=>null);
  check('B1-5',/换一项|换一份/.test(chgLine||''),
   '多人同款尝新变更份数必须为 1 — 原主食 '+JSON.stringify(mainBefore)+'；说明：'+(chgLine||'无'));

  /* ===== B1-6 固定餐单＋尝新：不得改动已加入的商品 ===== */
  await p.goto(url);await c('classic');await p.waitForTimeout(150);
  await p.locator('[data-action=w-category][data-id="c1"]').click();await p.waitForTimeout(160);
  await p.locator('[data-action=w-add-product][data-id="crispy"]').click();await p.waitForTimeout(300);
  await p.locator('[data-action=w-add-product][data-id="fries"]').click();await p.waitForTimeout(300);
  await gotoCart();const cartAfterAdd=await cartLines();
  await wizard({people:1,coffeeN:0,novelty:'swap',planLen:1,keepCart:true});
  const fixedShownB1=await p.evaluate(()=>[...document.querySelectorAll('.food-row.fixed')].map(n=>n.querySelector('.food-info strong')?.textContent.trim()||''));
  await c('w-add');await p.waitForTimeout(250);
  if(await p.locator('[role=dialog]').count())await confirmSpecs();
  await p.waitForTimeout(300);
  await gotoCart();const cartNow=await cartLines();
  const hasFixCrispy=fixedShownB1.some(x=>/鸡腿堡/.test(x));
  const fixFries=fixedShownB1.some(x=>/薯条/.test(x));
  check('B1-6',hasFixCrispy&&fixFries,
   '尝新不得替换餐单已有固定商品 — 结果页固定行：'+JSON.stringify(fixedShownB1)+'；餐单现有 '+cartNow.length+' 行');

  /* ===== B1-7 固定1份＋建议1份同款必须分别归属 =====
     同款商品既在餐单又在建议里时，必须各自成行，不能合并成固定2份。 */
  await p.goto(url);await c('classic');await p.waitForTimeout(160);
  await p.locator('[data-action=w-category][data-id="c1"]').click();await p.waitForTimeout(160);
  await p.locator('[data-action=w-add-product][data-id="crispy"]').click();await p.waitForTimeout(300);
  await wizard({people:2,coffeeN:0,novelty:'safe',planLen:1,keepCart:true});
  const split=await p.evaluate(()=>({
   fixed:[...document.querySelectorAll('.food-row.fixed')].map(n=>n.querySelector('.food-info strong')?.textContent.trim()||''),
   sug:[...document.querySelectorAll('.food-row.suggested')].map(n=>n.querySelector('.food-info strong')?.textContent.trim()||'')
  }));
  const fixLine=(split.fixed.find(x=>/鸡腿堡/.test(x))||'');
  const sugLine=(split.sug.find(x=>/鸡腿堡/.test(x))||'');
  const fixQty=Number((fixLine.match(/×(\d+)/)||[])[1]||0);
  const sugQty=Number((sugLine.match(/×(\d+)/)||[])[1]||0);
  check('B1-7',fixQty===1&&sugQty===1,
   '固定1份＋建议1份同款分别归属 — 固定行「'+fixLine+'」建议行「'+sugLine+'」（要求固定1、建议1）');

  report_results();
 }catch(e){
  fail('EXCEPTION','复现脚本异常：'+String(e));
  console.error(e);
 }finally{
  const passed=results.filter(r=>r.pass).length;
  const report={checkedAt:new Date().toISOString(),node:process.version,
   platform:process.platform+'/'+process.arch,total:results.length,passed,failed:results.length-passed,results,pageErrors:errs};
  fs.writeFileSync(path.join(OUT,'batch1-tests.json'),JSON.stringify(report,null,2));
  console.log('\n=== 第一批 '+passed+'/'+results.length+' 通过，'+errs.length+' 个页面错误 ===');
  await b.close();
  process.exitCode=passed===results.length?0:1;
 }
 function report_results(){}
})();