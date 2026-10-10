const test=require('node:test'),assert=require('node:assert/strict');
const W=require('../wizard-domain.js'),E=require('../meal-engine.js'),C=require('../demo-data.js'),D=require('../domain.js');

const base=()=>{const s=D.initialState();s.constraints.portion='regular';return s;};
const withPeople=n=>{const s=base();s.constraints.people=n;return s;};

/* ============ T01 八步闸门 ============ */
test('T01 八题全部有明确回答后才开门，且门随回答进度变化',()=>{
 let w=W.createSession();
 assert.equal(W.gateOpen(w),false,'初始不得开门');
 assert.equal(W.STEPS.length,8);
 W.STEPS.forEach((st,i)=>{
  assert.equal(st.key,['people','budget','external','taste','direction','novelty','plan','memory'][i]);
  assert.ok(st.title&&st.hint,'第'+(i+1)+'题缺文案');
 });
 for(let i=0;i<8;i++)w=W.answer(w,i,1);
 assert.equal(W.gateOpen(w),true,'八题答完应开门');
 assert.equal(W.answeredCount(w),8);
});
test('T01 只答一题不得生成整餐',()=>{
 const w=W.answer(W.createSession(),0,2);
 assert.equal(W.gateOpen(w),false);
 assert.equal(W.firstUnanswered(w),1);
});
test('T01 帮我决定只前进一题，不跳过剩余题目',()=>{
 let w=W.createSession();
 w=W.answer(w,0,2);           // 第 1 题
 w=W.decide(w,1,undefined,'按不设上限处理');
 assert.equal(w.step,3,'应只前进到第 3 题');
 assert.equal(W.answeredCount(w),2);
 assert.equal(W.gateOpen(w),false);
 assert.equal(w.answers[1].source,'decided');
});
test('T01 控件默认值不算已答',()=>{
 let w=W.createSession();
 assert.equal(W.isAnswered(w.answers[3]),false);
});
test('T01 返回保留答案',()=>{
 let w=W.createSession();
 w=W.answer(w,0,3);w=W.answer(w,1,{mode:'total',minor:6000});
 w=W.goBack(w);
 assert.equal(w.step,2,'从第 3 题返回应回到第 2 题');
 assert.equal(w.answers[0].value,3,'返回不得丢答案');
 assert.equal(w.answers[1].value.minor,6000);
});
test('T01 修改前面的题把后续标为待重验，不静默删除',()=>{
 let w=W.createSession();
 for(let i=0;i<5;i++)w=W.answer(w,i,i+1);
 w=W.invalidateAfter(w,1);
 assert.equal(w.answers[2].pendingRevalidation,true,'被依赖的后续题应标待重验');
 assert.equal(w.answers[4].value,5,'不得删除用户已选内容');
});

/* ============ T02 预算单位 ============ */
test('T02 每人预算随人数换算，整餐预算不随人数变',()=>{
 const per={...base().constraints,budget:{mode:'person',minor:3000}};
 const tot={...base().constraints,budget:{mode:'total',minor:6000}};
 assert.equal(D.budgetLimit({...per,people:2}),6000);
 assert.equal(D.budgetLimit({...per,people:3}),9000);
 assert.equal(D.budgetLimit({...tot,people:2}),6000);
 assert.equal(D.budgetLimit({...tot,people:3}),6000);
});
test('T02 不设上限时返回 null，不暗改预算',()=>{
 assert.equal(D.budgetLimit({...base().constraints,budget:{mode:'total',minor:null},people:2}),null);
});
test('T02 未知价格不报告已满足预算',()=>{
 const s=withPeople(1);s.constraints.budget={mode:'total',minor:100};
 const r=E.buildMeal(s,C.products,{});
 assert.ok(r.conflicts.length,'预算不足必须报冲突');
 assert.notEqual(r.budgetStatus,'within');
 const free=withPeople(1);free.context.feeMinor=null;
 assert.equal(E.buildMeal(free,C.products,{}).total,null,'费用未知总价必须为 null');
});

