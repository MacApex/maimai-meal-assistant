/* 真实门店模式前端。
   硬性规则：
   - 浏览器永远拿不到 MCP key，只与本机网关通信
   - 所有商品来自该门店真实可售菜单；不得混入演示商品
   - 任何接口失败都必须显式提示，禁止用假数据兜底
   - 官方报价绑定 ctxVersion；人数/商品/规格/门店一变立即标"待重算"
   - 营养与过敏原：接口未返回就是未知，绝不从名称推断
*/
'use strict';
const API='http://127.0.0.1:8795';
/* 会话令牌：只向同源的 /api/session 索取，用于证明调用方就是本项目网页。
   其他本机页面拿不到它，因此无法借用本机的官方凭据。 */
let SESSION_TOKEN=null;
async function ensureToken(){
 if(SESSION_TOKEN)return SESSION_TOKEN;
 let j=null;
 try{
  const r=await fetch('/api/session',{headers:{'content-type':'application/json'}});
  j=await r.json();
 }catch(e){ throw new Error('无法从本机网页服务取得会话令牌，请确认已用 start.sh 启动'); }
 if(!j||!j.token) throw new Error('本机网页服务未授权本次会话（缺少令牌）');
 SESSION_TOKEN=j.token;
 return SESSION_TOKEN;
}
const S={
 ctx:null,          /* 网关返回的上下文，含 ctxVersion */
 menu:null,         /* 真实菜单 */
 quote:null,        /* 官方报价 */
 cart:[],           /* [{code,name,priceMinor,qty,locked,spec}] */
 step:0, people:1, budgetMinor:null, externalDrinks:0, taste:null,
 dir:null, novelty:'safe', meals:1, qOverride:{}, specMap:{}, memConsent:{taste:false,selection:false,plan:false,feedback:false},
 slot:null, mode:1, pendingStore:null, busy:false,
 specSeq:0             /* 规格详情请求序号：只接受最后一次请求的结果 */
};
const STEPS=[
 {k:'people',q:'这顿几个人吃？'},
 {k:'budget',q:'这餐预算怎么定？'},
 {k:'external',q:'你已经有什么吃的、喝的？'},
 {k:'taste',q:'今天更想吃什么感觉？'},
 {k:'dir',q:'主食更想吃哪一边？'},
 {k:'novelty',q:'这顿想尝点新鲜吗？'},
 {k:'meals',q:'只选这顿，还是顺手排几顿？'},
 {k:'memory',q:'这些选择，下次要怎么用？'}
];
const $=s=>document.querySelector(s);
const el=(t,c,x)=>{const n=document.createElement(t);if(c)n.className=c;if(x!==undefined)n.textContent=x;return n;};
const yuan=m=>(m===null||m===undefined)?'待核实':'¥'+(m/100).toFixed(2);
function toast(m){const t=$('#toast');t.textContent=m;t.classList.add('show');clearTimeout(toast._t);
 toast._t=setTimeout(()=>t.classList.remove('show'),2600);}

/* ---------- 网关调用 ---------- */
async function api(path,body){
 let r;
 await ensureToken();
 try{r=await fetch(API+path,{method:body?'POST':'GET',
  headers:Object.assign(body?{'content-type':'application/json'}:{},SESSION_TOKEN?{'x-session-token':SESSION_TOKEN}:{}),
  body:body?JSON.stringify(body):undefined});}
 catch(e){throw new Error('无法连接本机网关（'+API+'）。请先运行 server/gateway.js。');}
 const j=await r.json().catch(()=>({ok:false,error:'网关返回的不是合法 JSON'}));
 if(!j.ok){const e=new Error(j.error||('网关错误 '+r.status));e.code=j.bizCode;e.stale=j.stale;e.status=r.status;throw e;}
 return j;
}

/* ---------- 启动 ---------- */
async function boot(){
 try{
  await ensureToken();
  let h;
  try{h=await fetch(API+'/api/health').then(r=>r.json());}
  catch(e){throw new Error('无法连接本机网关（'+API+'）。请用 start.sh 启动服务。');}
  if(h.writeOpsEnabled)console.warn('异常：网关声称开放了写操作');
  render();
  openStore();
 }catch(e){ renderFatal(e); }
}
function renderFatal(e){
 const m=$('#app');m.replaceChildren();
 const d=el('div','err');d.append(el('b','','无法进入真实模式'));
 d.append(el('p','',e.message));
 const b=el('button','cta','重试');b.onclick=boot;
 const b2=el('button','ghost','改用演示体验');b2.onclick=()=>{location.href='/demo/index.html';};
 m.append(d,el('p','muted','真实模式必须通过本机网关访问官方数据；失败时不会用演示数据冒充。'),b,b2);
}

/* ---------- 门店确认 ---------- */
function openStore(){
 const d=$('#storeDlg');
 if(!d.open)d.showModal();
}
/* <form method="dialog"> 会在按钮点击时提交并关闭弹层。
   这里把两个弹层的 form 换成普通 div 语义：拦截 submit，改为纯事件驱动。
   注意必须用冒泡阶段监听；捕获阶段会先于按钮的 click 处理，导致点不动。 */
document.addEventListener('submit',e=>{e.preventDefault();e.stopPropagation();},false);
document.addEventListener('click',async e=>{
 const b=e.target.closest('[data-a]');if(!b)return;
 const a=b.dataset.a;
 try{
  if(a==='switch-demo'){
   location.href='/demo/index.html';return;}
  if(a==='classic'){
   /* 经典自主选餐：不走八步向导，直接从该门店真实可售菜单里自选。
      数据仍来自官方接口，不引入演示商品。 */
   openClassic();return;}
  if(a==='close-store'){$('#storeDlg').close();return;}
  if(a==='search-store')return doSearch();
  if(a==='pick-mode')return doPickMode(b);
  if(a==='confirm-store')return doConfirmStore();
  if(a==='close-swap'){$('#swapDlg').close();return;}
  if(a==='close-spec'){$('#specDlg').close();return;}
  if(a==='confirm-spec')return doConfirmSpec();
  if(a==='retry-boot')return boot();
 }catch(err){toast(err.message);}
});

