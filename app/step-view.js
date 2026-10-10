(function(root){
'use strict';
/* 八步引导视图层。每一页有专属场景构图与一次性轻动效，不是同一张卡片换文案。
   无框架、无构建步骤、无 CDN 依赖，可直接 file:// 打开。 */
const W=root.McWizard,E=root.McEngine,C=root.McDemo,D=root.McDomain;

function el(tag,cls,text,attrs){
 const n=document.createElement(tag);
 if(cls)n.className=cls;
 /* text 参数只接受字符串或 null。传进 DOM 节点或多个子元素说明调用方误用了 el()，
    那会把 "[object HTMLParagraphElement]" 印到界面上，或干脆渲染出空容器。
    这里直接抛错，让这类错误在测试中立刻暴露，而不是变成一张"看起来没事"的截图。 */
 if(text!==undefined&&text!==null){
  if(typeof text!=='string')throw new TypeError('el("'+tag+'") 的 text 参数必须是字符串或 null，收到 '+typeof text+'。子元素请用 append() 或 add()。');
  n.textContent=text;
 }
 if(attrs&&typeof attrs==='object'&&!attrs.nodeType){
  for(const [k,v] of Object.entries(attrs)){
   if(v===null||v===undefined)continue;
   /* setAttribute 支持 aria-* 这类带连字符的属性名；dataset 不支持。
      统一走 setAttribute，避免"aria-label 不是合法属性名"这类运行期报错。 */
   n.setAttribute(k,v);
  }
 }
 return n;
}
function add(parent,...kids){for(const k of kids)if(k)parent.append(k);return parent;}
/* 触区不小于 44×44 */
/* data 里可能混有 aria-* / role 这类带连字符或非 camelCase 的键，
   它们不能写进 dataset（会抛 "'aria-label' is not a valid property name"），
   必须走 setAttribute。只有合法的 data-* 键才写 dataset。 */
function btn(label,action,cls,data,attrs){
 const b=el('button',cls||'',label,Object.assign({'data-action':action,'data-touch':'44'},attrs||{}));
 if(data)for(const [k,v] of Object.entries(data)){
  if(v===undefined||v===null)continue;
  if(/^[A-Za-z][A-Za-z0-9]*$/.test(k))b.dataset[k]=v;
  else b.setAttribute(k,v);
 }
 return b;
}
function money(minor){return minor===null||minor===undefined?'待核实':'¥'+(minor/100).toFixed(minor%100===0?0:2);}

/* ---------- 场景插画：每页不同构图，全部用真实加载的图片素材 ---------- */
function scene(step,opts){
 const o=opts||{};
 const box=el('div','scene scene-'+step);
 const img=el('img','scene-img');
 img.src='assets/'+(o.art||SCENE_ART[step])+'.webp';
 img.alt=o.alt||SCENE_ALT[step];
 img.loading='eager';img.decoding='async';
 img.width=320;img.height=200;
 box.append(img);
 if(step===1)box.append(seats(o.count||1));
 if(step===2)box.append(ruler(o.amount));
 if(step===3)box.append(trays(o.external));
 if(step===4)box.append(texture(o.taste));
 if(step===5)box.append(directions(o.dirs));
 if(step===6)box.append(swapSlot(o.novelty));
 if(step===7)box.append(timeline(o.length));
 if(step===8)box.append(receipt(o.memory));
 return box;
}
/* 每页场景构图使用的图片素材，全部取自实际存在的 assets/*.webp。
   选图原则贴合题意：人数用大桌图、预算用整餐图、已有吃喝用饮品、
   口感用鸡腿堡近景、方向用两种主食并列、尝新用小食、轮换用组合、记忆用甜品。 */
const SCENE_ART={1:'hero',2:'wings',3:'coffee',4:'crispy',5:'burger',6:'fries',7:'nuggets',8:'pie'};
const SCENE_ALT={1:'摆好餐位的餐桌示意',2:'餐垫与预算票据示意',3:'上下两层餐托示意',4:'酥脆口感近景示意',
 5:'两个方向的食品对比示意',6:'稳定底座与一个变化槽示意',7:'多顿时间带示意',8:'食品标签小票示意'};

/* 1 餐位依次入位 */
function seats(count){
 const wrap=el('div','seats');
 const shown=Math.min(count,4);
 for(let i=0;i<shown;i++){const s=el('span','seat');s.style.setProperty('--i',i);wrap.append(s);}
 if(count>4)wrap.append(el('span','seat-more','× '+count+' 个餐位'));
 return wrap;
}
/* 2 标尺停位 */
function ruler(amount){
 const r=el('div','ruler');
 r.append(el('span','ruler-label',amount?money(amount):'不设上限'));
 const bar=el('span','ruler-bar');bar.style.setProperty('--p',amount?Math.min(100,amount/100):0);r.append(bar);
 return r;
}
/* 3 已有食物落托 */
function trays(external,opts){
 const e=external||{};
 const o=opts||{};
 const wrap=el('div','trays');
 const top=el('div','tray tray-cart'),bot=el('div','tray tray-ext');
 top.append(el('span','tray-title',o.cartCount?('餐单已选 '+o.cartCount+' 件'):'餐单还空着'));
 bot.append(el('span','tray-title','外部已有'));
 for(const [k,label] of [['coffee','咖啡'],['otherDrink','饮品'],['main','主食'],['side','小食']]){
  const n=e[k]||0;
  bot.append(el('span','tray-chip'+(n?'':' zero'),label+' ×'+n));
 }
 wrap.append(top,bot);return wrap;
}
/* 4 质感拼贴：三块大小不同但统一色调的感官局部 */
function texture(words){
 const t=words||[];
 const wrap=el('div','texture');
 for(const [key,label] of [['crispy','香脆'],['mild','微辣'],['light','清爽']]){
  const on=t.includes(key);
  const p=el('span','tex tex-'+key+(on?' on':''),label);
  wrap.append(p);
 }
 return wrap;
}
/* 5 两方向错位，选中侧轻抬 */
function directions(dirs){
 const wrap=el('div','dirs');
 if(!dirs||!dirs.length)return wrap;
 dirs.slice(0,2).forEach((d,i)=>{
  const it=el('span','dir dir-'+i);
  it.append(el('span','dir-name',d.label),el('span','dir-sub',d.productCount+' 款可选'));
  wrap.append(it);
 });
 return wrap;
}
/* 6 稳定底座 + 仅一个变化槽 */
function swapSlot(novelty){
 const n=novelty||{};
 const wrap=el('div','swap');
 wrap.append(el('span','swap-base',n.mode==='safe'?'稳定基础':'稳定基础'));
 const slot=el('span','swap-slot'+(n.mode==='safe'?'':' flip'),n.mode==='safe'?'不换':'换一项');
 wrap.append(slot);return wrap;
}
/* 7 时间带按顿数展开，未算位置留占位 */
function timeline(len){
 const n=len||1;
 const wrap=el('div','timeline');
 for(let i=0;i<Math.max(1,n);i++){
  const seg=el('span','tl-seg'+(i===0?' current':'')+(i<n-1?' pending':''),i===0?'这顿':'第 '+(i+1)+' 顿');
  wrap.append(seg);
 }
 return wrap;
}
/* 8 标签小票 + 记忆口袋 */
function receipt(memory){
 const m=memory||{};
 const wrap=el('div','receipt');
 const slip=el('div','slip');
 slip.append(el('span','','本次明确选择'));
 for(const item of m.explicit||[])slip.append(el('span','slip-item',item));
 const pocket=el('div','pocket');
 pocket.append(el('span','','记忆口袋'));
 pocket.append(el('span','pocket-state',m.save?'已选保存':'这次就好'));
 wrap.append(slip,pocket);return wrap;
}

/* ---------- 顶部进度 ---------- */
function header(step,onBack,onClassic){
 const h=el('header','topbar');
 if(step>0)h.append(btn('←','back','icon-btn',null,{'aria-label':'返回上一题'}));
 h.append(el('div','brand','麦麦选餐'),el('span','spacer'));
 if(step)h.append(btn('经典选餐','classic','ghost-btn'));
 return h;
}
function progress(step){
 const box=el('div','progress',null,{'aria-label':'引导进度'});
 box.append(el('span','progress-text','第 '+step+' / 8 题'));
 const bar=el('div','progress-bar',null,{role:'progressbar','aria-valuenow':String(step),'aria-valuemin':'1','aria-valuemax':'8'});
 for(let i=1;i<=8;i++){
  const seg=el('span','seg'+(i<step?' done':i===step?' now':''));
  if(i===step)seg.setAttribute('aria-current','step');
  bar.append(seg);
 }
 box.append(bar);
 return box;
}

/* ---------- 八个页面 ---------- */
function page(step,s,ctx){
 const main=el('main','step-page step-'+step);
 main.append(header(step),progress(step));
 const st=W.STEPS[step-1];
 const body=el('section','step-body');
 body.append(el('h1','step-title',st.title),el('p','step-hint',st.hint));
 main.append(scene(step,ctx[step]||{}));
 main.append(body);
 return {main,body};
}

/* 1 人数 */
function stepPeople(s){
 const v=s.wizard.answers[0];
 const {main,body}=page(1,s,{1:{count:v.value||1}});
 const grid=el('div','choice-grid');
 for(const n of [1,2,3]){
  const b=btn('','w-people','people-tile',{value:n},{'aria-pressed':String(v.value===n),'aria-label':n+' 人'});
  b.append(el('strong','',n+' 人'),el('small','',['一人好好吃','两个人一起吃','三个人分享'][n-1]));
  grid.append(b);
 }
 body.append(grid);
 const more=el('div','more-people');
 const stepper=el('div','stepper');
 stepper.append(btn('−','w-people-dec','icon-btn',{value:(v.value||1)-1},{'aria-label':'减少人数'}),
   el('span','stepper-val',String(v.value||1)),
   btn('+','w-people-inc','icon-btn',{value:(v.value||1)+1},{'aria-label':'增加人数'}));
 more.append(el('span','','更多人数'),stepper);
 body.append(more);
 body.append(btn('按 '+(v.value||1)+' 人继续','w-people-confirm','cta',{},{disabled:v.value?null:'disabled'}));
 body.append(el('p','fine-note','精确人数，不使用范围。演示支持 1–12 人。选择人数后不会立刻推荐。'));
 body.append(decideRow(s,0,'人数我帮你按常规食量先算'));
 return main;
}
/* 2 预算 */
function stepBudget(s){
 const v=s.wizard.answers[1];
 const val=v.value||{};
 const {main,body}=page(2,s,{2:{amount:val.minor}});
 body.append(unitRow(s,val));
 if(val.mode&&val.mode!=='none'){
  const quick=el('div','choice-grid');
  const amounts=val.mode==='person'?[1500,2000,3000,4000]:[2000,3000,3500,5000,6000,8000];
  for(const a of amounts){
   const b=btn('¥'+a/100,'w-budget-amount','amount-tile',{value:a},{'aria-pressed':String(val.minor===a)});
   quick.append(b);
  }
  body.append(quick);
  if(val.minor!==null&&val.minor!==undefined){
   const stepper=el('div','stepper');
   stepper.append(btn('−','w-budget-step','icon-btn',{value:val.minor-100},{'aria-label':'减少预算'}),
     el('span','stepper-val',money(val.minor)),
     btn('+','w-budget-step','icon-btn',{value:val.minor+100},{'aria-label':'增加预算'}));
   body.append(stepper);
   body.append(el('p','notice',
    val.mode==='person'?'每人 '+money(val.minor)+' × '+(s.state.constraints.people||1)+' 人 = 合计上限 '+money(val.minor*(s.state.constraints.people||1))
     :'整餐合计上限 '+money(val.minor)+'，人数变化时金额不变。'));
  }
 }
 body.append(btn('按这个预算继续','w-budget-confirm','cta',{},{disabled:val.mode?null:'disabled'}));
 body.append(el('p','fine-note','金额是快捷输入值，不保证这些钱必然够买。未知价格或费用只标待核实。'));
 body.append(decideRow(s,1,'先不设上限，之后随时能改'));
 return main;
}
function unitRow(s,val){
 const row=el('div','choice-row');
 for(const [mode,label] of [['person','按每人算'],['total','按整餐算'],['none','暂不设上限']]){
  row.append(btn(label,'w-budget-mode','unit-tile',{value:mode},{'aria-pressed':String(val.mode===mode)}));
 }
 return row;
}
/* 3 已有吃喝 */
function stepExternal(s){
 const v=s.wizard.answers[2];
 const ext=v.value||W.emptyExternal();
 const {main,body}=page(3,s,{3:{external:ext,cartCount:s.state.cart?s.state.cart.reduce((a,l)=>a+l.quantity,0):0}});
 body.append(el('p','step-sub','只有餐单之外已经有的才填这里。'));
 const rows=el('div','ext-rows');
 for(const [key,label,unit] of [['coffee','咖啡','杯'],['otherDrink','其他饮品','杯'],['main','主食','份'],['side','小食','份']]){
  const row=el('div','count-field');
  row.append(el('span','',label));
  const st=el('div','stepper');
  st.append(btn('−','w-ext-dec','icon-btn',{key,value:(ext[key]||0)-1},{'aria-label':'减少'+label}),
    el('span','stepper-val',String(ext[key]||0)),
    btn('+','w-ext-inc','icon-btn',{key,value:(ext[key]||0)+1},{'aria-label':'增加'+label}));
  row.append(el('span','unit-hint',unit),st);
  rows.append(row);
 }
 body.append(rows);
 body.append(el('p','fine-note','咖啡和其他饮品会合并成一份饮品需求，不会重复计算。份量不清楚时按粗略估算补齐。'));
 body.append(btn('就按这些，继续','w-ext-confirm','cta'));
 body.append(decideRow(s,2,'都还没有，从零开始搭配'));
 return main;
}
/* 4 口味 */
function stepTaste(s){
 const v=s.wizard.answers[3];
 const words=(v.value&&v.value.words)||[];
 const {main,body}=page(4,s,{4:{taste:words}});
 body.append(el('p','step-sub','可以多选，香脆和微辣不冲突。'));
 const grid=el('div','choice-grid');
 for(const w of ['香脆','软嫩','微辣','不辣','不油腻']){
  const b=btn(w,'w-taste','taste-tile',{value:w},{'aria-pressed':String(words.includes(w)),'aria-label':w+' 口感'});
  grid.append(b);
 }
 body.append(grid);
 if(s.memory.hasSavedTaste()&&!words.length)
 body.append(el('p','fine-note','口感只影响排序。演示目录的辣度和油腻感资料不完整时会如实说明，不会假装匹配成功。'));
 body.append(btn('就按这些，继续','w-taste-confirm','cta'));
 body.append(decideRow(s,3,'都可以，你来挑'));
 return main;
}
/* 5 二选一 */
function stepDirection(s){
 const v=s.wizard.answers[4];
 const dir=v.value||s.directionInfo;
 const {main,body}=page(5,s,{5:{dirs:dir&&dir.directions}});
 if(!dir||dir.status==='noGap'){
  body.append(el('p','step-sub','这顿已经够了，还要看备选吗？'));
  const row=el('div','choice-row');
  row.append(btn('不用再添','w-dir-none','unit-tile',{},{'aria-pressed':'true'}));
  body.append(row,btn('只看看备选','w-dir-browse','secondary-action'));
  body.append(el('p','fine-note','选“看看”也不会产生购买需求。'));
  body.append(decideRow(s,4,'先不限定'));
  return main;
 }
 if(dir.status==='single'){
  body.append(el('p','step-sub','当前条件下只有一个可行方向，不硬造第二个。'));
  body.append(btn('沿用这个方向','w-dir-single','cta',{value:dir.directions[0].id}));
  body.append(btn('调整条件','back','secondary-action'));
  body.append(decideRow(s,4,'你来定'));
  return main;
 }
 body.append(el('p','step-sub','这两个方向在当前条件下都真实可选。'));
 const grid=el('div','dir-grid');
 for(const d of dir.directions){
  const b=btn('','w-dir','dir-tile',{value:d.id},{'aria-pressed':String(v.value&&v.value.id===d.id)});
  b.append(el('strong','',d.label),el('small','',d.productCount+' 款可选'));
  grid.append(b);
 }
 body.append(grid);
 body.append(btn('都可以，帮我定','w-dir-any','secondary-action'));
 body.append(el('p','fine-note','这一步只缩小方向，不展示完整餐单，也不代表你以前吃过。'));
 body.append(decideRow(s,4,'都行，你选'));
 return main;
}
/* 6 尝新 */
function stepNovelty(s){
 const v=s.wizard.answers[5];
 const mode=(v.value&&v.value.mode)||null;
 const {main,body}=page(6,s,{6:{novelty:{mode}}});
 body.append(el('p','step-sub','最多只换一份，其余保持不动。'));
 const grid=el('div','choice-grid');
 for(const [m,label,sub] of [['safe','稳妥一点','不主动换'],['swap','熟悉搭配，换一样','换其中一份'],['balance','你帮我拿捏','最多换一份']]){
  const b=btn('','w-novelty','novelty-tile',{value:m},{'aria-pressed':String(mode===m)});
  b.append(el('strong','',label),el('small','',sub));
  grid.append(b);
 }
 body.append(grid);
 if(mode==='swap'||mode==='balance'){
  body.append(el('h2','section-title','哪款是你确认熟悉的？'));
  const list=el('div','familiar-list');
  for(const p of (s.familiarCandidates||[])){
   list.append(btn(p.name,'w-familiar','chip',{value:p.id},{'aria-pressed':String((v.value&&v.value.familiar||[]).includes(p.id))}));
  }
  if(!(s.familiarCandidates||[]).length)list.append(el('p','fine-note','还没有本人确认熟悉的记录，将按常规组合换一样。'));
  body.append(list,btn('没有熟悉款，按常规组合','w-familiar-none','text-btn'));
  body.append(el('p','fine-note','熟悉款只来自你本人确认。演示目录没有官方新品标记，所以只说“换一款”，不说“新品”。'));
 }
 body.append(btn('就按这个，继续','w-novelty-confirm','cta'));
 body.append(decideRow(s,5,'帮我拿捏'));
 return main;
}
/* 7 轮换 */
function stepPlan(s){
 const v=s.wizard.answers[6];
 const len=(v.value&&v.value.length)||1;
 const {main,body}=page(7,s,{7:{length:len}});
 body.append(el('p','step-sub','先收集计划，是否使用旧记录由第 8 题决定。'));
 const grid=el('div','choice-grid');
 for(const n of [1,3,5]){
  const b=btn('','w-plan','plan-tile',{value:n},{'aria-pressed':String(len===n)});
  b.append(el('strong','',n===1?'只选这顿':'排 '+n+' 顿'),el('small','',n===1?'就搭这一餐':'给接下来几顿换个花样'));
  grid.append(b);
 }
 body.append(grid);
 if(len>1)body.append(el('p','notice','会尽量减少主食连续重复和整套重复；候选不足时如实标出重复，不保证绝不重复。'));
 body.append(btn('就按这个，继续','w-plan-confirm','cta'));
 body.append(decideRow(s,6,'帮我决定：先只搭本顿'));
 return main;
}
/* 8 记忆 */
function stepMemory(s){
 const v=s.wizard.answers[7];
 const mem=(v.value&&v.value.consent)||W.emptyConsent();
 const saved=s.memory.savedTasteList?s.memory.savedTasteList():[];
 const {main,body}=page(8,s,{8:{memory:{explicit:s.explicitTasteWords||[],save:mem.saveExplicitTaste||mem.saveFinalSelection}}});
 body.append(el('p','step-sub','四类同意各自独立，默认都不新增。'));
 const hasSaved=saved.length>0||s.memory.hasSavedSelections();
 if(hasSaved){
  body.append(el('h2','section-title','已保存的内容'));
  const list=el('div','saved-list');
  for(const t of saved)list.append(el('span','saved-item',t.label+(t.caveat?'（'+t.caveat+'）':'')));
  if(!saved.length)list.append(el('span','saved-item','有已同意保存的选餐记录，可在结果页查看来源'));
  body.append(list);
 }
 const toggle=(key,label,sub)=>{
  const b=btn('','w-consent','consent-row',{value:key},{'aria-pressed':String(!!mem[key])});
  b.append(el('span','consent-mark',mem[key]?'✓':'○'),add(el('span','consent-text'),el('strong','',label),el('small','',sub)));
  return b;
 };
 if(hasSaved){
  body.append(toggle('useSavedTaste','沿用已同意的口味','本次排序会参考这些条目'));
  body.append(toggle('useSavedSelections','沿用已同意的选餐记录','仅用于轮换参考，不是订单'));
 }
 body.append(toggle('saveExplicitTaste','记住我明确选的口味','只保存归属到你本人、且你明确确认过的条目'));
 body.append(toggle('saveFinalSelection','保存这次的选餐记录','需要你实际选定方案之后才会保存'));
 body.append(btn('这次就好','w-consent-none','secondary-action',{},{'aria-pressed':String(!mem.saveExplicitTaste&&!mem.saveFinalSelection)}));
 body.append(el('p','fine-note','多人共用答案不会自动成为你的个人口味。拒绝保存不影响这次出结果。'));
 const main2=btn('看看我的搭配','w-submit','cta');
 body.append(main2);
 return main;
}
function decideRow(s,index,label){
 const v=s.wizard.answers[index];
 return btn(label,'w-decide','decide-btn',{index},{'aria-pressed':String(v.source==='decided')});
}

/* ---------- 结果页 ---------- */
function result(s,rec){
 const main=el('main','flow result-page');
 /* 结果页必须能回到引导修改答案，否则用户无法自主调整 */
 const top=el('header','topbar');
 top.append(btn('←','w-edit-answers','icon-btn',null,{'aria-label':'返回修改答案'}),
  el('div','brand','麦麦选餐'),el('span','spacer'),
  btn('经典选餐','classic','ghost-btn'));
 main.append(top);
 const plan=(s.wizard.answers[6].value||{}).length||1;
 main.append(el('div','page-intro'),el('h2','','这一餐，帮你搭好了。'));
 if(plan>1)main.append(el('p','muted','共 '+plan+' 顿。下面是第 1 顿，其余几顿在下方。'));
 const card=el('section','meal-card');
 if(rec.conflicts.length){
  card.append(el('h3','','这次没能配出可行方案'));
  for(const c of rec.conflicts)card.append(el('p','conflict',c));
  card.append(el('p','fine-note','可以返回修改预算、人数或保留项。没有静默减少人数、删除餐单或放宽忌口。'));
 }else{
  E.setCatalog(C.products);
  const {fixed,suggested}=E.splitParts(rec,s.state);
  if(fixed.length){
   card.append(el('p','section-kicker','餐单已选'));
   for(const p of fixed)card.append(rowOf(p,'fixed'));
  }
  const ext=s.state.external||W.emptyExternal();
  if(W.externalDrinkCount(ext)||ext.main||ext.side)
   card.append(el('p','fine-note',W.buildExternalMessage(rec.coverage,rec.targets,{},ext,fixed.filter(p=>E.coverageOf(p).drink>0).length).join('；')||'已扣除外部已有，只补缺少的部分。'));
  card.append(el('p','section-kicker',suggested.length?'建议新增':'无需再添'));
  for(const p of suggested)card.append(rowOf(p,'suggested'));
  /* 合计区：单价×数量逐行可对账，合计必须等于各行小计之和 */
  const footer=el('div','rec-footer');
  const left=el('div');
  left.append(el('p','price-note','餐单＋建议新增 · 演示合计'),priceNode(rec.total));
  footer.append(left,
    el('span','budget-status',rec.budgetStatus==='pending'?'预算待核实':rec.budgetStatus==='within'?'演示价在上限内':rec.budgetStatus==='over'?'演示价超上限':'预算未设'));
  card.append(footer);
  for(const r of rec.reasons)card.append(el('p','reason-line',r));
  if(rec.noveltyApplied)card.append(el('p','reason-line','尝新：'+rec.noveltyApplied.note));
 }
 main.append(card);
 /* 多顿：突出第 1 顿，其余以缩略条展开查看（不得只在文案里承诺却不做） */
 const planObj=s.plan;
 if(planObj&&planObj.length>1&&planObj.meals.length>1)main.append(planSection(planObj,s));
 const addBtn=btn(suggestedCount(rec)?'加入餐单':'这顿已经搭好了','w-add','cta',{},{disabled:suggestedCount(rec)?null:'disabled'});
 main.append(addBtn);
 main.append(btn('看看有没有更合适的省钱搭配','w-savings','secondary-action'));
 main.append(btn('这顿吃过了','w-eaten','secondary-action'));
 if(s.state.cart.length)main.append(btn('查看餐单','cart','secondary-action'));
 main.append(el('p','fine-note','只加入本地餐单，不下单、不付款。图片、成分与价格均为虚构演示。'));
 return main;
}
/* 轮换计划的其余几顿：默认可折叠，点击展开逐顿明细 */
function planSection(plan,s){
 const box=el('section','plan-section');
 box.append(el('p','section-kicker','接下来 '+plan.length+' 顿'));
 if(plan.note)box.append(el('p','fine-note',plan.note));
 const list=el('div','plan-meals');
 for(const meal of plan.meals){
  if(meal.index===1)continue;/* 第 1 顿已在上面完整展示 */
  const det=el('div','plan-detail');
  det.append(el('p','plan-names',meal.parts.length?meal.parts.map(p=>p.name+' ×'+p.quantity).join('、'):'无需再添'));
  det.append(el('p','fine-note','演示合计 '+(meal.total?money(meal.total.minor):'待核实')+'　·　'+
   (meal.coverage?meal.coverage.main+' 份主食、'+meal.coverage.drink+' 杯饮品':'')+'　·　使用前会重新核验'));
  const row=el('div','plan-meal');
  /* 缩略条：默认可折叠，点击展开这一顿的明细 */
  const head=btn('第 '+meal.index+' 顿','w-plan-meal','plan-toggle',{index:String(meal.index)},
   {'aria-expanded':'false','aria-label':'展开第 '+meal.index+' 顿明细'});
  det.hidden=true;
  row.append(head,det);
  list.append(row);
 }
 box.append(list);
 const notes=[...new Set((plan.repeatNotes||[]).map(x=>x.name))];
 if(notes.length)box.append(el('p','fine-note','如实标注的重复：'+notes.join('、')+'（目录内可选项有限）'));
 if(plan.historyUsed&&plan.historyUsed.length)
  box.append(el('p','fine-note','参考获准的选餐记录，不是订单。'));
 return box;
}
function suggestedCount(rec){return (rec.suggestedParts||[]).length;}
/* 每一行都必须能自己算清：显示"单价 × 数量 = 小计"，
   否则页面上只看到一个单价，很容易被当成整行金额。 */
function rowOf(p,kind){
 const row=el('article','food-row '+kind);
 const c=E.coverageOf(p);
 const alloc=p.assignedTo&&p.assignedTo.length?('第 '+p.assignedTo.map(x=>x.slice(1)).join('、')+' 人'):(c.main>1?'共享':'');
 const qty=p.quantity||1;
 const unit=p.price&&p.price.minor!==null&&p.price.minor!==undefined?money(p.price.minor):null;
 const sub=unit===null?null:money(p.price.minor*qty);
 const priceWrap=el('div','row-price');
 if(unit!==null){
  priceWrap.append(el('span','unit-price',unit+' /份'),el('span','row-sub',qty>1?('× '+qty+' = '+sub):sub));
 }else priceWrap.append(el('span','unit-price','待核实'));
 row.append(thumb(p),add(el('div','food-info'),el('strong','',p.name+' ×'+qty),
   el('p','',alloc+(kind==='fixed'?' · 已加入':'')+(p.locked?' · 已保留':''))),priceWrap);
 return row;
}
function thumb(p){
 const i=el('img','thumb');i.src='assets/'+(p.art||'crispy')+'.webp';i.alt=p.name;i.width=56;i.height=56;i.loading='lazy';return i;
}
function priceNode(minor){return el('strong','price',minor?money(minor.minor):'待核实');}

root.McStepView={stepPeople,stepBudget,stepExternal,stepTaste,stepDirection,stepNovelty,stepPlan,stepMemory,result,
 el,add,btn,money,scene,header,progress};
})(window);