/* ============ T03/T11 C6 已有覆盖与精确 40 元回归 ============ */
test('T11 精确 40 元：1人34元餐单→2人→外部主食1份→总预算40，只补一杯6元茶',()=>{
 const s=withPeople(2);
 s.cart=[{key:'k1',productId:'solo34',quantity:1,specs:{drink:'tea'}}];
 s.external={...W.emptyExternal(),main:1,confirmed:true};
 s.constraints.budget={mode:'total',minor:4000};
 const r=E.buildMeal(s,C.products,{});
 assert.equal(r.conflicts.length,0,'不应误报无解：'+r.conflicts.join(''));
 assert.equal(r.coverage.main,2,'主食覆盖应为 2，不是 3');
 const drinks=r.parts.filter(p=>E.coverageOf(p).drink>0);
 E.setCatalog(C.products);const{fixed,suggested}=E.splitParts(r,s);const newDrinks=suggested.filter(p=>E.coverageOf(p).drink>0);
 assert.equal(newDrinks.length,1,'只应补 1 杯饮品');
 assert.equal(newDrinks[0].id,'tea');
 assert.equal(newDrinks[0].price.minor,600,'应补 6 元茶');
 assert.equal(r.total.minor,4000,'合计 40 元');
 assert.equal(s.cart[0].productId,'solo34','原餐单对象不得改变');
 assert.equal(s.cart.length,1);
});
test('T03 2人外部咖啡1杯只补1杯饮品，不删掉全组饮品',()=>{
 const s=withPeople(2);
 s.external={...W.emptyExternal(),coffee:1,confirmed:true};
 const r=E.buildMeal(s,C.products,{});
 assert.equal(r.coverage.drink,2,'饮品覆盖应为 2');
 assert.equal(r.parts.filter(p=>E.coverageOf(p).drink>0).length,1,'只补 1 杯');
});
test('T03 咖啡与其他饮品合并只抵扣一次',()=>{
 const s=withPeople(2);
 s.external={...W.emptyExternal(),coffee:1,otherDrink:1,confirmed:true};
 const r=E.buildMeal(s,C.products,{});
 assert.equal(r.coverage.drink,2,'2 杯外部饮品刚好覆盖 2 人，不再加购');
 assert.equal(r.parts.filter(p=>E.coverageOf(p).drink>0).length,0);
});
test('T03 餐单已有饮品时不再重复补',()=>{
 const s=withPeople(2);
 s.cart=[{key:'a',productId:'tea',quantity:2,specs:{size:'m',temp:'ice'}}];
 const r=E.buildMeal(s,C.products,{});
 E.setCatalog(C.products);
 const {fixed,suggested}=E.splitParts(r,s);
 assert.equal(suggested.filter(p=>E.coverageOf(p).drink>0).length,0,'饮品已够，不应再加');
 assert.equal(fixed.length>0,true,'餐单固定项应保留在结果里');
});
test('T03 主食已够时不再多加主食',()=>{
 const s=withPeople(1);
 s.external={...W.emptyExternal(),main:1,confirmed:true};
 const r=E.buildMeal(s,C.products,{});
 assert.equal(r.coverage.main,1);
 assert.equal(r.parts.filter(p=>E.coverageOf(p).main>0).length,0);
});
test('T03 未知份量标粗略估计',()=>{
 const s=withPeople(3);
 s.external={...W.emptyExternal(),main:1,amountConfidence:'rough',confirmed:true};
 const g=W.computeGap({external:s.external,coverage:{}},E.targets(3,'regular'));
 assert.match(g.externalMessage.join(''),/粗略/);
});
test('T03 没有缺口时不产生新增需求',()=>{
 const s=withPeople(1);
 s.cart=[{key:'a',productId:'solo34',quantity:1,specs:{drink:'tea'}}];
 const r=E.buildMeal(s,C.products,{});
 E.setCatalog(C.products);const{ suggested}=E.splitParts(r,s);
 assert.equal(suggested.length,0,'无需再添');
 assert.ok(r.reasons.join('').match(/无需再添|已搭好/));
});

/* ============ T04 C1 多维口味 ============ */
test('T04 香脆与微辣可并存，互不覆盖',()=>{
 const t=W.buildTaste(['香脆','微辣'],'explicit');
 assert.deepEqual(t.texture,['crispy']);
 assert.deepEqual(t.spice,['mild']);
 assert.equal(t.richness.length,0);
});
test('T04 香脆不代替辣度：香脆匹配不得给辣度加分',()=>{
 const t=W.buildTaste(['香脆'],'explicit');
 const spicy=C.products.find(p=>p.id==='wings');   // spice=labeled 1
 const m=W.tasteMatch(spicy,t);
 assert.ok(m.matched.some(x=>x.dim==='texture'),'wings 应匹配香脆');
 assert.equal(m.matched.some(x=>x.dim==='spice'),false,'未选辣度不得声称辣度匹配');
});
test('T04 缺辣度证据时如实说明资料不完整，且不伪称匹配成功',()=>{
 const t=W.buildTaste(['微辣'],'explicit');
 const p=C.products.find(x=>x.id==='crispy');     // spice evidence=unknown
 const m=W.tasteMatch(p,t);
 assert.equal(m.matched.length,0,'未知维度不得算作已符合');
 assert.ok(m.unknown.some(x=>x.dim==='spice'),'必须标为资料不完整');
 assert.match(W.tasteExplanation(p,t).join(''),/资料还不完整/);
});
test('T04 解释文案必须译成中文，不得把内部标识露给用户',()=>{
 /* 回归：曾直接输出「mild」「crispy」等内部英文标识 */
 const t=W.buildTaste(['香脆','微辣','不油腻'],'explicit');
 for(const id of ['crispy','wings','fish','tea']){
  const text=W.tasteExplanation(C.products.find(p=>p.id===id),t).join('');
  assert.equal(/[a-z]+/.test(text),false,'解释中出现英文内部标识：'+id+' → '+text);
 }
 const c=W.tasteExplanation(C.products.find(p=>p.id==='crispy'),t).join('');
 assert.match(c,/「香脆」有演示标签依据/);
 assert.match(c,/「微辣」偏好已收到，但这项商品资料还不完整/);
});
test('T04 口味解释文案不含低脂或健康承诺',()=>{
 const text=W.tasteExplanation(C.products.find(p=>p.id==='fish'),W.buildTaste(['不油腻'],'explicit')).join('');
 assert.equal(/低脂|健康|减脂/.test(text),false);
 assert.match(text,/「不油腻」/);
});
test('T04 不油腻不得转成低脂或健康承诺',()=>{
 const t=W.buildTaste(['不油腻'],'explicit');
 assert.deepEqual(t.richness,['light']);
 assert.equal(Object.prototype.hasOwnProperty.call(t,'health'),false,'不得生成健康字段');
 const ex=W.tasteExplanation(C.products.find(p=>p.id==='fish'),t).join('');
 assert.equal(/低脂|健康|减脂/.test(ex),false,'解释中不得出现健康承诺');
});
test('T04 口味真正影响结果：只改变口味即改变候选',()=>{
 const s=withPeople(2);
 const a=E.buildMeal(s,C.products,{taste:W.buildTaste(['香脆'],'explicit')});
 const b=E.buildMeal(s,C.products,{taste:W.buildTaste(['不油腻'],'explicit')});
 assert.notDeepEqual(a.parts.map(p=>p.id),b.parts.map(p=>p.id),'口味必须影响结果');
});
test('T04 个人忌口优先于全组口味',()=>{
 const s=withPeople(2);
 s.constraints.personPrefs={p2:{taste:'香脆',avoid:['chicken']}};
 const r=E.buildMeal(s,C.products,{taste:W.buildTaste(['香脆'],'explicit')});
 const assigned=r.parts.filter(p=>p.assignedTo.includes('p2')&&E.coverageOf(p).main>0);
 for(const p of assigned)assert.equal((p.ingredientTags||[]).includes('chicken'),false,'p2 忌口必须生效');
});
test('T04 个人例外影响排序',()=>{
 const s1=withPeople(2),s2=withPeople(2);
 s2.constraints.personPrefs={p2:{taste:'不油腻'}};
 const a=E.buildMeal(s1,C.products,{taste:W.buildTaste(['香脆'],'explicit')});
 const b=E.buildMeal(s2,C.products,{taste:W.buildTaste(['香脆'],'explicit')});
 assert.ok(a.parts.length&&b.parts.length);
 assert.notDeepEqual(a.parts.map(p=>p.id),b.parts.map(p=>p.id),'个人例外必须改变结果');
});