async function doSearch(){
 const city=$('#city').value.trim(),kw=$('#kw').value.trim();
 const msg=$('#storeMsg');
 if(!city||!kw){msg.textContent='需要同时填写城市与关键词。';return;}
 msg.textContent='正在查询真实门店…';
 /* 重新搜索意味着上一次的门店选择已作废：必须清空待选状态并禁用确认按钮，
    否则列表换了一批，"用这家店"却仍指向上一批的门店。 */
 S.pendingStore=null;
 $('#confirm-store').disabled=true;
 $('#modeWrap').classList.add('hidden');
 $('#slotWrap').classList.add('hidden');
 $('#storeList').replaceChildren();
 try{
  const j=await api('/api/stores',{city,keyword:kw});
  msg.textContent='找到 '+j.stores.length+' 家门店（数据来自官方接口）。';
  const wrap=$('#storeList');
  for(const s of j.stores){
   const btn=el('button','store');
   btn.type='button';btn.setAttribute('aria-pressed','false');
   btn.append(el('strong','',s.storeName));
   btn.append(el('div','meta',(s.storeAddress||s.address||'')+(s.distance?' · 距离 '+s.distance:'')+(s.reservation?' · 支持预约':'')));
   btn.onclick=()=>{
    S.pendingStore=s;S.mode=1;S.slot=null;
    [...wrap.children].forEach(x=>{if(x.setAttribute)x.setAttribute('aria-pressed','false');});
    btn.setAttribute('aria-pressed','true');
    $('#modeWrap').classList.remove('hidden');
    $('#confirm-store').disabled=false;
    $('#slotWrap').classList.add('hidden');
   };
   wrap.append(btn);
  }
 }catch(e){
  msg.textContent='';
  const d=el('div','err');d.append(el('b','','门店查询失败：'+e.message));
  d.append(el('p','hint','不会用演示门店代替。请检查城市与关键词是否正确，或改用演示体验。'));
  $('#storeList').replaceChildren(d);
 }
}
function doPickMode(b){
 if(S.mode!==Number(b.dataset.v)){S.qOverride={};S.specMap={};S.lockedComb=null;S.quote=null;}
 S.mode=Number(b.dataset.v);
 [...b.parentElement.children].forEach(x=>x.setAttribute('aria-pressed','false'));
 b.setAttribute('aria-pressed','true');
 const st=S.pendingStore;
 const wrap=$('#slotWrap');
 if(S.mode===1&&st&&st.reservation&&st.reservationOptions&&st.reservationOptions.length){
  const sel=$('#slot');sel.replaceChildren();
  for(const o of st.reservationOptions)
   for(const part of String(o.reservationOptionText||'').split('，'))
    {const op=el('option','',part);op.value=part;sel.append(op);}
  wrap.classList.remove('hidden');
 }else wrap.classList.add('hidden');
}
async function doConfirmStore(){
 const st=S.pendingStore;if(!st)return;
 const slot=$('#slotWrap').classList.contains('hidden')?null:$('#slot').value;
 const j=await api('/api/context',{storeCode:st.storeCode,beCode:st.beCode,beType:S.mode,
  storeName:st.storeName,reservationDate:slot||null});
 S.ctx=j.context;
 $('#storeDlg').close();
 await loadMenu();
}
async function loadMenu(){
 const m=$('#app');m.replaceChildren(el('p','loading','正在加载该门店的真实菜单…'));
 try{
  const j=await api('/api/menu',{});
  S.menu=j;
  /* 菜单响应不含 ctxVersion。若直接用菜单响应覆盖 S.ctx，
     之后每份报价都会被判为"已过期"。这里只补门店信息，保留版本号。 */
  S.ctx={...S.ctx,storeCode:j.storeCode,storeName:j.storeName,
   orderType:j.orderType,beType:j.beType,ctxVersion:(S.ctx&&S.ctx.ctxVersion)||0};
  S.quote=null;S.cart=[];S.qOverride={};S.specMap={};S.lockedComb=null;
  render();
 }catch(e){
  m.replaceChildren();
  const d=el('div','err');
  d.append(el('b','',e.stale?'当前门店不可用：':'菜单加载失败：'+e.message));
  if(/打烊|不在营业时间/.test(e.message))
   d.append(el('p','hint','可以换一家当前营业的门店继续。'));
  const b1=el('button','cta','重试');b1.onclick=loadMenu;
  const b2=el('button','ghost','换一家门店');b2.onclick=openStore;
  const b3=el('button','ghost','改用演示体验');b3.onclick=()=>{location.href='/demo/index.html';};
  m.append(d,el('p','muted','真实模式不会用演示菜单代替失败的请求。'),b1,b2,b3);
 }
}

