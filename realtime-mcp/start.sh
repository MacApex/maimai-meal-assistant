#!/usr/bin/env bash
# 真实模式一键启动：网关 + 网页
# 前提：~/.workbuddy/mcp.json 已配置 mcd-mcp（凭据由用户维护，本脚本不接触其值）
set -u
NODE="${NODE:-/Users/maxima/.workbuddy/binaries/node/versions/22.22.2-6/bin/node}"
# 换机器时该路径通常不存在：回落到 PATH 里的 node，而不是报一个看不懂的错
if [ ! -x "$NODE" ]; then NODE="$(command -v node || echo node)"; fi
ROOT="$(cd "$(dirname "$0")" && pwd)"
GATEWAY_PORT="${GATEWAY_PORT:-8795}"
WEB_PORT="${WEB_PORT:-8796}"

cleanup(){ [ -n "${GW_PID:-}" ] && kill "$GW_PID" 2>/dev/null; [ -n "${WEB_PID:-}" ] && kill "$WEB_PID" 2>/dev/null; }
trap cleanup EXIT INT TERM

echo "=========================================================="
echo " 麦麦选餐 · 真实门店模式"
echo " 网关端口：$GATEWAY_PORT（仅 127.0.0.1）  网页端口：$WEB_PORT"
echo "=========================================================="

PORT="$GATEWAY_PORT" "$NODE" "$ROOT/server/gateway.js" &
GW_PID=$!
sleep 2

if ! kill -0 "$GW_PID" 2>/dev/null; then
  echo "✗ 网关启动失败，请检查 ~/.workbuddy/mcp.json 是否已配置 mcd-mcp"
  exit 1
fi

cd "$ROOT/web" && "$NODE" -e "
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=process.cwd();
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
http.createServer((req,res)=>{
 let p=new URL(req.url,'http://x').pathname;
 if(p==='/')p='/index.html';
 const f=path.join(ROOT,p);
 if(!f.startsWith(ROOT)||!fs.existsSync(f)){res.writeHead(404);return res.end('not found');}
 res.writeHead(200,{'content-type':MIME[path.extname(f)]||'application/octet-stream'});
 res.end(fs.readFileSync(f));
}).listen($WEB_PORT,'127.0.0.1');
" &
WEB_PID=$!
sleep 1

echo ""
echo " 真实模式网页：http://127.0.0.1:$WEB_PORT"
echo " 演示体验入口：01_代码/app/index.html（离线单文件或目录版）"
echo ""
echo " 说明："
echo "  · 网页只与本机网关通信，浏览器拿不到也无法获取 MCP 凭据"
echo "  · 网关只开放只读接口，下单/领券/积分/地址等写操作架构上不可调用"
echo "  · 服务仅监听 127.0.0.1，公网不可达；不对外提供访问"
echo ""
echo " 按 Ctrl+C 停止"
wait