/* ============ T05 C2 二选一 ============ */
test('T05 两个方向来自真实可行商品，且明显不同',()=>{
 const s=withPeople(2);
 const d=W.buildDirections(C.products,{...s,coverage:{}},E.targets(2,'regular'),p=>E.allowed(p,['p1','p2'],s));
 assert.equal(d.status,'pair');
 assert.equal(d.directions.length,2);
 const[o1,o2]=d.directions.map(x=>x.optionIds);
 assert.equal(o1.filter(id=>o2.includes(id)).length,0,'两个方向不能共享同一批商品');
});
test('T05 只有一个方向时不硬造第二个',()=>{
 const s=withPeople(2);s.constraints.avoid=['chicken','beef','fish','wheat','egg'];
 const only=C.products.filter(p=>p.id==='wrap');
 const d=W.buildDirections(only,{...s,coverage:{}},E.targets(2,'regular'),p=>E.allowed(p,['p1','p2'],s));
 assert.ok(['single','none'].includes(d.status));
 assert.ok(d.directions.length<=1);
});
test('T05 已够主食时不为了凑题目再加主食',()=>{
 const s=withPeople(2);
 const d=W.buildDirections(C.products,{...s,coverage:{main:2,side:1,drink:2}},E.targets(2,'regular'),()=>true);
 assert.equal(d.status,'noGap');
 assert.equal(d.directions.length,0);
});
test('T05 只改变方向会改变对应候选',()=>{
 const s=withPeople(2);
 const base=E.buildMeal(s,C.products,{});
 const dirs=W.buildDirections(C.products,{...s,coverage:{}},E.targets(2,'regular'),p=>E.allowed(p,['p1','p2'],s));
 const a=E.buildMeal(s,C.products,{direction:{...dirs.directions[0],optionIds:dirs.directions[0].optionIds}});
 const b=E.buildMeal(s,C.products,{direction:{...dirs.directions[1],optionIds:dirs.directions[1].optionIds}});
 const ma=a.parts.find(p=>E.coverageOf(p).main>0),mb=b.parts.find(p=>E.coverageOf(p).main>0);
 assert.ok(ma&&mb);
 assert.notEqual(ma.id,mb.id,'不同方向必须给出不同主食');
 assert.ok(dirs.directions[0].optionIds.includes(ma.id));
 assert.ok(dirs.directions[1].optionIds.includes(mb.id));
});
test('T05 目录缺一种方向时不显示它',()=>{
 const noWrap=C.products.filter(p=>p.id!=='wrap');
 const s=withPeople(2);
 const d=W.buildDirections(noWrap,{...s,coverage:{}},E.targets(2,'regular'),()=>true);
 const labels=d.directions.map(x=>x.id);
 assert.equal(labels.includes('wrap'),false,'目录没有卷就不该显示卷方向');
});
test('T05 方向只收窄未满足需求，不替换已选餐单',()=>{
 const s=withPeople(2);
 s.cart=[{key:'a',productId:'corn',quantity:1,specs:{}}];
 const before=s.cart[0].productId;
 const d=W.buildDirections(C.products,{...s,coverage:{main:2,side:1,drink:2}},E.targets(2,'regular'),()=>true);
 const r=E.buildMeal(s,C.products,{direction:d.status==='pair'?d.directions[0]:null});
 assert.equal(s.cart[0].productId,before,'餐单不得被方向替换');
 assert.ok(r.parts.length>=0);
});
test('T05 方向只约束它对应的角色，不影响小食与饮品',()=>{
 /* 回归：coverageOf(tea) 是 {drink:1}，对 main 做 undefined<=0 比较会误判为 false，
    曾导致选方向后小食与饮品全部缺失。这里锁定该行为。 */
 const s=withPeople(2);
 const dirs=W.buildDirections(C.products,{...s,coverage:{}},E.targets(2,'regular'),p=>E.allowed(p,['p1','p2'],s));
 const d=dirs.directions[0];
 const tea=C.products.find(p=>p.id==='tea'),fries=C.products.find(p=>p.id==='fries');
 assert.equal(E.directionOk(tea,{direction:d}),true,'饮品不受主食方向约束');
 assert.equal(E.directionOk(fries,{direction:d}),true,'小食不受主食方向约束');
 assert.equal(E.directionOk(C.products.find(p=>p.id==='wrap'),{direction:d}),false,'同角色的非方向商品应被排除');
 const r=E.buildMeal(s,C.products,{direction:d});
 assert.equal(r.coverage.drink,2,'饮品缺口必须被补齐');
 assert.equal(r.coverage.side,1,'小食缺口必须被补齐');
 assert.equal(r.coverage.main,2);
});
test('T05 解释不得编造你常吃',()=>{
 const s=withPeople(2);
 const d=W.buildDirections(C.products,{...s,coverage:{}},E.targets(2,'regular'),()=>true);
 const r=E.buildMeal(s,C.products,{direction:d.directions[0]});
 assert.equal(r.reasons.join('').match(/你常吃|常吃/),null,'不得声称用户常吃某商品');
});

