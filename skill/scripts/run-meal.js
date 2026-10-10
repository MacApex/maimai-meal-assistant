#!/usr/bin/env node
/* 选餐助手 CLI：与 HTML 共用同一份领域逻辑（wizard-domain / meal-engine / domain），
   不存在两套算法，因此不会出现"Skill 和页面规则不一致"。

用法：
   node run-meal.js start                     查看八道问题与当前进度
   node run-meal.js answer <题号> <值>        回答某一题（1–8）
   node run-meal.js decide <题号>             该题"帮我决定"
   node run-meal.js state                     打印会话状态
   node run-meal.js suggest                   第 5 题的两个可行方向
   node run-meal.js result                    生成整餐（八题齐了才有结果）
   node run-meal.js plan3 | plan5             多顿轮换
   node run-meal.js savings                   省钱方案状态（未接真实时如实说明）
   node run-meal.js demo                      一次跑通八题并打印结果

会话文件默认在 ./.maimai-session.json，可用 SESSION_FILE 环境变量指定。
演示目录为虚构数据；未接入官方 MCP 时不会声称使用真实价格或优惠。
*/
'use strict';
const fs=require('fs'),path=require('path');
const W=require('./wizard-domain.js'),E=require('./meal-engine.js'),C=require('./demo-data.js'),D=require('./domain.js');
E.setCatalog(C.products);
const SESSION=process.env.SESSION_FILE||path.resolve(process.cwd(),'.maimai-session.json');

function load(){try{return JSON.parse(fs.readFileSync(SESSION,'utf8'));}catch(e){return null;}}
function save(s){fs.writeFileSync(SESSION,JSON.stringify(s,null,2));}
function newState(){
 const s=D.initialState();s.external={...W.emptyExternal(),confirmed:false};
 return {wizard:W.createSession(),state:s,consent:W.emptyConsent()};
}
function need(){const s=load();if(!s){console.error('还没有会话。先运行：node run-meal.js start');process.exit(1);}return s;}

const money=m=>m===null||m===undefined?'待核实':'¥'+(m/100).toFixed(m%100?2:0);

function sync(s){
 const w=s.wizard,a=(i)=>w.answers[i]&&w.answers[i].value;
 if(Number.isInteger(a(0)))s.state.constraints.people=a(0);
 const b=a(1);if(b)s.state.constraints.budget=b.mode==='none'?{mode:'total',minor:null}:{mode:b.mode,minor:b.minor};
 const e=a(2);if(e)s.state.external=e;
 const d=a(4);if(d&&d.optionIds)s.state.direction=d;
}

