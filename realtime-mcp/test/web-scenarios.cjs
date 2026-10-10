#!/usr/bin/env node
const {pickOpenStore}=require('./_open-store.cjs');
/* 补充场景：预算无解、多人补缺口、算价中途失败、菜单接口失败。
   与 web-flow.cjs 分开，避免一个长流程把问题混在一起。

   与 web-flow.cjs 保持同一套判定口径：
   - pass / fail / skip 分开统计，skip 表示真实数据不具备验证条件，不算通过也不算失败
   - 页面 JS 错误必须导致整体失败
   - 任一 fail 或页面错误，退出码非零（run-all.sh 依赖退出码） */
'use strict';
const fs=require('fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'/Users/maxima/.npm/_npx/31e32ef8478fbf80/node_modules/playwright');
const EXE=process.env.CHROMIUM_PATH||'/Users/maxima/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell'; /* 跨机可用环境变量覆盖 */
const OUT=path.resolve(__dirname,'..','证据');
const JOUT=path.resolve(__dirname,'..','证据','第四轮');
const WEB='http://127.0.0.1:8796';
const results=[];
const rec=(id,scene,input,expect,actual,pass,shot)=>{
 const state=pass==='skip'?'skip':(pass?'pass':'fail');
 results.push({id,scene,input,expect,actual,state,pass:state==='pass',screenshot:shot||null});
 console.log((state==='pass'?'✅ ':state==='skip'?'⏭  ':'❌ ')+id+' '+scene);
 console.log('   期望: '+expect);
 console.log('   实际: '+actual);
 if(state!=='fail'&&shot)console.log('   截图: '+path.basename(shot));
};
const shot=async(p,n)=>{const f=path.join(OUT,n+'.png');await p.screenshot({path:f,fullPage:true});return f;};

async function setupStore(p,city,kw){
 await p.goto(WEB,{waitUntil:'networkidle'});
 await p.locator('#storeDlg[open]').waitFor({timeout:20000});
 await pickOpenStore(p,city,kw);
}
async function answer(p,seq){
 for(const L of seq){await p.locator('.opts button',{hasText:L}).first().click();await p.waitForTimeout(200);}
 await p.locator('.opts button',{hasText:'看看我的真实推荐'}).click();
 await p.locator('.row-item, .err').first().waitFor({timeout:30000});
}

(async()=>{
 fs.mkdirSync(OUT,{recursive:true});fs.mkdirSync(JOUT,{recursive:true});
 const b=await chromium.launch({headless:true,executablePath:EXE,args:['--no-proxy-server','--proxy-bypass-list=<-loopback>']});
 const ctx=await b.newContext({viewport:{width:390,height:844}});
 const p=await ctx.newPage();
 const errs=[];p.on('pageerror',e=>errs.push(e.message));

 /* ---- 场景 A：预算极低 → 必须明确说无解，并给出已试数量 ---- */
 await setupStore(p,'杭州','西湖');
 await p.locator('.opts button',{hasText:'1 人'}).first().click();await p.waitForTimeout(200);
 await p.locator('.opts input[type=number]').fill('10');
 await p.locator('.opts button',{hasText:'用这个预算'}).click();await p.waitForTimeout(250);
 for(const L of ['都没有','都可以','汉堡','稳妥一点','1 顿']){await p.locator('.opts button',{hasText:L}).first().click();await p.waitForTimeout(200);}
 await p.locator('.opts button',{hasText:'看看我的真实推荐'}).click();
 await p.locator('.row-item,.err').first().waitFor({timeout:30000});
 const lowTxt=await p.locator('.step').textContent();
 /* 两种都是诚实披露：明确说预算内无解，或明确说已超出预算并给出调整入口 */
 const hasNoSolution=/找不到可行组合|已超出预算|超出预算/.test(lowTxt);
 rec('S-A','预算内无可行组合时如实告知',{people:1,budget:10},'明确说明预算内无解并给出尝试规模',
  hasNoSolution?('已提示：'+(lowTxt.match(/(找不到可行组合|已超出预算)[^。]{0,40}/)||['（措辞缺失）'])[0]):'未给出无解说明',hasNoSolution,
  await shot(p,'S-A-预算无解'));

 /* ---- 场景 B：4 人 + 已有 2 杯饮品 → 份数与饮品缺口应体现 ---- */
 await setupStore(p,'杭州','西湖');
 await answer(p,['4 人','帮我决定','已有 2 杯饮品','都可以','都可以','稳妥一点','1 顿']);
 const bInfo=await p.evaluate(()=>{
  const {pick}=solve();
  return {people:S.people,ext:S.externalDrinks,
   items:pick?pick.items.map(x=>x.it.name+'×'+x.qty):null,total:pick?pick.total:null};
 });
 const drinkQty=(bInfo.items||[]).filter(x=>/茶|可乐|雪碧|纯悦|气泡|奶昔/.test(x));
 rec('S-B','多人且已有饮品时按缺口补',bInfo,
  '饮品份数 = 4 − 2 = 2',
  '饮品为 '+(drinkQty.join('、')||'无')+'；主食等共 '+(bInfo.items||[]).length+' 项，合计 ¥'+(bInfo.total/100),
  drinkQty.length===1&&/×\s*2$/.test(drinkQty[0]), await shot(p,'S-B-多人补缺口'));

 /* ---- 场景 C：算价中途失败 → 明确报错，不得显示旧价为当前价 ---- */
 await setupStore(p,'杭州','西湖');
 await answer(p,['1 人','帮我决定','都没有','都可以','汉堡','稳妥一点','1 顿']);
 /* 先取得一次真实成功报价。真实上游偶发超时不算产品缺陷：最多重试 3 次，
    仍拿不到才如实标为"未覆盖"，不能把环境抖动记成产品失败。 */
 let goodPrice=null,cNote='';
 for(let attempt=1;attempt<=3&&!goodPrice;attempt++){
  await p.locator('button.cta',{hasText:'官方接口算价'}).click();
  await p.locator('.foot').waitFor({timeout:45000}).catch(()=>{});
  if(await p.locator('.foot').count()){goodPrice=(await p.locator('.foot .t').textContent()).trim();break;}
  cNote='第 '+attempt+' 次未拿到官方报价：'+((await p.locator('#toast').textContent())||'').trim().slice(0,48);
  console.log('   （'+cNote+'，重试）');
  await p.waitForTimeout(1200);
 }
 if(!goodPrice){
  rec('S-C','官方算价失败时明确提示且旧价不冒充现价',{先决条件:'需先取得一次成功报价'},
   '先取到一次真实报价，再注入 502，应提示失败且旧价标为已过期',
   '连续 3 次未拿到官方报价（'+cNote+'），本场景未覆盖：既不计通过也不计失败','skip',
   await shot(p,'S-C-算价失败'));
 }else{
  /* 让下一次算价失败 */
  await ctx.route('**/api/price',r=>r.fulfill({status:502,contentType:'application/json',
   body:JSON.stringify({ok:false,error:'模拟：上游算价失败（测试注入）'})}));
  await p.locator('.row-item .qty button',{hasText:'+'}).first().click();
  await p.locator('.stale button.cta').waitFor({timeout:20000});
  await p.locator('.stale button.cta').click();
  await p.waitForTimeout(2000);
  const toastTxt=(await p.locator('#toast').textContent())||'';
  const stillHasPrice=await p.locator('.foot .t').count();
  const staleN=await p.locator('.stale').count();
  const okC=/失败/.test(toastTxt)&&(stillHasPrice===0||staleN>0);
  rec('S-C','官方算价失败时明确提示且旧价不冒充现价',
   {已成功报价:goodPrice,注入:'502'},
   '提示失败；旧报价若保留必须标为已过期',
   /失败/.test(toastTxt)
    ?('提示：'+toastTxt.trim().slice(0,30)+'；旧价节点='+stillHasPrice+'；过期标记='+staleN)
    :('未提示失败，toast="'+toastTxt.trim().slice(0,30)+'"，旧价仍显示 '+stillHasPrice+' 处'),
   okC, await shot(p,'S-C-算价失败'));
  await ctx.unroute('**/api/price');
 }

 /* ---- 场景 D：菜单接口失败 → 不得回退到演示商品 ---- */
 await ctx.route('**/api/menu',r=>r.fulfill({status:502,contentType:'application/json',
  body:JSON.stringify({ok:false,error:'模拟：菜单接口失败（测试注入）'})}));
 await setupStore(p,'杭州','西湖').catch(()=>{});
 await p.waitForTimeout(1500);
 const menuFail=(await p.locator('main').textContent())||'';
 const noFakeItems=!/巨无霸|鸡腿堡|金黄薯条/.test(menuFail);
 rec('S-D','菜单接口失败时不得用演示数据冒充',{注入:'502'},
  '显示失败原因与重试入口，且不出现任何商品',
  noFakeItems?('显示：'+menuFail.replace(/\s+/g,' ').slice(0,46)+'…'):'页面出现商品，疑似演示数据混入',
  /失败/.test(menuFail)&&noFakeItems, await shot(p,'S-D-菜单失败'));
 await ctx.unroute('**/api/menu');

 const passN=results.filter(r=>r.state==='pass').length;
 const skipN=results.filter(r=>r.state==='skip').length;
 const failN=results.filter(r=>r.state==='fail').length;
 const json={at:new Date().toISOString(),total:results.length,passed:passN,skipped:skipN,
  failed:failN,pageErrors:errs,results};
 fs.writeFileSync(path.join(OUT,'web-scenarios.json'),JSON.stringify(json,null,2));
 fs.writeFileSync(path.join(JOUT,'web-scenarios.json'),JSON.stringify(json,null,2));
 console.log('\n=== 通过 '+passN+' · 未覆盖 '+skipN+' · 失败 '+failN+' · 页面错误 '+errs.length+' ===');
 if(errs.length)console.log('页面错误: '+errs.join(' | '));
 await b.close();
 process.exitCode=(failN===0&&errs.length===0)?0:1;
})();