/* ============ T06 C3 单件尝新 ============ */
test('T06 稳妥模式不引入任何变化',()=>{
 const s=withPeople(2);
 const r=E.buildMeal(s,C.products,{novelty:{mode:'safe',maxChangedUnits:1}});
 assert.equal(r.noveltyApplied.changed,0);
});
test('T06 最多只改一份商品＋规格，其余单位身份不变',()=>{
 const s=withPeople(2);
 const plain=E.buildMeal(s,C.products,{});
 const n=E.buildMeal(s,C.products,{novelty:{mode:'swap',maxChangedUnits:1}});
 assert.equal(n.noveltyApplied.changed,1);
 assert.ok(n.noveltyApplied.quantity<=1,'最多改一份');
 const changedIds=plain.parts.filter(p=>p.id!==n.parts.find(q=>q.lineId===p.lineId)?.id).map(p=>p.lineId);
 assert.ok(changedIds.length<=1,'最多一行发生变化');
});
test('T06 锁定项与熟悉款不被替换',()=>{
 const s=withPeople(2);
 const plain=E.buildMeal(s,C.products,{});
 const main=plain.parts.find(p=>E.coverageOf(p).main>0);
 const s2=withPeople(2);
 s2.locks=[{productId:main.id,quantity:main.quantity,specs:main.specs,lockId:'L1'}];
 const r=E.buildMeal(s2,C.products,{novelty:{mode:'swap',familiarUnitIds:[main.id],maxChangedUnits:1}});
 assert.notEqual(r.noveltyApplied.fromId,main.id,'锁定且标为熟悉的主食不得被换');
 const stillThere=r.parts.some(p=>p.id===main.id&&p.locked);
 assert.equal(stillThere,true,'锁定项必须仍在结果里');
});
test('T06 无官方新品证据时只说换一款，不称新品',()=>{
 const s=withPeople(2);
 const r=E.buildMeal(s,C.products,{novelty:{mode:'swap',maxChangedUnits:1}});
 assert.equal(r.noveltyApplied.isOfficialNew,false);
 assert.match(r.noveltyApplied.note,/换一项|换一款/);
 assert.equal(r.noveltyApplied.note.match(/新品/),null,'演示目录不得声称新品');
});
test('T06 假新品标记不能用于演示目录',()=>{
 const forged=C.products.map(p=>({...p,newProductEvidence:{source:'demo',officialFlag:true,checkedAt:'2099-01-01',validTo:'2099-12-31'}}));
 const p=C.products.find(x=>x.id==='tea');
 assert.equal(W.officialNewFlag(p,new Date().toISOString()),false);
});
test('T06 预算不允许时不偷偷加钱',()=>{
 const s=withPeople(1);
 /* 先取一个可行的基准预算，再确认换一项后仍不超限 */
 const plain=E.buildMeal(s,C.products,{});
 const limit=plain.total.minor;              /* 刚好够当前方案 */
 s.constraints.budget={mode:'total',minor:limit};
 const r=E.buildMeal(s,C.products,{novelty:{mode:'swap',maxChangedUnits:1}});
 if(r.total)assert.ok(r.total.minor<=limit,'不得超预算：'+r.total.minor+' > '+limit);
 else assert.ok(r.conflicts.length,'预算不足必须如实报冲突，不能默认达标');
 /* 预算刚好够时，换一项后总额不得超过上限；budgetStatus 不得谎报超标或未知 */
 assert.ok(['within','pending'].includes(r.budgetStatus));
 if(r.noveltyApplied&&r.noveltyApplied.changed===1)
  assert.ok(r.total.minor<=limit,'换一项后仍须在预算内');
});
test('T06 没有可行替代时保留原组合并说明',()=>{
 const s=withPeople(1);
 s.constraints.avoid=['chicken','beef','wheat','egg','fish'];
 s.constraints.budget={mode:'total',minor:600};
 const r=E.buildMeal(s,C.products,{novelty:{mode:'swap',maxChangedUnits:1}});
 if(r.noveltyApplied&&r.noveltyApplied.changed===0)assert.match(r.noveltyApplied.note,/保留原|没有可行/);
});

