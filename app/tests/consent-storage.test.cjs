/* 同意与存储的真实合同（对着页面实际使用的 memory-store.js）。
   之前的 preferences.test.cjs 测的是页面早已不加载的 preferences.js，
   属于"测死代码"，已替换为本文件。
   本文件同时覆盖 A16：无保存同意时不得有任何持久化写入。
*/
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../memory-store.js');

function fakeStorage(){
 const calls=[];let v=null;
 return {calls,
  getItem:()=>v,
  setItem:(k,x)=>{calls.push(['setItem',k]);v=x;},
  removeItem:k=>{calls.push(['removeItem',k]);v=null;},
  raw:()=>v};
}
const fresh=()=>{const st=fakeStorage();return {st,m:M.createMemoryStore(st)};};

test('空存储：读取不产生任何写入',()=>{
 const {st,m}=fresh();
 m.read();
 assert.deepEqual(st.calls,[],'只读不得触发写入');
});
test('无同意时保存口味不落盘',()=>{
 const {st,m}=fresh();
 m.saveExplicitTaste([{subjectId:'self',dimension:'texture',value:'香脆'}],null);
 assert.deepEqual(st.calls,[],'未授权时不得写入 localStorage');
});
test('有同意时保存口味可写入且可读回',()=>{
 const {st,m}=fresh();
 m.setConsent({saveExplicitTaste:true});
 m.saveExplicitTaste([{subjectId:'self',dimension:'texture',value:'香脆'}],'c1');
 assert.ok(st.calls.some(c=>c[0]==='setItem'),'授权后应写入');
 assert.ok(m.hasSavedTaste(),'写入后应能读到');
 assert.equal(m.savedTasteList().length,1);
});
test('四类同意彼此独立',()=>{
 const {st,m}=fresh();
 m.setConsent({saveExplicitTaste:true});
 m.saveExplicitTaste([{subjectId:'self',dimension:'texture',value:'香脆'}],'c1');
 m.saveFinalSelection({names:['鸡腿堡'],items:[{id:'crispy',quantity:1,specs:{}}]},null);
 assert.equal(m.hasSavedSelections(),false,'未授权保存选餐时不得写入选餐记录');
 assert.equal(m.hasSavedTaste(),true,'已授权的口味仍应保留');
});
test('关闭记忆后写入接口必须被拒绝',()=>{
 const {st,m}=fresh();
 m.setConsent({saveExplicitTaste:true});
 m.saveExplicitTaste([{subjectId:'self',dimension:'texture',value:'香脆'}],'c1');
 m.setMemoryEnabled(false);
 const before=st.calls.length;
 m.saveExplicitTaste([{subjectId:'self',dimension:'texture',value:'香脆'}],'c1');
 assert.equal(st.calls.length,before,'关闭记忆后不得再写入');
});
test('A16：未确认吃过时不得记录反馈',()=>{
 const {st,m}=fresh();
 m.setConsent({saveFeedback:true});
 const before=st.calls.length;
 const r=m.saveFeedback({unitId:'u1',kind:'good',eatenConfirmation:false},'c1');
 assert.equal(r.persisted,false);
 assert.equal(st.calls.length,before,'未确认吃过时不得新增写入');
});
test('A16：已吃过但未授权保存时，只用于本次，不落盘',()=>{
 const {st,m}=fresh();
 const before=st.calls.length;
 const r=m.saveFeedback({unitId:'u1',kind:'good',eatenConfirmation:true},null);
 assert.equal(st.calls.length,before,'无反馈保存同意时 setItem 调用必须为 0 次，实际 '+st.calls.length+' 次');
 assert.notEqual(r.persisted,true,'不得声称已保存');
});
test('A16：授权后反馈可写入、可读、可删',()=>{
 const {st,m}=fresh();
 m.setConsent({saveFeedback:true});
 const r=m.saveFeedback({unitId:'u1',kind:'good',eatenConfirmation:true},'c1');
 assert.equal(r.persisted,true);
 assert.ok(st.calls.some(c=>c[0]==='setItem'));
 m.deleteFeedback('u1');
});
test('删除口味后不得再被读到',()=>{
 const {m}=fresh();
 m.setConsent({saveExplicitTaste:true});
 m.saveExplicitTaste([{subjectId:'self',dimension:'texture',value:'香脆'}],'c1');
 assert.equal(m.savedTasteList().length,1);
 const saved=m.savedTasteList()[0];
 m.deleteTaste(saved.id);
 assert.equal(m.savedTasteList().length,0);
});
test('clearAll 必须真正清空；失败时如实返回失败',()=>{
 const {m}=fresh();
 m.setConsent({saveExplicitTaste:true});
 m.saveExplicitTaste([{subjectId:'self',dimension:'texture',value:'香脆'}],'c1');
 m.clearAll();
 assert.equal(m.hasSavedTaste(),false);
 /* 存储抛错时必须报失败，不能仍提示"已清除" */
 const blocked=M.createMemoryStore({getItem(){throw Error('blocked');},
  setItem(){throw Error('blocked');},removeItem(){throw Error('blocked');}});
 const r=blocked.clearAll();
 assert.equal(r.persisted,false,'存储不可用时 clearAll 必须报失败');
});
test('存储被拒时各写入接口不得抛异常',()=>{
 const blocked=M.createMemoryStore({getItem(){throw Error('blocked');},
  setItem(){throw Error('blocked');},removeItem(){throw Error('blocked');}});
 blocked.setConsent({saveExplicitTaste:true});
 for(const fn of ['saveExplicitTaste','saveFinalSelection','saveFeedback','saveRotation']){
  const args=fn==='saveFeedback'?[{unitId:'u',kind:'good',eatenConfirmation:true},'c1']
   :fn==='saveFinalSelection'?[{names:[],items:[]},'c1']
   :fn==='saveRotation'?[{meals:[]},'c1']:[{words:[]},'c1'];
  assert.doesNotThrow(()=>blocked[fn](...args),fn+' 在存储不可用时不得抛异常');
 }
});
test('获准历史只返回选餐记录，且带 consent 标记',()=>{
 const {m}=fresh();
 m.setConsent({useSavedSelections:true,saveFinalSelection:true});
 m.saveFinalSelection({names:['鸡腿堡'],items:[{id:'crispy',quantity:1,specs:{}}]},'c1');
 const h=m.usableHistory({useSavedSelections:true});
 assert.ok(Array.isArray(h));
 for(const x of h)assert.equal(x.kind,'selection','历史只能是选餐记录，不能是订单');
 assert.ok(h.every(x=>x.consent===true),'历史必须带同意标记');
});
test('未授权时 usableHistory 必须为空',()=>{
 const {m}=fresh();
 m.setConsent({useSavedSelections:false,saveFinalSelection:true});
 m.saveFinalSelection({names:['鸡腿堡'],items:[{id:'crispy',quantity:1,specs:{}}]},'c1');
 assert.deepEqual(m.usableHistory({useSavedSelections:false}),[]);
});