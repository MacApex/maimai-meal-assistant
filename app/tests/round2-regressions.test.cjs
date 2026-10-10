/* 第二轮：四个新回归的失败用例（领域层，严格整数分）
   全部使用第二版反馈给出的**精确输入**，先写会红的断言，再改实现。
   运行：node --test tests/round2-regressions.test.cjs
*/
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const W=require('../wizard-domain.js'),E=require('../meal-engine.js'),C=require('../demo-data.js'),D=require('../domain.js');
E.setCatalog(C.products);

function stateOf(people,opts){
 const s=D.initialState();
 s.constraints.people=people;s.constraints.portion=(opts&&opts.portion)||'regular';
 if(opts&&opts.budget)s.constraints.budget=opts.budget;
 if(opts&&opts.external)s.external={...W.emptyExternal(),confirmed:true,...opts.external};
 if(opts&&opts.cart)s.cart=opts.cart;
 if(opts&&opts.locks)s.locks=opts.locks;
 if(opts&&opts.fee!==undefined)s.context.feeMinor=opts.fee;
 return s;
}
const yuan=n=>Math.round(n/100);

/* ============ V2-01 已有餐单在尝新后重复计价 ============ */
/* 复现输入（第二版反馈 3.1）：经典已加鸡腿堡18元+薯条10元，
   1人、无外部已有、方向都可以、尝新 → 应新增果饮9元，明细合计 3700 分。
   实测 6500 分，多出的 2800 正是原餐单被重复计算。 */
