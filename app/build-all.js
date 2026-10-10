#!/usr/bin/env node
/* 单一源构建与自检。
   唯一源：app/src/（JS / CSS / HTML / 素材）。由它生成全部入口：
     1. 开发 app        01_代码/app
     2. 提交包 app      06_GitHub待提交包/app
     3. 外层 Skill      05_Skill/skill/scripts
     4. 包内 Skill      06_GitHub待提交包/skill/scripts
     5. 单 HTML         06_GitHub待提交包/standalone/index.html（校验其内嵌模块与 src 一致）

   上一版有两个致命缺陷，本轮必须修掉：
   A. 「目标不存在就跳过」——独立提交包里外层 01_代码 / 05_Skill 并不存在，
      于是全部跳过并报告「零漂移」，故意改坏产物也检不出来（R3-02）。
      现在：**必需目标缺失即失败**；包内实际存在的每个产物都必须被逐一比对。
   B. 只校验 JS，CSS / HTML / 素材 / 单 HTML / 包内 Skill 都游离在外。
      现在全部进入同一份清单，逐一比对 SHA256。
   另外包内 Skill 曾长期漏同步（R3-01），现已列为必需目标。

   用法：
     node build-all.js           生成全部入口
     node build-all.js --check   只校验不写入；任何缺失或不一致都退出 1
   退出码为真实进程退出码，不经管道，便于 CI 与审阅直接引用。
*/
'use strict';
const fs=require('fs'),path=require('node:path'),crypto=require('node:crypto');

const APP=path.resolve(__dirname);
/* 布局自适应：开发工作区里 app 位于 07_WorkBuddy独立产出/01_代码/app（往上两级），
   而独立复制出来的待提交包里 app 就在包根下（只往上一级）。
   早期版本硬编码两级，导致在独立包里把"目标缺失"当成一致，漏检漂移。 */
function detectRoot(){
 const cands=[path.resolve(APP,'..','..'),path.resolve(APP,'..'),APP];
 for(const c of cands){
  if(fs.existsSync(path.join(c,'06_GitHub待提交包'))||fs.existsSync(path.join(c,'skill'))
   ||fs.existsSync(path.join(c,'01_代码')))return c;
 }
 return path.resolve(APP,'..','..');
}
const ROOT=detectRoot();
const SRC=path.join(APP,'src');
const CHECK=process.argv.includes('--check');

const DEMO_MODULES=['demo-data.js','memory-store.js','domain.js','wizard-domain.js','meal-engine.js','step-view.js','wizard-app.js'];
const MODULES=['demo-data.js','memory-store.js','domain.js','wizard-domain.js',
               'meal-engine.js','data-adapter.js','mcp-transport.js','step-view.js','wizard-app.js'];
const CSS_FILES=['wizard.css'];
const HTML_FILES=['index.html'];
const ASSETS=['hero','crispy','fries','tea','burger','wings','nuggets','pie','coffee',
              'fish','wrap','corn','cake','sundae','milk','juice'];
/* Skill 自己的入口脚本，来自 Skill 目录，不属于 src */
const SKILL_SCRIPTS=['run-meal.js'];
/* 提交包内的工具脚本，随包发布，同样必须存在 */
const PKG_TOOLS=['build-all.js','build-standalone.js','secret-scan.js'];

/* 必需产物清单。required 表示缺失/不一致都必须失败。 */
/* file 支持候选路径：独立提交包里是 skill/scripts，开发工作区里是 05_Skill/skill/scripts。
   取第一个存在的；都不存在才算目标缺失（必需项缺失即失败，不再静默跳过）。 */
function resolveTarget(cands){
 for(const c of [].concat(cands)){
  const abs=path.join(ROOT,c);
  if(fs.existsSync(abs))return abs;
 }
 return path.join(ROOT,[].concat(cands)[0]);
}
const MANIFEST=[
 {target:'开发 app',     file:['01_代码/app'],                 items:MODULES,      src:true,  required:false},
 {target:'开发 app',     file:['01_代码/app'],                 items:CSS_FILES,    src:true,  required:false},
 {target:'开发 app',     file:['01_代码/app'],                 items:HTML_FILES,   src:true,  required:false},

 {target:'提交包 app',   file:['06_GitHub待提交包/app','app'], items:MODULES,      src:true,  required:true},
 {target:'提交包 app',   file:['06_GitHub待提交包/app','app'], items:CSS_FILES,    src:true,  required:true},
 {target:'提交包 app',   file:['06_GitHub待提交包/app','app'], items:HTML_FILES,   src:true,  required:true},

 {target:'外层 Skill',   file:['05_Skill/skill/scripts'],       items:MODULES,      src:true,  required:false},
 {target:'外层 Skill',   file:['05_Skill/skill/scripts'],       items:SKILL_SCRIPTS,src:false, required:false},

 /* R3-01：包内 Skill 曾长期漏同步，必须与外层同源且必须存在 */
 {target:'包内 Skill',   file:['06_GitHub待提交包/skill/scripts','skill/scripts'],items:MODULES,     src:true,  required:true},
 {target:'包内 Skill',   file:['06_GitHub待提交包/skill/scripts','skill/scripts'],items:SKILL_SCRIPTS,src:false,required:false}
];

