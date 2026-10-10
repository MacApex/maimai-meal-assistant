(function(root){
const C=typeof module!=='undefined'?require('./demo-data.js'):root.McDemo;
const D=typeof module!=='undefined'?require('./domain.js'):root.McDomain;
const empty=(status,reason)=>({status,data:null,provenance:null,reason});
function normalizeMoney(value,unit){if(!Number.isFinite(value)||value<0)return null;if(unit==='cent'&&Number.isInteger(value))return {minor:value,currency:'CNY'};if(unit==='yuan')return {minor:Math.round(value*100),currency:'CNY'};return null;}
function createRequestGate(){let seq=0;return {start:revision=>({seq:++seq,revision}),accept:(ticket,revision)=>ticket.seq===seq&&ticket.revision===revision};}
function createAdapter(mode,transport=null){
 async function call(operation,args,context){
  if(mode==='demo')return {status:'demo',data:operation==='catalog'?C:operation==='detail'?C.products.find(p=>p.id===args)||null:operation==='quote'?{total:D.total(args,C.products)}:null,provenance:{source:'虚构演示数据',checkedAt:null,storeId:null,channel:context.channel||null,conditions:['仅用于交互演示']},...(operation==='offers'?{reason:'省钱方案待接入'}:{})};
  if(!transport)return empty('notConnected','官方只读连接尚未配置');
  try{const r=await transport(operation,args,context);if(!r||!['verified','unavailable','expired','error','notConnected'].includes(r.status))return empty('error','真实与演示数据不可混用');if(r.status==='verified'&&(!r.provenance?.source||!r.provenance?.checkedAt||!r.provenance?.storeId||!r.provenance?.channel))return empty('error','缺少真实数据来源与适用条件');if(r.expiresAt&&Date.parse(r.expiresAt)<=Date.now())return empty('expired','报价已过期，请重新核验');return r;}catch(e){return empty('error','暂时无法读取官方数据，可继续选餐');}
 }
 return {getCatalog:c=>call('catalog',null,c),getDetail:(id,c)=>call('detail',id,c),quote:(lines,c)=>call('quote',lines,c),checkOffers:(lines,c)=>call('offers',lines,c)};
}
const api={createAdapter,normalizeMoney,createRequestGate};if(typeof module!=='undefined')module.exports=api;else root.McAdapter=api;
})(typeof window!=='undefined'?window:globalThis);