test('V2-01 固定餐单＋新增，尝新后不得重复计价',()=>{
 const s=stateOf(1,{cart:[
  {key:'crispy|',productId:'crispy',quantity:1,specs:{},assignedTo:[],contextRevision:0},
  {key:'fries|',productId:'fries',quantity:1,specs:{},assignedTo:[],contextRevision:0}
 ]});
 const r=E.buildMeal(s,C.products,{novelty:{mode:'swap',maxChangedUnits:1}});
 const fixed=r.fixedParts.map(p=>p.id+'×'+p.quantity).sort();
 const sug=r.suggestedParts.map(p=>p.id+'×'+p.quantity).sort();
 assert.deepEqual(fixed,['crispy×1','fries×1'],'固定餐单必须原样保留，实际 '+fixed.join(','));
 /* 金额：固定 18+10 ＋ 新增一份饮品；按 units 逐份求和就是唯一真相 */
 let sum=0;
 for(const u of r.units){const p=C.products.find(x=>x.id===u.productId);sum+=p.price.minor;}
 assert.equal(r.total?r.total.minor:null,sum,
  '合计必须等于逐份单价之和。预期 3700（18+10+9），实际 '+JSON.stringify(r.total)+'，units='+r.units.map(u=>u.productId).join(','));
 assert.equal(sum,3700,'本用例必须锁定 3700 分，实际 '+sum+'；建议='+sug.join(','));
});
test('V2-01 固定餐单＋新增，在总预算 40 元内应判为 within',()=>{
 const s=stateOf(1,{budget:{mode:'total',minor:4000},cart:[
  {key:'crispy|',productId:'crispy',quantity:1,specs:{},assignedTo:[],contextRevision:0},
  {key:'fries|',productId:'fries',quantity:1,specs:{},assignedTo:[],contextRevision:0}
 ]});
 const r=E.buildMeal(s,C.products,{novelty:{mode:'swap',maxChangedUnits:1}});
 assert.ok(r.total&&r.total.minor<=4000,'总价必须不超过 4000，实际 '+JSON.stringify(r.total));
 assert.equal(r.budgetStatus,'within','37 元的方案不应标超上限，实际 '+r.budgetStatus);
});
test('V2-01 真正超预算时不得仍提交为正常推荐',()=>{
 /* 总预算 20 元，固定餐单 18+10 已超：必须给出冲突，而不是照样出一个"超上限"的推荐 */
 const s=stateOf(1,{budget:{mode:'total',minor:2000},cart:[
  {key:'crispy|',productId:'crispy',quantity:1,specs:{},assignedTo:[],contextRevision:0},
  {key:'fries|',productId:'fries',quantity:1,specs:{},assignedTo:[],contextRevision:0}
 ]});
 const r=E.buildMeal(s,C.products,{});
 assert.ok(r.conflicts&&r.conflicts.length>0,'超预算必须给出直接冲突，实际 conflicts='+JSON.stringify(r.conflicts));
 assert.equal(r.suggestedParts.length,0,'冲突时不得仍产出建议新增，实际 '+r.suggestedParts.map(p=>p.id).join(','));
});
test('V2-01 锁定项与固定项在尝新时都不可被替换',()=>{
 const s=stateOf(1,{cart:[
  {key:'crispy|',productId:'crispy',quantity:1,specs:{},assignedTo:[],contextRevision:0}
 ],locks:[]});
 const r=E.buildMeal(s,C.products,{novelty:{mode:'swap',maxChangedUnits:1}});
 const fixedIds=r.fixedParts.map(p=>p.id);
 assert.ok(fixedIds.includes('crispy'),'固定鸡腿堡必须保留，实际 '+fixedIds.join(','));
});
test('V2-01 安全模式与尝新模式金额都只算一次固定餐单',()=>{
 for(const mode of ['safe','swap']){
  const s=stateOf(1,{cart:[
   {key:'crispy|',productId:'crispy',quantity:1,specs:{},assignedTo:[],contextRevision:0},
   {key:'fries|',productId:'fries',quantity:1,specs:{},assignedTo:[],contextRevision:0}
  ]});
  const r=E.buildMeal(s,C.products,{novelty:{mode,maxChangedUnits:1}});
  let sum=0;for(const u of r.units){sum+=C.products.find(x=>x.id===u.productId).price.minor;}
  assert.equal(r.total?r.total.minor:null,sum,mode+' 模式合计必须等于逐份之和，实际 '+JSON.stringify(r.total));
  /* 合同是"固定餐单只计一次"，不是"金额必须等于某个数"：
     safe 选茶 3400（18+10+6）、swap 换成果饮 3700（18+10+9）都正确，
     错的是把固定餐单再加一遍得到 6500。 */
  const ids=r.units.map(u=>u.productId);
  assert.equal(ids.filter(x=>x==='crispy').length,1,mode+' 鸡腿堡只应出现一份，实际 '+ids.join(','));
  assert.equal(ids.filter(x=>x==='fries').length,1,mode+' 薯条只应出现一份，实际 '+ids.join(','));
 }
});
test('V2-01 已知费用只加一次',()=>{
 const s=stateOf(1,{fee:200,cart:[
  {key:'crispy|',productId:'crispy',quantity:1,specs:{},assignedTo:[],contextRevision:0}
 ]});
 const r=E.buildMeal(s,C.products,{});
 let sum=200;for(const u of r.units){sum+=C.products.find(x=>x.id===u.productId).price.minor;}
 assert.equal(r.total?r.total.minor:null,sum,'已知费用 2 元只加一次，实际 '+JSON.stringify(r.total));
});

/* ============ V2-02 尝新后丢失"外部已有"覆盖量 ============ */
/* 3人、已有咖啡2杯、尝新：externalApplied.drink=2，本次新增1杯，
   coverage.drink 必须仍为 3。实测派生后变成 1。 */