/* ---------- 渲染 ---------- */
function render(){
 if(S.mode3==='classic'&&S.menu)return classicRender();
 const m=$('#app');m.replaceChildren();
 if(S.menu)m.append(sourceCard());
 if(S.step<8)return m.append(stepCard());
 m.append(resultCard());
}
function sourceCard(){
 const c=S.ctx||{};
 const d=el('div','src');
 d.append(el('b','','真实官方数据'));
 d.append(el('div','t','门店：'+(c.storeName||'—')+'　就餐方式：'+
  (c.beType===5?'得来速':'到店自提')+(c.reservationDate?('　时段：'+c.reservationDate):'')));
 d.append(el('div','t','更新时间：'+(S.menu&&S.menu.checkedAt||'—')+'　可售餐品 '+
  ((S.menu&&S.menu.items||[]).length)+' 项　·　数据源：麦当劳官方 MCP'));
 const ch=el('button','ghost','更换门店');ch.onclick=openStore;
 const cl=el('button','cta','经典自主选餐');cl.onclick=openClassic;
 d.append(ch,cl);
 return d;
}
function stepCard(){
 const st=STEPS[S.step];
 const c=el('div','step');
 c.append(el('div','n','第 '+(S.step+1)+' / 8 题'));
 c.append(el('div','q',st.q));
 const o=el('div','opts');
 const mk=(label,val,sub,on,pressed)=>{const b=el('button','');
  b.type='button';if(sub)b.append(el('span','v',String(sub)));
  b.append(document.createTextNode(label));
  b.setAttribute('aria-pressed',pressed?'true':'false');
  b.onclick=on;o.append(b);return b;};
 if(st.k==='people'){
  for(const n of [1,2,3,4,5,6])mk(n+' 人',n,n,()=>{S.people=n;S.lockedComb=null;next();},S.people===n);
 }else if(st.k==='budget'){
  mk('帮我决定',null,'—',()=>{S.budgetMinor=null;S.lockedComb=null;next();},S.budgetMinor===null);
  for(const y of [30,50,80,120])mk(y+' 元以内',y,y,()=>{S.budgetMinor=y*100;S.lockedComb=null;next();},S.budgetMinor===y*100);
  /* 自定义预算：真实门店价格差异大，固定档位常常不够用，
     也让预算内确实无解这类情况能被真实触达。 */
  const inp=el('input');inp.type='number';inp.min='1';inp.max='500';
  inp.placeholder='自定义金额（元）';inp.style.gridColumn='1/-1';
  inp.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();applyCustom();}};
  const applyCustom=()=>{const v=Number(inp.value);
   if(!v||v<1){toast('请输入有效金额');return;}
   S.budgetMinor=Math.round(v*100);S.lockedComb=null;next();};
  const okb=el('button','cta','用这个预算');okb.type='button';
  okb.style.gridColumn='1/-1';okb.onclick=applyCustom;
  o.append(inp,okb);
 }else if(st.k==='external'){
  for(const n of [0,1,2,3,4])mk(n===0?'都没有':('已有 '+n+' 杯饮品'),n,n,()=>{S.externalDrinks=n;S.lockedComb=null;next();},S.externalDrinks===n);
 }else if(st.k==='taste'){
  const ts=[['都可以',null],['香脆','脆'],['软嫩','嫩'],['清爽','清'],['微辣','辣']];
  for(const [lab,val] of ts)mk(lab,null,'🍔',()=>{S.taste=val;next();},S.taste===val);
 }else if(st.k==='dir'){
  mk('汉堡',null,'🍔',()=>{S.dir='burger';S.lockedComb=null;next();},S.dir==='burger');
  mk('卷',null,'🌯',()=>{S.dir='wrap';S.lockedComb=null;next();},S.dir==='wrap');
  mk('都可以',null,'🤝',()=>{S.dir=null;S.lockedComb=null;next();},S.dir===null);
 }else if(st.k==='novelty'){
  mk('稳妥一点',null,'✓',()=>{S.novelty='safe';S.lockedComb=null;next();},S.novelty==='safe');
  /* 「换一样」必须真的换一组：见 solve() 中 feasible 的选取分支 */
  mk('换一样',null,'🔄',()=>{S.novelty='swap';S.lockedComb=null;next();},S.novelty==='swap');
 }else if(st.k==='meals'){
  for(const n of [1,3,5])mk(n+' 顿',n,n,()=>{S.meals=n;next();},S.meals===n);
 }else if(st.k==='memory'){
  for(const [k,lab] of [['taste','保存这次口味偏好'],['selection','保存这次选餐结果'],
   ['plan','保存多顿计划'],['feedback','保存吃后反馈']]){
   const b=el('button','');b.type='button';
   b.append(document.createTextNode(lab));
   b.setAttribute('aria-pressed',S.memConsent[k]?'true':'false');
   b.onclick=()=>{S.memConsent[k]=!S.memConsent[k];render();};
   o.append(b);
  }
  /* 第八题的同意项是逐项开关，不能靠"选一个"前进；
     必须给一个明确的继续入口，否则用户永远停在第 8 题。 */
  const go=el('button','cta','看看我的真实推荐');go.type='button';
  go.style.gridColumn='1/-1';
  go.onclick=()=>{S.step=9;render();};
  o.append(go);
 }
 c.append(o);
 if(S.step>0){const back=el('button','ghost','← 上一题');back.onclick=()=>{S.step--;render();};c.append(back);}
 return c;
}
function next(){S.step++;render();}

/* ---------- 候选生成与预算搜索（本地完成） ---------- */
/* 角色由分类名推断仅用于内部排序；最终可售性以菜单为准。
   注意：营养/过敏原接口未返回，一律标未知，不从名称推断。 */
function roleOf(item,catName){
 const n=catName||'';
 if(/汉堡|卷|堡/.test(n)||/堡|卷/.test(item.name))return 'main';
 if(/小食|甜品|配餐|薯条|鸡块|翅/.test(n)||/薯条|鸡块|鸡翅|派|蛋挞|奥利奥/.test(item.name))return 'side';
 if(/饮料|饮品/.test(n)||/茶|可乐|雪碧|橙汁|奶昔|咖啡|豆浆/.test(item.name))return 'drink';
 return 'other';
}
function buildCandidates(){
 const items=S.menu.items||[];
 const cats=S.menu.categories||[];
 const byCode={};items.forEach(i=>{byCode[i.code]=i;});
 /* 建立 code -> 分类名 映射 */
 const catOf={};
 for(const c of cats)for(const m of c.meals||[])catOf[m]=c.name;
 const roles={main:[],side:[],drink:[]};
 for(const it of items){
  const r=roleOf(it,catOf[it.code]);
  if(roles[r]&&it.priceMinor>0)roles[r].push(it);
 }
 for(const k in roles)roles[k].sort((a,b)=>a.priceMinor-b.priceMinor);
 /* 二选一方向：只在该方向里取，不硬塞 */
 let mainPool=roles.main;
 if(S.dir==='burger')mainPool=mainPool.filter(x=>/堡/.test(x.name));
 else if(S.dir==='wrap')mainPool=mainPool.filter(x=>/卷/.test(x.name));
 if(!mainPool.length)mainPool=roles.main;
 return {roles,mainPool};
}
/* 预算参与搜索：不是先选最贵再拒绝，而是在预算内找可行组合。
   数量可被用户覆盖：qOverride 记住"用户把某商品改成几份"，
   否则每次重渲染都会回到默认值，用户改了就丢。 */
