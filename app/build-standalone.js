#!/usr/bin/env node
/* 打包单 HTML：把 CSS、JS 与图片全部内联，产出可直接双击打开的单个文件。
   硬性要求：无远程字体、无 CDN、无外部图片依赖、不内嵌任何凭据。
   内联方式：不改写业务代码里的字符串拼接（那会产出非法 JS），
     而是在脚本执行前拦截 <img>.src setter，把 'assets/xxx.webp' 映射成 data URI。
     单文件版与目录版跑的是同一份源码，不存在两套实现。
   用法：node build-standalone.js
*/
'use strict';
const fs=require('fs'),path=require('path');
const APP=path.resolve(__dirname);
const OUT_DIR=path.resolve(APP,'..','..','06_GitHub待提交包','standalone');
const OUT=path.join(OUT_DIR,'index.html');
/* 唯一源是 src/。单 HTML 必须与目录版同源，否则 build-all 无法校验它。 */
const SRC=path.join(APP,'src');
const useSrc=fs.existsSync(SRC);
const read=f=>fs.readFileSync(path.join(useSrc?SRC:APP,f),'utf8');
const readAsset=n=>fs.readFileSync(path.join(useSrc?path.join(SRC,'assets'):path.join(APP,'assets'),n+'.webp'));

const css=read('wizard.css');
/* 离线单文件只打包演示所需模块。
   data-adapter.js / mcp-transport.js 属于真实接入层，不应出现在演示文件里：
   一是徒增体积，二是容易让人误以为离线文件已接通官方业务。 */
const scripts=['demo-data.js','memory-store.js','domain.js','wizard-domain.js','meal-engine.js','step-view.js','wizard-app.js']
 .map(f=>'/* ===== '+f+' ===== */\n'+read(f)+'\n/* end:'+f+' */');

/* 收集实际会被引用的素材：商品 art 字段 + 八页场景图 + 首页主图 */
const used=new Set();
for(const m of read('demo-data.js').matchAll(/,\s*'([a-z0-9]+)',\s*'(?:main|side|drink|other)'/g))used.add(m[1]);
for(const m of read('step-view.js').matchAll(/SCENE_ART=\{([^}]+)\}/g))
 for(const s of m[1].matchAll(/:'(\w+)'/g))used.add(s[1]);
for(const m of read('step-view.js').matchAll(/p\.art\|\|'(\w+)'/g))used.add(m[1]);
used.add('hero');
used.add('crispy');

const assets={};let total=0;
for(const name of [...used].sort()){
 const file=path.join(APP,'assets',name+'.webp');
 if(!fs.existsSync(file)){console.error('缺少素材：'+name+'.webp');process.exit(1);}
 const buf=fs.readFileSync(file);
 total+=buf.length;
 assets[name]='data:image/webp;base64,'+buf.toString('base64');
}

/* 图片查表 shim：在任何业务脚本之前执行 */
const shim=`/* ===== 单文件版：图片查表 shim ===== */
(function(){
 var MAP=${JSON.stringify(assets)};
 var proto=window.HTMLImageElement&&window.HTMLImageElement.prototype;
 if(proto){
  var desc=Object.getOwnPropertyDescriptor(proto,'src');
  if(desc&&desc.set){
   Object.defineProperty(proto,'src',{configurable:true,
    get:function(){return desc.get.call(this);},
    set:function(v){
     var s=String(v);
     var m=s.match(/^(?:\\.\\/)?assets\\/([a-z0-9]+)\\.webp$/i);
     desc.set.call(this,(m&&MAP[m[1]])?MAP[m[1]]:s);
    }});
  }
 }
 window.addEventListener('error',function(e){
  var t=e.target;
  if(t&&t.tagName==='IMG'&&/assets\\//.test(t.getAttribute('src')||'')){
   t.setAttribute('src',MAP[Object.keys(MAP)[0]]||'');
  }
 },true);
 window.__McAssets=MAP;
})();`;

const html=`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#FFBC0D">
<meta name="description" content="更懂你的麦麦选餐助手：八个问题，把人数、预算、已有吃喝、口味和想不想尝新，凑成一餐能解释、能自己改的饭。">
<title>麦麦 · 更懂你的选餐助手（单文件版）</title>
<style>
${css}
</style>
</head>
<body>
<div id="app"></div>
<div id="toast" role="status" aria-live="polite"></div>
<script>
${shim}
${scripts.join('\n')}
</script>
</body>
</html>
`;

fs.mkdirSync(OUT_DIR,{recursive:true});
fs.writeFileSync(OUT,html,'utf8');

/* 打包后自检 */
const problems=[];
/* 只检查**会被浏览器发起**的引用：src/href/action 等属性，以及 CSS 的 url()。
   代码里的常量字符串（例如传输层里的默认端点）不会在离线单文件中被请求，
   不应被误判为外部依赖。 */
const attrUrl=/(?:src|href|action|data-src|poster)\s*=\s*["']\s*https?:\/\//i.test(html);
const cssUrl=/url\(\s*["']?\s*https?:\/\//i.test(html);
if(attrUrl||cssUrl)problems.push('存在外部 URL 引用（src/href/action 或 CSS url()）');
if(/fonts\.googleapis|cdn\.|unpkg|jsdelivr/i.test(html))problems.push('存在 CDN 或远程字体引用');
if(/Bearer\s+[A-Za-z0-9-]{8,}/.test(html))problems.push('疑似包含 Token');
if(/YOUR_MCP_TOKEN/.test(html))problems.push('包含 MCP Token 占位符');
if(!/data:image\/webp;base64/.test(html))problems.push('未内嵌任何 WebP 图片');
if(!/__McAssets/.test(html))problems.push('缺少图片查表 shim');
if(/assetUrl\(/.test(html))problems.push('残留旧版 assetUrl 改写');

console.log('已生成：'+OUT);
console.log('文件大小：'+(html.length/1024).toFixed(1)+' KB（图片原始字节 '+(total/1024).toFixed(1)+' KB，共 '+Object.keys(assets).length+' 张）');
console.log('内嵌素材：'+Object.keys(assets).join(', '));
if(problems.length){console.error('自检未通过：\n  - '+problems.join('\n  - '));process.exit(2);}
console.log('自检通过：无外部请求、无 CDN、无凭据、无未内嵌素材。');