#!/usr/bin/env node
/* 本地安全网关：浏览器与官方 MCP 之间的唯一通道。
 *
 * 安全边界（硬性）：
 *  1. 只监听 127.0.0.1，不开放任何外部地址，公网无法访问
 *  2. 凭据只从 ~/.workbuddy/mcp.json 读入内存，绝不下发给浏览器、绝不写盘
 *  3. 浏览器拿不到、也拿不到 key；它只能调用本文件暴露的 5 个只读接口
 *  4. 所有对外响应经脱敏：地址、门店名以外的个人信息、traceId 一律不出网
 *  5. 不实现任何写操作（下单/领券/积分/地址）——只读白名单，架构上杜绝
 *  6. 失败时如实报错，绝不用演示数据冒充真实结果
 *
 * 对外接口（全部只读）：
 *   GET  /api/context      当前上下文（门店/就餐方式/时段/来源/时间）
 *   POST /api/stores       按城市或关键词搜门店
 *   POST /api/menu         拉取真实可售菜单
 *   POST /api/detail       餐品详情与规格
 *   POST /api/price        官方算价（对少量方案调用）
 *   GET  /api/health       健康检查与来源声明
 */
'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),https=require('node:https');

const CFG_PATH=path.join(process.env.HOME||'', '.workbuddy','mcp.json');
let MCP_URL=null,HEADERS={};
try{
 const cfg=JSON.parse(fs.readFileSync(CFG_PATH,'utf8'));
 const s=(cfg.mcpServers||{})['mcd-mcp']||{};
 MCP_URL=s.url;HEADERS=s.headers||{};
 /* 测试基础设施（不是业务逻辑）：
    离线反例需要把上游换成合成 mock。只允许指向本机回环，
    且必须显式打开；生产运行时该变量为空，行为不变。 */
 if(process.env.MCD_GATEWAY_MOCK_UPSTREAM){
  const u=new URL(process.env.MCD_GATEWAY_MOCK_UPSTREAM);
  if(u.hostname==='127.0.0.1'||u.hostname==='localhost')MCP_URL=process.env.MCD_GATEWAY_MOCK_UPSTREAM;
  else{console.error('MCD_GATEWAY_MOCK_UPSTREAM 只允许指向 127.0.0.1');process.exit(2);}
 }
}catch(e){
 console.error('无法读取 MCP 配置：'+e.message);
 console.error('请先在 ~/.workbuddy/mcp.json 配置 mcd-mcp 服务。');
 process.exit(1);
}
if(!MCP_URL){console.error('配置中缺少 mcd-mcp.url');process.exit(1);}

/* 每次启动的身份标识：测试据此确认连到的是"本次启动的服务"，而不是残留旧进程 */
const RUN_ID=(process.env.MCD_GATEWAY_RUN_ID||('run-'+Date.now().toString(36)+'-'+require('node:crypto').randomBytes(3).toString('hex')));
/* 源码指纹：便于证据与运行版本对应 */
const SRC_SHA=require('node:crypto').createHash('sha256')
 .update(fs.readFileSync(__filename)).digest('hex');

/* ---------- 脱敏：个人隐私不出网 ----------
   只隐去"个人"字段：收货地址、联系人、电话、地址ID、链路追踪号。
   门店的公开地址（address）是用户判断该选哪家店的必要信息，必须保留——
   早前按 /address/ 匹配把它也隐去了，导致列表里几家店无法区分。 */
const PRIVATE_KEY=/^(fullAddress|addressId|contactName|phone|traceId|receiverName|gender)$/i;
function scrubDeep(v,key){
 if(key&&PRIVATE_KEY.test(String(key)))return '[已隐去]';
 if(v===null||v===undefined)return v;
 if(typeof v==='string')return v;
 if(Array.isArray(v))return v.map(x=>scrubDeep(x,key));
 if(typeof v==='object'){const o={};for(const k of Object.keys(v))o[k]=scrubDeep(v[k],k);return o;}
 return v;
}

