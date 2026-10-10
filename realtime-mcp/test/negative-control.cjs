#!/usr/bin/env node
/* 负向对照：把每处修复单独还原回修复前的写法，确认对应用例确实会变红。
   目的不是让测试通过，而是证明用例有判别力：
   撤掉修复后用例仍通过 = 用例没测到点上。
   全程只操作临时副本，不改动真实源码。
   注意：还原片段用正则并对空白宽容，避免因缩进差异导致"没找到"。 */
'use strict';
const fs=require('fs'),path=require('path'),os=require('os');
const {execFileSync}=require('child_process');
const ROOT=path.resolve(__dirname,'..');

const REVERTS=[
 {id:'N-01',file:'web/app.js',marks:['R4-05'],
  desc:'doQuote 的返回后校验被短路（还原为 await 后才取签名）',
  re:/const sameCtx=S\.ctx&&S\.ctx\.ctxVersion===snap\.ctxVersion&&S\.ctx\.storeCode===snap\.storeCode;\s*\n\s*const sameCart=cartSignature\(\)===snap\.signature;\s*\n\s*if\(!sameCtx\|\|!sameCart\)\{[\s\S]*?\n\s*\}\n\s*if\(j\.quote&&j\.quote\.cartSignature&&j\.quote\.cartSignature!==snap\.signature\)\{[\s\S]*?\n\s*\}\n/,
  rep:'/* 旧实现：既不做返回后校验，也用完成时的签名给结果盖章 */\n'},
 {id:'N-01b',file:'web/app.js',marks:['R4-05'],
  desc:'（配套）把签名改成 await 之后才取',
  re:/S\.quote=\{\.\.\.j\.quote,signature:snap\.signature,requestId:snap\.requestId\};/,
  rep:'S.quote={...j.quote,signature:cartSignature(),requestId:snap.requestId};'},
 {id:'N-02',file:'web/app.js',marks:['R4-06'],
  desc:'替换单品时数量取自菜单条目（item.qty 不存在）',
  re:/const curQty=\(\(\)=>\{[\s\S]*?\}\)\(\);/,
  rep:'const curQty=item.qty;'},
 {id:'N-03',file:'web/app.js',marks:['R4-07'],
  desc:'旧商品规格直接移交给新商品',
  re:/delete S\.specMap\[x\.code\];\s*\n\s*delete S\.specMap\[item\.code\];/,
  rep:"S.specMap[x.code]=S.specMap[item.code]||null;\n   delete S.specMap[item.code];"},
 {id:'N-04',file:'web/app.js',marks:['R4-08'],
  desc:'复制餐单时把过期报价写成当前合计',
  re:/L\.push\('⚠ 官方报价已于 '\+s\.quote\.quotedAt\+' 过期（餐单或门店已变更）'\);\s*\n\s*L\.push\('  该金额不是当前餐单的价格，\*\*待重新算价\*\*。'\);/,
  rep:"L.push('官方报价合计 '+yuan(s.quote.price)+'（'+s.quote.quotedAt+'）');"},
 {id:'N-05',file:'web/app.js',marks:['R4-09'],
  desc:'复制餐单不输出规格',
  re:/L\.push\('    规格：'\+\(it\.spec\|\|'未选\/该商品无规格'\)\);/,
  rep:'/* 旧实现不输出规格 */'},
 {id:'N-06',file:'web/app.js',marks:['R4-10'],
  desc:'零缺口也强制加一杯饮品（Math.max(1,needDrink)）',
  re:/const drinkVariants=needDrink>0[\s\S]*?: \[\[\.\.\.main,\.\.\.side\]\];/,
  rep:'const drinkVariants=roles.drink.slice(0,5).map(d=>\n   [...main,...side,{it:d,qty:baseQty(d,Math.max(1,needDrink))}]);'},
 {id:'N-07',file:'web/app.js',marks:['R4-11'],
  desc:'沿用锁组合那一刻的可行性，不重算预算与覆盖',
  re:/const coverage=checkCoverage\(items\);[\s\S]*?overBudget:!withinBudget,coverageBroken:!coverage\.ok\};/,
  rep:'return {pick:{items,total},feasibleCount:S.lockedFeasible,totalCount:S.lockedTotal,\n    overBudget:S.lockedFeasible>0};'}
];

function runFe(dir){
 try{
  execFileSync(NODE_BIN,[path.join(dir,'test','regress-r4-fe.js'),'--stage','negctl'],
   {cwd:dir,stdio:'pipe',timeout:240000});
 }catch(e){/* 退出码非 0 也可能有结果文件 */}
 const f=path.join(dir,'证据','第四轮','regress-r4-fe-negctl.json');
 if(!fs.existsSync(f))return null;
 try{return JSON.parse(fs.readFileSync(f,'utf8')).results;}catch(e){return null;}
}
const NODE_BIN=process.execPath;

(async()=>{
 const results=[];
 for(const rv of REVERTS){
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'negctl-'));
  fs.cpSync(ROOT,tmp,{recursive:true,filter:s=>!s.includes('基线快照')&&!s.includes('整改记录')});
  const fp=path.join(tmp,rv.file);
  const src=fs.readFileSync(fp,'utf8');
  if(!rv.re.test(src)){
   results.push({id:rv.id,desc:rv.desc,applied:false,reason:'正则未匹配（代码已变化）'});
   fs.rmSync(tmp,{recursive:true,force:true});continue;
  }
  fs.writeFileSync(fp,src.replace(rv.re,rv.rep));
  const r=runFe(tmp);
  if(!r)results.push({id:rv.id,desc:rv.desc,applied:true,detected:false,note:'用例未产出结果'});
  else{
   const failed=r.filter(x=>!x.pass).map(x=>x.id);
   const hit=rv.marks.every(m=>failed.includes(m));
   results.push({id:rv.id,desc:rv.desc,applied:true,expectedToFail:rv.marks,
    actuallyFailed:failed,detected:hit,
    note:hit?'撤销该修复后对应用例变红':'撤销后用例仍通过 → 用例对该修复不敏感'});
  }
  fs.rmSync(tmp,{recursive:true,force:true});
  process.stdout.write('.');
 }
 const detected=results.filter(r=>r.detected).length;
 const applied=results.filter(r=>r.applied).length;
 console.log('\n\n=== 负向对照：'+detected+'/'+applied+' 项修复被用例检出 ===');
 for(const r of results)
  console.log((r.detected?'✅ ':'❌ ')+r.id+' '+r.desc+
   (r.actuallyFailed&&r.actuallyFailed.length?(' → 变红 '+r.actuallyFailed.join(',')):'')+
   (r.reason?(' ['+r.reason+']'):''));
 fs.mkdirSync(path.join(ROOT,'证据','第四轮'),{recursive:true});
 fs.writeFileSync(path.join(ROOT,'证据','第四轮','negative-control.json'),
  JSON.stringify({at:new Date().toISOString(),
   note:'撤销单处修复后对应用例是否变红；变红说明用例有判别力',total:results.length,detected,results},null,2));
 process.exitCode=detected===applied?0:1;
})();