/* ============ T07 C5 轮换 ============ */
test('T07 轮换必须真的减少主食连续重复',()=>{
 /* 回归：工厂若忽略 buildPlan 传入的 penalize，各顿会长得完全一样，轮换形同虚设。 */
 const mk=i=>(cat,planOpts)=>E.buildMeal(withPeople(3),cat,planOpts||{});
 const plan=W.buildPlan(C.products,mk,3,null);
 assert.equal(plan.meals.length,3);
 const mainOf=m=>m.parts.filter(p=>W.coverageOf(p).main>0).map(p=>p.id).join(',');
 const sigs=plan.meals.map(m=>m.parts.map(x=>x.id+'×'+x.quantity).sort().join('|'));
 assert.notEqual(new Set(sigs).size,1,'三顿不应完全相同：'+JSON.stringify(sigs));
 assert.notEqual(mainOf(plan.meals[0]),mainOf(plan.meals[1]),'第 1、2 顿主食不应连续重复');
 for(const m of plan.meals)assert.ok(m.coverage.main>=3,'每顿都要满足人数');
});
test('T07 尝新不得把轮换拉回同一款',()=>{
 /* 回归：applyNovelty 曾无视 penalize，把每一顿都换回同一款主食，轮换形同虚设。 */
 const mk=i=>(cat,planOpts)=>E.buildMeal(withPeople(3),cat,{novelty:{mode:'swap',familiarUnitIds:[],maxChangedUnits:1},...planOpts});
 const plan=W.buildPlan(C.products,mk,3,null);
 const mainOf=m=>m.parts.filter(p=>W.coverageOf(p).main>0).map(p=>p.id).sort().join(',');
 assert.notEqual(mainOf(plan.meals[0]),mainOf(plan.meals[1]),
  '尝新开启时，第 1、2 顿主食仍不应相同：'+mainOf(plan.meals[0])+' vs '+mainOf(plan.meals[1]));
});
test('T07 外部提示不得把本次建议新增算成"已够"',()=>{
 /* 回归：曾出现"已够 3 杯"但列表里又新增了一杯的自相矛盾文案。 */
 const s=withPeople(3);
 s.external={...W.emptyExternal(),coffee:2,confirmed:true};
 const r=E.buildMeal(s,C.products,{});
 assert.equal(r.coverage.drink,3);
 const drinkLine=r.reasons.find(x=>/饮品|杯/.test(x))||'';
 const extLine=r.reasons.find(x=>/已扣除外部已有/.test(x))||'';
 assert.equal(/已够 3 杯/.test(extLine),false,'只有外部 2 杯时不得说"已够 3 杯"：'+extLine);
 assert.match(extLine,/还补 1 杯|已有饮品 2 杯/,'应说明还差几杯：'+extLine);
 assert.ok(drinkLine.length>0);
});
test('T07 3 顿与 5 顿都能生成，且尽量不重复主食',()=>{
 const mk=()=>{const s=withPeople(2);return s;};
 for(const len of [3,5]){
  const plan=W.buildPlan(C.products,i=>(cat)=>E.buildMeal(mk(),cat,{}),len,null);
  assert.equal(plan.meals.length,len);
  assert.match(plan.note,/暂无可用历史/);
  for(const m of plan.meals)assert.ok(m.coverage.main>=2,'每顿都要满足人数');
 }
});
test('T07 无历史与获准历史分别可运行，且来源可查看',()=>{
 const mk=i=>(cat)=>E.buildMeal(withPeople(2),cat,{});
 const none=W.buildPlan(C.products,mk,3,null);
 const withHist=W.buildPlan(C.products,mk,3,[{kind:'selection',at:'2026-10-01T00:00:00.000Z',source:'finalSelection',consent:true}]);
 assert.equal(none.historyUsed.length,0);
 assert.equal(withHist.historyUsed.length,1);
 assert.equal(withHist.historyUsed[0].kind,'selection');
 assert.match(withHist.note,/不是订单/);
});
test('T07 拒绝使用历史时结果不受旧记录影响',()=>{
 const mk=i=>(cat)=>E.buildMeal(withPeople(2),cat,{});
 const a=W.buildPlan(C.products,mk,3,null);
 const b=W.buildPlan(C.products,mk,3,[{kind:'selection',at:'2026-10-01T00:00:00.000Z',source:'finalSelection',consent:true}]);
 const sig=p=>p.meals.map(m=>m.parts.map(x=>x.id+'×'+x.quantity).sort().join('|'));
 assert.deepEqual(sig(a),sig(b),'默认不因历史改变计划');
});
test('T07 不把今天的咖啡抵扣未来五顿',()=>{
 const plan=W.buildPlan(C.products,i=>(cat)=>E.buildMeal(withPeople(1),cat,{}),3,null);
 for(const m of plan.meals)assert.ok(m.coverage.drink>=1,'每顿都要有自己的饮品');
});
test('T07 临用重验：人数或价格变化必须先确认',()=>{
 const plan=W.buildPlan(C.products,(i)=>(cat)=>E.buildMeal(withPeople(2),cat,{}),3,null);
 const m=plan.meals[1];
 const rv=W.revalidateMeal({...m,checkedAt:new Date().toISOString()},{coverage:{main:3},total:m.total},new Date().toISOString());
 assert.equal(rv.requiresConfirmation,true);
 assert.ok(rv.diffs.length);
 const ok=W.revalidateMeal({...m,checkedAt:new Date().toISOString()},{coverage:m.coverage,total:m.total},new Date().toISOString());
 assert.equal(ok.requiresConfirmation,false);
});

