/* 测试运行时定位：优先用环境变量，其次自动发现，最后才退回本机默认。
   之前每个测试文件都硬编码 /Users/maxima/... 的 playwright 与 chromium 路径，
   导致干净克隆后无法运行。统一改为运行时解析。
*/
'use strict';
const fs=require('fs'),path=require('path');

/* Playwright 模块位置：环境变量 > npx 缓存中的任意一份 > node_modules */
function findPlaywright(){
 if(process.env.PLAYWRIGHT_MODULE&&existsDir(process.env.PLAYWRIGHT_MODULE))return process.env.PLAYWRIGHT_MODULE;
 const roots=[
  path.join(process.cwd(),'node_modules','playwright'),
  path.join(process.cwd(),'node_modules','playwright-core')
 ];
 for(const r of roots)if(existsDir(r))return r;
 /* npx 缓存目录下的任意一份 playwright */
 const npx=path.join(process.env.HOME||'', '.npm','_npx');
 if(fs.existsSync(npx)){
  for(const d of fs.readdirSync(npx)){
   const p=path.join(npx,d,'node_modules','playwright');
   if(existsDir(p))return p;
  }
 }
 return 'playwright';/* 交给 Node 正常解析，失败时给出清晰错误 */
}
/* Chromium 可执行文件：环境变量 > 常见缓存目录扫描 */
function findChromium(){
 if(process.env.CHROMIUM_PATH&&fs.existsSync(process.env.CHROMIUM_PATH))return process.env.CHROMIUM_PATH;
 const base=path.join(process.env.HOME||'', 'Library','Caches','ms-playwright');
 const cands=[];
 if(fs.existsSync(base)){
  for(const d of fs.readdirSync(base)){
   cands.push(path.join(base,d,'chrome-headless-shell-mac-arm64','chrome-headless-shell'));
   cands.push(path.join(base,d,'chrome-mac','Chromium.app','Contents','MacOS','Chromium'));
   cands.push(path.join(base,d,'chrome-mac','Google Chrome for Testing.app','Contents','MacOS','Google Chrome for Testing'));
   cands.push(path.join(base,d,'chrome-linux','chrome'));
  }
 }
 for(const c of cands)if(fs.existsSync(c))return c;
 /* Playwright 自带的下载目录（Linux/Windows 常见命名） */
 const alt=path.join(process.env.HOME||'','.cache','ms-playwright');
 if(fs.existsSync(alt)){
  for(const d of fs.readdirSync(alt)){
   for(const leaf of ['chrome-linux/chrome','chrome-mac/Chromium.app/Contents/MacOS/Chromium'])
    {const c=path.join(alt,d,leaf);if(fs.existsSync(c))return c;}
  }
 }
 return null;/* 让 Playwright 用自己的默认值 */
}
function existsDir(p){try{return fs.statSync(p).isDirectory();}catch(e){return false;}}

let _pw=null;
function playwright(){
 if(_pw)return _pw;
 const mod=findPlaywright();
 try{_pw=require(mod);}catch(e){
  throw new Error('找不到 Playwright。请先安装（npm i -D playwright && npx playwright install chromium），'
   +'或设置 PLAYWRIGHT_MODULE 指向已安装的 playwright 目录。原始错误：'+e.message);
 }
 return _pw;
}
function launchOptions(){
 const o={headless:true};
 const exe=findChromium();
 if(exe)o.executablePath=exe;
 return o;
}
module.exports={playwright,findPlaywright,findChromium,launchOptions};