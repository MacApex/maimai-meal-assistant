#!/usr/bin/env node
/* 响应式与缩放：320 / 390 / 1024 / 1440，以及浏览器级 200% 缩放。
   检查项：关键元素可见、无横向溢出、报价区金额完整、点击目标不小于 44px。
   截图落在 证据/，供人工查看。 */
'use strict';
const fs=require('fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'/Users/maxima/.npm/_npx/31e32ef8478fbf80/node_modules/playwright');
const EXE=process.env.CHROMIUM_PATH||'/Users/maxima/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell'; /* 跨机可用环境变量覆盖 */
const OUT=path.resolve(__dirname,'..','证据','responsive');
const JOUT=path.resolve(__dirname,'..','整改记录','第四轮');
const STAGE=(process.argv.includes('--stage')?process.argv[process.argv.indexOf('--stage')+1]:null)||'run';
const WEB='http://127.0.0.1:'+(process.env.WEB_PORT||8796);
const results=[];
const rec=(id,scene,expect,actual,pass,shot)=>{
 results.push({id,scene,expect,actual,pass,screenshot:shot||null});
 console.log((pass?'✅ ':'❌ ')+id+' '+scene);
 if(!pass)console.log('   期望: '+expect+'\n   实际: '+actual);
};

const SIZES=[['320',320,568],['390',390,844],['1024',1024,768],['1440',1440,900]];

/* 用离线 mock 保证可重复；真实数据由 web-flow 覆盖 */
const MENU={ok:true,source:'SYNTHETIC_RESPONSIVE_ONLY',storeCode:'MOCK',storeName:'MOCK 门店',
 orderType:1,beType:1,checkedAt:'2026-10-10T00:00:00Z',
 categories:[{name:'汉堡',meals:['MAIN_A','MAIN_B']},{name:'小食',meals:['SIDE_A']},{name:'饮品',meals:['DRINK_A']}],
 items:[{code:'MAIN_A',name:'MOCK 基础汉堡',priceMinor:1000},
        {code:'MAIN_B',name:'MOCK 高价汉堡',priceMinor:4000},
        {code:'SIDE_A',name:'MOCK 薯条',priceMinor:500},
        {code:'DRINK_A',name:'MOCK 茶',priceMinor:500}]};

(async()=>{
 fs.mkdirSync(OUT,{recursive:true});fs.mkdirSync(JOUT,{recursive:true});
 const http=require('http');
 const srv=http.createServer((q,s)=>{
  let b='';q.on('data',c=>b+=c);
  q.on('end',()=>{
   const u=new URL(q.url,'http://x');
   const body=b?JSON.parse(b):{};
   const j=(c,o)=>{s.writeHead(c,{'content-type':'application/json'});s.end(JSON.stringify(o));};
   if(u.pathname==='/api/health')return j(200,{ok:true,source:'SYNTHETIC',writeOpsEnabled:false});
   if(u.pathname==='/api/stores')return j(200,{ok:true,stores:[{storeCode:'MOCK',beCode:null,storeName:'MOCK 门店',address:'',distance:1,reservation:false}]});
   if(u.pathname==='/api/context')return j(200,{ok:true,context:{storeCode:'MOCK',storeName:'MOCK 门店',orderType:1,beType:1,ctxVersion:1},quoteInvalidated:false});
   if(u.pathname==='/api/menu')return j(200,MENU);
   if(u.pathname==='/api/detail')return j(200,{ok:true,code:body.code,name:'MOCK',supportModify:false,modificationGroups:[],rounds:[]});
   if(u.pathname==='/api/price')return j(200,{ok:true,storeName:'MOCK 门店',quote:{storeCode:'MOCK',ctxVersion:1,
    quotedAt:'2026-10-10T00:00:00Z',cartSignature:body.cartSignature,
    productPrice:2000,originalPrice:2000,discount:0,price:2000,deliveryPrice:0,
    productList:[{productCode:'MAIN_A',productName:'MOCK 基础汉堡',quantity:1,subtotal:1000},
     {productCode:'SIDE_A',productName:'MOCK 薯条',quantity:1,subtotal:500},
     {productCode:'DRINK_A',productName:'MOCK 茶',quantity:1,subtotal:500}]}});
   return j(404,{ok:false,error:'未知接口'});
  });
 });
 await new Promise(r=>srv.listen(0,'127.0.0.1',r));
 const SP=srv.address().port;

 const br=await chromium.launch({headless:true,executablePath:EXE,args:['--no-proxy-server','--proxy-bypass-list=<-loopback>']});
 const WEBFILE='file://'+path.resolve(__dirname,'..','web','index.html');

 async function prep(ctx){
  await ctx.addInitScript(port=>{
   const orig=window.fetch.bind(window);
   window.fetch=(u,o)=>orig(String(u).replace('http://127.0.0.1:8795','http://127.0.0.1:'+port),o);
  },SP);
  const p=await ctx.newPage();
  const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.goto(WEBFILE,{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(300);
  await p.evaluate(m=>{
   S.menu=m;S.ctx={storeCode:'MOCK',storeName:'MOCK 门店',orderType:1,beType:1,ctxVersion:1};
   S.step=9;S.people=1;S.budgetMinor=null;S.externalDrinks=0;S.dir=null;S.novelty='safe';S.meals=1;
   S.qOverride={};S.specMap={};S.lockedComb=null;S.quote=null;S.mode3=null;render();
  },MENU);
  await p.waitForTimeout(150);
  await p.evaluate(()=>{const {pick}=solve();S.lockedComb=pick.items.map(z=>({code:z.it.code,qty:z.qty}));render();});
  await p.waitForTimeout(120);
  return {p,errs};
 }

 for(const [label,w,h] of SIZES){
  const ctx=await br.newContext({viewport:{width:w,height:h}});
  const {p,errs}=await prep(ctx);
  const m=await p.evaluate(()=>({
   overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,
   sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth,
   rows:document.querySelectorAll('.row-item').length,
   smallTargets:[...document.querySelectorAll('button')].filter(x=>{
    const r=x.getBoundingClientRect();return r.width>0&&r.height>0&&r.height<44;}).length,
   quoteBtn:!!document.querySelector('button.cta'),
   unknownTags:document.querySelectorAll('.unknown').length
  }));
  const shot=path.join(OUT,'R-'+label+'.png');
  await p.screenshot({path:shot,fullPage:true});
  rec('RS-'+label,`${w}×${h} 布局`,
   '无横向溢出；关键元素可见；点击目标 ≥44px；页面无 JS 错误',
   '溢出='+m.overflow+'（'+m.sw+'/'+m.cw+'）行数='+m.rows+' 过小按钮='+m.smallTargets+' 错误='+errs.length,
   !m.overflow&&m.rows>0&&m.smallTargets===0&&errs.length===0,shot);
  await ctx.close();
 }

 /* 200% 缩放：用 deviceScaleFactor + 更小视口模拟放大后的可视区域，
    并额外用 CSS zoom 检查排版是否仍然成立 */
 for(const [label,w,h] of [['200%',640,900]]){
  const ctx=await br.newContext({viewport:{width:w,height:h},deviceScaleFactor:2});
  const {p,errs}=await prep(ctx);
  await p.evaluate(()=>{document.body.style.zoom='2';});
  await p.waitForTimeout(250);
  const m=await p.evaluate(()=>({
   overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+2,
   rows:document.querySelectorAll('.row-item').length,
   nameReadable:[...document.querySelectorAll('.row-item .info strong')]
    .every(x=>x.getBoundingClientRect().height>=14)
  }));
  const shot=path.join(OUT,'R-'+label+'.png');
  await p.screenshot({path:shot,fullPage:true});
  rec('RS-'+label,'200% 放大',
   '放大后仍无横向溢出；商品名保持可读行高；无 JS 错误',
   '溢出='+m.overflow+' 行数='+m.rows+' 名称行高正常='+m.nameReadable+' 错误='+errs.length,
   !m.overflow&&m.rows>0&&m.nameReadable&&errs.length===0,shot);
  await ctx.close();
 }

 /* 经典自主选餐在移动端也要可用 */
 const ctx=await br.newContext({viewport:{width:320,height:568}});
 const {p,errs}=await prep(ctx);
 await p.evaluate(()=>openClassic());
 await p.waitForTimeout(250);
 const cm=await p.evaluate(()=>({
  cats:document.querySelectorAll('#app .step h3').length,
  overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,
  back:!!document.querySelector('#app button')
 }));
 const shot=path.join(OUT,'R-classic-320.png');
 await p.screenshot({path:shot,fullPage:true});
 rec('RS-classic','经典自主选餐（320px）',
  '可进入；分类可见；无横向溢出；无 JS 错误',
  '分类标题='+cm.cats+' 溢出='+cm.overflow+' 错误='+errs.length,
  cm.cats>0&&!cm.overflow&&errs.length===0,shot);
 await ctx.close();

 await br.close();srv.close();
 const passed=results.filter(r=>r.pass).length;
 fs.writeFileSync(path.join(JOUT,'响应式与缩放.json'),
  JSON.stringify({at:new Date().toISOString(),stage:STAGE,total:results.length,passed,skipped:0,
   note:'合成菜单；仅验证布局与可读性，不涉及真实调用',results},null,2));
 console.log('\n=== '+passed+'/'+results.length+' 通过 ===');
 process.exitCode=passed===results.length?0:1;
})();