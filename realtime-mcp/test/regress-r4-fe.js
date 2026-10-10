'use strict';
const path=require('path');
/* ---------- 前端反例：真实页面代码 + 离线 mock 网关，零真实调用 ---------- */
async function runFrontendCases(){
 const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'/Users/maxima/.npm/_npx/31e32ef8478fbf80/node_modules/playwright');
 const EXE=process.env.CHROMIUM_PATH||'/Users/maxima/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell'; /* 跨机可用环境变量覆盖 */
 const out=[];
 const state={releasePrice:null,priceBodies:[],nextQuote:null};
 const srv=http.createServer((req,res)=>{
  let b='';req.on('data',c=>b+=c);
  req.on('end',()=>{
   const u=new URL(req.url,'http://x');
   const body=b?JSON.parse(b):{};
   const json=(c,o)=>{res.writeHead(c,{'content-type':'application/json'});res.end(JSON.stringify(o));};
   if(u.pathname==='/api/health')return json(200,{ok:true,source:'SYNTHETIC_MOCK_ONLY',mode:'mock',writeOpsEnabled:false});
   if(u.pathname==='/api/stores')return json(200,{ok:true,stores:[{storeCode:'MOCK_A',beCode:null,storeName:'MOCK 合成A店',address:'',distance:1,reservation:false}]});
   if(u.pathname==='/api/context')return json(200,{ok:true,context:{storeCode:'MOCK_A',storeName:'MOCK 合成A店',orderType:1,beType:1,ctxVersion:1},quoteInvalidated:false});
   if(u.pathname==='/api/menu')return json(200,MENU);
   if(u.pathname==='/api/detail')return json(200,body.code==='MAIN_B'?DETAIL_B:DETAIL_A);
   if(u.pathname==='/api/price'){
    state.priceBodies.push(body);
    /* 挂起，直到测试显式释放——用来制造"旧响应晚到" */
    const payload=state.nextQuote||QUOTE_20;
    state.releasePrice=()=>json(200,{ok:true,storeCode:'MOCK_A',storeName:'MOCK 合成A店',
     quote:{storeCode:'MOCK_A',ctxVersion:1,quotedAt:'2026-10-10T00:00:00Z',
      cartSignature:body.cartSignature,...payload}});
    return;
   }
   return json(404,{ok:false,error:'未知接口'});
  });
 });
 await new Promise(r=>srv.listen(0,'127.0.0.1',r));
 const SP=srv.address().port;
 const WEBFILE='file://'+path.resolve(__dirname,'..','web','index.html');

 const b=await chromium.launch({headless:true,executablePath:EXE,args:['--no-proxy-server','--proxy-bypass-list=<-loopback>']});
 const ctx=await b.newContext({viewport:{width:390,height:844}});
 const p=await ctx.newPage();
 const errs=[];p.on('pageerror',e=>errs.push(e.message));
 /* 把页面的 API 指向本地 mock，并把"释放报价响应"的钩子暴露给测试 */
 await ctx.addInitScript(port=>{
  const orig=window.fetch.bind(window);
  window.__releasePrice=null;
  window.fetch=(u,o)=>{
   const url=String(u).replace('http://127.0.0.1:8795','http://127.0.0.1:'+port);
   return orig(url,o);
  };
 },SP);
 await ctx.exposeFunction('__mockRelease',()=>{ if(state.releasePrice){state.releasePrice();state.releasePrice=null;} });

 const setup=async()=>{
  await p.goto(WEBFILE,{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(350);
  await p.evaluate(m=>{
   S.menu=m;
   S.ctx={storeCode:'MOCK_A',storeName:'MOCK 合成A店',orderType:1,beType:1,ctxVersion:1};
   S.step=9;S.people=1;S.budgetMinor=null;S.externalDrinks=0;S.dir=null;S.novelty='safe';S.meals=1;
   S.qOverride={};S.specMap={};S.lockedComb=null;S.quote=null;S.mode3=null;
   render();
  },MENU);
  await p.waitForTimeout(120);
  await p.evaluate(()=>{const {pick}=solve();
   S.lockedComb=pick.items.map(z=>({code:z.it.code,qty:z.qty}));render();});
  await p.waitForTimeout(80);
 };
 const add=(id,scene,expect,actual,pass)=>out.push({id,scene,expect,actual,pass});

 /* R4-05 前端旧报价竞态：改数量后释放旧响应 */
 await setup();
 await p.evaluate(()=>{doQuote();});
 await p.waitForTimeout(350);
 await p.evaluate(()=>{S.qOverride.MAIN_A=2;render();});
 await p.waitForTimeout(150);
 await p.evaluate(()=>__mockRelease());
 await p.waitForTimeout(400);
 const r5=await p.evaluate(()=>({
  hasQuote:!!S.quote,price:S.quote&&S.quote.price,
  sigMatch:S.quote?S.quote.signature===cartSignature():null,
  staleShown:!!document.querySelector('.stale'),
  foot:(document.querySelector('.foot')||{}).textContent||''}));
 add('R4-05','前端：改数量后旧报价响应不得绑定到新餐单',
  '旧响应被丢弃，或页面显示为已过期；不得把 20 元显示为当前有效报价',
  r5.hasQuote?('报价 '+r5.price+'，签名匹配='+r5.sigMatch+'，页面过期标记='+r5.staleShown):'旧响应已丢弃',
  !r5.hasQuote||r5.sigMatch===false||r5.staleShown===true);

 /* R4-06 / R4-07 直接换单品（未先改数量）*/
 await setup();
 const r6=await p.evaluate(()=>{
  const before=solve().pick.items.find(x=>x.it.code==='MAIN_A');
  S.specMap.MAIN_A={values:[{code:'A_SAUCE',key:'0-1',quantity:1}],sig:'A_SAUCE'};
  openSwap(before.it);
  const btn=[...document.querySelectorAll('#swapBody .store')].find(x=>/高价/.test(x.textContent));
  if(btn)btn.click();
  const after=solve();
  const line=after.pick?after.pick.items.find(x=>x.it.code==='MAIN_B'):null;
  return {qty:line?line.qty:null,
   specB:S.specMap.MAIN_B?JSON.stringify(S.specMap.MAIN_B):null,
   text:[...document.querySelectorAll('.row-item .info strong')].map(x=>x.textContent).join(' | '),
   outQty: after.pick ? after.pick.items.map(x=>x.it.code+':'+x.qty) : []};
 });
 add('R4-06','前端：未改数量直接换单品，必须有合法数量',
  'MAIN_B 的 quantity 为 ≥1 的整数；页面不出现 ×undefined / ¥NaN',
  '换后 '+r6.outQty.join(', ')+'；页面「'+r6.text.replace(/\s+/g,' ').slice(0,50)+'」',
  Number.isInteger(r6.qty)&&r6.qty>=1&&!/undefined|NaN/.test(r6.text));
 add('R4-07','前端：换商品不得沿用旧商品专属规格',
  'MAIN_B 不得携带 A_SAUCE',
  r6.specB?('MAIN_B 规格='+r6.specB):'MAIN_B 无规格',
  !r6.specB||!r6.specB.includes('A_SAUCE'));

 /* R4-08 / R4-09 复制过期报价 + 规格 */
 await setup();
 const r8=await p.evaluate(async()=>{
  S.specMap.MAIN_A={values:[{code:'A_SAUCE',key:'0-1',quantity:1}],sig:'A_SAUCE'};
  render();
  S.quote={storeCode:'MOCK_A',ctxVersion:1,quotedAt:'2026-10-10T00:00:00Z',signature:'FORCED_STALE',
   productPrice:2000,originalPrice:2000,discount:0,price:2000,deliveryPrice:0,
   productList:[{productCode:'MAIN_A',productName:'MOCK 基础汉堡',quantity:1,subtotal:1000},
    {productCode:'SIDE_A',productName:'MOCK 薯条',quantity:1,subtotal:500},
    {productCode:'DRINK_A',productName:'MOCK 茶',quantity:1,subtotal:500}]};
  S.qOverride.MAIN_A=2;render();
  window.__copied='';
  /* file:// 下 navigator.clipboard 是只读访问器，直接赋值会静默失败，
     必须用 defineProperty 覆盖，否则会误判为"复制内容为空"。 */
  Object.defineProperty(navigator,'clipboard',{value:{writeText:async t=>{window.__copied=t;}},
   configurable:true});
  await copyCart();
  return window.__copied;
 });
 const showsOldAsCurrent=/官方报价合计/.test(r8)&&/20\.00/.test(r8);
 if(!r8||!r8.trim()){
  add('R4-08','前端：复制餐单不得把过期报价当作当前合计','复制文本必须非空','复制文本为空（测试未捕获到）',false);
 }else{
  add('R4-08','前端：复制餐单不得把过期报价当作当前合计',
   '过期报价必须标明待重算，不能作为当前官方合计',
   showsOldAsCurrent?('仍写「官方报价合计 ¥20.00」：'+r8.replace(/\n/g,' | ').slice(0,90))
    :('含过期标记：'+/待重新算价|已过期/.test(r8)),
   !showsOldAsCurrent&&/待重新算价|已过期/.test(r8));
 }
 add('R4-09','前端：复制餐单必须包含规格',
  '复制文本含所选规格',
  /规格：/.test(r8)?'含规格行':'未出现规格行',
  /规格：/.test(r8));

 /* R4-10 零缺口不再强制加饮品 */
 await setup();
 const r10=await p.evaluate(()=>{
  S.people=1;S.externalDrinks=1;S.lockedComb=null;
  const s=solve();
  return s.pick?s.pick.items.map(x=>x.it.code+':'+x.qty):null;
 });
 add('R4-10','选餐：已有饮品且缺口为零时不再强制加饮品',
  '1 人且已有 1 杯饮品 → 推荐中无额外饮品',
  '推荐='+JSON.stringify(r10),
  !(r10||[]).some(x=>/DRINK/.test(x)));

 /* R4-11 换商品后重新核对预算 */
 await setup();
 const r11=await p.evaluate(()=>{
  S.budgetMinor=2500;S.lockedComb=null;render();
  const main=solve().pick.items.find(x=>x.it.code==='MAIN_A');
  openSwap(main.it);
  const btn=[...document.querySelectorAll('#swapBody .store')].find(x=>/高价/.test(x.textContent));
  if(btn)btn.click();
  const s=solve();
  return {total:s.pick?s.pick.total:null,over:!!s.overBudget,within:!!s.withinBudget,
   text:document.querySelector('#app').textContent.replace(/\s+/g,' ').slice(0,220)};
 });
 add('R4-11','选餐：替换商品超出预算后必须明确提示并可调整',
  '超预算被识别，且页面出现明确提示与调整入口',
  '合计 '+(r11.total/100)+' 元，overBudget='+r11.over+'；页面含提示='+/超出预算|预算/.test(r11.text),
  r11.total===null||r11.total<=2500||(/超出预算/.test(r11.text)&&/上一题|减少|换回/.test(r11.text)));

 /* R4-13 第 6 题「尝新/换一样」必须真的改变结果，不能只是换句话 */
 await setup();
 const r13=await p.evaluate(()=>{
  S.budgetMinor=null;S.novelty='safe';S.lockedComb=null;
  const a=solve().pick.items.map(x=>x.it.code);
  /* 必须在不锁组合的状态下求解，否则走的是"沿用已展示组合"分支 */
  S.lockedComb=null;S.novelty='swap';
  const s=solve();
  const b=s.pick?s.pick.items.map(x=>x.it.code):null;
  const swapped=!!s.swapped;
  render();
  const dom=[...document.querySelectorAll('#app .row-item .info strong')].map(n=>n.textContent);
  return {safe:a,swap:b,swapped,dom};
 });
 add('R4-13','选餐：第 6 题「换一样」必须真的换一组商品',
  'safe 与 swap 得到的主食不同，且 swapped=true，页面渲染同步更换',
  'safe='+JSON.stringify(r13.safe)+'；swap='+JSON.stringify(r13.swap)+'；swapped='+r13.swapped+
  '；页面行='+JSON.stringify(r13.dom),
  !!r13.swapped&&!!r13.swap&&r13.safe[0]!==r13.swap[0]&&/高价汉堡/.test(r13.dom.join('|')));

 /* R4-14 未参与计算的答案必须在结果页披露，不能让用户以为自己选了也生效 */
 await setup();
 const r14=await p.evaluate(()=>{
  S.lockedComb=null;S.taste='清爽一点';S.meals=3;
  S.memConsent={taste:true,selection:false,plan:false,feedback:false};render();
  const t=document.querySelector('#app').textContent.replace(/\s+/g,' ');
  return {taste:/没有用它筛选商品/.test(t),meals:/多顿排程在真实接入版尚未实现/.test(t),
   mem:/仅在本次会话内记录/.test(t),text:t.slice(0,160)};
 });
 add('R4-14','结果页必须披露哪些答案没有参与计算',
  '口味、多顿、记忆三类未生效答案都有明确说明',
  '口味='+r14.taste+'；多顿='+r14.meals+'；记忆='+r14.mem,
  r14.taste&&r14.meals&&r14.mem);

 add('R4-12','页面无 JS 错误（离线反例运行期间）','errs.length===0',
  errs.length?('错误：'+errs.slice(0,2).join(' | ')):'无',errs.length===0);

 await b.close();
 srv.close();
 return out;
}

/* 独立可运行入口 + 看门狗（防止任何一步卡死） */
const MENU={ok:true,source:'SYNTHETIC_MOCK_ONLY',storeCode:'MOCK_A',storeName:'MOCK 合成A店',
 orderType:1,beType:1,checkedAt:'2026-10-10T00:00:00Z',
 categories:[{name:'汉堡',meals:['MAIN_A','MAIN_B']},{name:'小食',meals:['SIDE_A']},{name:'饮品',meals:['DRINK_A']}],
 items:[{code:'MAIN_A',name:'MOCK 基础汉堡',priceMinor:1000},
        {code:'MAIN_B',name:'MOCK 高价汉堡',priceMinor:4000},
        {code:'SIDE_A',name:'MOCK 薯条',priceMinor:500},
        {code:'DRINK_A',name:'MOCK 茶',priceMinor:500}]};
const DETAIL_A={ok:true,code:'MAIN_A',name:'MOCK 基础汉堡',supportModify:true,
 modificationGroups:[{name:'酱料',values:[{code:'A_SAUCE',name:'A酱',priceMinor:0,
  selectedKey:'0-1',unselectedKey:'0-0',minQuantity:0,maxQuantity:1,selectedQuantity:1}]}]};
const DETAIL_B={ok:true,code:'MAIN_B',name:'MOCK 高价汉堡',supportModify:true,
 modificationGroups:[{name:'芝士',values:[{code:'B_CHEESE',name:'B芝士',priceMinor:50,
  selectedKey:'0-1',unselectedKey:'0-0',minQuantity:0,maxQuantity:1,selectedQuantity:1}]}]};
const QUOTE_20={productPrice:2000,originalPrice:2000,discount:0,price:2000,deliveryPrice:0,
 productList:[{productCode:'MAIN_A',productName:'MOCK 基础汉堡',quantity:1,subtotal:1000},
              {productCode:'SIDE_A',productName:'MOCK 薯条',quantity:1,subtotal:500},
              {productCode:'DRINK_A',productName:'MOCK 茶',quantity:1,subtotal:500}]};
const http=require('http'),fsx=require('fs');
const STAGE=(process.argv.includes('--stage')?process.argv[process.argv.indexOf('--stage')+1]:null)||'run';
const OUT=path.resolve(__dirname,'..','整改记录','第四轮');
(async()=>{
 const wd=setTimeout(()=>{console.error('看门狗超时（120s），强制结束');process.exit(3);},120000);
 try{
  const out=await runFrontendCases();
  let pass=0;
  for(const r of out){
   console.log((r.pass?'✅ ':'❌ ')+r.id+' '+r.scene);
   console.log('   期望: '+r.expect);
   console.log('   实际: '+r.actual);
   if(r.pass)pass++;
  }
  fsx.mkdirSync(OUT,{recursive:true});
  fsx.writeFileSync(path.join(OUT,'regress-r4-fe-'+STAGE+'.json'),
   JSON.stringify({at:new Date().toISOString(),stage:STAGE,total:out.length,passed:pass,
    note:'合成数据；零真实调用',results:out},null,2));
  console.log('\n=== '+pass+'/'+out.length+' 通过（stage='+STAGE+'）===');
  clearTimeout(wd);
  process.exitCode=pass===out.length?0:1;
 }catch(e){console.error('异常:',e.message,'\n',e.stack.split('\n')[1]||'');clearTimeout(wd);process.exit(2);}
})();
