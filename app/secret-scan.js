#!/usr/bin/env node
/* 秘密扫描：只针对拟公开的待提交包，不搜用户主目录或任何真实凭据文件。
   规则命中只报告文件路径与计数，绝不打印匹配到的秘密本身。
   发现疑似真实密钥时立即中止，避免把它复制进报告。 */
'use strict';
const fs=require('fs'),path=require('path');
const ROOT=process.env.SCAN_ROOT||path.resolve(__dirname,'..');
const OUT=process.env.SCAN_OUT||path.join(ROOT,'整改记录','secret-scan.json');

/* 允许出现的占位形式：文档里的 MCD_MCP_TOKEN、YOUR_MCP_TOKEN 等环境变量名 */
const ALLOW_PLACEHOLDER=/YOUR_[A-Z_]*TOKEN|MCD_MCP_TOKEN|Bearer <已填写>|Bearer YOUR_|\$\{?[A-Z_]*TOKEN\}?|<你的|占位符|环境变量占位/;
const RULES=[
 {name:'UUID 形态凭据',re:/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi},
 {name:'Bearer 令牌',re:/Bearer\s+[A-Za-z0-9\-_]{16,}/g},
 {name:'常见 API Key 前缀',re:/\b(sk-|pk_|ghp_|gho_|AKIA)[A-Za-z0-9]{12,}/g},
 {name:'私钥块',re:/-----BEGIN [A-Z ]*PRIVATE KEY-----/g},
 {name:'赋值形式的密钥',re:/\b(token|secret|password|passwd|apiKey|api_key|access_key)\b\s*[:=]\s*["'][^"']{8,}["']/gi}
];
const SKIP_DIR=new Set(['node_modules','.git','assets','screenshots','originals']);
const TEXT_EXT=new Set(['.js','.cjs','.mjs','.ts','.json','.md','.html','.css','.txt','.yml','.yaml','.toml','.example','']);

const findings=[];
let scanned=0;
function walk(dir){
 for(const e of fs.readdirSync(dir,{withFileTypes:true})){
  if(SKIP_DIR.has(e.name))continue;
  const full=path.join(dir,e.name);
  if(e.isDirectory()){walk(full);continue;}
  const ext=path.extname(e.name).toLowerCase();
  if(!TEXT_EXT.has(ext))continue;
  if(/\.(png|jpg|jpeg|webp|gif|svg)$/i.test(e.name))continue;
  const text=fs.readFileSync(full,'utf8');scanned++;
  for(const rule of RULES){
   const matches=text.match(rule.re);
   if(!matches)continue;
   let real=matches.filter(m=>!ALLOW_PLACEHOLDER.test(m));
   /* 命中项全部为占位符 → 记为可解释的误报 */
   findings.push({file:path.relative(ROOT,full),rule:rule.name,count:matches.length,
    realCount:real.length,classification:real.length?'POTENTIAL_SECRET':'placeholderOnly'});
  }
 }
}
walk(ROOT);

const potential=findings.filter(f=>f.classification==='POTENTIAL_SECRET');
const report={scannedAt:new Date().toISOString(),root:path.basename(ROOT),filesScanned:scanned,
 totalFindings:findings.length,potentialSecrets:potential.length,findings,
 policy:'只扫描拟公开的待提交包；只报告路径与计数，不打印匹配到的秘密。'};
fs.mkdirSync(path.dirname(OUT),{recursive:true});
fs.writeFileSync(OUT,JSON.stringify(report,null,2));
console.log(JSON.stringify({filesScanned:scanned,totalFindings:findings.length,potentialSecrets:potential.length},null,2));
if(findings.length)findings.forEach(f=>console.log(`  [${f.classification}] ${f.file} · ${f.rule} ×${f.count}`));
if(potential.length){
 console.error('\n发现疑似真实凭据，请先隔离该文件并处理，不要提交：');
 potential.forEach(f=>console.error('  - '+f.file));
 process.exit(2);
}
console.log('\n未发现疑似真实凭据。');