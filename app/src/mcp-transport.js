/* 官方只读 MCP 传输层。
   职责边界（刻意保持很窄）：
   - 只允许白名单只读工具；写操作一律拒绝，且不发请求
   - Token 只从环境变量读取，绝不进入返回值、日志或错误信息
   - 每条出站日志先脱敏再返回；命中敏感模式直接拒绝该条日志
   - 未配置 / 未授权 / 超时 / 报错都返回结构化状态，不抛异常、不伪造数据
   真实门店链路需要用户提供门店上下文与授权后才会被调用；
   本文件可在完全离线的情况下用假 transport 验证上述全部行为。
*/
'use strict';
const https=require('node:https');

/* 只读白名单。名称之外的工具一律拒绝——包括所有写操作。 */
const READONLY=new Set(['now-time-info','query-nearby-stores','query-meals','query-meal-detail',
 'query-store-coupons','query-promotions','calculate-price']);
/* 明确点名拒绝的写操作，便于审计时一眼确认边界 */
const FORBIDDEN=['create-order','cancel-order','auto-bind-coupons','mall-create-order',
 'draw-lottery','party-order-create','delivery-create-address'];

/* 敏感模式：命中即认为该条日志不可输出 */
const SENSITIVE=[
 /Bearer\s+[A-Za-z0-9\-_.]{8,}/gi,
 /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
 /\b(sk-|pk_|ghp_|gho_|AKIA)[A-Za-z0-9]{12,}/g,
 /-----BEGIN [A-Z ]*PRIVATE KEY-----/g
];

/* 对任意文本做脱敏；返回 null 表示检出敏感内容，不可输出 */
function sanitize(text){
 if(text===null||text===undefined)return '';
 let s=String(text);
 for(const re of SENSITIVE)s=s.replace(re,'[已脱敏]');
 for(const re of SENSITIVE){re.lastIndex=0;if(re.test(s))return null;}
 return s;
}

/* 出站日志：先脱敏再构造，命中敏感则整条丢弃并标记 */
function buildLog(entry){
 const safe={};
 for(const [k,v] of Object.entries(entry||{})){
  const s=sanitize(v);
  if(s===null)return {blocked:true,reason:'日志含敏感内容，已整条丢弃'};
  safe[k]=s;
 }
 return safe;
}

/* HTTP 状态与业务错误的区分：HTTP 200 不等于调用成功 */
function classify(httpStatus,body){
 if(httpStatus===401||httpStatus===403)return {status:'notConnected',reason:'鉴权未通过'};
 if(httpStatus===429)return {status:'error',reason:'请求过于频繁，稍后再试'};
 if(httpStatus<200||httpStatus>=300)return {status:'error',reason:'服务返回 HTTP '+httpStatus};
 if(body&&body.error)return {status:'error',reason:'RPC 返回 error：'+sanitize(body.error.message||'未提供信息')};
 if(!body)return {status:'error',reason:'响应为空'};
 const r=body.result;
 if(!r)return {status:'error',reason:'响应缺少 result'};
 if(r.isError===true)return {status:'error',reason:'工具返回 isError'};
 if(r.content&&Array.isArray(r.content)&&r.content.some(c=>c&&c.type==='text'&&c.text))return {ok:true,text:r.content.find(c=>c.type==='text').text};
 return {ok:true,result:r};
}

/* 创建一个 transport。opts.token 缺省时只从环境变量取，且不保存在返回对象里。 */
function createTransport(opts){
 const o=opts||{};
 const url=o.url||'https://mcp.mcd.cn';
 const token=o.token||process.env.MCD_MCP_TOKEN||null;
 const timeoutMs=o.timeoutMs||15000;
 const logs=[];
 let seq=0;

 function post(payload){
  return new Promise(resolve=>{
   let u;try{u=new URL(url);}catch(e){return resolve({httpStatus:0,error:'URL 非法'});}
   const data=Buffer.from(JSON.stringify(payload),'utf8');
   const req=https.request({hostname:u.hostname,port:u.port||443,path:u.pathname+u.search,
    method:'POST',headers:{'content-type':'application/json','content-length':data.length,
    ...(token?{authorization:'Bearer '+token}:{})}},res=>{
    let buf='';
    res.setEncoding('utf8');
    res.on('data',c=>{buf+=c;if(buf.length>2e6){req.destroy();}});
    res.on('end',()=>{
     let body=null;try{body=JSON.parse(buf);}catch(e){body=null;}
     resolve({httpStatus:res.statusCode,body,raw:buf});
    });
   });
   req.setTimeout(timeoutMs,()=>{req.destroy();resolve({httpStatus:0,error:'请求超时'});});
   req.on('error',e=>resolve({httpStatus:0,error:e.message}));
   req.end(data);
  });
 }

 /* 只读调用。写操作直接拒绝，不发请求。 */
 async function call(operation,args,context){
  if(FORBIDDEN.includes(operation))
   return {status:'error',reason:'拒绝调用写操作 '+operation+'：本项目不下单、不领券、不扣积分'};
  if(!READONLY.has(operation))return {status:'error',reason:'不在只读白名单内：'+operation};
  if(!token)return {status:'notConnected',reason:'未配置 MCD_MCP_TOKEN'};
  const c=context||{};
  if(operation!=='now-time-info'&&!c.storeId)
   return {status:'notConnected',reason:'缺少门店上下文 storeId'};
  const payload={jsonrpc:'2.0',id:++seq,method:'tools/call',
   params:{name:operation,arguments:buildArgs(operation,args,c)}};
  const r=await post(payload);
  const cls=classify(r.httpStatus||0,r.body);
  const entry=buildLog({at:new Date().toISOString(),tool:operation,
   storeId:c.storeId||null,channel:c.channel||null,httpStatus:r.httpStatus||null,
   outcome:cls.status||(cls.ok?'ok':'error'),reason:cls.reason||null});
  logs.push(entry);
  if(!cls.ok)return {status:cls.status||'error',reason:cls.reason||'调用失败'};
  return {status:'verified',text:cls.text||null,result:cls.result||null,
   provenance:{source:'麦当劳官方 MCP',checkedAt:new Date().toISOString(),
    storeId:c.storeId||null,channel:c.channel||null,tool:operation}};
 }
 /* 按各工具的真实必填字段组装参数。字段来自认证后 tools/list 的实际返回。 */
 function buildArgs(operation,args,c){
  const beType=c.beType===undefined?1:c.beType;
  const orderType=c.orderType===undefined?1:c.orderType;
  const base={storeCode:c.storeId,orderType,beType};
  if(c.reservationAt)base.reservationDate=c.reservationAt;
  if(c.beCode)base.beCode=c.beCode;
  if(operation==='query-meal-detail')return {...base,code:args&&args.id};
  if(operation==='calculate-price')return {...base,items:args&&args.items?args.items:[],needTableware:!!(args&&args.needTableware)};
  if(operation==='query-nearby-stores')return {beType,searchType:1,city:c.city||undefined,keyword:c.keyword||c.storeId};
  return base;
 }
 return {call,getLogs:()=>logs.slice(),isConfigured:()=>!!token};
}

module.exports={createTransport,READONLY,FORBIDDEN,sanitize,buildLog,classify};