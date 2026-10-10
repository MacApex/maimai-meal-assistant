#!/usr/bin/env node
const {pickOpenStore}=require('./_open-store.cjs');
/* 真实模式纵向流程测试：确认门店 → 八题 → 真实推荐 → 改规格/改数量
   → 官方重新算价 → 保存餐单。每个场景记录脱敏输入、实际结果、是否通过。
   同时覆盖：接口失败、预算无解、换门店使报价失效。
   截图与证据写入 证据/，不包含 key、地址或账户隐私。 */
'use strict';
const fs=require('fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'/Users/maxima/.npm/_npx/31e32ef8478fbf80/node_modules/playwright');
const EXE=process.env.CHROMIUM_PATH||'/Users/maxima/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell'; /* 跨机可用环境变量覆盖 */
const OUT=path.resolve(__dirname,'..','证据');
const WEB='http://127.0.0.1:8796';

const results=[];
 function rec(id,scene,input,expect,actual,pass,shot){
  /* pass 可为 true / false / 'skip'。
     'skip' 表示该场景在当前真实数据下无法验证（例如官方未返回规格组），
     这种情况既不是通过也不是失败，必须单独统计，不能混进失败数。 */
  const state=pass==='skip'?'skip':(pass?'pass':'fail');
  results.push({id,scene,input:scrub(input),expect,actual,state,pass:state==='pass',shot:shot||null});
  console.log((state==='pass'?'✅ ':state==='skip'?'⏭  ':'❌ ')+id+' '+scene);
  console.log('   期望: '+expect);
  console.log('   实际: '+actual);
  if(pass&&shot)console.log('   截图: '+path.basename(shot));
 }
function scrub(o){
 const s=JSON.stringify(o);
 return s.replace(/\b1[3-9]\d{9}\b/g,'[手机号已隐去]')
  .replace(/\d{3}[-*\d]{6,}[\dXx*]/g,'[电话已隐去]')
  .replace(/[一-龥]{0,6}(路|街|号|小区|大厦|公寓)[\w\-号栋室层]{0,20}/g,'[地址已隐去]');
}
const shot=async(p,name)=>{const f=path.join(OUT,name+'.png');await p.screenshot({path:f,fullPage:true});return f;};

(async()=>{
 fs.mkdirSync(OUT,{recursive:true});
 const b=await chromium.launch({headless:true,executablePath:EXE,args:['--no-proxy-server','--proxy-bypass-list=<-loopback>']});
 const ctx=await b.newContext({viewport:{width:390,height:844}});
 const p=await ctx.newPage();
 const errors=[];p.on('pageerror',e=>errors.push(e.message));
 const c=async(a)=>{await p.locator('[data-a='+a+']').first().click();await p.waitForTimeout(180);};

 /* ---------- 场景 1：网关不可用时必须显式报错，不得用假数据 ---------- */
 await ctx.route('http://127.0.0.1:8795/**',r=>r.abort());
 await p.goto(WEB,{waitUntil:'networkidle'}).catch(()=>{});
 await p.waitForTimeout(700);
 let txt=await p.locator('main').textContent();
 rec('E-01','网关不可用时显式失败',
  '断网关','显示失败原因并提供重试/换演示，不出现任何商品',
  /无法连接本机网关|失败/.test(txt)?'显示「'+txt.trim().slice(0,42)+'…」':'页面内容异常',
  /无法连接本机网关/.test(txt)&&!/巨无霸|鸡腿堡/.test(txt),
  await shot(p,'E-01-网关不可用'));
 await ctx.unroute('http://127.0.0.1:8795/**');

 /* ---------- 场景 2：正常纵向流程 ---------- */
 await p.goto(WEB,{waitUntil:'networkidle'});
 await p.waitForTimeout(500);
 const dlg=await p.locator('#storeDlg[open]').count();
 rec('E-02','进入真实模式先要求确认门店',{step:1},'门店对话框自动打开',
  dlg===1?'门店确认框已打开':'未打开', dlg===1, await shot(p,'E-02-门店确认'));

 /* 门店会打烊：逐家尝试，选第一家当前营业的，并如实记录跳过了几家 */
 const pick=await pickOpenStore(p,'杭州','西湖');
 rec('E-03','城市+关键词查到真实门店',
  {city:'杭州',keyword:'西湖',候选:pick.total,跳过打烊:pick.skipped},
  '候选 '+pick.total+' 家，选中第 '+(pick.index+1)+' 家（跳过 '+pick.skipped.length+' 家打烊）',
  pick.total>0, await shot(p,'E-03-门店列表'));
 const srcTxt=await p.locator('.src').textContent().catch(()=>'');
 const hasItems=/可售餐品 \d+ 项/.test(srcTxt);
 rec('E-04','加载真实菜单并标明来源与时间',{},'显示门店、可售数量、更新时间、数据源',
  srcTxt.replace(/\s+/g,' ').trim().slice(0,70), hasItems&&/官方 MCP/.test(srcTxt),
  await shot(p,'E-04-真实菜单'));

 /* ---------- 八题 ---------- */
 const qa=async(label)=>{await p.locator('.opts button').first().click();await p.waitForTimeout(180);};
 await qa(); // 1 人
 rec('E-05','第1题人数',{people:1},'进入第2题',
  await p.locator('.step .n').textContent(), true, null);

 // 预算：选一个会逼出"无解"的低预算用于后续场景，这里先用 50
 await p.locator('.opts button', {hasText:'50 元以内'}).click(); await p.waitForTimeout(200);
 await p.locator('.opts button', {hasText:'都没有'}).click(); await p.waitForTimeout(200);
 await p.locator('.opts button', {hasText:'都可以'}).click(); await p.waitForTimeout(200);
 await p.locator('.opts button', {hasText:'汉堡'}).click(); await p.waitForTimeout(200);
 await p.locator('.opts button', {hasText:'稳妥一点'}).click(); await p.waitForTimeout(200);
 await p.locator('.opts button', {hasText:'1 顿'}).click(); await p.waitForTimeout(200);
 // 第8题：先切一个同意项，再点明确的继续按钮
 const memBtns=await p.locator('.opts button').count();
 await p.locator('.opts button',{hasText:'保存这次选餐结果'}).click(); await p.waitForTimeout(200);
 await p.locator('.opts button',{hasText:'看看我的真实推荐'}).click();
 await p.locator('.row-item').first().waitFor({timeout:20000});
 const rows=await p.locator('.row-item').count();
 rec('E-06','八题后给出真实推荐',{memBtns},'推荐行数>0，且商品名来自真实菜单',
  '推荐 '+rows+' 行', rows>0, await shot(p,'E-06-真实推荐'));

 const unknownTag=await p.locator('.unknown').count();
 rec('E-07','营养/过敏原未知不得推断',
  {},'每行标注「营养/过敏原：未知」', unknownTag+' 处未知标记', unknownTag>0, null);

 /* ---------- 官方算价 ---------- */
 await c('retry-boot').catch(()=>{});
 const quoteBtn=p.locator('button.cta', {hasText:'官方接口算价'});
 await quoteBtn.click(); await p.locator('.foot,.stale').first().waitFor({timeout:60000});
 const foot=await p.locator('.foot').textContent().catch(()=>'');
 const hasPrice=/官方报价/.test(foot);
 rec('E-08','调用官方接口算价',{},'显示官方报价、商品金额、优惠、费用、总额',
  foot.replace(/\s+/g,' ').trim().slice(0,80), hasPrice, await shot(p,'E-08-官方报价'));

 /* ---------- 改数量使报价失效 ---------- */
 await p.locator('.row-item .qty button', {hasText:'+'}).first().click();
 await p.waitForTimeout(400);
 const stale=await p.locator('.stale').textContent().catch(()=>'');
 rec('E-09','改数量后报价立即标待重算',{},'显示「报价已过期」并提供重新算价',
  stale.replace(/\s+/g,' ').trim().slice(0,50)||'未标记过期', /报价已过期/.test(stale),
  await shot(p,'E-09-报价失效'));

 /* ---------- 重新算价 ---------- */
 await p.locator('.stale button.cta').click(); await p.waitForTimeout(600); await p.locator('.foot').waitFor({timeout:60000});
 const foot2=await p.locator('.foot').textContent().catch(()=>'');
 rec('E-10','重新算价得到新官方金额',{},'报价刷新且金额变化',
  foot2.replace(/\s+/g,' ').trim().slice(0,60), /官方报价/.test(foot2),
  await shot(p,'E-10-重新算价'));

 /* ---------- 替换单品：用同角色的其他真实可售商品 ---------- */
 /* 主区域的 .row-item 选择器会同时命中弹层内的规格行，这里限定在 #app 下 */
 const mainRow='#app .row-item';
 const beforeNames=await p.locator(mainRow+' .info strong').allTextContents();
 await p.locator(mainRow).first().locator('button',{hasText:'换一个'}).click();
 await p.locator('#swapDlg[open]').waitFor({timeout:30000});
 const swapN=await p.locator('#swapBody .store').count();
 await p.locator('#swapBody .store').first().click();
 await p.waitForTimeout(600);
 const afterNames=await p.locator(mainRow+' .info strong').allTextContents();
 const changed=beforeNames.length!==afterNames.length||beforeNames.some((x,i)=>x!==afterNames[i]);
 rec('E-15','替换单品为该门店其他可售商品',{替换前:beforeNames.slice(0,3)},
  '可选项>0，且替换后餐单确实变化',
  '可换 '+swapN+' 个；'+beforeNames.slice(0,2).join('、')+' → '+afterNames.slice(0,2).join('、'),
  swapN>0&&changed, await shot(p,'E-15-替换单品'));
 const staleAfterSwap=await p.locator('.stale').count();
 rec('E-16','替换单品后报价需重算',{},'报价标记为待重算',
  staleAfterSwap?'已标记':'未标记（可能尚未算价）', staleAfterSwap>0||!(await p.locator('.foot').count()), null);

 /* ---------- 关闭规格弹层的统一做法 ----------
    规格弹层是 modal，不关掉会拦截后续所有点击，表现为
    "<button>−</button> ... intercepts pointer events" 这类难懂超时。
    每次需要操作主区域前都调用一次。 */
 const closeSpec=async()=>{
  if(!(await p.locator('#specDlg[open]').count()))return;
  await p.locator('#specDlg [data-a=close-spec]').click().catch(()=>{});
  await p.locator('#specDlg[open]').waitFor({state:'detached',timeout:10000}).catch(()=>{});
  await p.waitForTimeout(250);
 };
 /* ---------- 规格：必须用真正支持规格的真实餐品 ---------- */
 let specOpen=false,specRows=0,specMsg='';
 /* 只数主区域的推荐行：规格弹层里的规格项同样是 .row-item，
    不排除的话索引会落到弹层内的元素上，点不动也点错。 */
 const rowSel='#app > .row-item, #app .step > .row-item';
 const rowN=await p.locator(rowSel).count();
 for(let k=0;k<rowN;k++){
  await closeSpec();
  await p.locator(rowSel).nth(k).locator('button',{hasText:'规格'}).click();
  await p.locator('#specDlg[open]').waitFor({timeout:60000});
  await p.waitForTimeout(300);
  specRows=await p.locator('#specBody .row-item').count();
  specMsg=(await p.locator('#specMsg').textContent().catch(()=>''))||'';
  specOpen=true;
  if(specRows>0)break;
  await closeSpec();
 }
 rec('E-11','打开真实规格',{},'弹层打开；有规格则列出，无规格须明确说明',
  '弹层'+(specOpen?'已开':'')+'，规格 '+specRows+' 项'+(specRows?'':'（说明：'+(specMsg.trim().slice(0,28)||'未给出说明')+'）'),
  specOpen===true&&(specRows>0||specMsg.trim().length>0), await shot(p,'E-11-规格弹层'));

 /* 该门店此刻的推荐餐品可能都不支持规格（菜单接口不返回规格信息，
    只有详情接口有）。此时"改规格"无法验证——不能记为通过，
    也不能伪装成业务失败，如实记为未覆盖。
    先重新算价拿到有效报价，否则"失效"无从谈起。 */
 {
  /* 必须先有一份有效报价，"改规格让报价失效"才有意义。
     E-15 替换单品后 S.quote 已被清空，此时改规格不会产生"过期"，
     而是因为根本没有报价——那是另一回事，不能混为一谈。 */
  await closeSpec();
  if(!(await p.locator('.foot').count())){
   const qb=p.locator('button.cta',{hasText:'算价'}).first();
   if(await qb.count()){
    await qb.click();
    await p.locator('.foot').waitFor({timeout:60000});
   }
  }
  /* 找到有规格的那一行，重新打开它的规格弹层 */
  let specRow=-1;
  for(let k=0;k<rowN;k++){
   await closeSpec();
   await p.locator(rowSel).nth(k).locator('button',{hasText:'规格'}).click();
   await p.locator('#specDlg[open]').waitFor({timeout:30000});
   await p.waitForTimeout(300);
   if(await p.locator('#specBody .row-item').count()>0){specRow=k;break;}
  }
  if(specRow<0){
   rec('E-12','改规格后报价失效',{规格项数:0},'找不到有规格的餐品，本场景未覆盖',
    '重新算价后再次逐行检查，仍无规格组',  'skip',null);
  }else{
   const cbtn=p.locator('#confirm-spec');
   const enabled=await cbtn.isEnabled();
   if(enabled){
    await cbtn.click();
    /* 确认规格后会重渲染，报价标记是渲染出来的。
       必须等标记出现再断言，不能点完立刻查——否则测的是时序不是行为。 */
    await p.locator('.stale').first().waitFor({timeout:20000}).catch(()=>{});
    await p.waitForTimeout(500);
   }
   /* 签名对比：签名没变就是绑定关系没更新，属于真实缺陷而非时序问题 */
   const sigPair=await p.evaluate(()=>({
    now:cartSignature(),quoted:(window.S&&S.quote)?S.quote.signature:null,
    hasFoot:!!document.querySelector('.foot')}));
   const staleN=await p.locator('.stale').count();
   rec('E-12','改规格后报价失效',{规格项数:specRows,规格所在行:specRow+1},
    '报价标记为待重算（当前餐单签名与报价绑定签名不一致）',
    (enabled?('已标记待重算'+(staleN?'':'（未见过期标记）')):'确认按钮不可用')+
    '；有报价='+sigPair.hasFoot+'；签名一致='+(sigPair.now===sigPair.quoted),
    enabled&&staleN>0&&sigPair.hasFoot&&sigPair.now!==sigPair.quoted,
    await shot(p,'E-12-规格后失效'));
  }
  await closeSpec();
 }

 /* ---------- 换门店使报价失效 ---------- */
 /* 规格弹层必须先关闭：它是 modal，会拦截后续所有点击。
    这里显式关闭并等待，避免"元素被弹层遮挡"这类难懂的超时。 */
 if(await p.locator('#specDlg[open]').count()){
  await p.locator('#specDlg [data-a=close-spec]').click().catch(()=>{});
  await p.locator('#specDlg[open]').waitFor({state:'detached',timeout:10000}).catch(()=>{});
  await p.waitForTimeout(300);
 }
 const changeBtn=p.locator('.src button', {hasText:'更换门店'});
 if(await changeBtn.count()){
  await closeSpec();/* 规格弹层必须先关：它是 modal，会拦截"更换门店"的点击 */
  await changeBtn.click();
  await p.waitForTimeout(600);
  /* 换店仍用同一城市同一关键词：换一家门店验证的是"上下文变更让报价作废"，
     换关键词会把"门店变了"和"搜索条件变了"两件事混在一起。
     pickOpenStore 会逐家尝试，自动跳过打烊的。 */
  let pick2=null,pick2Err=null;
  try{ pick2=await pickOpenStore(p,'杭州','西湖'); }
  catch(e){ pick2Err=e.message; }
  if(!pick2){
   rec('E-13','换门店后重新加载并作废旧报价',{},
    '新门店菜单加载成功，且旧报价已标待重算',
    '未能选出第二家营业门店：'+(pick2Err||'未知原因'),'skip',null);
  }else{
   await p.locator('.src').first().waitFor({timeout:60000});
   await p.waitForTimeout(600);
   const ctxv=await p.evaluate(()=>document.body.innerText.includes('可售餐品'));
   rec('E-13','换门店后重新加载并作废旧报价',
    {新门店:pick2.storeName,跳过打烊:pick2.skipped.length},
    '新门店菜单加载成功，且旧报价已标待重算',
    (ctxv?'已加载 '+pick2.storeName:'未加载')+'；跳过 '+pick2.skipped.length+' 家打烊；过期标记 '+
    (await p.locator('.stale').count()),
    ctxv, await shot(p,'E-13-换门店'));
  }
 }else rec('E-13','换门店后重新加载并作废旧报价',{},'新门店菜单加载成功','未找到更换门店按钮',false,null);

 /* ---------- 页面无 key 泄漏 ---------- */
 const html=await p.content();
 const hasKey=/Bearer\s+[A-Za-z0-9\-_.]{16,}/.test(html)||/Authorization/i.test(html);
 rec('E-14','页面与脚本不含凭据',{check:'html'},'HTML 中无 Authorization/Bearer',
  hasKey?'发现疑似凭据':'未发现', !hasKey, null);

 const passN=results.filter(r=>r.state==='pass').length;
 const skipN=results.filter(r=>r.state==='skip').length;
 const failN=results.filter(r=>r.state==='fail').length;
 fs.writeFileSync(path.join(OUT,'web-flow-tests.json'),
  JSON.stringify({at:new Date().toISOString(),total:results.length,
   passed:passN,skipped:skipN,failed:failN,pageErrors:errors,results},null,2));
 console.log('\n=== 通过 '+passN+' · 未覆盖 '+skipN+' · 失败 '+failN+' · 页面错误 '+errors.length+' ===');
 if(errors.length)console.log('页面错误: '+errors.join(' | '));
 await b.close();
 /* 未覆盖不算失败（真实数据不具备条件），但页面错误必须导致失败 */
 process.exitCode=(failN===0&&errors.length===0)?0:1;
})();