/* 人数覆盖校验：主食与饮品份数是否满足人数与已有饮品。
   用于替换/改量/改规格后重新核对约束，而不是沿用旧结论。 */
function checkCoverage(items){
 const mainQty=items.filter(x=>/堡|卷|鸡|饭|面/.test(x.it.name)||/MAIN/.test(x.it.code))
  .reduce((a,x)=>a+x.qty,0);
 const drinkQty=items.filter(x=>/茶|可乐|雪碧|橙汁|奶昔|咖啡|豆浆|纯悦|气泡|DRINK/.test(x.it.name)
  ||/DRINK|TEA|COFFEE|JUICE/.test(x.it.code)).reduce((a,x)=>a+x.qty,0);
 const needDrink=Math.max(0,S.people-S.externalDrinks);
 const notes=[];
 if(mainQty<S.people)notes.push('主食 '+mainQty+' 份，少于 '+S.people+' 人');
 if(drinkQty<needDrink)notes.push('饮品 '+drinkQty+' 份，少于缺口 '+needDrink+' 杯');
 return {ok:notes.length===0,notes,mainQty,drinkQty,needDrink};
}
function solve(){
 /* 一旦向用户展示过某个组合，后续的数量调整只作用于该组合本身。
    否则改一份数量会改变总排序，界面会悄悄换成另一套商品——
    用户以为在改 A，实际下单的是 B。 */
 if(S.lockedComb){
  const items=S.lockedComb.map(z=>{const it=S.menu.items.find(m=>m.code===z.code);
   return it?{it,qty:S.qOverride[z.code]||z.qty,spec:S.specMap[z.code]||null}:null;}).filter(Boolean);
  if(items.length){
   const total=items.reduce((a,x)=>a+x.it.priceMinor*x.qty,0);
   /* P1-04：修改后必须重新核对人数覆盖与预算。
      旧实现沿用 lockedFeasible（锁组合那一刻的可行性），
      于是替换成更贵的商品后页面仍显示"有可行方案"。 */
   const coverage=checkCoverage(items);
   const withinBudget=S.budgetMinor===null||total<=S.budgetMinor;
   return {pick:{items,total},feasibleCount:withinBudget&&coverage.ok?1:0,
    totalCount:S.lockedTotal,coverage,withinBudget,
    overBudget:!withinBudget,coverageBroken:!coverage.ok};
  }
 }
 const {roles,mainPool}=buildCandidates();
 const needDrink=Math.max(0,S.people-S.externalDrinks);
 const baseQty=(it,def)=>(S.qOverride&&S.qOverride[it.code])||def;
 const tries=[];
 for(const m of mainPool.slice(0,6)){
  const main=[{it:m,qty:baseQty(m,S.people)}];
  const side=roles.side[0]?[{it:roles.side[0],qty:baseQty(roles.side[0],Math.max(1,Math.floor(S.people/2)))}]:[];
  /* 缺口为零时不应再买饮品：Math.max(1,needDrink) 会强迫加一份。
     这里按实际缺口取值，缺口为 0 就完全不放饮品。 */
  const drinkVariants=needDrink>0
   ? roles.drink.slice(0,5).map(d=>[...main,...side,{it:d,qty:baseQty(d,needDrink)}])
   : [[...main,...side]];
  for(const combo of drinkVariants){
   const items=combo.map(z=>({...z,spec:S.specMap[z.it.code]||null}));
   const total=items.reduce((a,x)=>a+x.it.priceMinor*x.qty,0);
   tries.push({items,total});
  }
 }
 tries.sort((a,b)=>a.total-b.total);
 const feasible=S.budgetMinor===null?tries:tries.filter(t=>t.total<=S.budgetMinor);
 /* 第 6 题「尝新」必须真的改变结果，不能只是换句话：
    safe → 预算内最省的那组（默认）
    swap → 在预算内可行组里换一组主食不同的；没有可换的就如实保持原组，
           不为了"显得换了"而篡改商品或价格。 */
 let pick,swapped=false;
 const base=feasible[0]||tries[0];
 if(S.novelty==='swap'){
  const alt=feasible.find(t=>t.items[0]&&base.items[0]&&t.items[0].it.code!==base.items[0].it.code);
  if(alt&&alt!==base){pick=alt;swapped=true;}
  else pick=base;
 }else pick=base;
 if(pick&&!S.lockedComb){
  S.lockedComb=pick.items.map(z=>({code:z.it.code,qty:z.qty}));
  S.lockedFeasible=feasible.length;S.lockedTotal=tries.length;
 }
 return {pick,feasibleCount:feasible.length,totalCount:tries.length,swapped,
  overBudget:S.budgetMinor!==null&&!!pick&&pick.total>S.budgetMinor};
}