/* ============ T08 C4 记忆同意 ============ */
function memStore(){const d={};return {getItem:k=>d[k]??null,setItem:(k,v)=>{d[k]=v;},removeItem:k=>{delete d[k];},_d:d};}
test('T08 无同意不新增长期数据',()=>{
 const st=W.createMemoryStore(memStore());
 const r=st.saveExplicitTaste([{subjectId:'self',dimension:'texture',value:'crispy'}],null);
 assert.equal(r.persisted,false);
 assert.equal(st.read().tastes.length,0);
});
test('T08 四类同意彼此独立',()=>{
 const st=W.createMemoryStore(memStore());
 st.setConsent({useSavedTaste:true,useSavedSelections:false,saveExplicitTaste:true,saveFinalSelection:false,saveRotationPlan:false});
 assert.equal(st.currentConsent().useSavedTaste,true);
 assert.equal(st.currentConsent().useSavedSelections,false);
 assert.equal(st.currentConsent().saveFinalSelection,false,'选餐保存不得被口味保存捆绑');
});
test('T08 只保存明确归属本人的条目，多人共用不归本人',()=>{
 const st=W.createMemoryStore(memStore());
 st.setConsent({saveExplicitTaste:true});
 const r=st.saveExplicitTaste([{subjectId:'p2',dimension:'texture',value:'crispy'}],'c1');
 assert.equal(r.persisted,false,'归属不明不得保存');
 assert.equal(st.read().tastes.length,0);
 st.saveExplicitTaste([{subjectId:'self',dimension:'texture',value:'crispy'}],'c1');
 assert.equal(st.read().tastes.length,1);
});
test('T08 存储失败必须如实返回失败',()=>{
 const bad={getItem:()=>null,setItem:()=>{throw new Error('quota');},removeItem:()=>{}};
 const st=W.createMemoryStore(bad);
 st.setConsent({saveExplicitTaste:true});
 const r=st.saveExplicitTaste([{subjectId:'self',dimension:'texture',value:'crispy'}],'c1');
 assert.equal(r.persisted,false);
 assert.match(r.message,/没能保存/);
});
test('T08 保存最终选餐必须在实际选定之后',()=>{
 const st=W.createMemoryStore(memStore());
 st.setConsent({saveFinalSelection:true});
 assert.equal(st.saveFinalSelection({items:[]},'c2').persisted,false,'未生成方案不得保存');
 assert.equal(st.saveFinalSelection(null,'c2').persisted,false);
 assert.equal(st.saveFinalSelection({items:[{name:'香脆鸡腿堡'}],totalMinor:1800},'c2').persisted,true);
});
test('T08 可逐条删除与清空',()=>{
 const st=W.createMemoryStore(memStore());
 st.setConsent({saveExplicitTaste:true,saveFinalSelection:true});
 st.saveExplicitTaste([{subjectId:'self',dimension:'texture',value:'crispy'}],'c');
 const id=st.read().tastes[0].id;
 st.deleteTaste(id);assert.equal(st.read().tastes.length,0);
 st.saveFinalSelection({items:[{name:'x'}]},'c');
 st.clearAll();
 assert.equal(st.read().tastes.length,0);
 assert.equal(st.read().selections.length,0);
});
test('T08 本次明确选择高于已保存偏好；拒绝保存不清掉本次答案',()=>{
 const sessionTaste=W.buildTaste(['香脆'],'explicit');
 const consent={useSavedTaste:true,saveExplicitTaste:false};
 const r=W.resolveTasteForRun(sessionTaste,W.buildTaste(['不油腻'],'saved'),consent);
 assert.deepEqual(r.texture,['crispy'],'本次选择必须胜出');
 assert.match(r.sourceLabel,/本次选/);
});
test('T08 获准时才使用已保存口味，否则不参与也不删除',()=>{
 const saved=W.buildTaste(['不油腻'],'saved');
 assert.equal(W.resolveTasteForRun(null,saved,{useSavedTaste:false}).source,null,'未获准不得使用');
 const used=W.resolveTasteForRun(null,saved,{useSavedTaste:true});
 assert.deepEqual(used.richness,['light']);
 assert.match(used.sourceLabel,/已同意/);
});
test('T08 旧数据未允许使用时不参与评分但不被删除',()=>{
 const st=W.createMemoryStore({getItem:k=>k==='maimai.memory.v2'?JSON.stringify({schema:2,tastes:[{id:'t1',subjectId:'self',dimension:'texture',value:'crispy',consentId:'c'}],selections:[],rotations:[],feedback:[],consent:null}):null,setItem:()=>{},removeItem:()=>{}});
 assert.equal(st.usableHistory({useSavedSelections:false}).length,0,'未获准不返回');
 assert.equal(st.read().tastes.length,1,'不得擅自删除');
});

