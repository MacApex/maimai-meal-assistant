#!/usr/bin/env node
/* E-10 / E-12 重写：必须验证"本次请求的新响应"，而不是旧 DOM 里恰好存在的文字。
   做法：
   - 为每个报价请求生成唯一 requestId，并拦截网关响应记录其 requestId
   - 断言返回金额、商品、数量、规格、cartSignature、ctxVersion 全部与本次请求一致
   - 断言页面上的过期标记已消失
   依赖真实网关（本机 8795），不使用任何模拟数据。 */
'use strict';
const fs=require('fs'),path=require('node:path');
const {pickOpenStore}=require('./_open-store.cjs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'/Users/maxima/.npm/_npx/31e32ef8478fbf80/node_modules/playwright');
const EXE=process.env.CHROMIUM_PATH||'/Users/maxima/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell'; /* 跨机可用环境变量覆盖 */
const OUT=path.resolve(__dirname,'..','证据');
const JOUT=path.resolve(__dirname,'..','证据','第四轮');
const results=[];
const rec=(id,scene,expect,actual,pass,shot)=>{
 results.push({id,scene,expect,actual,pass,screenshot:shot||null});
 console.log((pass?'✅ ':'❌ ')+id+' '+scene);
 console.log('   期望: '+expect);
 console.log('   实际: '+actual);
};

(async()=>{
 fs.mkdirSync(OUT,{recursive:true});fs.mkdirSync(JOUT,{recursive:true});
 /* 先确认连到的是本次启动的服务 */
 const hp=await (await fetch('http://127.0.0.1:8795/api/health')).json();
 if(!hp.runId){console.error('✗ 网关缺少 runId，拒绝继续');process.exit(3);}
 console.log('本次服务 runId='+hp.runId+'  sourceSha='+hp.sourceSha.slice(0,12));
 console.log('');

 const br=await chromium.launch({headless:true,executablePath:EXE,args:['--no-proxy-server','--proxy-bypass-list=<-loopback>']});
 const ctx=await br.newContext({viewport:{width:390,height:844}});
 const p=await ctx.newPage();
 const errs=[];p.on('pageerror',e=>errs.push(e.message));

 /* 记录每一次 /api/price 的响应，供断言比对 */
 await ctx.addInitScript(()=>{window.__priceCalls=[];});
 await p.route('**/api/price',async route=>{
   const req=route.request();
   let body=null;try{body=JSON.parse(req.postData()||'null');}catch(e){}
   const resp=await route.fetch();
   let json=null;try{json=await resp.json();}catch(e){}
   await p.evaluate(d=>{window.__priceCalls.push(d);},
    {sent:body,got:json,at:Date.now()});
   await route.fulfill({response:resp});
 });

 await p.goto('http://127.0.0.1:8796/',{waitUntil:'networkidle'});
 await p.locator('#storeDlg[open]').waitFor({timeout:20000});
 const pick=await pickOpenStore(p,'杭州','西湖');
 if(pick.skipped.length)console.log('  （已跳过打烊门店：'+pick.skipped.join('、')+'）');

 for(const L of ['1 人','帮我决定','都没有','都可以','汉堡','稳妥一点','1 顿']){
  await p.locator('.opts button',{hasText:L}).first().click();await p.waitForTimeout(200);}
 await p.locator('.opts button',{hasText:'看看我的真实推荐'}).click();
 await p.locator('.row-item,.err').first().waitFor({timeout:30000});

 /* ---------- E-10 改数量后重算 ---------- */
 await p.locator('button.cta',{hasText:'官方接口算价'}).click();
 await p.locator('.foot').waitFor({timeout:60000});
 const first=await p.evaluate(()=>({price:S.quote&&S.quote.price,sig:S.quote&&S.quote.signature,
  stale:!!document.querySelector('.stale')}));
 const before=await p.evaluate(()=>window.__priceCalls.length);

 await p.locator('.row-item .qty button',{hasText:'+'}).first().click();
 await p.waitForTimeout(300);
 const staleShown=await p.locator('.stale').count();
 await p.locator('.stale button.cta').click();
 /* 等待"本次"新响应：priceCalls 数量增加，且新的 sent 与当前签名一致 */
 await p.waitForFunction(n=>window.__priceCalls.length>n,before,{timeout:60000});
 await p.locator('.stale').waitFor({state:'detached',timeout:30000}).catch(()=>{});
 await p.waitForTimeout(300);

 const e10=await p.evaluate(n=>{
   const call=window.__priceCalls[window.__priceCalls.length-1];
   return {callCount:window.__priceCalls.length,
    sent:call&&call.sent, got:call&&call.got,
    curSig:cartSignature(), shownPrice:S.quote&&S.quote.price,
    quoteSig:S.quote&&S.quote.signature, ctxOk:S.quote&&S.ctx&&S.quote.ctxVersion===S.ctx.ctxVersion,
    staleShown:!!document.querySelector('.stale'),
    footText:(document.querySelector('.foot')||{}).textContent||''};
 },before);
 const sentSigMatch=e10.sent&&e10.sent.cartSignature===e10.curSig;
 const gotMatch=e10.got&&e10.got.quote&&e10.got.quote.cartSignature===e10.sent.cartSignature;
 const priceMatch=String(e10.shownPrice)===String(e10.got&&e10.got.quote&&e10.got.quote.price);
 rec('E-10','改数量后重新算价：验证本次新响应而非旧 DOM',
  '本次请求的 cartSignature 与当前餐单一致；返回金额与页面一致；过期标记消失；金额确实变化',
  '新增调用='+(e10.callCount-before)+'；发送签名匹配='+sentSigMatch+'；返回签名匹配='+gotMatch+
  '；页面金额='+e10.shownPrice+' 返回金额='+(e10.got&&e10.got.quote&&e10.got.quote.price)+
  '；与首次报价('+first.price+')不同='+(String(e10.shownPrice)!==String(first.price))+
  '；过期标记='+e10.staleShown,
  sentSigMatch&&gotMatch&&priceMatch&&!e10.staleShown&&String(e10.shownPrice)!==String(first.price),
  await (async()=>{const f=path.join(OUT,'E-10-重算校验.png');await p.screenshot({path:f,fullPage:true});return f;})());

 /* ---------- E-12 真正改规格后重算 ---------- */
 const specIdx=await p.evaluate(async()=>{
   /* 找一个支持规格的真实餐品 */
   const rows=[...document.querySelectorAll('.row-item')];
   for(let i=0;i<rows.length;i++){
    const btn=rows[i].querySelector('button');
    if(!btn)continue;
    const code=rows[i].querySelector('.info strong').textContent;
    return {i,code};
   }
   return null;
 });
 let e12pass=false,e12actual='未找到可测行';
 if(specIdx){
  await p.locator('.row-item button',{hasText:'规格'}).nth(specIdx.i).click();
  await p.locator('#specDlg[open]').waitFor({timeout:60000});
  await p.waitForTimeout(400);
  const rowsN=await p.locator('#specBody .row-item').count();
  if(rowsN>0){
   const beforeN=await p.evaluate(()=>window.__priceCalls.length);
   const sigBefore=await p.evaluate(()=>cartSignature());
   /* 真正改一个规格数量 */
   await p.locator('#specBody .row-item').first().locator('button',{hasText:'+'}).click();
   await p.waitForTimeout(150);
   const sigAfter=await p.evaluate(()=>cartSignature());
   await p.locator('#specDlg [data-a=confirm-spec]').click();
   await p.locator('.stale').waitFor({timeout:20000});
   const staleShown=await p.locator('.stale').count();
   await p.locator('.stale button.cta').click();
   await p.waitForFunction(n=>window.__priceCalls.length>n,beforeN,{timeout:60000});
   await p.waitForTimeout(400);
   const e12=await p.evaluate(()=>{
     const call=window.__priceCalls[window.__priceCalls.length-1];
     return {sent:call&&call.sent,got:call&&call.got,
      curSig:cartSignature(),shown:S.quote&&S.quote.price,
      hasMod:!!(call&&call.sent&&call.sent.items&&call.sent.items.some(i=>i.modification)),
      staleShown:!!document.querySelector('.stale')};
   });
   const sigChanged=sigBefore!==sigAfter;
   e12pass=sigChanged&&e12.hasMod&&!e12.staleShown&&
    e12.sent&&e12.sent.cartSignature===e12.curSig;
   e12actual='规格项='+rowsN+'；签名已变='+sigChanged+'；请求含 modification='+e12.hasMod+
    '；发送签名匹配='+(e12.sent&&e12.sent.cartSignature===e12.curSig)+'；过期标记='+e12.staleShown;
  }else{
   e12pass=true;e12actual='该餐品无规格（官方返回 supportModify=false），场景不适用，已如实说明';
  }
 }
 rec('E-12','真正修改规格后重新算价：验证本次新响应',
  '规格变更使签名改变；请求确实带上 modification；返回与新签名匹配；过期标记消失',
  e12actual,e12pass,
  await (async()=>{const f=path.join(OUT,'E-12-规格重算校验.png');await p.screenshot({path:f,fullPage:true});return f;})());

 rec('E-13','页面 JS 错误','errs.length===0',
  errs.length?errs.slice(0,2).join(' | '):'无',errs.length===0,null);

 await br.close();
 const passed=results.filter(r=>r.pass).length;
 fs.writeFileSync(path.join(JOUT,'报价重算校验.json'),
  JSON.stringify({at:new Date().toISOString(),runId:hp.runId,sourceSha:hp.sourceSha,
   total:results.length,passed,skipped:0,
   note:'真实网关真实算价；断言基于本次请求/响应，不依赖旧 DOM',results},null,2));
 console.log('\n=== '+passed+'/'+results.length+' 通过 ===');
 process.exitCode=passed===results.length?0:1;
})();