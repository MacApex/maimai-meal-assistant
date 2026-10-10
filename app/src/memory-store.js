(function(root){
'use strict';
/* C4 经同意的记忆存储。
   四类同意彼此独立：useSavedTaste / useSavedSelections / saveExplicitTaste / saveFinalSelection / saveRotationPlan。
   每条偏好都带来源(subjectId / dimension / value / source / consentId)，归属不明的多人共用答案不写入本人。
   存储失败必须如实返回失败，不允许显示成功。本地存储不暗示云同步。 */
const SCHEMA=2,KEY='maimai.memory.v2',LEGACY_KEY='maimai.preferences.v1';

function emptyStore(){return {schema:SCHEMA,consent:null,tastes:[],selections:[],rotations:[],feedback:[],migratedFrom:null};}

/* 旧结构（单值 taste / recent 名称串）只能按已有证据迁移：旧 recent 不证明吃过，不迁移为熟悉款。 */
function migrateLegacy(raw){
 const store=emptyStore();if(!raw)return store;
 try{
  const old=JSON.parse(raw);
  if(!old||old.enabled!==true)return store;
  store.migratedFrom=LEGACY_KEY;
  for(const item of old.items||[]){
   if(item?.id==='taste'&&typeof item.value==='string'){
    /* 旧值只是单一口感词，只能迁移为 texture 一维，且标记为旧结构迁移、来源不明 */
    store.tastes.push({id:'legacy-'+store.tastes.length,subjectId:'self',dimension:'texture',value:item.value,
     source:'legacyMigration',consentId:null,confirmedAt:null,
     caveat:'由旧版单值口味迁移，只覆盖口感一维，不代表辣度或油腻感。'});
   }
   /* 旧 recent 是“明确保存的近期选择”，不是订单也不是食用记录；不迁移为熟悉款 */
   if(item?.id==='recent'&&typeof item.value==='string'){
    store.selections.push({id:'legacy-recent',names:item.value.split('、'),source:'legacyMigration',consentId:null,
     caveat:'旧版保存的近期选择记录，不是订单，也不证明吃过。'});
   }
  }
 }catch(e){/*旧数据损坏时不迁移，也不阻断使用*/}
 return store;
}

function createMemoryStore(storage){
 let data=migrateLegacy(null),blocked=false,loadFailed=false;
 const read=()=>{try{return storage.getItem(KEY);}catch(e){return null;}};
 try{
  const raw=read();
  if(raw){const parsed=JSON.parse(raw);if(parsed&&parsed.schema===SCHEMA)data=parsed;else data=migrateLegacy(raw);}
  else{const legacy=read(LEGACY_KEY);if(legacy)data=migrateLegacy(legacy);}
 }catch(e){loadFailed=true;data=migrateLegacy(null);}
function write(){
 /* 记忆被关闭时，存储层必须直接拒绝写入。
    旧实现只在 UI 层判断，setMemoryEnabled(false) 之后 saveXxx 仍会落盘。 */
 if(blocked)return {persisted:false,reason:'memoryDisabled',message:'记忆已关闭，这次只在本次使用，没有保存。'};
 try{storage.setItem(KEY,JSON.stringify(data));return {persisted:true};}
 catch(e){return {persisted:false,reason:'storageError',message:'这次已用上，没能保存到下次。'};}
 }
 function stamp(){return new Date().toISOString();}

 return {
  /* 读取；返回 consent 与各类条目，供第 8 题展示确切条目 */
  read(){return JSON.parse(JSON.stringify({...data,blocked,loadFailed,persisted:!loadFailed}));},
  hasSavedTaste(){return data.tastes.length>0;},
  hasSavedSelections(){return data.selections.length>0;},
  savedTasteList(){return data.tastes.map(t=>({...t,label:tasteLabel(t)}));},
  savedSelectionList(){return data.selections.map(s=>({...s}));},
  /* 合并同意范围；四类各自独立，不捆绑 */
  setConsent(consent){
   data.consent={useSavedTaste:consent.useSavedTaste===true,useSavedSelections:consent.useSavedSelections===true,
    saveExplicitTaste:consent.saveExplicitTaste===true,saveFinalSelection:consent.saveFinalSelection===true,
    saveRotationPlan:consent.saveRotationPlan===true,at:stamp()};
   blocked=false;return write();
  },
  currentConsent(){return data.consent||{useSavedTaste:false,useSavedSelections:false,saveExplicitTaste:false,saveFinalSelection:false,saveRotationPlan:false};},
  /* 只保存用户明确归属到本人的口味条目。没有本人归属时不保存，不自动归本人。 */
  saveExplicitTaste(entries,consentId){
   if(!consentId)return {persisted:false,reason:'noConsent',message:'没有保存同意，未写入任何口味。'};
   /* 入参形状不对时直接返回，不得抛异常把界面打断 */
   if(!Array.isArray(entries))return {persisted:false,reason:'badInput',message:'这次没有可保存的口味。'};
   const clean=entries.filter(e=>e&&e.subjectId==='self'&&e.dimension&&e.value);
   if(!clean.length)return {persisted:false,reason:'nothingToSave',message:'没有归属到你本人的明确口味，未保存。'};
   data.tastes=data.tastes.filter(t=>!(t.subjectId==='self'&&t.dimension===clean[0].dimension&&t.value===clean[0].value));
   for(const e of clean)data.tastes.push({id:'t-'+stamp()+'-'+data.tastes.length,subjectId:'self',dimension:e.dimension,value:e.value,
    source:'explicitThisMeal',consentId,confirmedAt:stamp()});
   return write();
  },
  /* 保存最终选餐记录只能发生在实际选定方案之后，不能保存尚未生成或仅浏览的候选 */
  saveFinalSelection(selection,consentId){
   if(!consentId)return {persisted:false,reason:'noConsent',message:'没有保存同意，未写入选餐记录。'};
   if(!selection||!Array.isArray(selection.items)||!selection.items.length)
    return {persisted:false,reason:'notChosen',message:'还没有实际选定的方案，未保存。'};
   data.selections.push({id:'sel-'+stamp()+'-'+data.selections.length,
    names:selection.items.map(i=>i.name),items:selection.items,totalMinor:selection.totalMinor??null,
    source:'finalSelection',consentId,at:stamp()});
   return write();
  },
  /* 轮换计划保存需独立同意，不因选了 3/5 顿就自动保存 */
  saveRotation(plan,consentId){
   if(!consentId)return {persisted:false,reason:'noConsent',message:'轮换计划未获同意，未保存。'};
   if(!plan||!plan.meals||!plan.meals.length)return {persisted:false,reason:'empty'};
   data.rotations.push({id:'rot-'+stamp()+'-'+data.rotations.length,length:plan.length,
    meals:plan.meals.map(m=>({index:m.index,names:(m.parts||[]).map(p=>p.name)})),
    source:'rotationPlan',consentId,at:stamp()});
   return write();
  },
  /* 真实吃后反馈：必须已确认吃过，且必须有独立的反馈保存同意。
     A16：曾只检查 eatenConfirmation，导致用户拒绝保存时反馈仍写进 localStorage。
     现在 consentId 为空时只用于本次，不做任何持久化。 */
  saveFeedback(record,consentId){
   if(!record||record.eatenConfirmation!==true)return {persisted:false,reason:'notEaten',message:'还没确认吃过，不记录体验。'};
   if(!consentId)return {persisted:false,reason:'noConsent',sessionOnly:true,
    message:'这次已用上。没有保存同意，记忆里不会留下这条反馈。'};
   data.feedback.push({...record,id:'fb-'+stamp()+'-'+data.feedback.length,at:stamp(),consentId});
   return write();
  },
  /* 供 C5 轮换使用的历史：只给获准的“选餐记录”，kind 固定为 selection，绝不当成 order 或 eaten */
  usableHistory(consent){
   const c=consent||this.currentConsent();
   if(!c.useSavedSelections)return [];
   return data.selections.filter(s=>s.consentId).map(s=>({kind:'selection',at:s.at,source:s.source,names:s.names,consent:true}));
  },
  deleteTaste(id){data.tastes=data.tastes.filter(t=>t.id!==id);return write();},
  deleteSelection(id){data.selections=data.selections.filter(s=>s.id!==id);return write();},
  deleteFeedback(id){data.feedback=data.feedback.filter(f=>f.id!==id);return write();},
  clearAll(){data=emptyStore();blocked=false;
   try{storage.removeItem(KEY);storage.removeItem(LEGACY_KEY);return {persisted:true};}
   catch(e){return {persisted:false,message:'这次已用上，没能保存到下次。'};}},
  /* 关闭后续记忆：停止新增保存，已有条目仍可逐条删除 */
  setMemoryEnabled(enabled){blocked=!enabled;if(enabled&&!data.consent)data.consent={useSavedTaste:false,useSavedSelections:false,saveExplicitTaste:false,saveFinalSelection:false,saveRotationPlan:false,at:stamp()};return write();}
 };
}

function tasteLabel(t){
 const map={texture:{crispy:'香脆',soft:'软嫩',refreshing:'清爽'},spice:{mild:'微辣',none:'不辣'},richness:{light:'不油腻',rich:'偏厚重'}};
 const m=map[t.dimension]||{};return m[t.value]||t.value;
}

const api={createMemoryStore,SCHEMA,KEY,tasteLabel};if(typeof module!=='undefined')module.exports=api;else root.McMemory=api;
})(typeof window!=='undefined'?window:globalThis);