/* ---------- MCP 客户端 ---------- */
let seq=0;
function rpc(method,params){
 return new Promise((resolve,reject)=>{
  const body=JSON.stringify({jsonrpc:'2.0',id:++seq,method,params});
  const u=new URL(MCP_URL);
  const isLoopback=u.hostname==='127.0.0.1'||u.hostname==='localhost';
 const mod=(u.protocol==='http:'&&isLoopback)?http:https;
 const req=mod.request({hostname:u.hostname,port:u.port||(u.protocol==='http:'?80:443),
   path:u.pathname+u.search,method:'POST',
   headers:{'content-type':'application/json','accept':'application/json, text/event-stream',
    'content-length':Buffer.byteLength(body),...HEADERS}},res=>{
   let buf='';res.setEncoding('utf8');
   res.on('data',c=>{buf+=c;if(buf.length>8e6)req.destroy();});
   res.on('end',()=>{
    if(res.statusCode===401)return reject(Object.assign(new Error('鉴权失败：凭据无效或已失效'),{httpStatus:401}));
    if(res.statusCode===403)return reject(Object.assign(new Error('鉴权失败：无访问权限'),{httpStatus:403}));
    if(res.statusCode>=400)return reject(Object.assign(new Error('上游返回 HTTP '+res.statusCode),{httpStatus:res.statusCode}));
    const ct=res.headers['content-type']||'';
    let txt=buf;
    if(ct.includes('text/event-stream')){
     const ds=buf.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trim());
     txt=ds[ds.length-1]||'';
    }
    let json=null;try{json=JSON.parse(txt);}catch(e){}
    if(!json)return reject(new Error('上游响应无法解析'));
    if(json.error)return reject(Object.assign(new Error(json.error.message||'上游 RPC 错误'),{code:json.error.code}));
    resolve(json.result);
   });
  });
  req.setTimeout(20000,()=>{req.destroy();reject(Object.assign(new Error('上游请求超时'),{httpStatus:0}));});
  req.on('error',e=>reject(Object.assign(new Error('网络错误：'+e.code||e.message),{httpStatus:0})));
  req.end(body);
 });
}

/* 上游把业务 JSON 嵌在说明文字之后；这里配平大括号取出它 */
function extractPayload(text){
 if(!text)return null;
 const i=text.lastIndexOf('{"success"');
 if(i<0)return null;
 let d=0,e=-1,ins=false,esc=false;
 for(let k=i;k<text.length;k++){
  const ch=text[k];
  if(ins){if(esc)esc=false;else if(ch==='\\')esc=true;else if(ch==='"')ins=false;continue;}
  if(ch==='"')ins=true;
  else if(ch==='{')d++;
  else if(ch==='}'){d--;if(d===0){e=k+1;break;}}
 }
 if(e<0)return null;
 try{return JSON.parse(text.slice(i,e));}catch(err){return null;}
}

async function callTool(name,args){
 /* 白名单在**分发前**实际执行：未知工具一律拒绝，且绝不发往上游。
    旧实现里 ALLOW 只用于 health 展示，callTool 没有检查。 */
 if(!ALLOW.has(name))throw Object.assign(new Error('该操作不在允许的只读范围内'),{httpStatus:400,ownMessage:true});
 const r=await rpc('tools/call',{name,arguments:args});
 if(r.isError===true)throw new Error('上游工具返回 isError');
 const text=(r.content&&Array.isArray(r.content))
  ?r.content.filter(c=>c.type==='text').map(c=>c.text).join('\n'):'';
 const p=extractPayload(text);
 if(!p)throw new Error('上游未返回可解析的业务数据');
 if(p.success!==true)throw Object.assign(new Error(p.message||'业务失败'),{bizCode:p.code});
 return p.data;
}

/* ---------- 只读白名单：架构上杜绝写操作 ---------- */
const ALLOW=new Set(['query-nearby-stores','delivery-query-stores','query-meals',
 'query-meal-detail','calculate-price','query-store-coupons','available-coupons',
 'query-my-coupons','now-time-info','list-nutrition-foods','query-my-account','campaign-calendar']);

/* ---------- 会话：按会话隔离可变状态 ----------
   旧实现把 CTX/QUOTE 放在全局，任何标签页/会话都会互相污染，
   且 await 之后用"完成时的全局状态"给响应盖章。
   现在每个会话一份状态，且所有出站请求在**发起时**冻结快照。 */
