#!/usr/bin/env node
/* 静态服务：真实模式网页 + 演示体验入口 + 经典自主选餐入口。
   P1-05：旧实现把演示入口写成 ../01_代码/app/index.html，
   而本服务的根就是 web/，该路径必然 404，且"外层工作区恰好有文件"
   不能作为路由保证。这里用显式挂载点提供，且不存在就直接 404 + 说明。 */
'use strict';
const http=require('http'),fs=require('fs'),path=require('path');

const WEB=path.resolve(__dirname,'..','web');
const PROJECT=path.resolve(WEB,'..','..');           // 07_WorkBuddy独立产出
const DEMO_DIR=path.join(PROJECT,'01_代码','app');
const DEMO_STANDALONE=path.join(PROJECT,'06_GitHub待提交包','standalone');
const PORT=Number(process.env.WEB_PORT||8796);

const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
 '.css':'text/css; charset=utf-8','.webp':'image/webp','.png':'image/png',
 '.json':'application/json; charset=utf-8','.svg':'image/svg+xml'};

/* 只允许挂载这几个明确目录，不做任意路径穿越 */
const MOUNTS=[
 {prefix:'/demo/',dir:DEMO_DIR},
 {prefix:'/standalone/',dir:DEMO_STANDALONE}
];

function resolveFile(pathname){
 if(pathname==='/'||pathname==='/index.html')
  return path.join(WEB,'index.html');
 /* 显式挂载点优先（演示目录等） */
 for(const m of MOUNTS){
  if(pathname.startsWith(m.prefix)){
   const rel=decodeURIComponent(pathname.slice(m.prefix.length));
   const abs=path.resolve(m.dir,rel);
   if(!abs.startsWith(path.resolve(m.dir)))return null; /* 阻断 .. */
   return abs;
  }
 }
 /* 其余一律回落到真实模式网页目录。
    早前漏了这一步，导致 /app.js、/app.css 全部 404，页面只剩"正在检查本地网关…"。 */
 const rel=decodeURIComponent(pathname).replace(/^\/+/,'');
 const abs=path.resolve(WEB,rel);
 if(!abs.startsWith(path.resolve(WEB)))return null; /* 阻断 .. */
 return abs;
}

const TOKEN_FILE=process.env.MCD_GATEWAY_TOKEN_FILE;

const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://x').pathname;
 /* 会话令牌：只对来自本网页自身的同源请求下发。
    其他本机页面拿不到令牌，因此无法借用本机凭据调用网关。 */
 if(pathname==='/api/session'){
  /* 同源 GET 可能不带 Origin，因此以 Host 为主判据；
     若带了 Origin，则必须精确等于本服务地址。 */
  const host=(req.headers.host||'').split(':')[0];
  const o=req.headers.origin;
  let ok=(host==='127.0.0.1'||host==='localhost');
  if(o)ok=ok&&(o==='http://127.0.0.1:'+PORT||o==='http://localhost:'+PORT);
  if(!ok){res.writeHead(403,{'content-type':'application/json'});return res.end(JSON.stringify({ok:false,code:'FORBIDDEN'}));}
  if(!TOKEN_FILE||!fs.existsSync(TOKEN_FILE)){res.writeHead(503,{'content-type':'application/json'});return res.end(JSON.stringify({ok:false}));}
  const t=fs.readFileSync(TOKEN_FILE,'utf8').trim();
  res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
  return res.end(JSON.stringify({token:t}));
 }
 if(pathname==='/healthz')
  return json(res,200,{ok:true,service:'mcd-real-web',port:PORT});
 const f=resolveFile(pathname);
 if(!f||!fs.existsSync(f)||!fs.statSync(f).isFile()){
  const html=`<!doctype html><meta charset=utf-8><title>找不到页面</title>
<body style="font:16px/1.6 -apple-system,sans-serif;padding:40px;max-width:640px">
<h1>404 该地址没有内容</h1>
<p>请求路径：<code>${pathname.replace(/</g,'&lt;')}</code></p>
<p>本服务只挂载了三个位置：</p>
<ul>
 <li><a href="/">/</a> — 真实门店模式</li>
 <li><a href="/demo/index.html">/demo/</a> — 演示体验（目录版）</li>
 <li><a href="/standalone/index.html">/standalone/</a> — 演示体验（单文件版）</li>
</ul>
<p>演示目录是否存在：${fs.existsSync(DEMO_DIR)?'是':'否'}（${DEMO_DIR.replace(/</g,'&lt;')}）</p>
</body>`;
  res.writeHead(404,{'content-type':'text/html; charset=utf-8'});
  return res.end(html);
 }
 res.writeHead(200,{'content-type':MIME[path.extname(f).toLowerCase()]||'application/octet-stream',
  'cache-control':'no-store'});
 res.end(fs.readFileSync(f));
});
function json(res,c,o){res.writeHead(c,{'content-type':'application/json'});res.end(JSON.stringify(o));}

server.listen(PORT,'127.0.0.1',()=>{
 console.log('web 已启动 http://127.0.0.1:'+PORT);
 console.log('  /                 真实门店模式');
 console.log('  /demo/            演示体验（目录版）'+(fs.existsSync(DEMO_DIR)?'':' ←目录不存在'));
 console.log('  /standalone/      演示体验（单文件版）'+(fs.existsSync(DEMO_STANDALONE)?'':' ←不存在'));
});