function cmdStart(){
 const s=newState();save(s);
 console.log('更懂你的麦麦选餐助手 · 八道问题\n');
 W.STEPS.forEach(st=>console.log(`  第 ${st.n} 题  ${st.title}　（${st.hint}）`));
 console.log('\n八题全部回答后才会生成整餐。');
 console.log('示例：node run-meal.js answer 1 2');
}
function cmdAnswer(n,val){
 const s=need();const i=Number(n)-1;
 if(i<0||i>7){console.error('题号必须是 1–8');process.exit(1);}
 const parsed=parseAnswer(i,val);
 s.wizard=W.answer(s.wizard,i,parsed);
 sync(s);save(s);
 const a=s.wizard.answers[i];
 console.log(`第 ${i+1} 题已记录：${JSON.stringify(a.value)}`);
 console.log(`进度：${W.answeredCount(s.wizard)}/8，下一题 ${Math.min(8,s.wizard.step)}`);
 if(!W.gateOpen(s.wizard))console.log('（八题答完才生成整餐，可继续下一题）');
}
function parseAnswer(i,val){
 if(i===0)return Math.max(1,Math.min(12,parseInt(val,10)||1));
 /* 预算格式：total/80＝整餐 80 元；person/30＝每人 30 元；none＝不设上限 */
 if(i===1){const v=String(val).trim();
  if(v==='none')return {mode:'none',minor:null};
  const m=v.match(/^(total|person|total|每餐|整餐|每人)?[\/:]?(\d+)$/i);
  if(!m){console.error('格式：total/80（整餐 80 元）、person/30（每人 30 元）或 none');process.exit(1);}
  const mode=(m[1]||'total').toLowerCase()==='person'||m[1]==='每人'?'person':'total';
  return {mode,minor:Number(m[2])*100};}
 if(i===2){const m=String(val).match(/^(coffee|otherDrink|main|side)=(\d+)$/);
  if(!m){console.error('格式：coffee=1 或 main=2 等');process.exit(1);}
  return {...W.emptyExternal(),[m[1]]:Number(m[2]),confirmed:true};}
 if(i===3)return {words:String(val).split(/[,，、\s]+/).filter(Boolean)};
 if(i===4)return String(val)==='any'?null:{id:String(val),label:String(val),role:'main',optionIds:C.products.filter(p=>p.family===String(val)).map(p=>p.id)};
 if(i===5)return {mode:String(val),familiar:[]};
 if(i===6)return {length:[1,3,5].includes(Number(val))?Number(val):1};
 if(i===7)return {consent:{...W.emptyConsent(),saveExplicitTaste:String(val)==='taste'}};
 return val;
}
function cmdDecide(n){
 const s=need();const i=Number(n)-1;
 const defaults={0:1,1:{mode:'none',minor:null},2:{...W.emptyExternal(),confirmed:true},3:{words:[]},
  4:null,5:{mode:'balance',familiar:[]},6:{length:1},7:{consent:W.emptyConsent()}};
 s.wizard=W.decide(s.wizard,i,defaults[i]);
 sync(s);save(s);
 console.log(`第 ${i+1} 题按"${s.wizard.answers[i].reason||'帮我决定'}"记录。`);
 console.log(`进度：${W.answeredCount(s.wizard)}/8。只回答了这一题，下一题 ${Math.min(8,s.wizard.step)}。`);
}
function cmdState(){
 const s=need();
 console.log(`当前第 ${s.wizard.step} 题，已答 ${W.answeredCount(s.wizard)}/8，完成：${s.wizard.completed}`);
 s.wizard.answers.forEach((a,i)=>console.log(`  ${i+1}. ${W.STEPS[i].title}　${a.status==='unanswered'?'（未答）':JSON.stringify(a.value)}`));
}
function cmdSuggest(){
 const s=need();sync(s);
 const people=s.state.constraints.people;
 if(!people){console.error('先回答第 1 题人数。');process.exit(1);}
 const d=W.buildDirections(C.products,{...s.state,coverage:{}},E.targets(people,'regular'),
  p=>E.allowed(p,E.personIds(people),s.state));
 if(d.status==='noGap'){console.log('这顿已经够了，不用再加，也就不需要再问方向。');return;}
 if(d.status==='single'){console.log('只有一个可行方向，不硬造第二个：'+d.directions[0].label);return;}
 if(d.status==='none'){console.log('当前条件下没有可行方向，请调整人数、预算或忌口。');return;}
 console.log('两个真实可行的方向：');
 d.directions.forEach(x=>console.log(`  ${x.id}（${x.label}）　${x.productCount} 款可选`));
 console.log('回答方式：node run-meal.js answer 5 burger   或   answer 5 any');
}
function options(s){
 const tasteAns=s.wizard.answers[3].value;
 const taste=tasteAns?{...W.buildTaste(tasteAns.words,'explicit'),sourceLabel:'按本次选的'+(tasteAns.words||[]).join('、')}:null;
 const n=s.wizard.answers[5].value;
 const d=s.wizard.answers[4].value;
 return {taste,novelty:n?{mode:n.mode,familiarUnitIds:n.familiar||[],maxChangedUnits:1}:null,direction:d&&d.optionIds?d:null};
}
function cmdResult(){
 const s=need();
 if(!W.gateOpen(s.wizard)){console.error(`八题还没答完（${W.answeredCount(s.wizard)}/8），不生成整餐。`);process.exit(1);}
 sync(s);
 const r=E.buildMeal(s.state,C.products,options(s));
 printMeal(r,s);
}
function printMeal(r,s){
 E.setCatalog(C.products);
 const {fixed,suggested}=E.splitParts(r,s.state);
 if(r.conflicts.length){console.log('这次没能配出可行方案：');r.conflicts.forEach(c=>console.log('  · '+c));
  console.log('\n可以调整预算、取消部分保留或更改人数。没有静默删减任何内容。');return;}
 console.log('这一餐，帮你搭好了。\n');
 if(fixed.length){console.log('餐单已选：');fixed.forEach(p=>console.log(`  ${p.name} ×${p.quantity}`));}
 const ext=s.state.external||W.emptyExternal();
 const msg=W.buildExternalMessage(r.coverage,r.targets,{},ext);
 if(msg.length)console.log('\n外部已有：'+msg.join('；'));
 console.log('\n'+(suggested.length?'建议新增：':'无需再添'));
 suggested.forEach(p=>console.log(`  ${p.name} ×${p.quantity}${p.assignedTo.length?'　第 '+p.assignedTo.map(x=>x.slice(1)).join('、')+' 人':''}　${money(p.price.minor*p.quantity)}`));
 console.log(`\n合计：${money(r.total?r.total.minor:null)}　（演示数据，非官方实时价）`);
 console.log('预算状态：'+({within:'在上限内',pending:'待核实',unset:'未设上限'}[r.budgetStatus]||r.budgetStatus));
 console.log('\n为什么这么搭：');
 r.reasons.forEach(x=>console.log('  · '+x));
}
function cmdPlan(n){
 const s=need();
 if(!W.gateOpen(s.wizard)){console.error('八题还没答完，不生成计划。');process.exit(1);}
 sync(s);
 const opts=options(s);
 /* 工厂必须接收 buildPlan 传入的 {penalize}，否则轮换去重不会生效，各顿会长得一样 */
 const plan=W.buildPlan(C.products,i=>(cat,planOpts)=>E.buildMeal(JSON.parse(JSON.stringify(s.state)),cat,{...opts,...planOpts}),Number(n),null);
 console.log(`${plan.length} 顿轮换　${plan.note}\n`);
 plan.meals.forEach(m=>{
  console.log(`第 ${m.index} 顿：${m.parts.map(p=>p.name+'×'+p.quantity).join('、')||'无需再添'}　${money(m.total?m.total.minor:null)}`);
 });
 if(plan.repeatNotes.length){
  console.log('\n如实标注的重复：');
  [...new Set(plan.repeatNotes.map(x=>x.name))].forEach(nm=>console.log('  · '+nm+'（目录内可选项有限）'));
 }
 console.log('\n每顿使用前会重新核验人数、价格与供应；不会自动下单。');
}
function cmdSavings(){
 console.log('省钱方案状态：notConnected');
 console.log('说明：官方券资格与完整应付成本尚未在本机核验，不比较任何方案。');
 console.log('不会自动领券、凑单或购卡。未接入真实连接前，不用虚构价格冒充省钱成果。');
 console.log('\n接入后需核对：商品金额、配送费、餐具费、其他必付费用与优惠资格；');
 console.log('任何必要费用未知都标"待核实"，不能用 0 补齐后声称已满足。');
}
function cmdDemo(){
 const answers=[['1','2'],['2','total/80'],['3','coffee=1'],['4','香脆,微辣'],['5','any'],['6','swap'],['7','3'],['8','这次就好']];
 cmdStart();
 for(const [n,v] of answers)cmdAnswer(n,v);
 console.log('\n'+'='.repeat(46)+'\n');
 cmdResult();
}
const [cmd,...args]=process.argv.slice(2);
const table={start:cmdStart,answer:()=>cmdAnswer(args[0],args[1]),decide:()=>cmdDecide(args[0]),state:cmdState,
 suggest:cmdSuggest,result:cmdResult,plan3:()=>cmdPlan(3),plan5:()=>cmdPlan(5),savings:cmdSavings,demo:cmdDemo};
if(!table[cmd]){console.error('未知命令：'+(cmd||'(空)'));console.error('可用：start answer decide state suggest result plan3 plan5 savings demo');process.exit(1);}
table[cmd]();