const SESSIONS=new Map();
const SESSION_CAP=64;
function getSession(sid){
 if(!sid)throw Object.assign(new Error('缺少会话标识'),{httpStatus:400,ownMessage:true});
 let s=SESSIONS.get(sid);
 if(!s){
  if(SESSIONS.size>=SESSION_CAP){
   /* 只淘汰最久未用的会话，避免无界增长 */
   let oldest=null,oldestAt=Infinity;
   for(const [k,v] of SESSIONS)if(v.touched<oldestAt){oldestAt=v.touched;oldest=k;}
   if(oldest)SESSIONS.delete(oldest);
  }
  s={ctx:{storeCode:null,beCode:null,storeName:null,orderType:1,beType:1,ctxVersion:0,updatedAt:null},
   quote:null,storeCache:null,touched:Date.now()};
  SESSIONS.set(sid,s);
 }
 s.touched=Date.now();
 return s;
}
/* 门店检索的真实约束（实测，非猜测）：
   - searchType=1 是"搜索收藏餐厅"，收藏为空时返回 600050
   - searchType=2 需要 city 与 keyword **同时**给出，只给其一会返回 600058
   因此这里要求两者齐备；不猜测用户所在城市或位置。 */
async function listStores(cess,city,keyword){
 if(!city||!keyword)
  throw Object.assign(new Error('需要同时提供城市与关键词（上游要求两者齐备）'),{httpStatus:400,ownMessage:true});
 const data=await callTool('query-nearby-stores',
  {beType:1,searchType:2,city:String(city),keyword:String(keyword)});
 const arr=Array.isArray(data)?data:(data&&data.list)||[];
 if(!arr.length)throw Object.assign(new Error('该城市与关键词下没有找到可点餐门店'),{httpStatus:404,ownMessage:true});
 /* 门店公开信息，可下发；不含任何个人数据 */
 return arr.map(s=>({storeCode:String(s.storeCode),beCode:s.beCode||null,
  storeName:s.storeName,address:s.distance!==undefined?s.address:s.address,distance:s.distance,
  reservation:s.reservation===true,
  reservationOptions:s.reservationTimeOptions||null})).slice(0,20);
}

function bumpContext(sess,patch){
 const CTX=sess.ctx;
 const changed=Object.keys(patch).some(k=>CTX[k]!==patch[k]);
 const hadQuote=!!sess.quote;
 if(changed)sess.quote=null;/* 上下文一变，旧报价立即作废 */
 sess.ctx={...CTX,...patch,ctxVersion:CTX.ctxVersion+(changed?1:0),updatedAt:new Date().toISOString()};
 return {context:sess.ctx,quoteInvalidated:changed&&hadQuote};
}

/* ---------- 报价：发起时冻结，返回时核验 ----------
   P0-01：旧实现 await 之后用全局新 CTX 给结果盖章并写入缓存，
   导致"A 店的响应"被标成"B 店的结果"。现在：
   1) 发起时拍下不可变快照（含 requestId）
   2) 返回后逐项核对快照与当前会话/当前购物车签名
   3) 任何一项不符就 409 丢弃，绝不写入缓存 */
async function quote(sess,items,cartSig,ctxVer){
 const CTX=sess.ctx;
 if(!CTX.storeCode)throw Object.assign(new Error('尚未选择门店'),{httpStatus:400,ownMessage:true});
 if(ctxVer!==undefined&&ctxVer!==CTX.ctxVersion)
  throw Object.assign(new Error('上下文已变更，请重新算价'),{httpStatus:409,stale:true,ownMessage:true,expect:ctxVer,got:CTX.ctxVersion});
 if(!Array.isArray(items)||!items.length)throw Object.assign(new Error('没有可算价的商品'),{httpStatus:400,ownMessage:true});
 if(items.length>20)throw Object.assign(new Error('单次算价商品数超限（最多20）'),{httpStatus:400,ownMessage:true});
 /* 出发前的商品结构校验：数量必须是 ≥1 的正整数，规格必须属于所声明的组 */
 for(const it of items){
  if(!it||!it.productCode)throw Object.assign(new Error('商品缺少 productCode'),{httpStatus:400,ownMessage:true});
  if(!Number.isInteger(it.quantity)||it.quantity<1)
   throw Object.assign(new Error('商品数量必须是大于等于 1 的整数'),{httpStatus:400,ownMessage:true});
 }
 /* —— 冻结快照（此后一切标注都基于它，而不是完成时的全局状态）—— */
 const snap={requestId:require('node:crypto').randomUUID(),
  storeCode:CTX.storeCode,beCode:CTX.beCode,orderType:CTX.orderType,beType:CTX.beType,
  reservationDate:CTX.reservationDate,ctxVersion:CTX.ctxVersion,cartSig:cartSig||null,
  items:JSON.parse(JSON.stringify(items))};
 const args={storeCode:snap.storeCode,orderType:snap.orderType,beType:snap.beType,items:snap.items};
 if(snap.beCode)args.beCode=snap.beCode;
 if(snap.reservationDate)args.reservationDate=snap.reservationDate;
 const data=await callTool('calculate-price',args);
 /* —— 返回后核验：门店/上下文/购物车任一变化即丢弃 —— */
 const now=sess.ctx;
 if(now.storeCode!==snap.storeCode||now.ctxVersion!==snap.ctxVersion)
  throw Object.assign(new Error('门店或上下文已变更，该报价已作废'),{httpStatus:409,stale:true,ownMessage:true,expectStore:snap.storeCode,gotStore:now.storeCode,expectV:snap.ctxVersion,gotV:now.ctxVersion});

 const q={requestId:snap.requestId,ctxVersion:snap.ctxVersion,storeCode:snap.storeCode,
  orderType:snap.orderType,beType:snap.beType,cartSignature:snap.cartSig,
  quotedAt:new Date().toISOString(),...scrubDeep(data)};
 sess.quote=q;
 return q;
}

