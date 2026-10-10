const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
test('consent_and_storage',()=>{
 assert.ok(fs.existsSync(path.join(__dirname,'../preferences.js')),'preferences missing');
 const P=require('../preferences.js');let writes=0,v=null;const storage={getItem:()=>v,setItem:(k,x)=>{writes++;v=x;},removeItem:()=>{v=null;}};
 const p=P.createPreferenceStore(storage);assert.deepEqual(p.readPreferences().items,[]);assert.equal(writes,0);
 p.savePreferences([{id:'taste',value:'香脆'}]);assert.equal(p.readPreferences().items.length,1);
 p.setMemoryEnabled(false);p.savePreferences([{id:'other',value:'x'}]);assert.equal(p.readPreferences().items.length,1);
 p.deletePreference('taste');assert.equal(p.readPreferences().items.length,0);p.clearPreferences();assert.equal(v,null);
 v='{bad';assert.deepEqual(P.createPreferenceStore(storage).readPreferences().items,[]);
 const bad=P.createPreferenceStore({getItem(){throw Error('blocked')},setItem(){throw Error('blocked')},removeItem(){throw Error('blocked')}});assert.equal(bad.savePreferences([{id:'taste',value:'香脆'}]).persisted,false);
});
