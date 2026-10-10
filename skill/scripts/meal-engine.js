(function(root){
'use strict';
/* 整餐引擎：把八题答案真正变成推荐结果。
   硬约束先行（餐单、锁定、人数与覆盖、明确忌口、预算、供应），软排序随后（多维口味、本人例外、方向、熟悉与一份变化、轮换内去重）。
   所有随机性都被禁止：同输入必须得到同输出，排序有确定性 tie-break。 */
const D=typeof module!=='undefined'?require('./domain.js'):root.McDomain;
const W=typeof module!=='undefined'?require('./wizard-domain.js'):root.McWizard;
const clone=W.clone,money=W.money;
const ROLES=['main','side','drink'];

/* 默认份量：每人 1 主食、每 2 人 1 份共享小食、每人 1 饮品。这是粗略食物规则，不代表营养或精准饱腹。 */
function targets(people,portion){
 const p=portion||'regular';const n=Math.max(1,people||1);
 const sideBase=Math.ceil(n/2);
 return {main:n,side:p==='less'?0:p==='more'?sideBase*2:sideBase,drink:n};
}
/* 个人身份只用 p1/p2…，不收集姓名、年龄或任何儿童数据。 */
function personIds(people){return Array.from({length:Math.max(0,people||0)},(_,i)=>'p'+(i+1));}
function coverageOf(p){return W.coverageOf(p);}
function coverageKey(p){return W.coverageKey(p);}

/* 硬约束：明确忌口优先于全组口味。个人忌口优先于共享商品。 */
function avoidSet(state){
 const base=new Set(state.constraints.avoid||[]);
 for(const id of personIds(state.constraints.people))
  for(const a of (state.constraints.personPrefs?.[id]?.avoid||[]))base.add(a);
 return base;
}
function allowed(product,assignedTo,state){
 const avoid=avoidSet(state);if(!avoid.size)return true;
 if(!Array.isArray(product.ingredientTags))return false;/* 成分未知不能伪造合格 */
 if(!product.ingredientTags.length)return true;
 return ![...avoid].some(a=>product.ingredientTags.includes(a));
}
/* 方向只约束它对应的角色，且只影响未满足需求，不替换已选餐单。 */
/* 方向只约束它对应的那个角色。用“是否覆盖该角色”判断，不能用数值比较——
   coverageOf(tea) 是 {drink:1}，[main] 为 undefined，undefined<=0 为 false 会误判。 */
function directionOk(product,state){
 const d=state.direction;if(!d)return true;
 const cov=coverageOf(product);
 if(!cov[d.role])return true;
 return d.optionIds.includes(product.id);
}

/* 覆盖计算：先占餐单与锁定的人员槽位，再把外部已有分到剩余槽位，最后只补缺口。 */
function buildCoverage(state,catalog){
 const n=state.constraints.people,ids=personIds(n);
 const cov={main:0,side:0,drink:0};
 const occupiedMain=new Set(),occupiedDrink=new Set();
 const units=[];
 const lines=[...(state.cart||[])];
 /* 餐单与锁定是固定项 */
 for(const lock of state.locks||[])lines.push(lock);
 for(const line of lines){
  const p=catalog.find(x=>x.id===line.productId);if(!p)continue;
  const c=coverageOf(p),qty=line.quantity||1;
  const lineIds=line.assignedTo||[];
  for(let i=0;i<qty;i++){
   const size=c.main||c.drink||0;
   let mine=lineIds.length?lineIds.slice(i*size,(i+1)*size):[];
   if(!mine.length&&(c.main||c.drink)){
    const occ=c.main?occupiedMain:occupiedDrink;
    mine=ids.filter(id=>!occ.has(id)).slice(0,c.main||c.drink);
   }
   if(p.role==='side'||(c.main||0)>1)mine=ids;
   const u=D.makeUnit(p,mine,line.specs||{},line.lockId||null);
   u.origin='fixed';                     /* 来自餐单或锁定的固定单位 */
   if(!allowed(p,mine.length?mine:ids,state))return {error:'已选餐单或保留项与明确忌口冲突，或成分信息待核实；请自行调整餐单或条件。'};
   if(c.main)mine.slice(0,c.main).forEach(id=>occupiedMain.add(id));
   if(c.drink)mine.slice(0,c.drink).forEach(id=>occupiedDrink.add(id));
   for(const r of ROLES)cov[r]+=c[r]||0;
   units.push(u);
  }
 }
 /* 外部已有：咖啡与其他饮品合计只抵扣一次饮品需求，绝不按一个布尔值删掉整组饮品 */
 const ext=state.external||W.emptyExternal();
 const remainingMain=ids.filter(id=>!occupiedMain.has(id));
 const drinkNeed=Math.max(0,(targets(n,state.constraints.portion).drink)-cov.drink);
 const drinkExternal=Math.min(W.externalDrinkCount(ext),drinkNeed);
 /* 主食外部已有按实际份数抵扣剩余槽位 */
 const externalApplied={main:Math.min(ext.main||0,remainingMain.length),side:ext.side||0,drink:drinkExternal};
 for(let i=0;i<externalApplied.main;i++)cov.main++;
 cov.side+=externalApplied.side;
 cov.drink+=externalApplied.drink;
 return {cov,units,ids,occupiedMain,occupiedDrink,externalApplied};
}

/* 单份缺口补齐：为每个未覆盖人员槽位找一件商品 */
function fillGap(state,catalog,base,options){
 const opts=options||{};
 const t=targets(state.constraints.people,state.constraints.portion);
 const units=base.units.map(u=>({...u,used:false}));
 const out=units.filter(u=>u.used===false);
 const cov={...base.cov};
 const penalize=new Set(opts.penalize||[]);
 const taste=opts.taste||null;
 const need=(role)=>Math.max(0,(t[role]||0)-cov[role]);
 const products=catalog.filter(p=>p.recommendable!==false);

 /* 确定性排序分：分数越高越优先。只有有证据且符合的维度才加分。
    assignees 是实际食用者。个人例外优先于全组口味：那个人自己选的口味是他那份的主依据，
    全组口味只是默认倾向，不能压过个人明确选择。 */
 function rank(product,assignees){
  let score=-(product.rank||0);
  if(penalize.has(product.id))score-=50;
  if(!directionOk(product,state))score-=1000;
  if(!allowed(product,assignees&&assignees.length?assignees:base.ids,state))score-=1000;
  const who=assignees&&assignees.length?assignees:base.ids;
  const personal=who.filter(id=>state.constraints.personPrefs?.[id]?.taste);
  if(personal.length){
   /* 有个人明确口味时，用他自己的口味评分；全组口味只作次要参考 */
   for(const id of personal)score+=W.tasteScore(product,W.buildTaste([state.constraints.personPrefs[id].taste],'person'))*6;
   score+=W.tasteScore(product,taste);
  }else score+=W.tasteScore(product,taste)*3;
  return score;
 }
 /* 主食按人逐个挑选：先为每个未覆盖的人排出他的最优，再依次落位，
    这样第 2 位“不油腻”的偏好能真正影响他/她那份，而不是被第 1 位偏好带偏。 */
 function pickFor(personId,role,filterFn){
  const pool=products.filter(filterFn);
  const ranked=pool.map(p=>({p,score:rank(p,[personId])}))
   .sort((a,b)=>b.score-a.score||a.p.id.localeCompare(b.p.id));
  return ranked.length?ranked[0].p:null;
 }
 for(const role of ['main','side','drink']){
  let guard=0;
  while(need(role)>0&&guard++<40){
   /* 补单一槽位时优先用刚好覆盖该角色的单品；组合装只在没有可行单品时才考虑，
      并且绝不允许把其他角色补超——避免用一份组合装把三个槽位一起灌满。 */
   const overshoots=p=>ROLES.some(r=>r!==role&&(coverageOf(p)[r]||0)>0&&cov[r]+(coverageOf(p)[r]||0)>t[r]);
   const exact=p=>ROLES.every(r=>r===role||!coverageOf(p)[r]);
   const pool=products.filter(p=>{const c=coverageOf(p);if(!(c[role]>0))return false;
     if(cov[role]+(c[role]||0)>t[role])return false;      /* 本角色不补超 */
     if(!directionOk(p,state)||!allowed(p,base.ids,state))return false;
     return true;})
    .sort((a,b)=>rank(b)-rank(a)||a.id.localeCompare(b.id));
   const exactPool=pool.filter(exact);
   const usable=exactPool.length?exactPool:pool.filter(p=>!overshoots(p));
   const chosen=usable[0]||pool.filter(exact)[0];
   if(!chosen)break;
   const p=chosen,c=coverageOf(p);
   if(role==='drink'){
    const occ=new Set([...base.occupiedDrink,...out.filter(u=>coverageOf(u).drink).flatMap(u=>u.assignedTo)]);
    const mine=[base.ids.find(id=>!occ.has(id))||base.ids[0]];
    out.push(D.makeUnit(p,mine,{}));out[out.length-1].origin='suggested';if(c.drink)mine.forEach(id=>base.occupiedDrink.add(id));
   }else if(role==='main'){
    /* 主食按人逐个挑选：谁还没吃到，就按那个人的偏好挑一份。
       这样第 2 位“不油腻”的例外能真正影响他/她那份。 */
    const free=base.ids.filter(id=>!base.occupiedMain.has(id));
    if(!free.length)break;
    const person=free[0];
    const p=pickFor(person,role,p=>{const c=coverageOf(p);
      if(!(c.main>0))return false;
      if(cov.main+(c.main||0)>t.main)return false;
      if(!directionOk(p,state))return false;
      if(!allowed(p,[person],state)&&!allowed(p,[...free],state))return false;
      return true;})||usable[0];
    const pc=coverageOf(p);
    const take=free.slice(0,pc.main||1);
    out.push(D.makeUnit(p,take,{}));out[out.length-1].origin='suggested';
    take.forEach(id=>base.occupiedMain.add(id));
    for(const r of ROLES)cov[r]+=pc[r]||0;
    continue;
   }else out.push(D.makeUnit(p,base.ids,{}));
   for(const r of ROLES)cov[r]+=c[r]||0;
   out[out.length-1].origin='suggested';   /* 本次补缺口的单位 */
  }
 }
 return {units:out,cov};
}

/* 生成整餐。options.direction / taste / novelty / penalize 全部来自八题答案。 */
function buildMeal(state,catalog,options){
 const opts=options||{};
 let s=clone(state);
 /* 方向必须在评分前写入状态，否则方向不会真正影响结果 */
 if(opts.direction)s.direction=opts.direction;
 if(opts.novelty)s.novelty=opts.novelty;
 if(opts.taste)s.sessionTaste=opts.taste;
 if(!Number.isInteger(s.constraints.people)||s.constraints.people<1||s.constraints.people>12)
  return failure('先选择精确人数（演示支持 1–12 人）。');
 const base=buildCoverage(s,catalog);
 if(base.error)return failure(base.error);
 const taste=opts.taste||null;
 const filled=fillGap(s,catalog,base,{taste:taste,penalize:opts.penalize});
 const t=targets(s.constraints.people,s.constraints.portion);
 if(filled.cov.main<t.main)
  return failure('主食份数少于当前人数；请调整已有数量、人数或解除部分保留。');
 const parts=D.group(filled.units);
 const sum=cost(parts,s,catalog);
 const limit=D.budgetLimit(s.constraints);
 /* 预算覆盖餐单＋建议新增＋已知必付费用。未知价格不能报告已满足预算。
    超预算时给出直接冲突，不静默减人数、删餐单或放宽忌口。 */
 if(limit!==null&&sum&&sum.minor>limit)
  return failure('当前餐单与建议新增合计 '+(sum.minor/100)+' 元，超过你设的 '+(limit/100)+' 元上限。请调整预算、取消部分保留，或减少人数——没有静默删减任何内容。');
 const reasons=buildReasons(s,filled,t,base,taste,opts);
 const rec={parts,units:filled.units,coverage:filled.cov,externalApplied:base.externalApplied,total:sum,
  /* 供尝新派生金额使用：餐单固定金额与已知费用必须一起带过去 */
  cartTotal:D.total(s.state?s.state.cart:s.cart,catalog),
  feeMinor:s.context&&s.context.feeMinor?s.context.feeMinor:0,
  budgetStatus:limit===null?'unset':sum?'within':'pending',
  budgetLimit:limit,targets:t,reasons,conflicts:[],
  signature:D.signature(filled.units),
  direction:s.direction||null,noveltyMode:opts.novelty?.mode||null};
 const novelty=W.applyNovelty(rec,catalog,opts.novelty,{taste,budgetLimit:limit,
  allowedFn:p=>allowed(p,base.ids,s)&&directionOk(p,s),
  /* 轮换时，尝新替换不得把这一顿换回上一顿已经吃过的主食，
     否则每一顿都会被拉回同一款，轮换就失去意义。 */
  penalize:opts.penalize,
  /* 费用必须原样传递：null 表示未知，绝不能被 ||0 变成"免费" */
  feeMinor:s.context?s.context.feeMinor:0});
 /* applyNovelty 已在 unit 层重算并派生 parts/total/coverage/signature/budgetStatus。
    这里只取它派生后的字段，绝不再单独覆盖 total，否则行项与合计会不一致。 */
 if(novelty.noveltyApplied)rec.noveltyApplied=novelty.noveltyApplied;
 if(novelty.parts)rec.parts=novelty.parts;
 if(novelty.units)rec.units=novelty.units;
 if(novelty.total!==undefined)rec.total=novelty.total;
 if(novelty.coverage)rec.coverage=novelty.coverage;
 if(novelty.signature)rec.signature=novelty.signature;
 if(novelty.budgetStatus)rec.budgetStatus=novelty.budgetStatus;
 if(novelty.unknownReason!==undefined)rec.unknownReason=novelty.unknownReason;
 /* 预算结论已由 deriveFromUnits 按最终金额判定，这里不得再算一次——
    旧代码在此处用 limit===null?'unset':... 覆盖，导致"金额未知"被写成"预算未设"。 */
 const {fixed,suggested}=splitParts(rec,s);
 if(!suggested.length)reasons.push('这顿已经搭好了，无需再添。');
 else reasons.push('份量按演示规则搭配，不代表营养或精准饱腹。');
 rec.fixedParts=fixed;rec.suggestedParts=suggested;
 return rec;
}
/* 无解时返回统一形状：必须带空的 fixedParts/suggestedParts，
   否则调用方读 suggestedParts.length 会抛异常，把"如实告知无解"变成页面崩溃。 */
function failure(message){return {parts:[],units:[],coverage:{main:0,side:0,drink:0},conflicts:[message],
 reasons:[],total:null,budgetStatus:'pending',budgetLimit:null,signature:'',
 fixedParts:[],suggestedParts:[],noveltyApplied:null,unknownReason:'预算或条件冲突'};}
/* parts 已经包含固定餐单与锁定单位（buildCoverage 会把它们展开进 units），
   所以这里只加已知必付费用，不能再把 state.cart 加一次，否则会重复计价。 */
function cost(parts,state,catalog){
 const base=D.total(parts,catalog);
 if(base===null)return null;
 if(state.context&&state.context.feeMinor===null)return null;
 return money(base.minor+((state.context&&state.context.feeMinor)||0));
}
/* 解释必须可追溯：有证据才说符合，未知就说资料不完整，不制造匹配百分比。 */
function buildReasons(state,filled,t,base,taste,opts){
 const bits=[];
 bits.push(filled.cov.main+' 份主食'+(filled.cov.side?'，'+filled.cov.side+' 份小食可共享':'')+'，'+filled.cov.drink+' 杯饮品。');
 if(base.externalApplied.main||base.externalApplied.drink||base.externalApplied.side){
  /* 只把餐单与外部已有的量算作"已覆盖"；本次建议新增不能算进去，否则文案会自相矛盾 */
  const fixedDrinks=base.units.filter(u=>coverageOf(u).drink>0).length;
  bits.push('已扣除外部已有 '+W.buildExternalMessage(filled.cov,t,{main:Math.max(0,t.main-filled.cov.main),side:Math.max(0,t.side-filled.cov.side),drink:Math.max(0,t.drink-filled.cov.drink)},state.external,fixedDrinks)+'；只补缺少的部分。');
 }
 if(taste&&taste.source){
  const first=filled.units[0];
  const named=first?tasteExplanationFor(first,taste):[];
  bits.push(named.length?named.join('；')+'（来源：'+taste.sourceLabel+'）。':'按'+W.describeTaste(taste)+'的方向挑选；这项商品没有可用标签依据。');
 }
 if(state.direction)bits.push('按你选的'+describeDirection(state.direction)+'方向补主食。');
 if(opts.noveltyMode==='safe')bits.push('按你说的稳妥一点，这次不主动换。');
 return bits;
}
function tasteExplanationFor(product,taste){return W.tasteExplanation(product,taste);}

/* 第 5 题用的方向描述：只说用户选的方向，不编造“你常吃”。 */
const DIRECTION_NAMES={burger:'汉堡',wrap:'卷',chicken:'鸡肉',fish:'鱼排',side:'小食',drink:'饮品'};
function describeDirection(d){if(!d)return'';return d.label||DIRECTION_NAMES[d.id]||d.id;}

/* 区分“已固定”与“建议新增”。
   parts 里同时含餐单/锁定固定单位和本次补的缺口单位；
   只有 suggested 能加入餐单，fixed 绝不能被重复批量加入（否则双击或后退会重复下单式操作）。 */
/* 固定与建议新增必须按 unit 来源分开聚合。
   旧实现用 parts（聚合行）去 units 里 find 第一个匹配：同一商品既在餐单又在建议里时，
   会把整行都判成"固定"，导致新增的那几份从建议里消失、显示成"已加入×2"但购物车只有1份。
   这里改为：先按 unit 的 origin 分组，再各自聚合。 */
function splitParts(rec,state){
 const units=rec.units||[];
 const fixedUnits=units.filter(u=>u.origin==='fixed');
 const sugUnits=units.filter(u=>u.origin!=='fixed');
 return {fixed:W.aggregateParts(fixedUnits),suggested:W.aggregateParts(sugUnits)};
}
let _catalog=[];
function catalog_find(id){return _catalog.find(p=>p.id===id);}
function setCatalog(c){_catalog=c;}

const api={targets,personIds,coverageOf,coverageKey,allowed,buildCoverage,fillGap,buildMeal,failure,cost,
 avoidSet,directionOk,describeDirection,splitParts,setCatalog};
if(typeof module!=='undefined')module.exports=api;else root.McEngine=api;
})(typeof window!=='undefined'?window:globalThis);