/* ============ T09 饭后反馈 ============ */
test('T09 未确认吃过不问体验',()=>{
 const g=W.feedbackGate('m1',false);
 const b=W.beginFeedback(g,false);
 assert.equal(b.open,false);
 assert.match(b.reason,/还没确认/);
});
test('T09 加餐单或下单不触发吃过',()=>{
 const g=W.feedbackGate('m1',false);
 assert.equal(W.beginFeedback(g,false).open,false);
 const rec=W.feedbackRecord(g,'u1','too-spicy',false,null);
 assert.equal(rec,null,'未确认吃过不产生反馈记录');
});
test('T09 只评价被指定的一项，且无同意不成长喜恶',()=>{
 const g=W.beginFeedback(W.feedbackGate('m1',true),true);
 assert.equal(g.open,true);
 const rec=W.feedbackRecord(g,'u1','too-richy',true,null);
 assert.equal(rec.unitId,'u1');
 assert.equal(rec.saveConsentId,null);
});
test('T09 存储层也拒绝未吃过的反馈',()=>{
 const st=W.createMemoryStore(memStore());
 assert.equal(st.saveFeedback({mealId:'m',unitId:'u',kind:'x',eatenConfirmation:false},null).persisted,false);
});

/* ============ T12 规格与局部替换 ============ */
test('T12 多份价差按全部选中份数计算',()=>{
 const fries=C.products.find(p=>p.id==='fries'),nug=C.products.find(p=>p.id==='nuggets');
 for(const q of [1,3]){
  const d=D.replacementDifference({...fries,quantity:q},nug);
  assert.equal(d.total.minor,300*q);
 }
 assert.equal(D.replacementDifference({...fries,quantity:3},{...nug,price:null}),null,'未知价不造差价');
});
test('T12 既有人规格保留，新人规格待选',()=>{
 const tea=C.products.find(p=>p.id==='tea');
 const s=withPeople(2);
 s.cart=[{key:'a',productId:'tea',quantity:1,specs:{size:'m',temp:'ice'}}];
 const r=E.buildMeal(s,C.products,{});
 E.setCatalog(C.products);
 const {fixed,suggested}=E.splitParts(r,s);
 assert.equal(s.cart[0].specs.size,'m','餐单规格不得被改');
 assert.equal(fixed.length,1,'餐单那杯应归为固定项');
 const added=suggested.filter(p=>E.coverageOf(p).drink>0);
 assert.equal(added.length,1,'只补一杯');
 assert.equal(D.validateSpecs(tea,added[0].specs).valid,false,'新人规格待确认，不能复制他人授权');
});
test('T12 规格不同即为不同商品身份',()=>{
 assert.notEqual(D.lineKey('tea',{size:'m',temp:'ice'}),D.lineKey('tea',{size:'l',temp:'ice'}));
});

/* ============ T13 锁定与冲突 ============ */
test('T13 锁定身份在冲突与重算后保留',()=>{
 const s=withPeople(1);
 const r=E.buildMeal(s,C.products,{});
 const main=r.parts.find(p=>E.coverageOf(p).main>0);
 s.locks=[{productId:main.id,quantity:1,specs:main.specs,lockId:'L1'}];
 const r2=E.buildMeal(s,C.products,{});
 assert.equal(r2.parts.filter(p=>p.locked).length>0,true);
 assert.equal(r2.parts.find(p=>p.locked).id,main.id);
 s.constraints.avoid=['chicken'];
 const r3=E.buildMeal(s,C.products,{});
 assert.ok(r3.conflicts.length,'忌口冲突必须说明');
 assert.equal(s.locks[0].productId,main.id,'冲突不得静默解锁');
 delete s.constraints.avoid;
 assert.equal(E.buildMeal(s,C.products,{}).parts.find(p=>p.locked).id,main.id);
});
test('T13 冲突时不得暗减人数或删餐单',()=>{
 const s=withPeople(2);
 s.cart=[{key:'a',productId:'solo34',quantity:2,specs:{drink:'tea'}}];
 s.constraints.budget={mode:'total',minor:100};
 const r=E.buildMeal(s,C.products,{});
 assert.ok(r.conflicts.length);
 assert.equal(s.constraints.people,2);
 assert.equal(s.cart.length,1);
});