/* ---------- 结果与官方报价 ---------- */
function resultCard(){
 const c=el('div','step');
 c.append(el('div','n','真实推荐 · 来自该门店实际可售菜单'));
 const {pick,feasibleCount,totalCount,overBudget,coverage,coverageBroken,swapped}=solve();
 if(!pick){c.append(el('p','err','该门店没有可用于搭配的餐品。'));return c;}
 if(feasibleCount===0&&!overBudget)
  c.append(el('p','err','预算 '+(S.budgetMinor/100)+' 元内找不到可行组合（已试 '+
   totalCount+' 种，均超预算）。最低可行约 '+(pick.total/100)+' 元。'));
 /* 修改后可能已经超预算或人数覆盖不足：必须明确提示并给出调整入口 */
 if(overBudget){
  const w=el('div','err');
  w.append(el('b','','已超出预算'));
  w.append(el('p','','当前合计 '+(pick.total/100)+' 元，预算 '+(S.budgetMinor/100)+' 元。'));
  w.append(el('p','hint','可以减少份数、换回更便宜的商品，或点击「← 上一题」修改预算。'));
  c.append(w);
 }
 if(coverage&&coverageBroken){
  const w2=el('div','err');
  w2.append(el('b','','人数覆盖不足'));
  (coverage.notes||[]).forEach(n=>w2.append(el('p','',n)));
  w2.append(el('p','hint','可增加份数，或点击「← 上一题」修改人数。'));
  c.append(w2);
 }
 /* 八步答案里哪些真的改变了结果、哪些没有——必须在结果页说清楚。
    第四轮自检发现：第 4（口味）、7（多顿）、8（记忆）题此前只被存下来，
    并没有参与计算；与其假装生效，不如如实标出。 */
 {
  const notes=[];
  if(S.taste)notes.push('口味「'+S.taste+'」已记录，但该门店官方接口未返回口味属性，本次没有用它筛选商品——资料不足就不编造匹配。');
  if(S.novelty==='swap')notes.push(swapped
   ?'已按「换一样」换成另一组预算内可行组合。'
   :'你想换一组新的，但预算内只有这一组可行，因此没有更换——不为了显得换了而硬凑。');
  if(S.meals>1)notes.push('你选了 '+S.meals+' 顿，但多顿排程在真实接入版尚未实现：本次只生成这一顿，其余顿次需要各自重新核验价格与供应。');
  const agreed=Object.keys(S.memConsent).filter(k=>S.memConsent[k]);
  notes.push(agreed.length
   ?'记忆授权（'+agreed.join('、')+'）仅在本次会话内记录：未写入服务端，也未写入本地存储。'
   :'未授权任何记忆项：本次不保存偏好、结果或反馈。');
  const nb=el('div','notes');
  nb.append(el('p','hint','关于这八步答案，有几条需要说明：'));
  notes.forEach(t=>nb.append(el('p','hint',t)));
  c.append(nb);
 }
 const lock=c;
 /* 渲染候选行 */
 for(const x of pick.items){
  const r=el('div','row-item');r.dataset.code=x.it.code;
  const info=el('div','info');
  info.append(el('strong','',x.it.name+' ×'+x.qty));
  info.append(el('p','','单价 '+yuan(x.it.priceMinor)+' · 小计 '+yuan(x.it.priceMinor*x.qty)));
  const u=el('span','unknown','营养/过敏原：未知');
  info.append(el('p','',''));info.append(u);
  const q=el('div','qty');
  const minus=el('button','','−');minus.onclick=()=>chg(x.it.code,-1);
  const plus=el('button','','+');plus.onclick=()=>chg(x.it.code,1);
  const spec=el('button','ghost','规格');
  spec.onclick=()=>openSpec(x.it);
  const swap=el('button','ghost','换一个');
  swap.onclick=()=>openSwap(x.it);
  q.append(minus,el('span','n',String(x.qty)),plus,spec,swap);
  r.append(info,el('div','price',yuan(x.it.priceMinor*x.qty)),q);
  lock.append(r);
 }
 c.append(quoteBlock(pick));
 const b=el('button','cta','保存餐单（文本）');b.onclick=()=>copyCart();
 c.append(b);
 return c;
}
function quoteBlock(pick){
 const box=el('div');
 const q=S.quote;
 if(!q){
  const b=el('button','cta','用官方接口算价（'+(pick?pick.items.reduce((a,x)=>a+x.qty,0):0)+' 件）');
  b.onclick=()=>doQuote();
  box.append(b,el('p','hint','价格由官方接口核算；未经核算不显示金额。'));
  return box;
 }
 /* 旧报价不隐藏，而是保留并标记为待重算——让用户看见"之前那个价已作废" */
 const stale=q.ctxVersion!==(S.ctx&&S.ctx.ctxVersion)||q.signature!==cartSignature();
 const f=el('div','foot');
 const line=el('div','l');
 line.append(el('span','',stale?'官方报价（已过期）':'官方报价'),el('span','t',yuan(q.price)));
 f.append(line);
 for(const p of q.productList)
  f.append(el('div','d',p.productName+' ×'+p.quantity+'　'+yuan(p.subtotal)));
 f.append(el('div','d','商品金额 '+yuan(q.productPrice)+'　优惠 '+yuan(q.discount)+
  '　其他费用 '+yuan((q.deliveryPrice||0)+(q.tablewarePrice||0))));
 f.append(el('div','d','报价时间 '+q.quotedAt+'　门店 '+(S.ctx&&S.ctx.storeName||'')));
 if(q.discount>0)f.append(el('div','d','↑ 已按真实返回的优惠计算；不代表全网最低。'));
 box.append(f);
 if(stale){
  const s=el('div','stale');
  s.append(el('b','','报价已过期'),document.createTextNode('：餐单或门店有变动，上面的金额不再适用，请重新算价。'));
  const b=el('button','cta','重新算价');b.onclick=()=>doQuote();
  s.append(b);box.append(s);
 }
 return box;
}
/* 报价签名：必须由"当前真正要提交给官方的那份商品列表"派生。
   早期版本读的是一个从未被填充的 S.cart，导致任何改动都不会让签名变化、
   报价永远显示"未过期"——这是会让用户按旧价下单的隐患。 */
function cartSignature(){
 const {pick}=solve();
 if(!pick)return 'empty';
 return JSON.stringify({
  ctx:S.ctx?S.ctx.ctxVersion:0,
  store:S.ctx?S.ctx.storeCode:null,
  items:pick.items.map(x=>({code:x.it.code,qty:x.qty,
   spec:x.spec?x.spec.sig:null}))
 });
}
/* 报价：发出前冻结"这一单到底是什么"，回来时逐项核对。
   P0-01 旧实现在 await 之后才取 cartSignature()，
   于是旧响应会被打上新餐单的签名，看上去"完全有效"。 */
