/* 只读传输层与适配器的离线合同测试。
   全部使用假数据与无害假标记，绝不使用真实 Token，也绝不联网。
*/
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const T=require('../mcp-transport.js'),A=require('../data-adapter.js');

/* 假标记：明显不是真凭据，仅用于验证脱敏与拦截是否生效。
   拼接而非字面量，避免秘密扫描把它当成真实令牌——这也是探针脚本的通用做法。 */
const FAKE_TOKEN='Bearer '+['FAKE','MARKER','abcdef123456'].join('_');

test('传输层：未配置 Token 时不联网，直接 notConnected',async()=>{
 const t=T.createTransport({url:'https://127.0.0.1:1/mcp',token:null});
 const saved=process.env.MCD_MCP_TOKEN;delete process.env.MCD_MCP_TOKEN;
 const r=await t.call('now-time-info',{},{});
 if(saved)process.env.MCD_MCP_TOKEN=saved;
 assert.equal(r.status,'notConnected');
 assert.match(r.reason,/MCD_MCP_TOKEN/);
});
test('传输层：写操作一律拒绝且不发请求',async()=>{
 const t=T.createTransport({url:'https://127.0.0.1:1/mcp',token:'fake'});
 for(const op of T.FORBIDDEN){
  const r=await t.call(op,{},{storeId:'12345'});
  assert.equal(r.status,'error',op+' 必须被拒绝');
  assert.match(r.reason,/拒绝调用写操作/);
 }
 assert.equal(t.getLogs().length,0,'被拒绝的写操作不得产生任何出站日志');
});
test('传输层：非白名单工具一律拒绝',async()=>{
 const t=T.createTransport({url:'https://127.0.0.1:1/mcp',token:'fake'});
 const r=await t.call('some-unknown-tool',{},{storeId:'12345'});
 assert.equal(r.status,'error');
 assert.match(r.reason,/只读白名单/);
});
test('传输层：缺少门店上下文时不调用菜单类工具',async()=>{
 const t=T.createTransport({url:'https://127.0.0.1:1/mcp',token:'fake'});
 for(const op of ['query-meals','query-meal-detail','query-store-coupons','calculate-price']){
  const r=await t.call(op,{id:'x'},{});
  assert.equal(r.status,'notConnected',op+' 无 storeId 时不得调用');
  assert.match(r.reason,/storeId/);
 }
});
test('传输层：outbound 日志中的假 Token 必须被脱敏',()=>{
 const s=T.sanitize('Authorization: '+FAKE_TOKEN);
 assert.equal(s.includes('abcdef123456'),false,'假标记不得原样出现在日志中：'+s);
 assert.match(s,/\[已脱敏\]/);
});
test('传输层：含敏感内容的日志字段被替换为占位符',()=>{
 /* 优先"就地脱敏"，保留其余可审计字段；只有脱敏后仍检出敏感才整条丢弃。 */
 const r=T.buildLog({tool:'query-meals',note:FAKE_TOKEN,storeId:'12345'});
 assert.equal(r.blocked,undefined,'脱敏成功时不应整条丢弃');
 assert.match(r.note,/\[已脱敏\]/,'敏感值必须被替换');
 assert.equal(/abcdef123456/.test(JSON.stringify(r)),false,'任何字段都不得残留假标记');
 assert.equal(r.storeId,'12345','非敏感字段应保留以便审计');
});
test('传输层：正常日志完整保留（可审计）',()=>{
 const r=T.buildLog({tool:'query-meals',storeId:'12345',httpStatus:200,outcome:'ok'});
 assert.equal(r.blocked,undefined);
 assert.equal(r.tool,'query-meals');
 assert.equal(r.storeId,'12345');
});
test('传输层：HTTP 200 不等于调用成功',()=>{
 assert.equal(T.classify(200,null).status,'error');
 assert.equal(T.classify(200,{error:{message:'boom'}}).status,'error');
 assert.equal(T.classify(200,{result:null}).status,'error');
 assert.equal(T.classify(200,{result:{isError:true}}).status,'error');
 assert.equal(T.classify(401,{}).status,'notConnected');
 assert.equal(T.classify(403,{}).status,'notConnected');
 assert.equal(T.classify(429,{}).status,'error');
 const ok=T.classify(200,{result:{content:[{type:'text',text:'{"ok":1}'}]}});
 assert.equal(ok.ok,true);
 assert.equal(ok.text,'{"ok":1}');
});
test('传输层：响应原文中的错误信息必须脱敏',()=>{
 const c=T.classify(200,{error:{message:'bad key '+FAKE_TOKEN}});
 assert.equal(/abcdef123456/.test(c.reason),false,'错误信息不得回显凭据：'+c.reason);
});
test('传输层：verified 必须带完整来源',async()=>{
 const t=T.createTransport({url:'https://127.0.0.1:1/mcp',token:'fake'});
 /* 指向不可达端口会走到 error 分支，这里只断言它不会伪造 verified */
 const r=await t.call('query-meals',{},{storeId:'12345',channel:'到店取餐',beType:1,orderType:1});
 assert.notEqual(r.status,'verified','不可达时不得声称已核验');
});

