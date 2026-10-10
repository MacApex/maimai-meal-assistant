#!/usr/bin/env node
/* 五入口一致性：正向必须一致，负向（故意改坏）必须失败。
   第三版反馈 R3-02 的核心是"改坏产物仍报零漂移"，这里做反例验证。 */
'use strict';
const fs=require('fs'),path=require('node:path'),os=require('os');
const {execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..','..');
const OUT=path.join(__dirname,'..','证据');
const PKG=path.join(ROOT,'06_GitHub待提交包');
const results=[];
const rec=(id,scene,expect,actual,pass)=>{
 results.push({id,scene,expect,actual,pass});
 console.log((pass?'✅ ':'❌ ')+id+' '+scene);
 if(!pass)console.log('   期望: '+expect+'\n   实际: '+actual);
};
function runCheck(cwd){try{
 execFileSync(process.execPath,['build-all.js','--check'],{cwd,stdio:'pipe'});
 return 0;
}catch(e){return e.status===undefined?1:e.status;}}
function copyPkg(){const d=fs.mkdtempSync(path.join(os.tmpdir(),'entry-'))+'/pkg';
 fs.cpSync(PKG,d,{recursive:true});return d;}

/* 1. 正向：开发工作区与独立包都应通过 */
rec('C-1a','开发工作区五入口一致','退出码 0','退出码 '+runCheck(path.join(ROOT,'01_代码','app')),
 runCheck(path.join(ROOT,'01_代码','app'))===0);
const cleanCopy=copyPkg();
rec('C-1b','独立待提交包五入口一致','退出码 0','退出码 '+runCheck(path.join(cleanCopy,'app')),
 runCheck(path.join(cleanCopy,'app'))===0);

/* 2. 负向：每种破坏都必须被发现 */
const cases=[
 ['C-2a','改坏提交包 app 的模块',d=>{fs.appendFileSync(path.join(d,'app','wizard-domain.js'),'\n//x\n');}],
 ['C-2b','改坏包内 Skill 的模块（R3-01 漏同步入口）',d=>{fs.appendFileSync(path.join(d,'skill','scripts','wizard-domain.js'),'\n//x\n');}],
 ['C-2c','改坏外层 Skill（若包内存在）',d=>{const f=path.join(d,'skill','scripts','meal-engine.js');if(fs.existsSync(f))fs.appendFileSync(f,'\n//x\n');}],
 ['C-2d','删除包内 Skill 必需模块',d=>{fs.rmSync(path.join(d,'skill','scripts','meal-engine.js'),{force:true});}],
 ['C-2e','改坏提交包 CSS',d=>{fs.appendFileSync(path.join(d,'app','wizard.css'),'\n.x{}\n');}],
 ['C-2f','改坏单 HTML 内嵌模块段',d=>{
   const f=path.join(d,'standalone','index.html');let s=fs.readFileSync(f,'utf8');
   s=s.replace('/* ===== demo-data.js ===== */','/* ===== demo-data.js ===== */\n/* injected */');
   fs.writeFileSync(f,s);}],
 ['C-2g','在单 HTML 标记段之外注入内容',d=>{
   fs.appendFileSync(path.join(d,'standalone','index.html'),'\n<!-- injected -->');}]
];
for(const [id,desc,break_] of cases){
 const d=copyPkg();
 break_(d);
 const rc=runCheck(path.join(d,'app'));
 rec(id,desc,'退出码非 0（必须检出漂移）','退出码 '+rc,rc!==0);
 fs.rmSync(path.dirname(d),{recursive:true,force:true});
}

/* 3. 真实模式的产物不得进入演示单 HTML */
const standalone=path.join(PKG,'standalone','index.html');
if(fs.existsSync(standalone)){
 const html=fs.readFileSync(standalone,'utf8');
 const hasGateway=/mcp\.mcd\.cn|MCD_MCP_TOKEN|127\.0\.0\.1:8795/.test(html);
 rec('C-3','单 HTML（演示版）不含真实接入痕迹','不含网关地址/凭据名/上游域名',
  hasGateway?'发现真实接入痕迹':'未发现',!hasGateway);
}
fs.writeFileSync(path.join(OUT,'entry-consistency.json'),
 JSON.stringify({at:new Date().toISOString(),total:results.length,passed:results.filter(r=>r.pass).length,results},null,2));
console.log('\n=== '+results.filter(r=>r.pass).length+'/'+results.length+' 通过 ===');
process.exitCode=results.every(r=>r.pass)?0:1;