let quoteSeq=0;
async function doQuote(){
 const {pick}=solve();
 if(!pick)return;
 /* —— 出发前冻结 —— */
 const snap={
  requestId:'q'+(++quoteSeq),
  ctxVersion:S.ctx&&S.ctx.ctxVersion,
  storeCode:S.ctx&&S.ctx.storeCode,
  signature:cartSignature(),
  items:pick.items.map(x=>({productCode:x.it.code,quantity:x.qty,
   modification:x.spec&&x.spec.values?{values:x.spec.values}:undefined}))
 };
 S.quotePending=snap.requestId;
 try{
  const j=await api('/api/price',{items:snap.items,ctxVersion:snap.ctxVersion,cartSignature:snap.signature});
  /* —— 回来后核对：期间任何改动都会让签名或版本对不上 —— */
  const sameCtx=S.ctx&&S.ctx.ctxVersion===snap.ctxVersion&&S.ctx.storeCode===snap.storeCode;
  const sameCart=cartSignature()===snap.signature;
  if(!sameCtx||!sameCart){
   /* 旧响应绝不落到当前购物车上：丢弃并提示 */
   toast('购物车或门店已变化，刚才的报价已丢弃，请重新算价');
   S.quotePending=null;
   render();
   return;
  }
  if(j.quote&&j.quote.cartSignature&&j.quote.cartSignature!==snap.signature){
   toast('报价与当前餐单不匹配，已丢弃');
   S.quotePending=null;render();return;
  }
  S.quote={...j.quote,signature:snap.signature,requestId:snap.requestId};
  S.quotePending=null;
  toast('官方报价已更新');
  render();
 }catch(e){
  S.quotePending=null;
  toast('算价失败：'+e.message);
  render();
 }
}
function chg(code,delta){
 const {pick}=solve();
 if(!pick)return;
 const x=pick.items.find(i=>i.it.code===code);if(!x)return;
 const next=Math.max(1,x.qty+delta);
 S.qOverride[code]=next;
 render();
}
/* 导出/复制与页面显示使用同一份不可变餐单快照。
   P1-03：旧实现在报价已 stale 时仍把旧金额写成"官方报价合计"，
   并且完全没有序列化规格。现在：
   - 失效报价绝不作为当前合计，只标"待重新算价"
   - 每行都带编码、数量与所选规格
   - 带上门店、渠道、报价时间与状态 */
function cartSnapshot(){
 const {pick}=solve();
 if(!pick)return null;
 const sig=cartSignature();
 const stale=!!(S.quote&&(S.quote.signature!==sig||
   (S.ctx&&S.quote.ctxVersion!==S.ctx.ctxVersion)));
 return {
  storeName:(S.ctx&&S.ctx.storeName)||'（未选择门店）',
  storeCode:(S.ctx&&S.ctx.storeCode)||null,
  channel:(S.ctx&&S.ctx.beType===5?'得来速':'到店自提'),
  reservationDate:(S.ctx&&S.ctx.reservationDate)||null,
  ctxVersion:S.ctx&&S.ctx.ctxVersion,
  items:pick.items.map(x=>({code:x.it.code,name:x.it.name,qty:x.qty,
   priceMinor:x.it.priceMinor,subtotalMinor:x.it.priceMinor*x.qty,
   spec:x.spec?specText(x.spec):null})),
  quote:S.quote?{price:S.quote.price,quotedAt:S.quote.quotedAt,valid:!stale}:null,
  signature:sig,stale
 };
}
function specText(spec){
 if(!spec||!spec.values||!spec.values.length)return null;
 const names=(S.menu&&S.menu.specNames)||{};
 const parts=spec.values.map(v=>{
  const label=names[v.code]||v.code;
  return v.quantity>0?(label+'×'+v.quantity):(label+'（未选）');
 });
 return parts.join('、');
}
function cartText(){
 const s=cartSnapshot();if(!s)return '';
 const L=['【麦麦选餐 · 真实门店】',
  '门店：'+s.storeName+(s.storeCode?('（'+s.storeCode+'）'):''),
  '就餐方式：'+s.channel+(s.reservationDate?('　时段：'+s.reservationDate):''),
  '上下文版本：v'+s.ctxVersion,''];
 for(const it of s.items){
  L.push('· '+it.name+'（'+it.code+'）×'+it.qty+'　'+yuan(it.subtotalMinor));
  L.push('    规格：'+(it.spec||'未选/该商品无规格'));
 }
 L.push('');
 if(!s.quote){
  L.push('金额：尚未调用官方算价');
 }else if(s.quote.valid){
  L.push('官方报价合计：'+yuan(s.quote.price)+'（报价时间 '+s.quote.quotedAt+'）');
 }else{
  L.push('⚠ 官方报价已于 '+s.quote.quotedAt+' 过期（餐单或门店已变更）');
  L.push('  该金额不是当前餐单的价格，**待重新算价**。');
 }
 L.push('','营养与过敏原：官方接口未返回，标为未知。');
 L.push('餐单签名：'+s.signature);
 return L.join('\n');
}
async function copyCart(){
 const txt=cartText();
 if(!txt){toast('没有可复制的餐单');return;}
 try{await navigator.clipboard.writeText(txt);toast('餐单已复制到剪贴板');}
 catch(e){const ta=el('textarea');ta.value=txt;document.body.append(ta);ta.select();
  try{document.execCommand('copy');toast('餐单已复制');}catch(_){toast('复制失败，请手动选择文本');}
  ta.remove();}
}

