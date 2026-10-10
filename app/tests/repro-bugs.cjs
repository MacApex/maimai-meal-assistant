/* 复现评审报告中的已复现问题。
   每条只输出实际观测值，不预设结论；未被复现的会如实标 NOT_REPRODUCED。
   运行：node tests/repro-bugs.cjs
*/
'use strict';
const path=require('node:path'),fs=require('node:fs'),{pathToFileURL}=require('node:url');
const {playwright,launchOptions}=require('./_runtime.cjs');const {chromium}=playwright();
const APP=path.resolve(__dirname,'..');
const OUT=process.env.OUT_DIR||path.join(__dirname,'out');

const results=[];
const rec=(id,title,expected,actual,reproduced)=>{
 results.push({id,title,expected,actual,verdict:reproduced?'REPRODUCED':'NOT_REPRODUCED'});
 console.log('['+id+'] '+title);
 console.log('  预期: '+expected);
 console.log('  实际: '+actual);
 console.log('  判定: '+(reproduced?'已复现':'当前版本未复现')+'\n');
};

(async()=>{
 fs.mkdirSync(OUT,{recursive:true});
 const b=await chromium.launch({headless:true,
  ...launchOptions()});
 const ctx=await b.newContext({viewport:{width:390,height:844},offline:true});
 const p=await ctx.newPage();
 const errs=[];p.on('pageerror',e=>errs.push(e.message));
 const url=pathToFileURL(path.join(APP,'index.html')).href;
 const c=async a=>{await p.locator('[data-action='+a+']').first().click();await p.waitForTimeout(150);};
 const pick=async(a,v)=>{await p.locator('[data-action='+a+'][data-value="'+v+'"]').first().click();await p.waitForTimeout(160);};

 /* 走完八题 */
 async function runWizard(cfg){
  await p.goto(url);await c('w-start');
  await pick('w-people',String(cfg.people));
  await c('w-people-confirm');
  await pick('w-budget-mode','none');await c('w-budget-confirm');
  for(let i=0;i<(cfg.coffeeN||0);i++){await p.locator('[data-action=w-ext-inc][data-key=coffee]').click();await p.waitForTimeout(110);}
  await c('w-ext-confirm');
  await c('w-taste-confirm');
  if(await p.locator('[data-action=w-dir]').count())await p.locator('[data-action=w-dir]').first().click();
  else await c('w-dir-any');
  await p.waitForTimeout(160);
  await pick('w-novelty',cfg.novelty||'safe');
  await c('w-novelty-confirm');
  await pick('w-plan',String(cfg.planLen||1));
  await c('w-plan-confirm');
  await c('w-submit');
  await p.waitForTimeout(280);
 }

 try{
  /* ===== BUG-1 推荐加入餐单不完整 ===== */
  await runWizard({people:3,coffeeN:2,planLen:5});
  const sug=await p.locator('.food-row.suggested').count();
  await c('w-add');await p.waitForTimeout(240);
  const dlg=await p.locator('[role=dialog]').count();
  if(dlg){
   for(const g of ['size','temp']){
    if(await p.locator('[data-action=w-spec][data-group='+g+']').count()){
     await p.locator('[data-action=w-spec][data-group='+g+']').first().click();await p.waitForTimeout(120);
    }
   }
   await c('w-spec-confirm');
  }
  await p.waitForTimeout(350);
  const cartN=await p.locator('.cart-row').count();
  rec('BUG-1','推荐加入餐单不完整',
   '三类建议全部加入餐单（'+sug+' 项）',
   '规格弹层'+(dlg?'有':'无')+'，餐单实际 '+cartN+' 项',
   cartN<sug);

  /* ===== BUG-2 未来餐次重复抵扣今天已有食物 ===== */
  await runWizard({people:3,coffeeN:2,planLen:5});
  const toggles=await p.locator('[data-action=w-plan-meal]').count();
  const futureTexts=[];
  for(let i=0;i<toggles;i++){
   await p.locator('[data-action=w-plan-meal]').nth(i).click();await p.waitForTimeout(180);
   futureTexts.push(await p.locator('.plan-detail').nth(i).locator('.plan-names').textContent());
  }
  /* 关键看"建议新增几杯"：正确应为第1顿1杯、未来各顿3杯 */
  const mainNames=await p.locator('.food-row.suggested').allTextContents();
  const firstDrink=(()=>{const t=mainNames[mainNames.length-1]||'';const m=t.match(/×(\d+)/);return m?Number(m[1]):null;})();
  const futureCounts=futureTexts.map(t=>{const m=t.match(/(?:柠檬茶|可乐|雪泡|红茶|奶昔|橙汁|气泡)[^×]*×(\d+)/);return m?Number(m[1]):null;});
  const known=futureCounts.filter(v=>v!==null);
  const futureAllShort=known.length>0&&known.every(v=>v<3);
  rec('BUG-2','未来餐次重复抵扣今天已有食物',
   '第1顿补1杯（今天已有2杯）；未来4顿各补3杯',
   '第1顿补 '+firstDrink+' 杯；未来各顿建议饮品份数=['+futureCounts.join(',')+']'+
   (futureAllShort?' → 未来各顿仍在抵扣今日咖啡':''),
   futureAllShort);

  /* ===== BUG-3 点击"这顿吃过了"无反馈控件 ===== */
  await runWizard({people:2,coffeeN:0,planLen:1});
  await c('w-eaten');await p.waitForTimeout(300);
  const flag=await p.evaluate(()=>McApp.feedbackOpen());
  const fbN=await p.locator('[data-action^=w-fb-]').count();
  rec('BUG-3','点击"这顿吃过了"未出现反馈控件',
   '出现合口味／想调整／先不评等反馈按钮',
   'feedbackOpen()='+flag+'，可见 w-fb-* 按钮 '+fbN+' 个',
   flag===true&&fbN===0);

  /* ===== BUG-4 无同意的反馈仍写入持久层 ===== */
  const mem=await p.evaluate(()=>{
   const calls=[];const store={getItem:()=>null,setItem:(k)=>calls.push(k),removeItem:()=>{}};
   const M=window.McMemory.createMemoryStore(store);
   const r=M.saveFeedback({mealId:'m',unitId:'u',kind:'good',eatenConfirmation:true,saveConsentId:null},null);
   return {setItemCalls:calls.length,persisted:r&&r.persisted};
  });
  rec('BUG-4','无保存同意的已吃过反馈仍写入持久层',
   'setItem 调用 0 次（拒绝保存不落盘）',
   'setItem '+mem.setItemCalls+' 次，persisted='+mem.persisted,
   mem.setItemCalls>0);

  /* ===== BUG-5 待提交包按 README 无法复跑 ===== */
  const PKG=path.join(ROOT,'06_GitHub待提交包');
  const readme=fs.readFileSync(path.join(PKG,'README.md'),'utf8');
  const problems=[];
  if(/cd app/.test(readme)&&!fs.existsSync(path.join(PKG,'app','tests')))
   problems.push('README 要求 cd app，但包内无 app/tests（tests 实际在包根）');
  const rootTests=path.join(PKG,'tests');
  for(const name of ['wizard.test.cjs','browser-wizard.cjs','standalone-check.cjs']){
   const f=path.join(rootTests,name);
   if(!fs.existsSync(f))continue;
   const src=fs.readFileSync(f,'utf8');
   if(name!=='browser-wizard.cjs'){
    for(const m of src.matchAll(/require\('([^']+)'\)/g)){
     if(!fs.existsSync(path.resolve(rootTests,m[1])))problems.push(name+' require 失效：'+m[1]);
    }
   }
   const abs=[...src.matchAll(/\/Users\/[A-Za-z0-9_.\/-]+/g)].map(m=>m[0]);
   if(abs.length)problems.push(name+' 含作者机器绝对路径 '+abs.length+' 处');
  }
  rec('BUG-5','待提交包按 README 无法复跑',
   '在包内按 README 命令跑通测试',
   problems.length?problems.join('；'):'未发现问题',
   problems.length>0);
 }catch(e){
  console.error('复现脚本异常:',String(e));
  results.push({id:'SCRIPT-ERROR',title:'复现脚本自身异常',expected:'无异常',actual:String(e),verdict:'REPRODUCED'});
 }finally{
  const report={checkedAt:new Date().toISOString(),node:process.version,platform:process.platform+'/'+process.arch,results,pageErrors:errs};
  fs.writeFileSync(path.join(OUT,'repro-bugs.json'),JSON.stringify(report,null,2));
  console.log('=== 汇总 ===');
  results.filter(r=>r.id!=='SCRIPT-ERROR').forEach(r=>console.log('  '+r.id+' '+r.verdict+' '+r.title));
  console.log('已复现 '+results.filter(r=>r.verdict==='REPRODUCED'&&r.id!=='SCRIPT-ERROR').length+' / '+results.filter(r=>r.id!=='SCRIPT-ERROR').length);
  console.log('页面 JS 错误:',errs.length?errs.join(' | '):'无');
  await b.close();
 }
})();