test('V2-02 尝新后 coverage 必须含外部已有，且每部分只计一次',()=>{
 const s=stateOf(3,{external:{coffee:2}});
 const r=E.buildMeal(s,C.products,{novelty:{mode:'swap',maxChangedUnits:1}});
 assert.equal(r.externalApplied.drink,2,'外部饮品覆盖应为 2 杯，实际 '+r.externalApplied.drink);
 const newDrinks=r.units.filter(u=>E.coverageOf(u).drink>0).length;
 assert.equal(r.coverage.drink,3,'coverage.drink 必须为 3（2 外部＋1 新增），实际 '+r.coverage.drink);
 assert.equal(r.coverage.drink,newDrinks+2,'覆盖量＝外部2＋新增'+newDrinks+'，不得重复或丢失');
});
test('V2-02 safe 模式同样必须保留外部覆盖',()=>{
 const s=stateOf(3,{external:{coffee:2}});
 const r=E.buildMeal(s,C.products,{novelty:{mode:'safe',maxChangedUnits:1}});
 assert.equal(r.coverage.drink,3,'safe 模式 coverage.drink 应为 3，实际 '+r.coverage.drink);
});
test('V2-02 固定＋建议＋外部三部分各自只计一次',()=>{
 const s=stateOf(2,{external:{coffee:1},cart:[
  {key:'crispy|',productId:'crispy',quantity:1,specs:{},assignedTo:[],contextRevision:0}
 ]});
 const r=E.buildMeal(s,C.products,{});
 const fixedDrinks=r.units.filter(u=>u.origin==='fixed'&&E.coverageOf(u).drink>0).length;
 const sugDrinks=r.units.filter(u=>u.origin!=='fixed'&&E.coverageOf(u).drink>0).length;
 assert.equal(r.coverage.drink,1+sugDrinks,'覆盖＝外部1＋建议'+sugDrinks+'＋固定'+fixedDrinks+'，实际 '+r.coverage.drink);
});

/* ============ V2-03 不同规格被合并成一种规格 ============ */
/* 经典页分别加入中杯冰茶×1和大杯常温茶×1，再为2人生成稳妥推荐：
   fixedParts 必须保留两种规格，不能合并成中杯冰茶×2。 */
test('V2-03 不同规格必须保留为独立行',()=>{
 const s=stateOf(2,{cart:[
  {key:'tea|size=m&temp=ice',productId:'tea',quantity:1,specs:{size:'m',temp:'ice'},assignedTo:[],contextRevision:0},
  {key:'tea|size=l&temp=room',productId:'tea',quantity:1,specs:{size:'l',temp:'room'},assignedTo:[],contextRevision:0}
 ]});
 const r=E.buildMeal(s,C.products,{});
 const teaLines=r.fixedParts.filter(p=>p.id==='tea');
 assert.equal(teaLines.length,2,'fixedParts 中茶必须是两行，实际 '+teaLines.length+' 行：'+teaLines.map(p=>JSON.stringify(p.specs)).join(' | '));
 const sizes=teaLines.map(p=>p.specs.size+'-'+p.specs.temp).sort();
 assert.deepEqual(sizes,['l-room','m-ice'],'两种规格都必须保留，实际 '+sizes.join(','));
 assert.ok(teaLines.every(p=>p.quantity===1),'每行各 1 份，不得合并成 2');
});
/* 人员不是可合并性的判定维度：同款同规格分给两人应合并为一行，
   但人员并集必须完整保留，不能因为合并而丢失归属。 */
test('V2-03 同商品同规格合并后人员并集必须完整保留',()=>{
 const s=stateOf(2,{cart:[
  {key:'tea|a',productId:'tea',quantity:1,specs:{size:'m',temp:'ice'},assignedTo:['p1'],contextRevision:0},
  {key:'tea|b',productId:'tea',quantity:1,specs:{size:'m',temp:'ice'},assignedTo:['p2'],contextRevision:0}
 ]});
 const r=E.buildMeal(s,C.products,{});
 const teaLines=r.fixedParts.filter(p=>p.id==='tea');
 assert.equal(teaLines.length,1,'同款同规格应合并为一行，实际 '+teaLines.length);
 assert.equal(teaLines[0].quantity,2,'合并后数量必须为 2，实际 '+teaLines[0].quantity);
 const who=(teaLines[0].assignedTo||[]).slice().sort().join(',');
 assert.equal(who,'p1,p2','人员并集必须完整，实际 '+who);
});
test('V2-03 签名必须区分规格',()=>{
 const mk=specs=>{const s=stateOf(1,{cart:[{key:'tea|'+specs.size+'-'+specs.temp,productId:'tea',quantity:1,specs,assignedTo:[],contextRevision:0}]});
  return E.buildMeal(s,C.products,{}).signature;};
 const a=mk({size:'m',temp:'ice'}),b=mk({size:'l',temp:'room'});
 assert.notEqual(a,b,'不同规格不得得到相同签名：'+a+' vs '+b);
});