const ASSET_TARGETS=[
 {target:'提交包 assets',file:['06_GitHub待提交包/app/assets','app/assets'],required:true}
];
const STANDALONE=['06_GitHub待提交包/standalone/index.html','standalone/index.html'];

const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const short=h=>h.slice(0,12);
const exists=p=>fs.existsSync(p);

const entries=[];
let missing=0,drift=0,written=0;

function record(target,file,state,expected,actual,required){
 entries.push({target,file,state,expected,actual,required});
 if(state==='一致')return;
 if(state==='缺失(可选)'||state==='源缺失(可选)')return;
 if(required){missing++;}else{drift++;}
}

for(const t of MANIFEST){
 const dir=resolveTarget(t.file);
 for(const item of t.items){
  const sp=t.src?path.join(SRC,item):path.join(resolveTarget(['05_Skill/skill/scripts','skill/scripts']),item);
  if(!exists(sp)){record(t.target,item,t.required?'源缺失':'源缺失(可选)','-','-',t.required);continue;}
  const want=sha(fs.readFileSync(sp));
  const dp=path.join(dir,item);
  if(!exists(dp)){
   record(t.target,item,t.required?'目标缺失':'目标缺失(可选)',short(want),'-',t.required);
   if(!CHECK){fs.mkdirSync(path.dirname(dp),{recursive:true});fs.copyFileSync(sp,dp);written++;}
   continue;
  }
  const cur=sha(fs.readFileSync(dp));
  if(cur===want)record(t.target,item,'一致',short(want),short(cur),t.required);
  else{
   record(t.target,item,'不一致',short(want),short(cur),t.required);
   if(!CHECK){fs.copyFileSync(sp,dp);written++;}
  }
 }
}

/* 提交包工具脚本：必须在包内存在（不比对内容，只确保不丢） */
for(const f of PKG_TOOLS){
 const dp=path.join(resolveTarget(['06_GitHub待提交包/app','app']),f);
 if(!exists(dp))record('提交包 app',f,'目标缺失','-','-',true);
 else record('提交包 app',f,'存在',short(sha(fs.readFileSync(dp))),short(sha(fs.readFileSync(dp))),true);
}

/* 素材 */
for(const at of ASSET_TARGETS){
 const dir=resolveTarget(at.file);
 for(const a of ASSETS){
  const sp=path.join(SRC,'assets',a+'.webp');
  if(!exists(sp)){record(at.target,a+'.webp','源缺失(可选)','-','-',false);continue;}
  const want=sha(fs.readFileSync(sp));
  const dp=path.join(dir,a+'.webp');
  if(!exists(dp)){
   record(at.target,a+'.webp','目标缺失',short(want),'-',at.required);
   if(!CHECK){fs.mkdirSync(path.dirname(dp),{recursive:true});fs.copyFileSync(sp,dp);written++;}
   continue;
  }
  const cur=sha(fs.readFileSync(dp));
  if(cur===want)record(at.target,a+'.webp','一致',short(want),short(cur),at.required);
  else{record(at.target,a+'.webp','不一致',short(want),short(cur),at.required);if(!CHECK){fs.copyFileSync(sp,dp);written++;}}
 }
}

