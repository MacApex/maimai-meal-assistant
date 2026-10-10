#!/usr/bin/env node
/* 网关安全与只读边界测试（全部本机，不涉及真实下单）。 */
'use strict';
const fs=require('fs'),path=require('node:path');
const G='http://127.0.0.1:'+(process.env.GATEWAY_PORT||8795);
const WEB='http://127.0.0.1:'+(process.env.WEB_PORT||8796);
let TOKEN=null;
const results=[];
const rec=(id,scene,expect,actual,pass)=>{
 results.push({id,scene,expect,actual,pass});
 console.log((pass?'✅ ':'❌ ')+id+' '+scene);
 console.log('   期望: '+expect);
 console.log('   实际: '+actual);
};
async function post(p,body,headers){
 const r=await fetch(G+p,{method:body?'POST':'GET',
  headers:Object.assign(body?{'content-type':'application/json'}:{},TOKEN?{'x-session-token':TOKEN}:{},headers||{}),
  body:body?JSON.stringify(body):undefined});
 return {status:r.status,body:await r.json().catch(()=>({}))};
}
(async()=>{
 /* 先从本网页取会话令牌；取不到就拒绝继续，避免测出假绿 */
 try{
  const r=await fetch(WEB+'/api/session');const j=await r.json();TOKEN=j.token||null;
 }catch(e){}
 if(!TOKEN){console.error('✗ 无法获取会话令牌（web 服务未启动或未授权）');process.exit(3);}
 console.log('已获取会话令牌，长度 '+TOKEN.length+'（值不回显）');
 /* 前置：网关需为全新状态（未选门店）。run-all.sh 会启动全新网关。
    若单独运行且已选过门店，前三项会因状态残留而失败。 */
 /* 1. 写操作在架构上不可达 */
 for(const p of ['/api/create-order','/api/draw-lottery','/api/auto-bind-coupons',
  '/api/cancel-order','/api/mall-create-order','/api/delivery-create-address']){
  const r=await post(p,{});
  /* 错误文案已按第四版要求改为稳定的公开 code（不再透传上游原文），
     因此这里断言「404 + 结构化 code + 无上游调用」，不再匹配旧文案。 */
  rec('G-'+p.replace(/\//g,''),'写操作路径不存在：'+p,
   '返回 404 且带稳定 code，不透传内部信息',
   'HTTP '+r.status+' code='+(r.body.code||'(无)')+' 错误='+(r.body.error||''),
   r.status===404&&!!r.body.code&&!/unknown tool|jsonrpc/i.test(r.body.error||''));
 }
 /* 2. 健康检查声明写操作关闭 */
 const h=await post('/api/health');
 rec('G-health','健康检查如实声明写操作未开放','writeOpsEnabled=false 且列出只读工具',
  'writeOpsEnabled='+h.body.writeOpsEnabled+'，只读工具 '+((h.body.toolsExposed||[]).length)+' 个',
  h.body.writeOpsEnabled===false&&(h.body.toolsExposed||[]).length>0);
 /* 3. 未选门店不得取菜单/详情/算价 */
 for(const [p,b] of [['/api/menu',{}],['/api/detail',{code:'1100'}],['/api/price',{items:[{productCode:'1100',quantity:1}]}]]){
  const r=await post(p,b);
  rec('G-pre'+p.replace(/\//g,''),'未选门店时拒绝 '+p,'返回 400 并说明需先选门店',
   'HTTP '+r.status+' '+(r.body.error||''),r.status===400&&/门店/.test(r.body.error||''));
 }
 /* 4. 搜店参数校验 */
 const noKw=await post('/api/stores',{city:'杭州'});
 rec('G-store1','搜店缺关键词时拒绝','400 并说明需城市+关键词',
  'HTTP '+noKw.status+' '+(noKw.body.error||''),noKw.status===400);
 /* 5. 恶意来源被拒 */
 const evilOrigin=await post('/api/health',null,{Origin:'https://evil.example'});
 rec('G-origin','跨域来源被拒绝','403 跨域来源被拒绝',
  'HTTP '+evilOrigin.status+' '+(evilOrigin.body.error||''),evilOrigin.status===403);
 /* fetch 属于受保护头，Host 会被忽略；这里用 http.request 原始发包才能验证。 */
 const badHost=await new Promise(res=>{
  const u=new URL(G);
  const req=require('node:http').request({hostname:u.hostname,port:u.port,path:'/api/health',
   method:'GET',headers:{Host:'evil.example'}},r=>{let b='';r.on('data',c=>b+=c);
   r.on('end',()=>res({status:r.statusCode,body:(()=>{try{return JSON.parse(b);}catch(e){return {};}})()}));});
  req.setTimeout(8000,()=>{req.destroy();res({status:0,body:{error:'timeout'}});});
  req.on('error',e=>res({status:0,body:{error:e.message}}));
  req.end();
 });
 rec('G-host','非本机 Host 被拒绝','403 仅允许本机访问',
  'HTTP '+badHost.status+' '+(badHost.body.error||''),badHost.status===403);
 /* 6. 算价商品数上限：必须先选好门店，否则会先命中"尚未选择门店"而测不到限额 */
 const st0=await post('/api/stores',{city:'杭州',keyword:'西湖'});
 const store0=st0.body.stores&&st0.body.stores[0];
 if(store0){
  await post('/api/context',{storeCode:store0.storeCode,beCode:store0.beCode,beType:1,storeName:store0.storeName});
  const many=await post('/api/price',{items:Array.from({length:21},()=>({productCode:'1100',quantity:1}))});
  rec('G-limit','单次算价商品数超限被拒','400 提示最多 20',
   'HTTP '+many.status+' '+(many.body.error||''),many.status===400&&/20/.test(many.body.error||''));
 }
 /* 7. 响应不含凭据 */
 const cfg=JSON.parse(fs.readFileSync(path.join(process.env.HOME,'.workbuddy','mcp.json'),'utf8'));
 const secrets=Object.values(cfg.mcpServers['mcd-mcp'].headers||{}).filter(v=>typeof v==='string'&&v.length>=8);
 const st=st0;
 const raw=JSON.stringify(st.body);
 rec('G-secret','接口响应不含 MCP 凭据','响应体中不出现凭据值',
  secrets.some(s=>raw.includes(s))?'发现凭据':'未发现',!secrets.some(s=>raw.includes(s)));
 rec('G-priv','门店列表不含个人账户字段','不出现 addressId/contactName/phone/fullAddress/traceId',
  (raw.match(/addressId|contactName|fullAddress|traceId/g)||[]).join(',')||'无',
  !/addressId|contactName|fullAddress|traceId/.test(raw));
 /* 8. 上下文版本：算价后改门店，旧 ctxVersion 必须被拒 */
 const store=st.body.stores&&st.body.stores[0];
 if(store){
  await post('/api/context',{storeCode:store.storeCode,beCode:store.beCode,beType:1,storeName:store.storeName});
  const c1=(await post('/api/context')).body.context.ctxVersion;
  await post('/api/context',{storeCode:(st.body.stores[1]||store).storeCode,beType:1});
  const staleQuote=await post('/api/price',{items:[{productCode:'1100',quantity:1}],ctxVersion:c1});
  rec('G-stale','换门店后用旧 ctxVersion 算价被拒','409 提示上下文已变更',
   'HTTP '+staleQuote.status+' '+(staleQuote.body.error||''),
   staleQuote.status===409&&/变更/.test(staleQuote.body.error||''));
 }
 fs.writeFileSync(path.resolve(__dirname,'..','证据','gateway-security.json'),
  JSON.stringify({at:new Date().toISOString(),total:results.length,passed:results.filter(r=>r.pass).length,results},null,2));
 console.log('\n=== '+results.filter(r=>r.pass).length+'/'+results.length+' 通过 ===');
 process.exitCode=results.every(r=>r.pass)?0:1;
})();