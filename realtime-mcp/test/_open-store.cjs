/* 选一家当前真正营业的门店。
   门店会打烊：盲选搜索结果的第一家，会让真实链路测试在打烊时段必然失败。
   这里逐家尝试，选第一家菜单能加载成功的，并如实记录跳过了哪几家。

   实测踩出来的几个要点（都写在这里，避免以后重犯）：
   1) 失败后门店弹层可能已关闭，不能假设它还开着——每次重搜前显式调用 openStore()；
   2) 判成功/失败不能靠 ".err 出现与否"：菜单是异步加载的，上一轮节点可能还在，
      Promise.race 会误判。正确判据是页面状态 S.menu 是否为本次门店加载的菜单；
   3) 不要在每轮循环里重新搜店——doSearch 会清空门店列表，而确认按钮的 disabled
      状态不会随之重置，重复搜索会让列表索引与按钮状态错位；
   4) 若此前用例中断过网关，页面处于降级态，必须重新加载才能搜店；
   5) "换一家门店"按钮是动态创建的 classed .ghost，直接调 openStore() 更可靠。 */
'use strict';

const SEL={
  dlgC:'#storeDlg',
  dlg:'#storeDlg[open]',
  city:'#city',
  kw:'#kw',
  search:'[data-a=search-store]',
  store:'.store',
  confirm:'[data-a=confirm-store]'
};

/* 打开门店弹层并等待其真正可见 */
async function ensureDialog(p){
  const isOpen=await p.locator(SEL.dlgC).evaluate(n=>n.open).catch(()=>false);
  if(!isOpen){
   await p.evaluate(()=>{ if(typeof openStore==='function')openStore(); });
  }
  await p.locator(SEL.dlg).waitFor({timeout:15000});
  await p.waitForTimeout(150);
}

/* 搜索门店并返回数量。
   若页面处于"网关不可用"的降级态（此前用例中断过网关），先重新加载页面，
   否则在错误态里点搜索拿不到任何门店，会误判成"没有门店"。 */
async function search(p,city,kw){
  const degraded=await p.evaluate(()=>{
   const t=document.querySelector('main');
   return !!(t&&/无法连接本机网关|无法进入真实模式/.test(t.textContent||''));
  }).catch(()=>false);
  if(degraded){
   await p.reload({waitUntil:'networkidle'}).catch(()=>{});
   await p.waitForTimeout(800);
  }
  await ensureDialog(p);
  await p.fill(SEL.city,city);
  await p.fill(SEL.kw,kw);
  await p.locator(SEL.search).click();
  await p.locator(SEL.store+',.err').first().waitFor({timeout:60000});
  return p.locator(SEL.store).count();
}

/* 判定本次门店是否加载成功。
   判据用"菜单来源卡"是否出现并显示可售数量——
   这是用户真正看到的东西，且不依赖页面内部变量是否暴露到 window。
   不用 ".err 出现与否"：菜单是异步加载的，上一轮的节点可能还在，会误判。 */
async function menuLoadedFor(p){
 try{
  const src=p.locator('.src').first();
  await src.waitFor({timeout:35000});
  /* 来源卡出现后还要确认确实有可售数量，否则可能只是空壳 */
  await p.waitForFunction(()=>{
   const n=document.querySelector('.src');
   return !!(n&&/可售餐品\s*\d+\s*项/.test(n.textContent||''));
  },null,{timeout:20000});
  return true;
 }catch(e){
  return false;
 }
}

async function pickOpenStore(p,city,kw){
  /* 真实上游偶发超时是正常的：搜不到结果时重试一次，而不是直接判定"没有门店" */
  let n=await search(p,city,kw);
  if(n===0){
   await p.waitForTimeout(1500);
   n=await search(p,city,kw);
  }
  if(n===0)throw new Error('「'+city+' · '+kw+'」下没有搜到门店，无法继续真实链路测试');

  /* 只搜一次，循环里复用同一份列表（见文件头第 3 点） */
  const names=await p.locator(SEL.store).allTextContents();
  const skipped=[];
  for(let i=0;i<n;i++){
   await ensureDialog(p);
   await p.locator(SEL.store).nth(i).click();
   const storeCode=await p.evaluate(()=>{
    try{return (S.pendingStore&&S.pendingStore.storeCode)||'';}catch(e){return '';}
   });
   /* 关键：确认前先抹掉上一家残留的来源卡。
      否则本轮菜单加载失败时，旧来源卡还在，.src 判定会假成功。 */
   await p.evaluate(()=>{ document.querySelectorAll('.src').forEach(n=>n.remove()); });
   await p.locator(SEL.confirm).click();

   const got=await menuLoadedFor(p);
   if(got){
    if(skipped.length)console.log('  （已跳过当前打烊的门店：'+skipped.join('、')+'）');
    return {index:i,total:n,skipped,
     storeName:(names[i]||'').trim().slice(0,24),storeCode};
   }
   /* 打烊等原因失败：记录门店名，进入下一家。
     不重新搜索——下一轮只重开弹层。 */
   skipped.push((names[i]||'').trim().slice(0,20)||('候选第'+(i+1)+'家'));
   await p.waitForTimeout(400);
  }
  throw new Error('候选的 '+n+' 家门店当前都没有营业（上游 600057），无法继续真实链路测试');
}

module.exports={pickOpenStore,search,ensureDialog};
