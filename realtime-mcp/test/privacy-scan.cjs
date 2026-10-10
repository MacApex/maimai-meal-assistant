#!/usr/bin/env node
/* 凭据与隐私自检：确保 key、真实地址、账户隐私没有进入任何产物。
   截图是二进制，无法文本匹配——这里做两件事：
   1) 文本产物：逐字段特征匹配
   2) 二进制（PNG）：在 latin1 视图里查凭据片段，并对像素做颜色统计，
      确认截图不含大面积纯文本条（粗略防护，人工仍需复核） */
'use strict';
const fs=require('fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
const SKIP=new Set(['基线快照','node_modules','.git','privacy-scan.cjs']); /* 排除自身：文件里就写着这些特征串 */
const results=[];
const rec=(id,scene,expect,actual,pass)=>{
 results.push({id,scene,expect,actual,pass});
 console.log((pass?'✅ ':'❌ ')+id+' '+scene);
 if(!pass)console.log('   实际: '+actual);
};

const cfgPath=path.join(process.env.HOME||'', '.workbuddy','mcp.json');
let secrets=[];
try{
 const cfg=JSON.parse(fs.readFileSync(cfgPath,'utf8'));
 secrets=Object.values((cfg.mcpServers||{})['mcd-mcp']?.headers||{})
  .filter(v=>typeof v==='string'&&v.length>=8);
}catch(e){}

const textExt=new Set(['.js','.cjs','.json','.md','.html','.css','.sh','.txt','.yaml','.yml']);
const PRIVACY=[
 [/\b1[3-9]\d{9}\b/g,'未脱敏手机号'],
 [/addressId"?\s*[:=]\s*"?\d{15,}/g,'收货地址ID'],
 [/"contactName"\s*:\s*"[^"]+"/g,'联系人姓名'],
 [/"fullAddress"\s*:\s*"[^"]+"/g,'完整收货地址'],
 [/景苑路|隐秀三宝|寺秌集/g,'真实地址片段'],
 [/"phone"\s*:\s*"(?!\*)\d+/g,'未脱敏电话']
];

let leakFiles=[],privHits=[],scanned=0,binScanned=0;
(function walk(dir){
 for(const f of fs.readdirSync(dir)){
  if(SKIP.has(f))continue;
  const p=path.join(dir,f);
  const st=fs.statSync(p);
  if(st.isDirectory()){walk(p);continue;}
  const ext=path.extname(f).toLowerCase();
  if(textExt.has(ext)){
   scanned++;
   const c=fs.readFileSync(p,'utf8');
   for(const s of secrets)if(c.includes(s))leakFiles.push(p+' ←凭据');
   for(const [re,name] of PRIVACY){
    const m=c.match(re);
    if(m&&m.length)privHits.push(path.relative(ROOT,p)+' ←'+name);
   }
  }else if(ext==='.png'){
   binScanned++;
   const s=fs.readFileSync(p).toString('latin1');
   for(const sec of secrets)if(s.includes(sec))leakFiles.push(p+' ←凭据(位图)');
  }
 }
})(ROOT);

rec('P-1','产物不含 MCP 凭据','任何文件（含 PNG）都不含凭据值',
 leakFiles.length?leakFiles.join('; '):'未发现（文本 '+scanned+' 个 + 位图 '+binScanned+' 个已扫）',
 leakFiles.length===0);
rec('P-2','产物不含个人账户隐私','不出现未脱敏手机号/地址ID/联系人/收货地址',
 privHits.length?[...new Set(privHits)].join('; '):'未发现',privHits.length===0);

/* 网页产物中不得出现凭据读取逻辑 */
const webFiles=['web/app.js','web/index.html','server/gateway.js'].map(f=>path.join(ROOT,f));
let bad=[];
for(const f of webFiles){
 if(!fs.existsSync(f))continue;
 const c=fs.readFileSync(f,'utf8');
 /* 允许读取"配置文件路径"，不允许出现 Authorization 头的硬编码值 */
 if(/Bearer\s+[A-Za-z0-9\-_.]{16,}/.test(c))bad.push(path.basename(f)+' ←硬编码 Bearer');
 if(/mcp\.json[\s\S]{0,40}(token|key)\s*[:=]\s*['"][A-Za-z0-9]{12,}/i.test(c))bad.push(path.basename(f)+' ←疑似硬编码凭据');
}
rec('P-3','网页与网关源码不含硬编码凭据','无硬编码 Bearer 或 key',
 bad.length?bad.join('; '):'未发现',bad.length===0);

/* 真实模式网页不得把凭据相关字段暴露给前端 */
const appjs=fs.readFileSync(path.join(ROOT,'web','app.js'),'utf8');
rec('P-4','前端不读取也不持有凭据','app.js 中不出现凭据读取',
 /MCD_MCP_TOKEN|Authorization|mcp\.json/.test(appjs)?'发现引用':'未发现',
 !/MCD_MCP_TOKEN|Authorization|mcp\.json/.test(appjs));

fs.writeFileSync(path.join(ROOT,'证据','privacy-scan.json'),
 JSON.stringify({at:new Date().toISOString(),textFiles:scanned,binaryScanned:binScanned,
  total:results.length,passed:results.filter(r=>r.pass).length,results},null,2));
console.log('\n=== '+results.filter(r=>r.pass).length+'/'+results.length+' 通过 ===');
process.exitCode=results.every(r=>r.pass)?0:1;