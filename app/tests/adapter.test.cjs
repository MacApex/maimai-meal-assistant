const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
test('adapter_isolation',async()=>{
 assert.ok(fs.existsSync(path.join(__dirname,'../data-adapter.js')),'adapter missing');const A=require('../data-adapter.js');
 assert.equal((await A.createAdapter('official').getCatalog({})).status,'notConnected');
 assert.equal((await A.createAdapter('demo').getCatalog({})).status,'demo');
 assert.equal((await A.createAdapter('official',async()=>({status:'demo',data:[]})).getCatalog({})).status,'error');
 assert.equal(A.normalizeMoney(10,null),null);
 const x=A.createRequestGate();const first=x.start(0),second=x.start(1);assert.equal(x.accept(first,0),false);assert.equal(x.accept(second,1),true);
 assert.equal((await A.createAdapter('official',async()=>({status:'verified',data:{},provenance:{source:'x',checkedAt:'2020-01-01',storeId:'s',channel:'c',conditions:[]},expiresAt:'2020-01-02'})).quote([],{})).status,'expired');
 assert.equal((await A.createAdapter('official',async()=>{throw Error('network')}).quote([],{})).status,'error');
});