/* ============ V2-04 未知费用经过尝新变成确定金额 ============ */
/* context.feeMinor=null：safe 的 total 为 null，swap 却变成 8000 分。
   未知不得等同免费。 */
test('V2-04 未知费用时 safe 与 swap 都必须保持未知',()=>{
 for(const mode of ['safe','swap']){
  const s=stateOf(1,{fee:null});
  const r=E.buildMeal(s,C.products,{novelty:{mode,maxChangedUnits:1}});
  assert.equal(r.total,null,mode+' 模式在费用未知时 total 必须为 null，实际 '+JSON.stringify(r.total));
  assert.equal(r.budgetStatus,'pending',mode+' 模式必须标待核实，实际 '+r.budgetStatus);
 }
});
test('V2-04 未知费用不得产生确定的省钱额',()=>{
 const s=stateOf(1,{fee:null});
 const r=E.buildMeal(s,C.products,{novelty:{mode:'swap',maxChangedUnits:1}});
 assert.equal(r.total,null,'推荐结果不得给出确定应付金额');
 /* 省钱比较：只要有任一方案的必要费用未知，就不得进入"已比较"状态 */
 const withUnknown=W.compareSavings([
  {id:'a',isBaseline:true,people:1,quote:{total:{minor:3400},unknownFields:['feeMinor'],checkedAt:'2026-10-10T00:00:00Z'}},
  {id:'b',people:1,quote:{total:{minor:2900},unknownFields:[],checkedAt:'2026-10-10T00:00:00Z'}}
 ]);
 assert.equal(withUnknown.status,'pending','含未知费用时不得比较并声称省了多少，实际 '+withUnknown.status);
 assert.ok(withUnknown.delta===null||withUnknown.delta===undefined,'不得给出确定的节省额，实际 '+JSON.stringify(withUnknown.delta));
 const allKnown=W.compareSavings([
  {id:'a',isBaseline:true,people:1,quote:{total:{minor:3400},unknownFields:[],checkedAt:'2026-10-10T00:00:00Z'}},
  {id:'b',people:1,quote:{total:{minor:2900},unknownFields:[],checkedAt:'2026-10-10T00:00:00Z'}}
 ]);
 assert.equal(allKnown.status,'compared','全部已知时才允许比较');
 assert.equal(allKnown.delta.minor,-500,'省 5 元必须精确为 -500 分，实际 '+JSON.stringify(allKnown.delta));
});
test('V2-04 明确已知 0 元按 0 计算',()=>{
 const s=stateOf(1,{fee:0});
 const r=E.buildMeal(s,C.products,{});
 assert.ok(r.total&&typeof r.total.minor==='number','已知 0 元必须算出确定金额，实际 '+JSON.stringify(r.total));
});
test('V2-04 已知费用参与总价且只加一次',()=>{
 const s=stateOf(1,{fee:500});
 const r=E.buildMeal(s,C.products,{});
 let sum=500;for(const u of r.units){sum+=C.products.find(x=>x.id===u.productId).price.minor;}
 assert.equal(r.total?r.total.minor:null,sum,'已知费用 5 元只加一次，实际 '+JSON.stringify(r.total));
});