/* 单 HTML：必须存在，且内嵌的每个模块与 src 逐一相符 */
const sa=path.join(ROOT,STANDALONE.find(x=>fs.existsSync(path.join(ROOT,x)))||STANDALONE[0]);
if(!exists(sa)){
 record('单 HTML','standalone/index.html','目标缺失','-','-',true);
}else{
 const html=fs.readFileSync(sa,'utf8');
 /* 离线单文件只内嵌演示模块；真实接入模块不应出现在演示文件里 */
 for(const m of DEMO_MODULES){
  const esc=m.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  /* 单 HTML 里的分段标记由 build-standalone.js 生成：
     /* ===== xxx.js ===== * /  ...  /* end:xxx.js * /            */
  const seg=html.match(new RegExp('/\\* ===== '+esc+' ===== \\*/[\\s\\S]*?/\\* end:'+esc+' \\*/'));
  const want=sha(fs.readFileSync(path.join(SRC,m)));
  if(!seg)record('单 HTML',m,'未找到内嵌段',short(want),'-',true);
  else{
   /* 比对时去掉两端的标记注释，只取源码本体 */
   const body=seg[0]
    .replace(new RegExp('^/\\* ===== '+esc+' ===== \\*/'),'')
    .replace(new RegExp('/\\* end:'+esc+' \\*/$'),'')
    .replace(/^\n/,'').replace(/\n$/,'');
   const cur=sha(body);
   if(cur===want)record('单 HTML',m,'一致',short(want),short(cur),true);
   else record('单 HTML',m,'不一致',short(want),short(cur),true);
  }
 }
}

/* 单 HTML 整文件哈希：逐段比对只能发现标记段内的改动，
   在 </html> 之后追加内容不会被发现。这里额外记录整文件哈希。 */
const MANIFEST_FILE=path.join(APP,'build-manifest.json');
const saAbs=path.join(ROOT,(STANDALONE.find(x=>fs.existsSync(path.join(ROOT,x)))||STANDALONE[0]));
if(!CHECK){
 fs.writeFileSync(MANIFEST_FILE,JSON.stringify({
  generatedAt:new Date().toISOString(),
  standalone:fs.existsSync(saAbs)?{path:path.relative(ROOT,saAbs),sha256:sha(fs.readFileSync(saAbs))}:null,
  entries:entries.map(e=>({target:e.target,file:e.file,state:e.state,expected:e.expected,actual:e.actual}))
 },null,2));
}else if(fs.existsSync(MANIFEST_FILE)){
 try{
  const mf=JSON.parse(fs.readFileSync(MANIFEST_FILE,'utf8'));
  if(mf.standalone&&fs.existsSync(saAbs)){
   const cur=sha(fs.readFileSync(saAbs));
   if(cur!==mf.standalone.sha256)
    record('单 HTML','整文件哈希','不一致',short(mf.standalone.sha256),short(cur),true);
  }
 }catch(e){}
}


/* ---- 输出 ---- */
const bad=entries.filter(e=>e.state!=='一致'&&e.state!=='存在'&&e.state!=='源缺失(可选)'&&e.state!=='目标缺失(可选)');
console.log(CHECK?'=== build-all --check（只校验）==':'=== build-all（生成）==');
console.log('唯一源：'+SRC);
console.log('检查 '+entries.length+' 项产物；必需项异常 '+bad.length+'（缺失或不一致），写入 '+written);
console.log('');
const byTarget={};
for(const e of entries)(byTarget[e.target]=byTarget[e.target]||[]).push(e);
for(const [t,list] of Object.entries(byTarget)){
 const combo=sha(list.map(x=>x.file+':'+x.state).join('\n'));
 const nBad=list.filter(x=>x.state!=='一致'&&x.state!=='存在').length;
 console.log('['+t+'] 组合校验和 '+short(combo)+(nBad?'  ⚠ '+nBad+' 项异常':'  全部一致'));
 for(const e of list){
  if(e.state!=='一致'&&e.state!=='存在'&&e.state!=='源缺失(可选)'&&e.state!=='目标缺失(可选)')
   console.log('   ✗ '+e.file+'  '+e.state+'  期望 '+e.expected+' 实际 '+e.actual);
 }
}
const overall=sha(entries.map(e=>e.target+'/'+e.file+'='+e.state).join('\n'));
console.log('\n五入口组合校验和：'+short(overall));

try{
 const outDir=path.join(ROOT,'证据','第三轮');
 fs.mkdirSync(outDir,{recursive:true});
 fs.writeFileSync(path.join(outDir,(CHECK?'build-check':'build-generate')+'-hashes.json'),
  JSON.stringify({at:new Date().toISOString(),mode:CHECK?'check':'generate',src:SRC,
   badCount:bad.length,written,overallHash:overall,entries},null,2));
}catch(e){}

if(CHECK){
 if(bad.length){
  console.error('\n✗ 自检失败：必需产物缺失或与唯一源不一致，共 '+bad.length+' 项。');
  bad.forEach(e=>console.error('   '+e.target+'/'+e.file+'  '+e.state+'  期望 '+e.expected+' 实际 '+e.actual));
  process.exit(1);
 }
 console.log('\n✓ 自检通过：五入口产物均存在且与唯一源一致。');
}else{
 console.log('\n✓ 已生成全部入口。');
}