/* ---------- 规格 ---------- */
function openSpec(item){
 S.specItem=item;
 const dlg=$('#specDlg');
 /* 弹层可能已经开着（例如用户直接点另一行的"规格"）。
    showModal() 对已打开的 dialog 会抛 InvalidStateError，
    且旧内容会挡在前面让点击落到错误元素上。这里先关再开。 */
 if(dlg.open)dlg.close();
 /* 请求序号守卫：详情是异步的。若用户连续点不同餐品的"规格"，
    先发的请求可能后到，届时会把已关闭的弹层重新弹出并显示错误餐品的规格。
    这里只接受最后一次请求的结果。 */
 const seq=++S.specSeq;
 $('#specTitle').textContent=item.name+' · 规格';
 const body=$('#specBody');body.replaceChildren();
 /* 请求返回前先清掉上一次的说明，避免新请求还在飞时读到上一个商品的文案 */
 $('#specMsg').textContent='正在查询该餐品的规格…';
 $('#confirm-spec').disabled=true;/* 查询期间禁止确认，避免提交未返回的规格 */
 S.specSel={};
 api('/api/detail',{code:item.code}).then(j=>{
  if(seq!==S.specSeq)return;/* 已有更新的请求，丢弃本次结果 */
  const openDlg=()=>{ if(!dlg.open)dlg.showModal(); };
  if(!j.modificationGroups||!j.modificationGroups.length){
   $('#specMsg').textContent='该餐品无规格可选（官方返回 supportModify='+j.supportModify+'）。';
   $('#specBody').append(el('p','unknown','营养/过敏原：接口未返回，标为未知。'));
   openDlg();return;
  }
  j.modificationGroups.forEach((g,gi)=>{
   g.values.forEach(v=>{
    const row=el('div','row-item');
    const info=el('div','info');
    info.append(el('strong','',v.name));
    info.append(el('p','',(v.priceMinor?('加价 '+yuan(v.priceMinor)):'无加价')+
     '　可加 '+(v.minQuantity)+'–'+(v.maxQuantity)+' 份'));
    const q=el('div','qty');
    const mi=el('button','','−'),pl=el('button','','+');
    const n=el('span','n',String(v.selectedQuantity||0));
    S.specSel[v.code]={v,g,gi,n};
    mi.onclick=()=>{const s=S.specSel[v.code];s.count=Math.max(v.minQuantity,(s.count||0)-1);n.textContent=s.count;};
    pl.onclick=()=>{const s=S.specSel[v.code];s.count=Math.min(v.maxQuantity,(s.count||0)+1);n.textContent=s.count;};
    S.specSel[v.code].count=v.selectedQuantity||0;
    q.append(mi,n,pl);
    row.append(info,q);
    body.append(row);
   });
  });
  $('#specBody').append(el('p','hint','未勾选的规格项若存在 unselectedKey，提交时也需按官方规则传入。'));
  $('#specMsg').textContent='';
  openDlg();
  $('#confirm-spec').disabled=false;
 }).catch(e=>{
  if(seq!==S.specSeq)return;
  $('#specBody').replaceChildren();
  const x=el('div','err');x.append(el('b','','规格查询失败：'+e.message));
  $('#specBody').append(x);
  openDlg();
 });
}
function doConfirmSpec(){
 const values=[];
 for(const code in S.specSel){
  const s=S.specSel[code];
  const key=(s.count>0)?s.v.selectedKey:s.v.unselectedKey;
  if(key)values.push({code,key,quantity:s.count||0});
 }
 /* 签名必须包含"该商品已被确认过规格"这一事实。
    只用 values 序列化是不够的：所有规格数量都是 0 时，
    values 与"从未打开过规格弹层"完全相同，签名不变，
    于是改了规格却不会把旧报价标为待重算——用户会拿旧金额下单。
    这里带上商品编码与规格组键，保证任何一次确认都产生新签名。 */
 const sig=JSON.stringify({code:S.specItem.code,vals:values,
  groups:Object.keys(S.specSel).sort()});
 const {pick}=solve();
 if(pick)S.specMap[S.specItem.code]={values,sig};
 $('#specDlg').close();
 toast('规格已更新，报价需重新核算');
 render();
}
boot();
/* ---------- 替换单品：同角色内换成该门店其他真实可售商品 ---------- */
function openSwap(item){
 const box=$('#swapDlg');
 $('#swapTitle').textContent='把「'+item.name+'」换成';
 const body=$('#swapBody');body.replaceChildren();
 const role=item._role||guessRole(item);
 /* P1-02 数量必须来自"当前餐单"，而不是菜单条目或 undefined。
    旧实现用 item.qty（菜单对象上没有这个字段）→ qty 为 undefined。 */
 const curQty=(()=>{const {pick}=solve();
  const x=pick&&pick.items.find(i=>i.it.code===item.code);
  return x&&Number.isInteger(x.qty)&&x.qty>=1?x.qty:1;})();
 const cands=(S.menu.items||[]).filter(x=>x.code!==item.code&&x.priceMinor>0&&guessRole(x)===role);
 if(!cands.length){
  body.append(el('p','muted','该角色下没有其他可售商品可换。'));
  $('#swapDlg').showModal();return;
 }
 for(const x of cands.slice(0,12)){
  const b=el('button','store');
  b.type='button';
  b.append(el('strong','',x.name));
  b.append(el('div','meta','单价 '+yuan(x.priceMinor)+'　编码 '+x.code));
  b.onclick=()=>{
   /* 数量沿用当前餐单的正整数，不允许 undefined */
   const qty=curQty;
   S.lockedComb=(S.lockedComb||[]).map(z=>z.code===item.code?{code:x.code,qty}:z);
   delete S.qOverride[item.code];
   S.qOverride[x.code]=qty;
   /* 旧规格只属于旧商品：必须丢弃，不能把 A_SAUCE 塞给只有 B_CHEESE 的 B。
      新商品的规格要在打开规格面板时按新详情重新确认。 */
   delete S.specMap[x.code];
   delete S.specMap[item.code];
   S.quote=null;
   $('#swapDlg').close();
   toast('已替换为 '+x.name+'（'+qty+' 份），规格需重新确认，报价需重新核算');
   render();
   /* 换商品后按新详情重新校验规格 */
   setTimeout(()=>openSpec(x),120);
  };
  body.append(b);
 }
 $('#swapDlg').showModal();
}
function guessRole(item){
 const n=item.name||'';
 if(/堡|卷/.test(n))return 'main';
 if(/薯条|鸡块|鸡翅|派|蛋挞|奥利奥|冰淇淋|苹果片|玉米杯/.test(n))return 'side';
 if(/茶|可乐|雪碧|橙汁|奶昔|咖啡|豆浆|纯悦|气泡/.test(n))return 'drink';
 return 'other';
}

