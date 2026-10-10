(function(root){
'use strict';
/* 八步引导与六项能力的纯领域逻辑。
   本文件不碰 DOM，可在 Node 中直接单测。Skill 与 HTML 共用这一份规则，避免两套算法漂移。 */
const clone=x=>JSON.parse(JSON.stringify(x));
const money=minor=>({minor,currency:'CNY'});

/* ---------- 1. 八回答状态机 ---------- */
const STEPS=[
 {n:1,key:'people',     title:'这顿几个人吃？',            hint:'先摆好餐位。'},
 {n:2,key:'budget',     title:'这餐预算怎么定？',          hint:'定个花费范围。'},
 {n:3,key:'external',   title:'你已经有什么吃的、喝的？',  hint:'先算上已有的。'},
 {n:4,key:'taste',      title:'今天更想吃什么感觉？',      hint:'找到想吃的感觉。'},
 {n:5,key:'direction',  title:'这两个方向，更想吃哪边？',  hint:'缩小到你要的方向。'},
 {n:6,key:'novelty',    title:'这顿想尝点新鲜吗？',        hint:'决定要不要一点新鲜。'},
 {n:7,key:'plan',       title:'只选这顿，还是顺手排几顿？', hint:'给接下来留点变化。'},
 {n:8,key:'memory',     title:'这些选择，下次要怎么用？',   hint:'最后，由你决定记不记。'}
];
function emptyAnswer(){return {status:'unanswered',value:null,source:null,at:null};}
function createSession(){
 return {step:1,completed:false,answers:STEPS.map(emptyAnswer),inputCount:0,decisionCount:0,revision:0,
  startedAt:null,submittedAt:null,pendingRevalidation:[]};
}
/* 完成由显式回答判定。控件的默认值不算已答。 */
function answerStatus(w,index){return w&&w.answers[index]?w.answers[index].status:'unanswered';}
function isAnswered(ans){return ans&&(ans.status==='answered'||ans.status==='unlimited');}
function answeredCount(w){return w.answers.filter(isAnswered).length;}
function firstUnanswered(w){const i=w.answers.findIndex(a=>!isAnswered(a));return i<0?null:i;}
/* 只有八题全部有明确回答才允许生成整餐推荐。 */
function gateOpen(w){return !!w&&w.answers.every(isAnswered);}
/* “帮我决定”只回答当前题：设置本题的不限定或解释过的默认值，绝不跳过其余题目。 */
function decide(w,index,value,reason){
 const next=clone(w);next.answers[index]={status:'unlimited',value:value===undefined?null:value,source:'decided',reason:reason||null,at:new Date().toISOString()};
 next.decisionCount++;next.revision++;
 if(next.step===index+1&&index<STEPS.length-1)next.step=index+2;
 return next;
}
function answer(w,index,value,status){
 const next=clone(w);next.answers[index]={status:status||'answered',value,source:'explicit',at:new Date().toISOString()};
 next.inputCount++;next.revision++;
 if(next.step===index+1&&index<STEPS.length-1)next.step=index+2;
 return next;
}
/* 返回修改保留答案；被依赖的方向标为待重验，不静默删除用户选择。 */
function goBack(w){
 const next=clone(w);if(next.step>1)next.step--;else next.step=1;next.revision++;return next;
}
/* 修改第 index 题后，把它之后依赖它的题目标为待重验。
   pendingRevalidation 挂在答案对象上，不删除用户已选内容。 */
function invalidateAfter(w,index){
 const next=clone(w);
 for(let i=index+1;i<next.answers.length;i++)
  if(isAnswered(next.answers[i]))next.answers[i].pendingRevalidation=true;
 next.revision++;return next;
}

/* ---------- 2. C1 生活化口味翻译 ---------- */
/* 生活化措辞 → 内部维度。三类可以并存，互不覆盖。 */
const TASTE_DIMS=[
 {key:'texture', word:'香脆',  need:'crispy',   evidence:'labeled'},
 {key:'texture', word:'软嫩',  need:'soft',     evidence:'labeled'},
 {key:'spice',   word:'微辣',  need:'spice',    evidence:'labeled'},
 {key:'spice',   word:'不辣',  need:'nospice',  evidence:'labeled'},
 {key:'richness',word:'不油腻',need:'light',   evidence:'labeled'}
];
function emptyTaste(){return {texture:[],spice:[],richness:[],flavor:[],source:null,confirmedAt:null};}
/* 多选保留全部维度。香脆不代替辣度；不油腻不转成低脂或健康。 */
function buildTaste(words,source){
 const t=emptyTaste();t.source=source||'explicit';t.confirmedAt=new Date().toISOString();
 for(const w of [].concat(words||[])){const d=TASTE_DIMS.find(x=>x.word===w);if(!d)continue;
  if(d.need==='crispy')t.texture.push('crispy');else if(d.need==='soft')t.texture.push('soft');
  else if(d.need==='spice')t.spice.push('mild');else if(d.need==='nospice')t.spice.push('none');
  else if(d.need==='light')t.richness.push('light');}
 return t;
}
/* 只对有证据的维度评分。返回结构化说明，绝不制造匹配百分比。 */
function tasteMatch(product,taste){
 const a=product.attributes||{};const out={matched:[],unknown:[],mismatch:[]};
 if(!taste||taste.source===null)return out;
 const push=(dim)=>{
  const dimWords=taste[dim]||[];if(!dimWords.length)return;
  const ev=a[dim]&&a[dim].evidence;
  if(ev!=='labeled'){out.unknown.push({dim,wanted:dimWords.join('、')});return;}
  const val=dim==='texture'?a.texture.label:dim==='spice'?(a.spice.level===0?'none':'mild'):a.richness.level;
  if(dimWords.includes(val))out.matched.push({dim,wanted:dimWords.join('、'),actual:val});
  else out.mismatch.push({dim,wanted:dimWords.join('、'),actual:val});
 };
 push('texture');push('spice');push('richness');
 return out;
}
/* 维度内部用英文标识（crispy/mild），但解释是给用户看的，必须译回中文。 */
const ROLES=['main','side','drink'];
const DIM_WORD={crispy:'香脆',soft:'软嫩',mild:'微辣',none:'不辣',light:'不油腻'};
function wordLabel(w){return DIM_WORD[w]||w;}
function tasteExplanation(product,taste){
 const m=tasteMatch(product,taste);const bits=[];
 for(const x of m.matched)bits.push('「'+wantText(x.wanted)+'」有演示标签依据');
 for(const x of m.unknown)bits.push('「'+wantText(x.wanted)+'」偏好已收到，但这项商品资料还不完整');
 for(const x of m.mismatch)bits.push('「'+wantText(x.wanted)+'」与该商品标签不符，未计入加分');
 return bits;
}
/* wanted 可能是单个值，也可能是"香脆、软嫩"这样的组合 */
function wantText(w){return String(w).split(/[、,]/).map(wordLabel).join('、');}
/* 确定性排序分：只按有证据且符合的维度加分，香脆不给辣度加分，反之亦然。 */
function tasteScore(product,taste){return tasteMatch(product,taste).matched.length*10;}

/* ---------- 3. C2 可行二选一方向 ---------- */
/* 只在“还缺什么”的角色里生成方向；已够主食就不再为了凑题目买主食。 */
function gapRoles(state,catalog,targets){
 const gaps=[];for(const role of ['main','side','drink']){
  const need=(targets[role]||0)-((state.coverage&&state.coverage[role])||0);
  if(need>0)gaps.push({role,need});}
 return gaps;
}
const FAMILY_NAMES={burger:'汉堡',wrap:'卷',chicken:'鸡肉',fish:'鱼排',side:'小食',drink:'饮品',other:'组合'};
/* 从当前硬约束下真实可行的商品里取两个有意义且可区分的方向。
   方向只在该角色确实是缺口时生成；组合装（family=other）不算一个“方向”，因为它不是口味或品类选择。 */
function buildDirections(catalog,state,targets,allowedFn){
 const gaps=gapRoles(state,catalog,targets);
 if(!gaps.length)return {status:'noGap',directions:[],gaps:[]};
 const primary=gaps[0];
 const feasible=catalog.filter(p=>p.recommendable!==false&&coverageOf(p)[primary.role]>0&&(!allowedFn||allowedFn(p)));
 const byFamily=new Map();
 for(const p of feasible){
  const f=p.family||p.role;
  if(f==='other')continue;                 /* 组合装不是方向 */
  if(!byFamily.has(f))byFamily.set(f,[]);
  byFamily.get(f).push(p.id);
 }
 const dirs=[...byFamily.entries()].map(([family,ids])=>({id:family,label:FAMILY_NAMES[family]||family,role:primary.role,optionIds:ids,productCount:ids.length}))
  .sort((a,b)=>b.productCount-a.productCount||a.id.localeCompare(b.id));
 const top=dirs.filter(d=>d.productCount>0).slice(0,2);
 if(!top.length)return {status:'none',directions:[],gaps};
 if(top.length===1)return {status:'single',directions:top,gaps,note:'当前条件下只有一个可行方向，不硬造第二个。'};
 return {status:'pair',directions:top,gaps};
}
/* 选择方向只收窄未满足需求，不替换已选餐单，也不改变锁定。 */
function applyDirection(state,direction){
 if(!direction)return state;
 const next=clone(state);next.constraints.direction=direction;next.direction={role:direction.role,optionIds:direction.optionIds,chosenId:direction.id,sourceRevision:next.revision||0,status:'chosen'};
 return next;
}
function directionAllows(state,product){
 const d=state.direction;if(!d)return true;
 if(coverageOf(product)[d.role]<=0)return true;/* 只约束这个方向对应的角色 */
 return d.optionIds.includes(product.id);
}

/* ---------- 4. C3 一个变化 + 熟悉搭档 ---------- */
function emptyNovelty(){return {mode:null,familiarUnitIds:[],familiarEvidence:null,maxChangedUnits:1,newProductEvidence:null};}
/* 官方新品证据必须齐全才允许称“新品”；演示目录没有，只能说“换一款”。 */
function officialNewFlag(product,now){
 const e=product.newProductEvidence;
 if(!e||e.officialFlag!==true)return false;
 if(e.checkedAt&&now&&e.checkedAt>now)return false;
 if(e.validTo&&now&&e.validTo<now)return false;
 return true;
}
/* 最多改变一份（商品＋规格），其余单位身份与人员规格不动，锁定不动。 */
/* 尝新：以 unit（单份）为唯一更新单位，最多替换一个 suggested 且未锁定的 unit。
   替换后由新的 units 重新派生 parts/total/coverage/signature，避免分别改字段导致金额不同步。
   固定餐单（origin='fixed'）与锁定项都不参与替换。 */
function applyNovelty(rec,catalog,novelty,options){
 const opts=options||{};
 if(!novelty||!novelty.mode)return deriveFromUnits(rec,rec.units||[],catalog,opts);
 /* 安全模式同样要走统一派生：否则覆盖量、外部已有与费用未知会被漏掉 */
 if(novelty.mode==='safe')
  return {...deriveFromUnits(rec,rec.units||[],catalog,opts),
   noveltyApplied:{changed:0,mode:'safe',note:'按你说的稳妥一点，这次不主动换。'}};
 const units=rec.units||[];
 if(!units.length)return {...deriveFromUnits(rec,[],catalog,opts),
  noveltyApplied:{changed:0,mode:novelty.mode,note:'当前没有可调整的建议项。'}};
 const familiar=new Set(novelty.familiarUnitIds||[]);
 /* 只有未锁定、且来自建议新增的 unit 才可替换；fixed 是用户已加入餐单的，不能动 */
 const targets=units.filter(u=>u.origin!=='fixed'&&!u.locked&&!familiar.has(u.productId));
 if(!targets.length)return {...deriveFromUnits(rec,units,catalog,opts),
  noveltyApplied:{changed:0,mode:novelty.mode,note:'没有可替换的建议项，保留原方案。'}};
 const now=opts.now||new Date().toISOString();
 const unitPrice=u=>(u.price&&u.price.minor!==null&&u.price.minor!==undefined)?u.price.minor:0;
 let best=null;
 for(const unit of targets){
  const product=catalog.find(p=>p.id===unit.productId);if(!product)continue;
  const alternatives=catalog.filter(p=>p.id!==product.id&&p.role===product.role&&coverageKey(p)===coverageKey(product)
   &&p.recommendable!==false&&(!opts.allowedFn||opts.allowedFn(p))&&p.price&&p.price.minor!==null);
  const ranked=alternatives.map(p=>{
   const isNew=officialNewFlag(p,now);
   return {p,isNew,score:(isNew?100:0)+tasteScore(p,opts.taste)-(p.price.minor-product.price.minor)/1000-(p.rank||0)/100};
  }).sort((a,b)=>b.score-a.score);
  for(const alt of ranked){
   /* 轮换去重：上一顿已吃过的商品不能再被换回来 */
   if(opts.penalize&&opts.penalize.has&&opts.penalize.has(alt.p.id))continue;
   /* 只替换这一份，金额差也只按一份算 */
   const delta=alt.p.price.minor-product.price.minor;
   const after=(rec.total?rec.total.minor:0)+delta;
   const limit=opts.budgetLimit??null;
   if(limit!==null&&after>limit)continue;
   best={unit,from:product,to:alt.p,delta,isNew:alt.isNew};
   break;/* 最多只换一个 unit */
  }
  if(best)break;
 }
 if(!best)return {...deriveFromUnits(rec,units,catalog,opts),noveltyApplied:{changed:0,mode:novelty.mode,note:'预算内没有可行的替换，保留原组合。'}};

 /* 在 unit 层替换：只动一个 unit，其余原样保留 */
 const replaced=makeUnitLike(best.to,best.unit);
 const newUnits=units.map(u=>u===best.unit?replaced:u);
 const derived=deriveFromUnits(rec,newUnits,catalog,opts);
 return {...derived,
  noveltyApplied:{changed:1,mode:novelty.mode,fromId:best.from.id,fromName:best.from.name,
   toId:best.to.id,toName:best.to.name,quantity:1,isOfficialNew:best.isNew,
   note:best.isNew?'把其中一份换成了有官方新品标记的商品。':'沿用常规组合，只换一项。'}};
}
/* 用新商品替换一个 unit，但保留原 unit 的人员归属、规格、锁定与来源 */
function makeUnitLike(product,unit){
 return {...clone(product),productId:product.id,id:product.id,quantity:1,
  specs:clone(unit.specs||{}),assignedTo:clone(unit.assignedTo||[]),
  lockId:unit.lockId||null,locked:!!unit.locked,shared:!!unit.shared,
  origin:unit.origin||'suggested',lineId:product.id+'|'+(unit.lockId||'open')};
}
/* 由最终 units 重新派生 parts / total / coverage / signature。
   任何展示与金额都必须来自这里，避免出现"行项变了但合计没变"。 */
/* 由最终 units 统一派生一切：parts / 金额 / 覆盖 / 签名 / 预算结论。
   这是唯一的派生入口——不在多层各打补丁，避免"行项变了合计没变"。
   四条合同：
   1) 金额只按最终 units 逐份求和，已知必付费用只加一次。units 已含 fixed，
      因此**绝不能再加 rec.cartTotal**（曾导致固定餐单被重复计价）。
   2) 费用未知（feeMinor===null）不等于免费：total 保持 null，不得写成 0。
   3) 覆盖＝外部有效覆盖 ＋ 本次 units 覆盖；每部分只计一次。
   4) 聚合与签名使用规范化后的 商品＋规格＋来源＋锁定＋人员 身份。 */
function deriveFromUnits(rec,units,catalog,opts){
 const o=opts||{};
 /* --- 金额：逐份单价求和 --- */
 let sum=0;let unknownPrice=false;
 for(const u of units){
  const p=catalog.find(x=>x.id===u.productId);
  const minor=p&&p.price?p.price.minor:null;
  if(minor===null||minor===undefined)unknownPrice=true;else sum+=minor;
 }
 /* 必付费用：null 表示未知，绝不等同 0 */
 const fee=o.feeMinor;
 const feeKnown=fee!==null&&fee!==undefined;
 const price=unknownPrice||!feeKnown?null:money(sum+(fee||0));

 /* --- 覆盖：外部已有 + 本次 units，每部分只计一次 --- */
 const cov={main:0,side:0,drink:0};
 const ext=rec.externalApplied||{};
 for(const k of ROLES)cov[k]+=(ext[k]||0);
 for(const u of units){
  const c=coverageOf(u);
  for(const k of ROLES)cov[k]+=(c[k]||0);
 }

 const parts=aggregateParts(units);
 const limit=o.budgetLimit??null;
 /* 金额未知时不得报告"预算内"。用户没设预算（limit===null）时状态是"未设"，
    但金额未知仍要如实说明，因此 unknownReason 一定要给出。 */
 const budgetStatus=price===null?'pending':limit===null?'unset':(price.minor<=limit?'within':'over');
 return {...rec,units,parts,total:price,coverage:cov,budgetStatus,
  unknownReason:price===null?(unknownPrice?'部分餐品价格待核实':'必付费用待核实'):null,
  signature:signatureOf(units)};
}
/* 规范化规格：按组 id 排序后拼接，保证 {size,temp} 与 {temp,size} 得到同一身份 */
function specKey(specs){
 if(!specs)return '';
 const keys=Object.keys(specs).sort();
 if(!keys.length)return '';
 return keys.map(k=>k+'='+specs[k]).join(',');
}
/* unit 身份：商品＋规范化规格＋来源＋锁定。人员是聚合后的结果，不是身份的一部分——
   否则同一款主食会因分给不同人而裂成多行（曾导致"鸡腿堡×3"显示成三行 ×1）。 */
function unitKey(u){
 return [u.productId||u.id,specKey(u.specs),u.origin||'suggested',u.lockId||'open'].join('|');
}
function signatureOf(units){
 return units.map(unitKey).sort().join(';');
}
/* 聚合：同身份合并数量与人员集合。不同规格、不同来源或不同锁定的必须分行。 */
function aggregateParts(units){
 const map=new Map();
 for(const u of units){
  const key=unitKey(u);
  if(!map.has(key))map.set(key,{...clone(u),id:u.productId||u.id,lineId:key,quantity:0,assignedTo:[]});
  const p=map.get(key);p.quantity++;p.assignedTo.push(...(u.assignedTo||[]));
 }
 return [...map.values()].map(p=>({...p,assignedTo:[...new Set(p.assignedTo)].sort()}))
  .sort((a,b)=>{
   const rk=x=>(coverageOf(x).main?0:x.role==='side'?1:x.role==='drink'?2:3);
   return rk(a)-rk(b)||String(a.id).localeCompare(String(b.id))||specKey(a.specs).localeCompare(specKey(b.specs));
  });
}

/* ---------- 5. C4 经同意的记忆 + 真实吃后反馈 ---------- */
function emptyConsent(){return {useSavedTaste:false,useSavedSelections:false,saveExplicitTaste:false,saveFinalSelection:false,saveRotationPlan:false};}
/* 四类同意彼此独立，不能捆绑。 */
function consentAllowsSavedTaste(c){return !!(c&&c.useSavedTaste);}
function consentAllowsSavedSelections(c){return !!(c&&c.useSavedSelections);}
/* 本次明确选择高于已保存偏好。第 4 题已确认沿用的旧口味就是本次答案，第 8 题拒绝保存不会清掉它。 */
function resolveTasteForRun(sessionTaste,savedTaste,consent){
 if(sessionTaste&&sessionTaste.source)return {...sessionTaste,sourceLabel:'按本次选的'+describeTaste(sessionTaste)};
 if(consentAllowsSavedTaste(consent)&&savedTaste)return {...savedTaste,sourceLabel:'参考已同意的偏好'};
 return emptyTaste();
}
function describeTaste(t){const bits=[];for(const w of ['香脆','软嫩'])if(t.texture.includes(w==='香脆'?'crispy':'soft'))bits.push(w);
 if(t.spice.includes('mild'))bits.push('微辣');if(t.spice.includes('none'))bits.push('不辣');if(t.richness.includes('light'))bits.push('不油腻');
 return bits.length?bits.join('、'):'都可以';}
/* 只有本人主动确认吃过，才问合口味；加餐单、下单、时间流逝都不算。 */
function feedbackGate(mealId,eatenConfirmed){return {open:false,mealId,reason:eatenConfirmed?null:'还没确认这顿吃过，不问体验。'};}
function beginFeedback(gate,eatenConfirmed){return eatenConfirmed?{...gate,open:true,reason:null}:{...gate,open:false,reason:'还没确认这顿吃过，不问体验。'};}
/* 未确认吃过时返回 null，表示不产生任何反馈记录。
   加入餐单、下单或时间流逝都不构成吃过证据。 */
function feedbackRecord(gate,unitId,kind,eatenConfirmed,saveConsentId){
 if(!eatenConfirmed)return null;
 return {mealId:gate.mealId,unitId,kind,eatenConfirmation:true,saveConsentId:saveConsentId||null};
}
/* 保存失败必须如实说失败，不能显示成功。 */
function persistResult(writeResult){
 try{const r=writeResult();return r&&r.persisted?{ok:true}:{ok:false,message:'这次已用上，没能保存到下次。'};}
 catch(e){return {ok:false,message:'这次已用上，没能保存到下次。'};}
}

/* ---------- 6. C5 有变化的多顿轮换 ---------- */
/* 先减少主食连续重复，再减少整套重复；饮品、喜好和锁定可以重复。
   stateFactory(index) 返回一个 (catalog, options) => rec 的函数，保证每一顿基于当次真实条件生成。 */
function buildPlan(catalog,stateFactory,length,history){
 const meals=[];const notes=[];
 const usedHistory=(history||[]).filter(h=>h&&h.kind==='selection'&&h.consent===true);
 const sig=k=>(k.parts||[]).map(x=>x.id+'×'+x.quantity).sort().join('|');
 for(let i=0;i<length;i++){
  const penal=new Set();
  if(i>0){
   const prev=meals[i-1];
   /* 主食不连续重复 */
   for(const p of catalog.filter(p=>coverageOf(p).main>0))if(prev.mainIds.includes(p.id))penal.add(p.id);
   /* 整套不重复（第二轮开始） */
   if(i>1&&sig(prev)===sig(meals[i-2]))notes.push({meal:i+1,reason:'候选不足，与前一顿相同'});
  }
  const rec=stateFactory(i)(catalog,{penalize:penal});
  if(!rec||!Array.isArray(rec.parts)){meals.push({index:i+1,mainIds:[],parts:[],total:null,coverage:{main:0,side:0,drink:0},unavailable:true});continue;}
  meals.push({index:i+1,mainIds:rec.parts.filter(p=>coverageOf(p).main>0).map(p=>p.id),
   parts:rec.parts,total:rec.total,coverage:rec.coverage,checkedAt:null,conflicts:rec.conflicts||[]});
 }
 const rep=[];
 for(let i=1;i<meals.length;i++)for(const p of meals[i].parts){
  if(meals[i-1].parts.some(x=>x.id===p.id))rep.push({meal:i+1,name:p.name,quantity:p.quantity,reason:'目录内可选项有限，如实重复'});}
 return {id:'plan-'+length,length,meals,
  historyUsed:usedHistory.map(h=>({kind:h.kind,at:h.at,source:h.source})),
  repeatNotes:rep,inputRevision:0,savedConsent:null,notes,
  note:usedHistory.length?'参考获准的选餐记录，不是订单':'暂无可用历史，先让这几顿彼此不同'};
}
/* 每顿使用前重新核验；旧报价不能当有效报价。 */
function revalidateMeal(planMeal,current,now){
 const diffs=[];
 if(planMeal.coverage&&current.coverage&&planMeal.coverage.main!==current.coverage.main)
  diffs.push({field:'人数',before:planMeal.coverage.main,after:current.coverage.main});
 if(planMeal.total&&current.total&&planMeal.total.minor!==current.total.minor)
  diffs.push({field:'价格',before:planMeal.total.minor,after:current.total.minor,needsReprice:true});
 const expired=planMeal.checkedAt&&now&&Date.parse(planMeal.checkedAt)+86400000<Date.parse(now);
 if(expired)diffs.push({field:'报价时效',before:planMeal.checkedAt,after:now,needsReprice:true});
 const missing=current.unavailable&&current.unavailable.length?current.unavailable.map(id=>({field:'供应',id})):[];
 return {ok:diffs.length===0&&!missing.length,diffs:[...diffs,...missing],requiresConfirmation:diffs.length>0||missing.length>0};
}

/* ---------- 7. C6 已有饮食补餐 ---------- */
/* external 分开记录咖啡与其他饮品；先占餐单与锁定的人员槽位，再把外部数量分到剩余槽位。 */
function emptyExternal(){return {coffee:0,otherDrink:0,main:0,side:0,amountConfidence:'exact',confirmed:false};}
function externalDrinkCount(e){return (e.coffee||0)+(e.otherDrink||0);}
/* 只生成未满足的数量：咖啡计入饮品覆盖，不重复计一次，也不因一个布尔值删掉整组饮品。 */
function computeGap(state,targets){
 const fixed=state.coverage||{};
 const cart=fixed.cart?{...fixed}:{main:0,side:0,drink:0};
 const ext=state.external||emptyExternal();
 const covered={main:(fixed.main||0)+(ext.main||0),side:(fixed.side||0)+(ext.side||0),drink:(fixed.drink||0)+externalDrinkCount(ext)};
 const gap={};
 for(const role of ['main','side','drink'])gap[role]=Math.max(0,(targets[role]||0)-covered[role]);
 const externalMessage=buildExternalMessage(covered,targets,gap,ext);
 return {covered,gap,needsAnything:Object.values(gap).some(v=>v>0),externalMessage};
}
/* 外部已有提示。只看外部与餐单带来的覆盖，**不把本次建议新增算进"已够"**，
   否则会出现"已够 3 杯"但列表里又新增了一杯的自相矛盾说法。
   fixedDrinks 是餐单里已有的饮品杯数，externalDrinks 是外部已有的杯数。 */
function buildExternalMessage(covered,targets,gap,ext,fixedDrinks){
 const externalDrink=externalDrinkCount(ext);
 const fixed=typeof fixedDrinks==='number'?fixedDrinks:0;
 const drinkCovered=externalDrink+fixed;
 const people=state_people(targets);
 const bits=[];
 if(drinkCovered>0&&targets.drink-drinkCovered>0)
  bits.push(people+' 人已有饮品 '+drinkCovered+' 杯，还补 '+(targets.drink-drinkCovered)+' 杯');
 else if(drinkCovered>0)
  bits.push('餐单与外部饮品已够 '+drinkCovered+' 杯，饮品无需再添');
 if((ext.main||0)>0&&(covered.main||0)>=targets.main)bits.push('主食已够 '+covered.main+' 份，不再多加主食');
 else if((ext.main||0)>0)bits.push('已有主食 '+(ext.main||0)+' 份，还补 '+Math.max(0,targets.main-covered.main)+' 份');
 if(ext.amountConfidence==='rough')bits.push('不清楚具体份量，按数量粗略估算');
 return bits;
}
function state_people(targets){return targets.main||1;}

/* ---------- 8. 省钱 Wizard：真实总成本比较 ---------- */
/* 使用分的定点金额。任何必要费用未知就标待核实，不能用 0 补齐后声称已满足。 */
function emptyQuote(){return {mode:'demo',contextKey:null,checkedAt:null,expiresAt:null,itemsTotal:null,deliveryFee:null,
 tablewareFee:null,otherMandatoryFees:null,discount:null,total:null,eligibilityEvidence:null,unknownFields:[]};}
function computeQuote(input){
 const q=emptyQuote();
 q.mode=input.mode||'demo';q.contextKey=input.contextKey||null;q.checkedAt=input.checkedAt||null;q.expiresAt=input.expiresAt||null;
 const fields={itemsTotal:input.itemsTotal,deliveryFee:input.deliveryFee,tablewareFee:input.tablewareFee,
  otherMandatoryFees:input.otherMandatoryFees,discount:(input.eligibility===true&&input.expired!==true)?input.discount:0};
 const unknown=[];
 for(const [k,v] of Object.entries(fields)){
  if(v===null||v===undefined||!Number.isInteger(v)){unknown.push(k);continue;}
  if(k==='discount')q.discount=money(v);else q[k]=money(v);
 }
 q.unknownFields=unknown;
 /* 优惠资格不符、券到期、无法叠加、核价失败都不能算成省钱 */
 if(input.eligibility!==true)q.eligibilityEvidence='不符合优惠资格，未计入任何优惠';
 else if(input.expired===true)q.eligibilityEvidence='优惠已过期，未计入';
 else if(input.stackingRejected===true)q.eligibilityEvidence='优惠无法叠加，只按单张计算';
 else if(unknown.length)q.eligibilityEvidence='必要费用未知，总价待核实';
 else q.eligibilityEvidence='本次已核验';
 if(!unknown.length){
  q.total=money(q.itemsTotal.minor+q.deliveryFee.minor+q.tablewareFee.minor+q.otherMandatoryFees.minor+q.discount.minor);
 }
 return q;
}
/* 固定需求后比较方案：人数、足量规则、口味忌口、锁定、规格、门店渠道时段与已有餐单都不可变。 */
/* 省钱比较：只要有任一方案的必要费用未知，就整体拒绝比较。
   旧实现把未知方案直接 filter 掉，然后对剩下的算 delta——这会在用户以为
   "已经比过了"的情况下，用一份不完整的方案得出节省额。 */
function compareSavings(plans){
 const list=Array.isArray(plans)?plans:[];
 const incomplete=list.filter(p=>!p.quote||!p.quote.total||(p.quote.unknownFields&&p.quote.unknownFields.length));
 if(incomplete.length)
  return {status:'pending',plans:list,
   message:'必要费用待核实（'+(incomplete[0].quote&&incomplete[0].quote.unknownFields||[]).join('、')+'），无法比较真实总成本。'};
 const valid=list.filter(p=>p.quote&&p.quote.total);
 if(!valid.length)return {status:'pending',plans:list,message:'省钱方案待接入，或必要费用未知，无法比较真实总成本。'};
 const sorted=[...valid].sort((a,b)=>a.quote.total.minor-b.quote.total.minor||a.id.localeCompare(b.id));
 const best=sorted[0],base=list.find(p=>p.isBaseline)||sorted[0];
 const delta=base.quote.total&&best.quote.total?money(best.quote.total.minor-base.quote.total.minor):null;
 return {status:'compared',plans:list,sorted,best,baseline:base,delta,
  message:'本次已核验的这些方案中较省。不代表全网最低或全渠道最优。',
  scope:{people:base.people,store:base.store,channel:base.channel,reservationAt:base.reservationAt,checkedAt:base.quote.checkedAt}};
}
/* 改变餐品、数量、规格、承诺或新增支出，必须预览差异并由用户明确应用。 */
function savingsDiff(baseline,alternative){
 const d=[];
 const bp=new Map(baseline.parts.map(p=>[p.id+'|'+JSON.stringify(p.specs||{}),p.quantity]));
 const ap=new Map(alternative.parts.map(p=>[p.id+'|'+JSON.stringify(p.specs||{}),p.quantity]));
 for(const [k,q] of bp)if(!ap.has(k))d.push({type:'removed',key:k,quantity:q});
 for(const [k,q] of ap)if(!bp.has(k))d.push({type:'added',key:k,quantity:q});
 else{const old=bp.get(k);if(old!==q)d.push({type:'quantity',key:k,before:old,after:q});}
 return d;
}

/* ---------- 辅助：与 domain.js 共享的最小契约 ---------- */
function coverageOf(p){if(p.role==='main'||p.role==='side'||p.role==='drink')return {[p.role]:1};return p.coverage||{};}
function coverageKey(p){const c=coverageOf(p);return ['main','side','drink'].map(r=>r+':'+(c[r]||0)).join(',');}

/* C4 存储：与 memory-store.js 同一实现，Skill 与 HTML 共用，避免两套记忆规则漂移。 */
const Memory=(typeof module!=='undefined'?require('./memory-store.js'):root.McMemory);
function createMemoryStore(storage){return Memory.createMemoryStore(storage);}

const api={STEPS,TASTE_DIMS,createSession,emptyAnswer,answerStatus,isAnswered,answeredCount,firstUnanswered,gateOpen,decide,answer,goBack,invalidateAfter,
 emptyTaste,buildTaste,tasteMatch,tasteExplanation,tasteScore,describeTaste,TASTE_DIMS,
 gapRoles,buildDirections,applyDirection,directionAllows,
 emptyNovelty,officialNewFlag,applyNovelty,
 emptyConsent,consentAllowsSavedTaste,consentAllowsSavedSelections,resolveTasteForRun,feedbackGate,beginFeedback,feedbackRecord,persistResult,
 buildPlan,revalidateMeal,
 emptyExternal,externalDrinkCount,computeGap,buildExternalMessage,
 emptyQuote,computeQuote,compareSavings,savingsDiff,
 coverageOf,coverageKey,createMemoryStore,clone,money,aggregateParts,deriveFromUnits};
if(typeof module!=='undefined')module.exports=api;else root.McWizard=api;
})(typeof window!=='undefined'?window:globalThis);