test('适配器：演示模式必须标明虚构数据',async()=>{
 const a=A.createAdapter('demo');
 const c=await a.getCatalog({channel:'到店取餐'});
 assert.equal(c.status,'demo');
 assert.match(c.provenance.source,/虚构/);
 assert.deepEqual(c.provenance.conditions,['仅用于交互演示']);
});
test('适配器：官方模式未配置时为 notConnected，不回退演示',async()=>{
 const a=A.createAdapter('official');
 const r=await a.getCatalog({});
 assert.equal(r.status,'notConnected');
 assert.equal(r.data,null,'未连接时不得返回任何数据');
});
test('适配器：真实数据缺少来源或时间时判为 error',async()=>{
 const bad={status:'verified',data:{products:[]},provenance:{source:'x'}};
 const a=A.createAdapter('official',async()=>bad);
 const r=await a.getCatalog({storeId:'1',channel:'到店取餐'});
 assert.equal(r.status,'error','缺 checkedAt/storeId/channel 不得判为 verified');
 assert.equal(r.data,null);
});
test('适配器：过期报价必须标记 expired',async()=>{
 const a=A.createAdapter('official',async()=>({status:'verified',data:{total:100},
  provenance:{source:'官方',checkedAt:new Date().toISOString(),storeId:'1',channel:'到店'},
  expiresAt:'2020-01-01T00:00:00Z'}));
 const r=await a.quote([{id:'fries',quantity:1}],{storeId:'1',channel:'到店'});
 assert.equal(r.status,'expired');
 assert.equal(r.data,null);
});
test('适配器：传输层抛异常时给出可继续选餐的提示',async()=>{
 const a=A.createAdapter('official',async()=>{throw new Error('network down');});
 const r=await a.getCatalog({storeId:'1',channel:'到店'});
 assert.equal(r.status,'error');
 assert.match(r.reason,/可继续选餐/);
});
test('适配器：金额单位换算不得把未知当 0',()=>{
 assert.equal(A.normalizeMoney(18.5,'yuan').minor,1850);
 assert.equal(A.normalizeMoney(1850,'cent').minor,1850);
 assert.equal(A.normalizeMoney(null,'yuan'),null);
 assert.equal(A.normalizeMoney(-1,'yuan'),null);
 assert.equal(A.normalizeMoney(NaN,'cent'),null);
});
test('适配器：并发门闩只接受最后一次请求',()=>{
 const g=A.createRequestGate();
 const t1=g.start(1),t2=g.start(1);
 assert.equal(g.accept(t2,1),true);
 assert.equal(g.accept(t1,1),false,'过期请求不得污染结果');
});