/* ---------- HTTP 服务 ---------- */
function send(res,code,obj){
 const body=JSON.stringify(scrubDeep(obj));
 res.writeHead(code,{'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store','x-content-type-options':'nosniff'});
 res.end(body);
}
function readBody(req){
 return new Promise((resolve,reject)=>{
  let b='';req.on('data',c=>{b+=c;if(b.length>1e6){req.destroy();reject(new Error('请求体过大'));}});
  req.on('end',()=>{try{resolve(b?JSON.parse(b):{});}catch(e){reject(new Error('请求体不是合法 JSON'));}});
  req.on('error',reject);
 });
}

/* ---------- 公开错误映射：绝不透传上游原文 ----------
   R4-03：合成上游错误里含 CANARY，旧实现把 message 原样返回浏览器。
   现在对外只暴露稳定的 code + 白名单内的中文提示；
   详细原因只写本地日志，且日志里也要去掉 URL 与疑似凭据片段。 */
const SENSITIVE=[
 /Bearer\s+[A-Za-z0-9\-_.]{6,}/gi,
 /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
 /\b(sk-|pk_|ghp_|gho_|AKIA)[A-Za-z0-9]{10,}/g,
 /https?:\/\/[^\s"'<>]+/g,
 /[一-龥]{0,4}(路|街|号|小区|大厦)[\w\-号栋室层]{0,20}/g
];
function scrubLog(s){
 let t=String(s===undefined||s===null?'':s);
 for(const re of SENSITIVE)t=t.replace(re,'[已脱敏]');
 return t.slice(0,300);
}
/* 对外错误：固定 code + 固定文案。任何上游细节都不外传。 */
const PUBLIC_ERR={
 401:['UNAUTHORIZED','会话未授权或已失效，请刷新页面重试'],
 403:['FORBIDDEN','请求来源不被允许'],
 404:['NOT_FOUND','未找到可用的数据'],
 409:['STALE','上下文已变更，请重新操作'],
 400:['BAD_REQUEST','请求参数不合法'],
 413:['TOO_LARGE','请求内容过大'],
 502:['UPSTREAM_FAILED','官方接口暂时不可用，请稍后重试'],
 503:['UPSTREAM_UNAVAILABLE','官方接口暂时不可用，请稍后重试']
};
function publicError(status){
 const e=PUBLIC_ERR[status]||PUBLIC_ERR[502];
 return {ok:false,code:e[0],error:e[1]};
}
/* 归一化任何异常到对外错误；细节仅进本地日志 */
function toPublic(e){
 const st=e.httpStatus||502;
 if(!e.httpStatus||st>=500)console.error('[gateway] 上游/内部错误:',scrubLog(e.message));
 else console.error('[gateway] 请求被拒:',scrubLog(e.message));
 /* 自己写出来的参数校验提示是安全的（不含上游内容），
    直接返回具体原因，界面才能给出可操作的下一步；
    上游错误与内部错误一律用通用文案，绝不透传原文。 */
 if(e.ownMessage&&st<500)return {ok:false,code:(PUBLIC_ERR[st]||PUBLIC_ERR[400])[0],error:e.message};
 return publicError(st);
}

/* ---------- 会话能力令牌 ----------
   CORS 不是鉴权。每次启动生成一个令牌，只有本项目网页知道；
   其他本机页面即使猜到端口也拿不到令牌。 */
const SESSION_TOKEN=require('node:crypto').randomBytes(24).toString('hex');
const WEB_PORT=Number(process.env.WEB_PORT||8796);
const WEB_ORIGIN='http://127.0.0.1:'+WEB_PORT;

const server=http.createServer(async(req,res)=>{
 /* 1) 仅本机 Host */
 const host=(req.headers.host||'').split(':')[0];
 if(!['127.0.0.1','localhost','[::1]'].includes(host)){
  return send(res,403,{ok:false,code:'FORBIDDEN',error:'请求来源不被允许'});
 }
 /* 2) Origin 精确到 scheme+host+port，而不是"任意本地端口" */
 const origin=req.headers.origin;
 if(origin){
  let ok=false;
  try{const o=new URL(origin);ok=(o.protocol==='http:'||o.protocol==='https:')
   &&(o.hostname==='127.0.0.1'||o.hostname==='localhost')&&Number(o.port||80)===WEB_PORT;}
  catch(e){}
  if(!ok)return send(res,403,publicError(403));
  res.setHeader('access-control-allow-origin',origin);
  res.setHeader('vary','Origin');
 }
 if(req.method==='OPTIONS'){
  res.writeHead(204,{'access-control-allow-methods':'GET,POST,OPTIONS',
   'access-control-allow-headers':'content-type,x-session-token',
   'access-control-max-age':'600'});
  return res.end();
 }
 const u=new URL(req.url,'http://127.0.0.1');
 const p=u.pathname;
 try{
  /* 健康检查不需要会话，但也不泄露任何敏感信息 */
  if(p==='/api/health'&&req.method==='GET')
   return send(res,200,{ok:true,source:'official-mcp',mode:'real',
    protocolVersion:'2025-03-26',writeOpsEnabled:false,
    toolsExposed:[...ALLOW],runId:RUN_ID,sourceSha:SRC_SHA,
    webOrigin:WEB_ORIGIN,note:'真实官方数据；写操作未开放'});

  /* 3) 其余接口一律要求会话令牌 */
  const token=req.headers['x-session-token'];
  if(token!==SESSION_TOKEN)return send(res,401,{ok:false,code:'UNAUTHORIZED',error:'会话未授权或已失效，请刷新页面重试'});
  const sid=token.slice(0,32);
  const sess=getSession(sid);

  if(p==='/api/context'&&req.method==='GET'){
   const C2=sess.ctx;
   return send(res,200,{ok:true,context:C2,hasQuote:!!sess.quote,
    quoteContextVersion:sess.quote?sess.quote.ctxVersion:null,
    quoteStale:sess.quote?sess.quote.ctxVersion!==C2.ctxVersion:true});
  }
  if(req.method==='POST'){
   const body=await readBody(req);
   if(p==='/api/stores'){
    const list=await listStores(sess,body.city,body.keyword);
    sess.storeCache=list;
    /* 门店列表是公开信息，但字段名 address 会被脱敏规则当成个人地址隐去，
       用户在列表里就分不清是哪家店。这里显式改名为 storeAddress 后下发，
       仍然只含门店公开信息，不含任何个人数据。 */
    return send(res,200,{ok:true,stores:list.map(s=>({
     storeCode:s.storeCode,beCode:s.beCode,storeName:s.storeName,
     storeAddress:s.address,distance:s.distance,
     reservation:s.reservation,reservationOptions:s.reservationOptions}))});
   }
   if(p==='/api/context'){
    if(!body.storeCode)return send(res,400,{ok:false,code:'BAD_REQUEST',error:'请先选择门店'});
    const beType=[1,5].includes(body.beType)?body.beType:1;
    const orderType=1;
    const known=sess.storeCache&&sess.storeCache.find(s=>s.storeCode===String(body.storeCode));
    const r=bumpContext(sess,{storeCode:String(body.storeCode),
     beCode:body.beCode||(known&&known.beCode)||null,
     storeName:body.storeName||(known&&known.storeName)||null,
     orderType,beType,
     reservationDate:body.reservationDate||null});
    sess.cartSig=body.cartSignature||null;
    return send(res,200,{ok:true,context:r.context,quoteInvalidated:r.quoteInvalidated});
   }
   if(p==='/api/menu'){
    const snap={...sess.ctx};/* 菜单同样冻结快照 */
    if(!snap.storeCode)return send(res,400,{ok:false,code:'BAD_REQUEST',error:'请先选择门店'});
    if(body.ctxVersion!==undefined&&body.ctxVersion!==snap.ctxVersion)
     return send(res,409,{ok:false,code:'STALE',error:'门店上下文已变更，请重新选择门店',stale:true});
    const args={storeCode:snap.storeCode,orderType:snap.orderType,beType:snap.beType};
    if(snap.beCode)args.beCode=snap.beCode;
    if(snap.reservationDate)args.reservationDate=snap.reservationDate;
    const data=await callTool('query-meals',args);
    /* 返回后核验：期间换了门店就必须丢弃，不能把 A 店菜单标成 B 店 */
    if(sess.ctx.storeCode!==snap.storeCode||sess.ctx.ctxVersion!==snap.ctxVersion)
     return send(res,409,{ok:false,code:'STALE',error:'门店上下文已变更，请重新选择门店',stale:true});
    const table=data&&data.meals||{};
    const items=Object.keys(table).map(code=>({code,
     name:table[code].name,priceMinor:Number(table[code].currentPrice)*100,
     originalPriceMinor:Number(table[code].originalPrice)*100,
     canWithOrder:table[code].canWithOrder===true,image:table[code].image||null}));
    return send(res,200,{ok:true,source:'official-mcp',checkedAt:new Date().toISOString(),
     storeCode:snap.storeCode,storeName:snap.storeName,orderType:snap.orderType,beType:snap.beType,
     categories:(data&&data.categories||[]).map(c=>({name:c.name,meals:(c.meals||[]).map(m=>m.code)})),
     items});
   }
   if(p==='/api/detail'){
    const snap={...sess.ctx};
    if(!snap.storeCode)return send(res,400,{ok:false,code:'BAD_REQUEST',error:'请先选择门店'});
    if(!body.code)return send(res,400,{ok:false,code:'BAD_REQUEST',error:'请先选择门店'});
    const args={storeCode:snap.storeCode,orderType:snap.orderType,beType:snap.beType,code:String(body.code)};
    if(snap.beCode)args.beCode=snap.beCode;
    const d=await callTool('query-meal-detail',args);
    const mods=(d&&d.modification&&d.modification.items)||[];
    return send(res,200,{ok:true,source:'official-mcp',checkedAt:new Date().toISOString(),
     code:d.code,name:d.name,supportModify:d.supportModify===true,
     rounds:d.rounds||[],
     modificationGroups:mods.map(g=>({name:g.name||null,
      minValues:g.minValues,maxValues:g.maxValues,
      values:(g.values||[]).map(v=>({code:v.code,name:v.name,priceMinor:(v.price||0)*100,
       maxQuantity:v.maxQuantity,minQuantity:v.minQuantity,
       selectedQuantity:v.selectedQuantity,selectedKey:v.selectedKey,unselectedKey:v.unselectedKey}))})),
     /* 营养/成分：接口未返回就是未知，绝不从名称推断 */
     nutrition:null,allergens:null,unknownFields:['nutrition','allergens']});
   }
   if(p==='/api/price'){
    const q=await quote(sess,body.items,body.cartSignature,body.ctxVersion);
    return send(res,200,{ok:true,quote:q,source:'official-mcp',
     storeCode:q.storeCode,storeName:sess.ctx.storeName});
   }
  }
  return send(res,404,publicError(404));
 }catch(e){
  /* 对外只给稳定 code 与固定文案；上游原文仅进脱敏后的本地日志 */
  const out=toPublic(e);
  if(e.stale)out.stale=true;
  return send(res,e.httpStatus>=400&&e.httpStatus<600?e.httpStatus:502,out);
 }
});

const PORT=Number(process.env.PORT||8787);
server.listen(PORT,'127.0.0.1',()=>{
 const actual=server.address().port;
 console.log('真实 MCP 网关已启动');
 console.log('  监听：http://127.0.0.1:'+actual+'  （仅本机，公网不可达）');
 console.log('  上游：'+MCP_URL);
 console.log('  凭据：已从配置文件读入内存，不下发浏览器');
 console.log('  写操作：未开放（架构上不可调用）');
 console.log('  runId：'+RUN_ID);
 /* 会话令牌是本次启动的能力凭证：绝不打印到 stdout（日志会被归档）。
    测试需要它时，通过 MCD_GATEWAY_TOKEN_FILE 写入一个仅本机可读的临时文件。 */
 if(process.env.MCD_GATEWAY_TOKEN_FILE){
  try{fs.writeFileSync(process.env.MCD_GATEWAY_TOKEN_FILE,SESSION_TOKEN,{mode:0o600});}catch(e){}
 }
});
server.on('error',e=>{console.error('启动失败：'+e.message);process.exit(1);});