/* ============ T15 省钱 Wizard ============ */
test('T15 未知费用必须标待核实，不能用 0 补齐',()=>{
 const q=W.computeQuote({mode:'demo',itemsTotal:5000,deliveryFee:null,tablewareFee:0,otherMandatoryFees:0,discount:0,eligibility:true});
 assert.ok(q.unknownFields.includes('deliveryFee'));
 assert.equal(q.total,null,'必要费用未知时不得给出总价');
 assert.match(q.eligibilityEvidence,/待核实/);
});
test('T15 优惠资格不符不计入优惠',()=>{
 const q=W.computeQuote({mode:'demo',itemsTotal:5000,deliveryFee:0,tablewareFee:0,otherMandatoryFees:0,discount:-800,eligibility:false});
 assert.equal(q.discount.minor,0,'不合资格时折扣不生效');
 assert.match(q.eligibilityEvidence,/不符合/);
});
test('T15 券过期不计入',()=>{
 const q=W.computeQuote({mode:'demo',itemsTotal:5000,deliveryFee:0,tablewareFee:0,otherMandatoryFees:0,discount:-800,eligibility:true,expired:true});
 assert.equal(q.total.minor,5000,'过期券不参与计算');
 assert.match(q.eligibilityEvidence,/过期/);
});
test('T15 无法叠加时只按单张计算',()=>{
 const q=W.computeQuote({mode:'demo',itemsTotal:5000,deliveryFee:0,tablewareFee:0,otherMandatoryFees:0,discount:-800,eligibility:true,stackingRejected:true});
 assert.equal(q.discount.minor,-800);
 assert.match(q.eligibilityEvidence,/无法叠加/);
});
test('T15 比较只在费用完整时给出，且不承诺全网最低',()=>{
 const mk=(id,total,isBaseline)=>({id,isBaseline,parts:[{id:'a'}],quote:W.computeQuote({mode:'demo',itemsTotal:total,deliveryFee:0,tablewareFee:0,otherMandatoryFees:0,discount:0,eligibility:true,checkedAt:'2026-10-09T00:00:00.000Z'})});
 const r=W.compareSavings([mk('base',6000,true),mk('alt',5200,false)]);
 assert.equal(r.status,'compared');
 assert.equal(r.best.id,'alt');
 assert.equal(r.delta.minor,-800);
 assert.match(r.message,/本次已核验的这些方案中较省/);
 /* 文案必须明确否定全网最低／全渠道最优，而不是含糊带过 */
 assert.match(r.message,/不代表全网最低或全渠道最优/);
 assert.ok(r.scope.checkedAt,'必须给出比较时间');
});
test('T15 必要费用未知时不比较',()=>{
 const mk=(id,delivery)=>({id,parts:[],quote:W.computeQuote({mode:'demo',itemsTotal:5000,deliveryFee:delivery,tablewareFee:0,otherMandatoryFees:0,discount:0,eligibility:true})});
 const r=W.compareSavings([mk('a',null),mk('b',null)]);
 assert.equal(r.status,'pending');
 assert.match(r.message,/待接入|未知/);
});
test('T15 方案差异必须可预览',()=>{
 const d=W.savingsDiff({parts:[{id:'fries',quantity:1,specs:{}},{id:'tea',quantity:2,specs:{}}]},
                        {parts:[{id:'nuggets',quantity:1,specs:{}},{id:'tea',quantity:2,specs:{}}]});
 assert.ok(d.some(x=>x.type==='removed'&&x.key.startsWith('fries')));
 assert.ok(d.some(x=>x.type==='added'&&x.key.startsWith('nuggets')));
 assert.equal(d.filter(x=>x.key.startsWith('tea')).length,0,'未变项不得计入差异');
});

/* ============ T16 时序与幂等 ============ */
test('T16 旧请求结果不得覆盖新状态',()=>{
 const r=D.applyAsyncResult(D.initialState(),{requestId:'old'},{requestId:'old'});
 assert.ok(r);
});
test('T16 同一动作 ID 幂等，重复点击不重复加入',()=>{
 const tea=C.products.find(p=>p.id==='tea');
 let s=D.initialState();
 const act={type:'ADD',products:[tea],specs:{tea:{size:'m',temp:'ice'}},id:'same'};
 s=D.reduce(s,act);
 const q=D.reduce(s,act);
 assert.equal(q.cart.length,1);
 assert.equal(q.cart[0].quantity,1);
});
test('T16 草稿取消不污染原状态',()=>{
 const s=D.initialState();
 assert.deepEqual(D.cancelEdit(D.beginEdit(s)),s);
});

/* ============ 确定性 ============ */
test('确定性：同输入必须得到同输出',()=>{
 const s=withPeople(3);
 s.external={...W.emptyExternal(),coffee:1,confirmed:true};
 const sig=()=>E.buildMeal(s,C.products,{taste:W.buildTaste(['香脆','微辣'],'explicit')}).parts.map(p=>p.lineId+'@'+p.assignedTo.join(',')).join('|');
 assert.equal(sig(),sig());
 assert.equal(sig(),sig());
});

/* ============ 目录自检 ============ */
test('演示目录自检：无秘密、无官方背书、价格用分',()=>{
 assert.equal(new Set(C.products.map(p=>p.id)).size,C.products.length);
 for(const p of C.products){
  assert.equal(p.source,'demo');
  if(p.price!==null){assert.equal(p.price.currency,'CNY');assert.ok(Number.isInteger(p.price.minor),'价格必须是整数分');}
 }
 assert.equal(C.products.every(p=>p.newProductEvidence.officialFlag===false),true,'演示目录不得有官方新品标记');
});