/* ---------- 经典自主选餐 ----------
   不走八步向导：直接从该门店真实可售菜单里按分类挑选。
   数据来源与向导完全相同（同一份官方菜单），不引入任何演示商品。
   营养与过敏原仍标未知——接口没有返回。 */
function openClassic(){
 if(!S.menu){toast('请先选择门店并加载菜单');openStore();return;}
 S.mode3='classic';
 document.body.classList.add('classic');
 render();
}
function exitClassic(){
 S.mode3=null;
 document.body.classList.remove('classic');
 render();
}
function classicAdd(code){
 S.qOverride[code]=Math.max(0,(S.qOverride[code]||0)+1);
 if(!S.qOverride[code])delete S.qOverride[code];
 S.quote=null;/* 数量变了，旧报价失效 */
 render();
}
function classicCat(name){
 return (S.menu.categories||[]).find(c=>c.name===name);
}
function classicRender(){
 const m=$('#app');m.replaceChildren();
 m.append(sourceCard());
 const bar=el('div','src');
 bar.append(el('b','','经典自主选餐'));
 bar.append(el('div','t','直接浏览该门店当前实际可售的商品，自由挑选；数据同样来自官方接口。'));
 const back=el('button','ghost','返回八步向导');back.onclick=exitClassic;
 bar.append(back);
 m.append(bar);
 const picked=(S.menu.items||[]).filter(i=>S.qOverride[i.code]>0);
 if(picked.length){
  const box=el('div','step');
  box.append(el('h3','','已选（'+picked.length+' 种）'));
  for(const it of picked){
   const r=el('div','row-item');
   const info=el('div','info');
   info.append(el('strong','',it.name+' ×'+S.qOverride[it.code]));
   info.append(el('p','','单价 '+yuan(it.priceMinor)));
   info.append(el('span','unknown','营养/过敏原：未知'));
   const q=el('div','qty');
   const mi=el('button','','−'),pl=el('button','','+');
   mi.onclick=()=>classicAdd(it.code,-1);
   pl.onclick=()=>classicAdd(it.code,1);
   const sp=el('button','ghost','规格');sp.onclick=()=>openSpec(it);
   q.append(mi,el('span','n',String(S.qOverride[it.code])),pl,sp);
   r.append(info,el('div','price',yuan(it.priceMinor*S.qOverride[it.code])),q);
   box.append(r);
  }
  const total=picked.reduce((a,i)=>a+i.priceMinor*S.qOverride[i.code],0);
  box.append(el('div','sum big','本地合计 '+yuan(total)+'（未经官方算价）'));
  const pq=el('button','cta','用官方接口算价');
  pq.onclick=()=>doClassicQuote(picked);
  box.append(pq);
  const cp=el('button','ghost','复制餐单');cp.onclick=()=>copyCart();
  box.append(cp);
  if(S.quote){const st=classicStale();const f=el('div','foot');
   const line=el('div','l');
   line.append(el('span','',st?'官方报价（已过期）':'官方报价'),el('span','t',yuan(S.quote.price)));
   f.append(line);
   f.append(el('div','d','报价时间 '+S.quote.quotedAt));
   if(st){const w=el('div','stale');w.append(el('b','','报价已过期'),document.createTextNode('：餐单已变更，请重新算价。'));
    const b=el('button','cta','重新算价');b.onclick=()=>doClassicQuote(picked);w.append(b);f.append(w);}
   box.append(f);}
  m.append(box);
 }
 for(const c of (S.menu.categories||[])){
  const sec=el('div','step');
  sec.append(el('h3','',c.name));
  const items=(c.meals||[]).map(code=>(S.menu.items||[]).find(x=>x.code===code)).filter(Boolean);
  for(const it of items){
   const r=el('div','row-item');
   const info=el('div','info');
   info.append(el('strong','',it.name));
   info.append(el('p','','单价 '+yuan(it.priceMinor)+'　编码 '+it.code));
   info.append(el('span','unknown','营养/过敏原：未知'));
   const plus=el('button','cta','加入');
   plus.onclick=()=>classicAdd(it.code,1);
   const cnt=S.qOverride[it.code]?el('span','unknown','已选 '+S.qOverride[it.code]+' 份'):null;
   r.append(info,plus);
   if(cnt)r.append(cnt);
   sec.append(r);
  }
  if(items.length)m.append(sec);
 }
}
function classicStale(){
 if(!S.quote)return true;
 return S.quote.signature!==classicSignature()||
  (S.ctx&&S.quote.ctxVersion!==S.ctx.ctxVersion);
}
function classicSignature(){
 return JSON.stringify({ctx:S.ctx?S.ctx.ctxVersion:0,
  items:Object.keys(S.qOverride).filter(k=>S.qOverride[k]>0).sort()
   .map(k=>[k,S.qOverride[k],S.specMap[k]?S.specMap[k].sig:null])});
}
async function doClassicQuote(picked){
 const items=picked.map(i=>({productCode:i.code,quantity:S.qOverride[i.code],
  modification:S.specMap[i.code]&&S.specMap[i.code].values?{values:S.specMap[i.code].values}:undefined}));
 const snap={requestId:'cq'+(++quoteSeq),ctxVersion:S.ctx&&S.ctx.ctxVersion,
  storeCode:S.ctx&&S.ctx.storeCode,signature:classicSignature(),items};
 S.quotePending=snap.requestId;
 try{
  const j=await api('/api/price',{items:snap.items,ctxVersion:snap.ctxVersion,cartSignature:snap.signature});
  if(snap.signature!==classicSignature()||snap.ctxVersion!==(S.ctx&&S.ctx.ctxVersion)){
   toast('餐单已变化，刚才的报价已丢弃');S.quotePending=null;render();return;}
  S.quote={...j.quote,signature:snap.signature,requestId:snap.requestId};
  S.quotePending=null;toast('官方报价已更新');render();
 }catch(e){S.quotePending=null;toast('算价失败：'+e.message);render();}
}
