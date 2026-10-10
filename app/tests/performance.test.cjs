const test=require('node:test'),assert=require('node:assert/strict');
const W=require('../wizard-domain.js'),E=require('../meal-engine.js'),C=require('../demo-data.js'),D=require('../domain.js');
E.setCatalog(C.products);
const base=()=>{const s=D.initialState();s.constraints.portion='regular';return s;};

/* 阈值固定 2000ms，不因本机跑得快就放宽。跨设备差异在报告里如实记录，不隐藏。 */
const device={platform:process.platform,arch:process.arch,node:process.version};
function timeIt(fn){const t=process.hrtime.bigint();const r=fn();return {ms:Number(process.hrtime.bigint()-t)/1e6,r};}

test('性能：1 人整餐应在 2 秒内完成',()=>{
 const s=base();s.constraints.people=1;
 const {ms}=timeIt(()=>E.buildMeal(s,C.products,{taste:W.buildTaste(['香脆','微辣'],'explicit')}));
 assert.ok(ms<2000,'1 人耗时 '+ms.toFixed(1)+'ms 超过 2000ms');
 console.log('# 1 人：'+ms.toFixed(1)+'ms');
});
test('性能：2 人整餐应在 2 秒内完成',()=>{
 const s=base();s.constraints.people=2;
 const {ms}=timeIt(()=>E.buildMeal(s,C.products,{taste:W.buildTaste(['香脆','微辣'],'explicit')}));
 assert.ok(ms<2000,'2 人耗时 '+ms.toFixed(1)+'ms 超过 2000ms');
 console.log('# 2 人：'+ms.toFixed(1)+'ms');
});
test('性能：12 人整餐应在 2 秒内完成',()=>{
 const s=base();s.constraints.people=12;
 const {ms}=timeIt(()=>E.buildMeal(s,C.products,{taste:W.buildTaste(['香脆','微辣'],'explicit')}));
 assert.ok(ms<2000,'12 人耗时 '+ms.toFixed(1)+'ms 超过 2000ms');
 console.log('# 12 人：'+ms.toFixed(1)+'ms');
});
test('性能：3 顿与 5 顿轮换应在 2 秒内完成',()=>{
 for(const len of [3,5]){
  const {ms}=timeIt(()=>W.buildPlan(C.products,i=>(cat,o)=>{
   const st=base();st.constraints.people=3;return E.buildMeal(st,cat,o||{});},len,null));
  assert.ok(ms<2000,len+' 顿轮换耗时 '+ms.toFixed(1)+'ms 超过 2000ms');
  console.log('# '+len+' 顿轮换：'+ms.toFixed(1)+'ms');
 }
});
test('性能：结果与目录顺序无关',()=>{
 const s=base();s.constraints.people=6;
 const {r:a}=timeIt(()=>E.buildMeal(s,C.products,{}));
 const {r:b}=timeIt(()=>E.buildMeal(s,[...C.products].reverse(),{}));
 assert.deepEqual(a.parts.map(p=>p.id).sort(),b.parts.map(p=>p.id).sort(),'目录顺序不得影响结果');
 console.log('# 目录顺序无关：'+a.parts.map(p=>p.id).sort().join(','));
});
test('报告设备信息，供跨设备对比',()=>{
 console.log('# 设备：'+JSON.stringify(device));
 assert.ok(device.platform&&device.node,'必须记录设备与版本');
});