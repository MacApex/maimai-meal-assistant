(function(){
'use strict';
const W=McWizard,E=McEngine,C=McDemo,D=McDomain,V=McStepView;
let storage;try{storage=localStorage;}catch(e){storage={getItem(){return null},setItem(){throw e},removeItem(){throw e}};}
const memory=W.createMemoryStore(storage);

/* 会话状态。刷新默认清空未获同意的草稿与餐单，并明确告知。
   只有第 8 题明确同意保存的内容才写入本地存储。 */
const s={
 route:'home',
 wizard:W.createSession(),
 state:D.initialState(),
 memory,
 directionInfo:null,
 familiarCandidates:[],
 explicitTasteWords:[],
 plan:null,
 rec:null,
 savings:null,
 eaten:false,
 feedbackOpen:false,
 dialog:null,
 scrollByRoute:{},
 message:'',
 lastAdded:null
};
E.setCatalog(C.products);

const STEPS=[V.stepPeople,V.stepBudget,V.stepExternal,V.stepTaste,V.stepDirection,V.stepNovelty,V.stepPlan,V.stepMemory];

function notify(text){const n=document.getElementById('toast');n.textContent=text;n.classList.add('show');clearTimeout(notify.t);notify.t=setTimeout(()=>n.classList.remove('show'),2600);}

/* 第 8 题之前不允许出现完整推荐 */
function gate(){return W.gateOpen(s.wizard);}

function currentStep(){return Math.min(8,Math.max(1,s.wizard.step));}
function answerValue(i){const a=s.wizard.answers[i];return a?a.value:null;}

function render(){
 const app=document.getElementById('app');app.replaceChildren();
 let node;
 if(s.route==='home')node=home();
 else if(s.route==='classic')node=classic();
 else if(s.route==='cart')node=cart();
 else if(s.route==='preferences')node=preferences();
 else if(s.route==='result')node=V.result(s,s.rec||E.buildMeal(s.state,C.products,runtimeOptions()));
 else node=(STEPS[currentStep()-1])(s);
 app.append(node);
 if(s.dialog){const ov=sheet();if(ov){node.inert=true;app.append(ov);}}
 const bar=bottomBar();
 if(bar)app.append(bar);
}

/* 把八题答案翻译成引擎输入 */
function runtimeOptions(){
 const tasteAns=answerValue(3);
 let taste=tasteAns?{...W.buildTaste(tasteAns.words,tasteAns.source==='decided'?'decided':'explicit'),
  sourceLabel:tasteAns.source==='decided'?'你让我决定的':'按本次选的'+tasteAns.words.join('、')}:null;
 const dirAns=answerValue(4);
 const noveltyAns=answerValue(5);
 const memAns=answerValue(7);
 const consent=(memAns&&memAns.consent)||W.emptyConsent();
 /* 若本次没有明确口味，且第 8 题获准沿用已保存口味，才使用已保存偏好 */
 if(!taste&&W.consentAllowsSavedTaste(consent)){
  const saved=memory.savedTasteList();
  if(saved.length){
   const t=W.emptyTaste();
   for(const item of saved){if(!t[item.dimension])t[item.dimension]=[];if(!t[item.dimension].includes(item.value))t[item.dimension].push(item.value);}
   t.source='saved';t.sourceLabel='参考已同意的偏好';taste=t;
  }
 }
 const novel=noveltyAns?{mode:noveltyAns.mode,familiarUnitIds:noveltyAns.familiar||[],maxChangedUnits:1}:null;
 return {taste,novelty:novel,direction:dirAns&&dirAns.optionIds?dirAns:null};
}

/* 子页顶栏：经典选餐／餐单／偏好都需要一个明确的"回到首页"出口，
   否则用户进入这些页面后会找不到回去的路。 */
function subHeader(title,rightAction,rightLabel){
 const h=V.el('header','topbar');
 h.append(V.btn('←','w-home','icon-btn',null,{'aria-label':'回到首页'}),
  V.el('div','brand',title),V.el('span','spacer'));
 if(rightAction)h.append(V.btn(rightLabel,rightAction,'ghost-btn'));
 return h;
}

function home(){
 const n=V.el('main','home');
 n.append(V.add(V.el('div','home-intro'),V.el('h1',null,'今天这顿，'),V.el('h1',null,'帮你选。')),
  V.el('p','muted','八个问题，搭一餐合口味的。'));
 const art=V.el('img','hero-art');art.src='assets/hero.webp';art.alt='今天的这一餐';art.width=320;art.height=200;n.append(art);
 const a=V.btn('','w-start','entry primary',null,{'aria-label':'进入智能选餐助手'});
 a.append(entryIcon('✧'),V.add(V.el('span'),V.el('span','label','智能选餐助手'),V.el('small','','八个问题，帮你搭')),V.el('span','arrow','›'));
 const c=V.btn('','classic','entry secondary',null,{'aria-label':'进入经典自主选餐'});
 c.append(entryIcon('☷'),V.add(V.el('span'),V.el('span','label','经典选餐'),V.el('small','','全分类，自己挑')),V.el('span','arrow','›'));
 n.append(a,c);
 if(gate()&&!s.wizard.completed)n.append(V.el('p','resume-note','上次八题还没答完，可以继续。'),V.btn('继续第 '+currentStep()+' 题','w-resume','secondary-action'));
 n.append(V.el('p','home-note','不用打字，也不用从几十种选择开始。'),
  footerNode());
 return n;
}
/* 首页页脚。V.el 的第三参是纯文本，混用子元素会渲染出 [object HTMLParagraphElement]，
   所以这里单独用 append 组装。 */
function footerNode(){
 const f=V.el('footer','home-footer');
 f.append(V.el('p',null,'独立创意项目，非麦当劳官方产品'));
 f.append(V.el('p',null,'餐品与价格为虚构演示 · 不产生订单'));
 f.append(V.el('p','conn-line','官方 MCP：'+connLabel()));
 f.append(V.btn('我的口味与偏好','preferences'));
 return f;
}
function connLabel(){
 /* 真实数据与演示数据必须明确区分；本页面从不接收凭据 */
 return s.connectionState==='verified'?'已验证只读（本页仍使用演示目录）':'尚未在本页验证（演示数据）';
}
function entryIcon(ch){return V.el('span','entry-icon',ch);}

function classic(){
 const n=V.el('main');
 n.append(subHeader('麦麦选餐','w-start','智能助手'));
 n.append(V.add(V.el('div','title-row'),V.el('h2',null,'慢慢挑，也很好。')));
 const layout=V.el('div','menu-layout');
 const nav=V.el('nav','categories',null,{'aria-label':'商品分类'});
 for(const c of C.categories){
  const b=V.btn(c.name,'w-category','category'+(s.state.categoryId===c.id?' active':''),{id:c.id});
  if(s.state.categoryId===c.id)b.setAttribute('aria-current','true');
  nav.append(b);
 }
 const list=V.el('section','menu-products');
 list.append(V.el('h3','menu-heading',(C.categories.find(c=>c.id===s.state.categoryId)||{}).name||''));
 if(s.state.categoryId==='c6')list.append(V.el('p','fine-note','仅演示分类结构，不提供或声称实际热量。'));
 for(const p of C.products.filter(p=>p.categoryIds.includes(s.state.categoryId))){
  const row=V.el('article','menu-item');
  const img=V.el('img','thumb');img.src='assets/'+(p.art||'crispy')+'.webp';img.alt=p.name;img.width=56;img.height=56;img.loading='lazy';
  /* 名称与描述放在同一个文本块里：之前直接平铺导致描述被挤进 56px 图片列 */
  const info=V.el('div','menu-item-info');
  info.append(V.el('h3',null,p.name),V.el('p',null,p.description));
  row.append(img,info,
   V.add(V.el('div','menu-item-bottom'),V.add(V.el('div'),V.el('p','price-note','演示价'),
     V.el('strong','price',p.price?'¥'+(p.price.minor/100):'待核实')),
    V.btn('+','w-add-product','add',{id:p.id},{'aria-label':'添加'+p.name})));
  list.append(row);
 }
 layout.append(nav,list);n.append(layout);
 n.append(V.el('p','fine-note','切换到经典选餐不会清空餐单，返回助手会回到原题。'));
 return n;
}

function cart(){
 const n=V.el('main','flow');
 n.append(subHeader('我的餐单','w-start','智能助手'));
 n.append(V.el('div','page-intro'),V.el('h2',null,'我的餐单'),V.el('p','muted','智能选的、自己挑的，都在这里。'));
 if(!s.state.cart.length){
  n.append(V.add(V.el('div','empty'),V.el('h3',null,'餐单还空着'),V.el('p','muted','挑一份喜欢的，开始这一餐。')),V.btn('去经典选餐','classic','cta'));
  return n;
 }
 const list=V.el('div','cart-list');
 for(const l of s.state.cart){
  const p=C.products.find(x=>x.id===l.productId);if(!p)continue;
  const img=V.el('img','thumb');img.src='assets/'+(p.art||'crispy')+'.webp';img.alt=p.name;img.width=56;img.height=56;img.loading='lazy';
  const row=V.el('article','cart-row');
  row.append(V.add(V.el('div','cart-top'),img,V.add(V.el('div','food-info'),V.el('strong',null,p.name),V.el('p',null,specsText(l))),
    p.specGroups.length?V.btn('改规格','w-edit-line','text-btn',{key:l.key}):null),
   V.add(V.el('div','cart-controls'),V.el('strong','price',p.price?'¥'+(p.price.minor/100)*l.quantity:'待核实'),
    V.add(V.el('div','stepper'),V.btn('−','w-qty','icon-btn',{key:l.key,value:l.quantity-1},{'aria-label':'减少数量'}),
     V.el('span',null,String(l.quantity)),V.btn('+','w-qty','icon-btn',{key:l.key,value:l.quantity+1},{'aria-label':'增加数量'}))));
  list.append(row);
 }
 n.append(list,
  V.add(V.el('div','total-row'),V.el('strong',null,'演示合计'),V.el('strong','price',moneyOf(D.total(s.state.cart,C.products)))),
  V.el('p','fine-note','只加入本地餐单，不下单、不付款。价格与供应均为虚构演示。'),
  V.btn('继续选餐','classic','cta'),V.btn('回到智能助手','w-start','secondary-action'));
 return n;
}
function specsText(line){
 const p=C.products.find(x=>x.id===line.productId);if(!p)return '';
 return p.specGroups.map(g=>g.options.find(o=>o.id===line.specs[g.id])?.label).filter(Boolean).join(' · ')||'无需额外规格';
}

function preferences(){
 const n=V.el('main','flow');
 n.append(subHeader('口味与偏好','w-start','智能助手'));
 n.append(V.el('div','page-intro'),V.el('h2',null,'口味，由你做主。'),V.el('p','muted','只记住你同意的内容，随时可以改。'));
 n.append(V.el('div','notice neutral','仅保存在当前浏览器，不会云同步。未保存的餐单和会话在刷新后清空。'));
 const tastes=memory.savedTasteList();
 if(!tastes.length&&!memory.hasSavedSelections())
  n.append(V.add(V.el('div','empty'),V.el('h3',null,'还没有保存偏好'),V.el('p','muted','默认不记忆，也不影响继续选餐。')));
 for(const t of tastes){
  n.append(V.add(V.el('div','preference'),
   V.el('p',null,'口味偏好：'+t.label+(t.caveat?'（'+t.caveat+'）':'')),
   V.btn('删除','w-del-taste','text-btn',{id:t.id})));
 }
 n.append(V.btn('清除全部已保存内容','w-clear-mem','secondary-action'),
  V.el('p','fine-note','选择记录不代表实际购买或食用。清空后不可恢复。'));
 return n;
}

function bottomBar(){
 if(!s.state.cart.length||s.route==='cart'||s.route==='home')return null;
 const bar=V.el('aside','bottom-bar',null,{'aria-label':'共用餐单'});
 bar.append(V.el('span','bag-count',String(s.state.cart.reduce((a,l)=>a+l.quantity,0))),
  V.add(V.el('div','bag-info'),V.el('span',null,'我的餐单'),V.el('small',null,'演示合计 · '+moneyOf(D.total(s.state.cart,C.products)))),
  V.btn('查看餐单','cart','cta'));
 return bar;
}
function moneyOf(m){return m?'¥'+(m.minor/100):'待核实';}

/* ---------- 交互 ---------- */
function go(route){s.route=route;s.dialog=null;history.pushState({d:(history.state?.d||0)+1},'','#'+route);render();scrollTo(0,s.scrollByRoute[route]||0);const h=document.querySelector('main h1,main h2');if(h){h.setAttribute('tabindex','-1');h.focus({preventScroll:true});}}
window.addEventListener('popstate',()=>{const r=location.hash.slice(1);s.route=['home','classic','cart','preferences','result'].includes(r)?r:'home';s.dialog=null;render();});
window.addEventListener('scroll',()=>{s.scrollByRoute[s.route]=scrollY;},{passive:true});

function setAnswer(i,value,status,stayOnStep){
 s.wizard=W.answer(s.wizard,i,value,status);
 /* 单选题选中即算已答，但允许停在本题微调后再确认 */
 if(stayOnStep)s.wizard.step=i+1;
 syncFromAnswers();
 render();
}
function decideCurrent(i,value,reason){
 s.wizard=W.decide(s.wizard,i,value,reason);
 applyDecide(i);
 render();
}
function applyDecide(i){
 const v=s.wizard.answers[i].value;
 if(i===0){s.state.constraints.people=v||1;}
 if(i===1){s.state.constraints.budget=v&&v.mode&&v.mode!=='none'?{mode:v.mode,minor:v.minor}:{mode:'total',minor:null};}
 if(i===2){s.state.external=v||W.emptyExternal();}
 if(i===4){if(v&&v.optionIds)s.state.direction=v;}
}
function syncFromAnswers(){
 const p=answerValue(0);if(Number.isInteger(p))s.state.constraints.people=p;
 const b=answerValue(1);if(b)s.state.constraints.budget=b.mode&&b.mode!=='none'?{mode:b.mode,minor:b.minor}:{mode:'total',minor:null};
 const e=answerValue(2);if(e)s.state.external=e;
 const d=answerValue(4);if(d&&d.optionIds)s.state.direction=d;
 /* 第 5 题依赖 1–4：算出真实可行的方向 */
 const opts=runtimeOptions();
 s.directionInfo=W.buildDirections(C.products,{...s.state,coverage:opts.coverage||{}},E.targets(s.state.constraints.people,'regular'),
  p=>E.allowed(p,E.personIds(s.state.constraints.people),s.state)&&E.directionOk(p,{direction:d}));
 s.familiarCandidates=C.products.filter(p=>p.role==='main'||p.role==='side').slice(0,4).map(p=>({id:p.id,name:p.name}));
 s.explicitTasteWords=answerValue(3)?.words||[];
}

function recompute(){
 const opts=runtimeOptions();
 s.rec=E.buildMeal(s.state,C.products,opts);
 /* 多顿轮换：只有第 7 题要求时才生成 */
 const len=(answerValue(6)||{}).length||1;
 if(len>1){
  s.plan=W.buildPlan(C.products,i=>(cat,planOpts)=>{
   const st=JSON.parse(JSON.stringify(s.state));
   /* 必须透传 buildPlan 的 penalize，否则各顿会长得一样，轮换就失去意义 */
   return E.buildMeal(st,cat,{...opts,...planOpts});
  },len,W.consentAllowsSavedSelections((answerValue(7)||{}).consent)?memory.usableHistory((answerValue(7)||{}).consent):null);
 }else s.plan=null;
}

/* ---------- 事件 ---------- */
document.getElementById('app').addEventListener('click',e=>{
 const b=e.target.closest('button[data-action]');if(!b||b.disabled)return;
 const a=b.dataset.action,v=b.dataset.value;
 /* 首页 */
 if(a==='w-start'){go('wizard');return;}
 if(a==='w-resume'){s.route='wizard';render();return;}
 if(a==='classic'){go('classic');return;}
 if(a==='w-home'){go('home');return;}
 if(a==='cart'){go('cart');return;}
 if(a==='preferences'){go('preferences');return;}
 if(a==='back'){
  if(s.route==='wizard'){s.wizard=W.goBack(s.wizard);syncFromAnswers();render();return;}
  if(history.state?.d>0)history.back();else go('home');return;
 }
 /* 第 1 题：单选选中后可继续，但人数允许在同页用加减器微调，所以保留显式确认 */
 if(a==='w-people'){setAnswer(0,Number(v),undefined,true);return;}
 if(a==='w-people-inc'||a==='w-people-dec'){
  const cur=answerValue(0)||1;const n=Math.max(1,Math.min(12,Number(v)));
  if(answerValue(0))setAnswer(0,n);else{s.wizard=W.answer(s.wizard,0,n);s.wizard.step=1;syncFromAnswers();render();}
  return;}
 if(a==='w-people-confirm'){
  const n=answerValue(0);if(!n)return;
  s.wizard.step=2;syncFromAnswers();render();return;}
 /* 第 2 题 */
 if(a==='w-budget-mode'){
  const cur=answerValue(1)||{};const val={mode:v,minor:v==='none'?null:(cur.minor??null)};
  s.wizard.answers[1]={status:'answered',value:val,source:'explicit',at:new Date().toISOString()};
  s.wizard.inputCount++;s.wizard.revision++;syncFromAnswers();render();return;}
 if(a==='w-budget-amount'){
  const cur=answerValue(1)||{mode:'total'};
  s.wizard.answers[1]={status:'answered',value:{...cur,minor:Number(v)},source:'explicit',at:new Date().toISOString()};
  s.wizard.inputCount++;s.wizard.revision++;syncFromAnswers();render();return;}
 if(a==='w-budget-step'){
  const cur=answerValue(1)||{mode:'total'};
  s.wizard.answers[1]={status:'answered',value:{...cur,minor:Math.max(0,Number(v))},source:'explicit',at:new Date().toISOString()};
  s.wizard.inputCount++;s.wizard.revision++;syncFromAnswers();render();return;}
 if(a==='w-budget-confirm'){
  /* 只选了单位但没填金额时，按“暂不设上限”记录，不能留下半答状态 */
  const cur=answerValue(1);
  const val=cur&&cur.mode==='none'?cur:(cur&&cur.minor!==null&&cur.minor!==undefined?cur:{mode:'none',minor:null});
  s.wizard.answers[1]={status:'answered',value:val,source:val.mode==='none'?'unlimited':'explicit',at:new Date().toISOString()};
  s.wizard.inputCount++;s.wizard.revision++;
  s.wizard.step=3;syncFromAnswers();render();return;}
 /* 第 3 题 */
 if(a==='w-ext-inc'||a==='w-ext-dec'){
  const cur={...W.emptyExternal(),...(answerValue(2)||{})};
  cur[b.dataset.key]=Math.max(0,Number(v));cur.confirmed=true;
  s.wizard.answers[2]={status:'answered',value:cur,source:'explicit',at:new Date().toISOString()};
  s.wizard.inputCount++;s.wizard.revision++;syncFromAnswers();render();return;}
 if(a==='w-ext-confirm'){
  /* 全为 0 时也要算作明确回答“都还没有”，不能靠控件默认值 */
  const cur={...W.emptyExternal(),...(answerValue(2)||{})};
  cur.confirmed=true;
  s.wizard.answers[2]={status:'answered',value:cur,source:cur.main||cur.side||W.externalDrinkCount(cur)?'explicit':'decided',at:new Date().toISOString()};
  s.wizard.inputCount++;s.wizard.revision++;
  s.wizard.step=4;syncFromAnswers();render();return;}
 /* 第 4 题 */
 if(a==='w-taste'){
  const cur=answerValue(3)||{words:[]};
  const words=cur.words.includes(v)?cur.words.filter(x=>x!==v):[...cur.words,v];
  s.wizard.answers[3]={status:'answered',value:{...cur,words},source:'explicit',at:new Date().toISOString()};
  s.wizard.inputCount++;s.wizard.revision++;syncFromAnswers();render();return;}
 if(a==='w-taste-confirm'){
  /* 没有勾选任何口感时，“就按这些，继续”视为明确回答“都可以”，而不是未答 */
  const cur=answerValue(3);
  s.wizard.answers[3]={status:'answered',value:cur&&cur.words&&cur.words.length?cur:{words:[]},
   source:cur&&cur.words&&cur.words.length?'explicit':'unlimited',at:new Date().toISOString()};
  s.wizard.inputCount++;s.wizard.revision++;
  s.wizard.step=5;syncFromAnswers();render();return;}
 /* 第 5 题 */
 if(a==='w-dir'){
  const info=s.directionInfo;const d=info&&info.directions.find(x=>x.id===v);
  if(!d)return;
  setAnswer(4,{id:d.id,label:d.label,role:d.role,optionIds:d.optionIds});s.wizard.step=6;render();return;}
 if(a==='w-dir-any'){setAnswer(4,null,'unlimited');s.wizard.step=6;render();return;}
 if(a==='w-dir-single'){setAnswer(4,s.directionInfo.directions[0]);s.wizard.step=6;render();return;}
 if(a==='w-dir-none'){setAnswer(4,null,'unlimited');s.wizard.step=6;render();return;}
 if(a==='w-dir-browse'){setAnswer(4,{browse:true});s.wizard.step=6;render();return;}
 /* 第 6 题 */
 if(a==='w-novelty'){
  const cur=answerValue(5)||{mode:null,familiar:[]};
  s.wizard.answers[5]={status:'answered',value:{...cur,mode:v},source:'explicit',at:new Date().toISOString()};
  s.wizard.inputCount++;s.wizard.revision++;render();return;}
 if(a==='w-familiar'){
  const cur=answerValue(5)||{mode:'swap',familiar:[]};
  const fam=cur.familiar.includes(v)?cur.familiar.filter(x=>x!==v):[...cur.familiar,v];
  s.wizard.answers[5]={status:'answered',value:{...cur,familiar:fam},source:'explicit',at:new Date().toISOString()};
  s.wizard.inputCount++;render();return;}
 if(a==='w-familiar-none'){
  const cur=answerValue(5)||{mode:'swap'};
  s.wizard.answers[5]={status:'answered',value:{...cur,familiar:[]},source:'explicit',at:new Date().toISOString()};
  s.wizard.inputCount++;render();return;}
 if(a==='w-novelty-confirm'){
  /* 确认按钮本身才算这一题已答：只选了模式但没确认时不算 */
  const cur=answerValue(5);
  s.wizard.answers[5]={status:'answered',value:cur&&cur.mode?cur:{mode:'balance',familiar:[]},source:'explicit',at:new Date().toISOString()};
  s.wizard.inputCount++;s.wizard.revision++;
  s.wizard.step=7;render();return;}
 /* 第 7 题 */
 if(a==='w-plan'){
  s.wizard.answers[6]={status:'answered',value:{length:Number(v)},source:'explicit',at:new Date().toISOString()};
  s.wizard.inputCount++;s.wizard.revision++;render();return;}
 if(a==='w-plan-confirm'){
  /* 没有明确选择顿数时，“帮我决定”的解释就是先只搭本顿 */
  const cur=answerValue(6);
  if(!cur||!cur.length)s.wizard.answers[6]={status:'answered',value:{length:1},source:'decided',at:new Date().toISOString()};
  s.wizard.step=8;render();return;}
 /* 第 8 题 */
 if(a==='w-consent'){
  const cur=answerValue(7)||{consent:W.emptyConsent()};
  const consent={...W.emptyConsent(),...cur.consent};
  consent[v]=!consent[v];
  s.wizard.answers[7]={status:'answered',value:{...cur,consent},source:'explicit',at:new Date().toISOString()};
  s.wizard.inputCount++;s.wizard.revision++;render();return;}
 if(a==='w-consent-none'){
  s.wizard.answers[7]={status:'answered',value:{consent:W.emptyConsent()},source:'explicit',at:new Date().toISOString()};
  s.wizard.inputCount++;s.wizard.revision++;render();return;}
 if(a==='w-submit'){submitWizard();return;}
 /* 帮我决定：只回答当前题 */
 if(a==='w-decide'){handleDecide(Number(b.dataset.index));return;}
 /* 结果页 */
 if(a==='w-edit-answers'){s.route='wizard';render();scrollTo(0,0);return;}
 if(a==='w-add'){addSuggestions();return;}
 if(a==='w-savings'){openSavings();return;}
 /* 轮换计划里某一顿的展开/收起 */
 if(a==='w-plan-meal'){
  const det=b.nextElementSibling;
  if(!det)return;
  const open=det.hidden;
  det.hidden=!open;
  b.setAttribute('aria-expanded',String(open));
  b.setAttribute('aria-label',(open?'收起':'展开')+'第 '+b.dataset.index+' 顿明细');
  b.classList.toggle('open',open);
  return;}
 if(a==='w-eaten'){s.eaten=true;s.feedbackOpen=true;render();notify('现在可以评价这顿了吗？');return;}
 if(a==='w-fb-good'){closeFeedback('合口味');return;}
 if(a==='w-fb-adjust'){s.feedbackOpen=false;s.dialog={type:'fb-item'};render();return;}
 if(a==='w-fb-skip'){closeFeedback(null);return;}
 if(a==='w-fb-item'){s.dialog={type:'fb-kind',unit:b.dataset.id};render();return;}
 if(a==='w-fb-kind'){recordFeedback(b.dataset.kind);return;}
 if(a==='close-dialog'){s.dialog=null;render();return;}
 /* 经典与餐单 */
 if(a==='w-category'){s.state.categoryId=b.dataset.id;render();return;}
 if(a==='w-add-product'){addProduct(b.dataset.id);return;}
 if(a==='w-qty'){changeQty(b.dataset.key,Number(v));return;}
 if(a==='w-edit-line'){editSpecs(b.dataset.key);return;}
 /* 规格选择：必须写进 d.specs[key][group]，[key] 是商品（行）标识。
   曾写成 d.specs[group]，与按钮读取和校验时的键不一致，导致选完永远校验不过。 */
 if(a==='w-spec'){
  const d=s.dialog;
  const key=b.dataset.product||(d.products&&d.products[0]&&(d.products[0].lineId||d.products[0].id))||null;
  d.specs={...d.specs,[key]:{...(d.specs[key]||{}),[b.dataset.group]:b.dataset.value}};
  render();return;}
 if(a==='w-spec-confirm'){confirmSpecs();return;}
 if(a==='w-del-taste'){const r=memory.deleteTaste(b.dataset.id);notify(r.persisted?'已删除这一条':'删除失败，条目仍在');render();return;}
 if(a==='w-clear-mem'){memory.clearAll();notify('已清除全部已保存内容');render();return;}
});

function handleDecide(i){
 const step=i+1;
 if(i===0)decideCurrent(0,1,'按常规食量先算');
 else if(i===1)decideCurrent(1,{mode:'none',minor:null},'先不设上限');
 else if(i===2)decideCurrent(2,{...W.emptyExternal(),confirmed:true},'都还没有');
 else if(i===3)decideCurrent(3,{words:[]},'都可以，你来挑');
 else if(i===4)decideCurrent(4,null,'先不限定');
 else if(i===5)decideCurrent(5,{mode:'balance',familiar:[]},'帮我拿捏');
 else if(i===6)decideCurrent(6,{length:1},'先只搭本顿');
 else return;
 /* 只前进一题，绝不跳过剩余题目 */
 s.wizard.step=Math.min(8,step+1);
 syncFromAnswers();render();
}

function submitWizard(){
 /* 用户直接点“看看我的搭配”而没动任何同意开关时，
    第 8 题算作明确回答“这次就好”，而不是未答；同时不新增任何长期保存。 */
 if(!W.isAnswered(s.wizard.answers[7]))
  s.wizard.answers[7]={status:'answered',value:{consent:W.emptyConsent()},source:'unlimited',at:new Date().toISOString()};
 if(!gate()){notify('还有题目没答完');return;}
 const mem=answerValue(7)||{consent:W.emptyConsent()};
 const consent=mem.consent||W.emptyConsent();
 const result=W.persistResult(()=>memory.setConsent(consent));
 const tasteAns=answerValue(3);
 const saves=[];
 if(consent.saveExplicitTaste&&tasteAns&&tasteAns.words.length){
  const t=W.buildTaste(tasteAns.words,'explicit');
  const entries=[];
  if(t.texture.length)entries.push({subjectId:'self',dimension:'texture',value:t.texture[0]});
  if(t.spice.length)entries.push({subjectId:'self',dimension:'spice',value:t.spice[0]});
  if(t.richness.length)entries.push({subjectId:'self',dimension:'richness',value:t.richness[0]});
  const r=W.persistResult(()=>memory.saveExplicitTaste(entries,'consent-'+Date.now()));
  saves.push(r);
 }
 s.wizard={...s.wizard,completed:true,step:8};
 recompute();
 /* 保存最终选餐记录必须发生在实际选定方案之后 */
 let chosenNotice=null;
 if(consent.saveFinalSelection&&s.rec&&s.rec.suggestedParts&&s.rec.suggestedParts.length){
  const r=W.persistResult(()=>memory.saveFinalSelection({items:s.rec.suggestedParts,totalMinor:s.rec.total?s.rec.total.minor:null},'consent-'+Date.now()));
  chosenNotice=r;
 }
 if(consent.saveRotationPlan&&s.plan){
  W.persistResult(()=>memory.saveRotation(s.plan,'consent-'+Date.now()));
 }
 go('result');
 if(!result.ok)notify(result.message);
 else if(chosenNotice&&!chosenNotice.ok)notify(chosenNotice.message);
 else if(saves.some(x=>!x.ok))notify('这次已用上，部分内容没能保存到下次。');
}

/* 推荐加入餐单：完整建议列表作为待提交快照，弹层只负责收集"需要规格"的子集。
   确认后一次性提交**完整快照**，而不是只提交弹层里的那几项。
   旧实现把建议先过滤成 needSpecs 再提交，导致无规格的主食/小食全被丢掉。 */
function addSuggestions(){
 if(!s.rec||!s.rec.suggestedParts||!s.rec.suggestedParts.length)return;
 const all=JSON.parse(JSON.stringify(s.rec.suggestedParts));
 const needSpecs=all.filter(p=>p.specGroups&&p.specGroups.length);
 if(!needSpecs.length){
  /* 全都无需规格：直接原子提交完整列表，不弹层、不空提交 */
  commitAdd(all,{});
  return;
 }
 const specs={};
 for(const p of needSpecs)specs[p.lineId||p.id]={...(p.specs||{})};
 s.dialog={type:'specs',products:needSpecs,specs,pending:all,id:'add-'+Date.now(),fromSuggestion:true};
 render();
}
/* 一次事务提交。products 是完整列表，specs 按商品键存放已确认的规格。 */
function commitAdd(products,specs){
 const id=(s.dialog&&s.dialog.id)||'add-'+Date.now();
 if(!products||!products.length)return;
 s.state=D.reduce(s.state,{type:'ADD',products,specs:specs||{},id});
 const n=s.state.cart.reduce((a,l)=>a+l.quantity,0);
 notify('已加入 '+products.length+' 种，餐单共 '+n+' 件');
 s.dialog=null;
 recompute();
 go('cart');
}
/* 改规格：必须替换原行，不能 ADD 出一行新的。 */
function confirmSpecs(){
 const d=s.dialog;
 const bad=d.products.some(p=>!D.validateSpecs(p,d.specs[p.lineId||p.id]||{}).valid);
 if(bad)return;
 if(d.editKey){
  /* 逐行编辑：按原 key 替换，保留原数量与人员归属 */
  const p=d.products[0];
  const specKey=p.lineId||p.id;
  /* D.reduce 返回新状态，不是原地修改 */
  s.state=D.reduce(s.state,{type:'EDIT_LINE',key:d.editKey,product:p,specs:d.specs[specKey]||{},id:'edit-'+d.editKey});
  notify('已更新规格，数量不变');
  s.dialog=null;
  recompute();
  go('cart');
  return;
 }
 /* 推荐加入：提交完整快照 pending，规格用弹层确认过的 */
 commitAdd(d.pending||d.products,d.specs);
}
function addProduct(id){
 const p=C.products.find(x=>x.id===id);if(!p)return;
 const now=Date.now();
 if(s.lastAdded===id&&now-s.lastAddedAt<500)return;
 s.lastAdded=id;s.lastAddedAt=now;
 if(p.specGroups&&p.specGroups.length){
  const specs={};for(const g of p.specGroups)specs[p.id]={...(specs[p.id]||{})};
  s.dialog={type:'specs',products:[p],specs,id:'add-'+now};
  render();return;
 }
 s.state=D.reduce(s.state,{type:'ADD',products:[p],specs:{},id:'add-'+now});
 notify('已加入餐单');
 render();
}
function changeQty(key,q){
 s.state=D.reduce(s.state,{type:'QUANTITY',key,quantity:q});
 recompute();render();
}
/* 改规格：把原行的数量与人员归属一起带进弹层，确认后走 EDIT_LINE 替换原行 */
function editSpecs(key){
 const l=s.state.cart.find(x=>x.key===key);if(!l)return;
 const p=C.products.find(x=>x.id===l.productId);if(!p)return;
 s.dialog={type:'specs',products:[{...p,lineId:p.id,quantity:l.quantity,assignedTo:l.assignedTo||[]}],
  specs:{[p.id]:{...l.specs}},id:'edit-'+key,editKey:key};
 render();
}

function openSavings(){
 /* 未接入真实报价时如实说明，不用虚构价格冒充省钱成果 */
 s.savings={status:'pending',message:'省钱方案待接入：官方券资格与总价尚未在本页核验。不会自动领券、凑单或购卡。'};
 s.dialog={type:'savings'};render();
}
function recordFeedback(kind){
 const d=s.dialog;if(!d)return;
 const rec=W.feedbackRecord(W.feedbackGate('meal-current',s.eaten),d.unit,kind,s.eaten,
  (answerValue(7)?.consent||{}).saveExplicitTaste?'consent-'+Date.now():null);
 if(!rec){notify('还没确认这顿吃过，不记录体验');s.dialog=null;render();return;}
 const r=W.persistResult(()=>memory.saveFeedback(rec,rec.saveConsentId));
 s.dialog=null;s.feedbackOpen=false;render();
 notify(r.persisted?'已记录，会影响以后的推荐':'这次已用上，没能保存到下次');
}
function closeFeedback(kind){
 if(kind){
  const rec=W.feedbackRecord(W.feedbackGate('meal-current',s.eaten),'all',kind,s.eaten,null);
  if(rec){const r=W.persistResult(()=>memory.saveFeedback(rec,null));notify(r.persisted?'已记录':'这次已用上，没能保存到下次');}
 }
 s.feedbackOpen=false;render();
}

/* ---------- 弹层 ---------- */
function sheet(){
 const d=s.dialog;
 const ov=V.el('div','dialog-backdrop');
 const box=V.el('section','sheet',null,{role:'dialog','aria-modal':'true','aria-labelledby':'dlg-title'});
 box.append(V.el('div','handle'),V.add(V.el('div','sheet-header'),V.el('h2',null,d.type==='specs'?'确认规格':d.type==='savings'?'省钱方案':'刚才哪里不合适？',{id:'dlg-title'}),
  V.btn('×','close-dialog','icon-btn',{'aria-label':'关闭并取消'})));
 if(d.type==='specs'){
  box.append(V.el('p','muted','先确认每行必选规格。演示价下不同杯型同价。'));
  for(const p of d.products){
   if(!p.specGroups||!p.specGroups.length)continue;
   const key=p.lineId||p.id;
   box.append(V.el('h3','spec-product',p.name+' ×'+(p.quantity||1)));
   for(const g of p.specGroups){
    const row=V.el('div','tools-row');
    for(const o of g.options)
     row.append(V.btn(o.label,'w-spec','chip'+(((d.specs[key]||{})[g.id]===o.id)?' selected':''),{group:g.id,value:o.id,product:key},{'aria-pressed':String((d.specs[key]||{})[g.id]===o.id)}));
    box.append(row);
   }
  }
  const c=V.btn(d.editKey?'确认规格修改':'确认并加入餐单','w-spec-confirm','cta');
  c.disabled=d.products.some(p=>!D.validateSpecs(p,d.specs[p.lineId||p.id]||{}).valid);
  box.append(c);
 }
 if(d.type==='savings'){
  box.append(V.el('div','notice'),V.el('strong',null,s.savings.message));
  box.append(V.el('p','fine-note','只有在获准的真实连接核验过券资格与完整应付成本后，才会比较方案并显示节省额。任何必要费用未知都只标待核实。'));
 }
 if(d.type==='fb-item'){
  for(const p of (s.rec&&s.rec.suggestedParts)||[])
   box.append(V.btn(p.name,'w-fb-item','drawer-choice',{id:p.id}));
 }
 if(d.type==='fb-kind'){
  for(const [k,label] of [['too-spicy','太辣'],['too-rich','太腻'],['texture','口感不对'],['portion','份量不合适']])
   box.append(V.btn(label,'w-fb-kind','drawer-choice',{kind:k}));
 }
 box.append(V.btn('取消','close-dialog','secondary-action'));
 ov.append(box);return ov;
}

document.addEventListener('keydown',e=>{
 if(!s.dialog)return;
 if(e.key==='Escape'){e.preventDefault();s.dialog=null;render();}
 if(e.key==='Tab'){
  const nodes=[...document.querySelectorAll('[role=dialog] button:not(:disabled)')];
  const first=nodes[0],last=nodes.at(-1);
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
  else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
 }
});

/* 饭后反馈：只有主动确认吃过才出现 */
const origRender=render;
window.McApp={getState:()=>JSON.parse(JSON.stringify({step:s.wizard.step,answered:W.answeredCount(s.wizard),completed:s.wizard.completed,route:s.route,people:s.state.constraints.people,cart:s.state.cart.length})),
 feedbackOpen:()=>s.feedbackOpen};
render();
})();