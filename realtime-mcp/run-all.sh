#!/usr/bin/env bash
# 一键复跑真实模式全部测试。
# 第四版反馈要求：
#   - 任何必需测试失败，整体必须返回非零退出码
#   - 必须验证服务身份与就绪状态，避免命中旧服务
#   - 页面错误导致失败；skipped 与 passed 分开统计
set -u

NODE="${NODE:-/Users/maxima/.workbuddy/binaries/node/versions/22.22.2-6/bin/node}"
# 换机器时该路径通常不存在：回落到 PATH 里的 node
if [ ! -x "$NODE" ]; then NODE="$(command -v node || echo node)"; fi
ROOT="$(cd "$(dirname "$0")" && pwd)"
GATEWAY_PORT="${GATEWAY_PORT:-8795}"
WEB_PORT="${WEB_PORT:-8796}"
STAGE="${STAGE:-run}"

GW_PID=""
WEB_PID=""
TOKEN_FILE=""
FAILED=0
SUMMARY=""

cleanup() {
  [ -n "$GW_PID" ] && kill "$GW_PID" 2>/dev/null
  [ -n "$WEB_PID" ] && kill "$WEB_PID" 2>/dev/null
  [ -n "$TOKEN_FILE" ] && rm -f "$TOKEN_FILE" 2>/dev/null
  return 0
}
trap cleanup EXIT INT TERM

record() {
  # $1 name  $2 rc  $3 total  $4 passed  $5 skipped
  local name="$1" rc="$2" total="$3" passed="$4" skipped="$5" status="PASS"
  if [ "$rc" -ne 0 ]; then status="FAIL"; FAILED=1; fi
  local line
  line=$(printf '  %-22s %-4s 退出码=%-3s 通过=%s/%s 跳过=%s' "$name" "$status" "$rc" "$passed" "$total" "$skipped")
  SUMMARY="${SUMMARY}${line}
"
  echo "[$status] $name  退出码=$rc  通过=$passed/$total  跳过=$skipped"
}

json_field() { "$NODE" -e "try{const j=require(process.argv[1]);console.log(j[process.argv[2]]!==undefined?j[process.argv[2]]:0)}catch(e){console.log(0)}" "$1" "$2"; }

echo "=== 启动本次服务 (gateway=$GATEWAY_PORT web=$WEB_PORT) ==="

# 端口必须空闲：不允许命中残留旧进程
for p in "$GATEWAY_PORT" "$WEB_PORT"; do
  if lsof -ti tcp:"$p" >/dev/null 2>&1; then
    echo "端口 $p 已被占用。请先停掉占用进程，避免命中旧服务。"
    exit 2
  fi
done

TOKEN_FILE="$(mktemp -t mcdgw).txt"
PORT="$GATEWAY_PORT" WEB_PORT="$WEB_PORT" MCD_GATEWAY_TOKEN_FILE="$TOKEN_FILE" \
  "$NODE" "$ROOT/server/gateway.js" > "$ROOT/证据/gateway.log" 2>&1 &
GW_PID=$!
WEB_PORT="$WEB_PORT" MCD_GATEWAY_TOKEN_FILE="$TOKEN_FILE" \
  "$NODE" "$ROOT/server/web.js" > "$ROOT/证据/web.log" 2>&1 &
WEB_PID=$!

# 就绪判定：必须拿到本次 runId 与源码指纹，而不是"端口能连上"
READY=""
i=0
while [ "$i" -lt 40 ]; do
  sleep 0.25
  i=$((i+1))
  READY=$("$NODE" -e '
const http=require("http");
http.get({host:"127.0.0.1",port:process.argv[1],path:"/api/health"},r=>{
 let b="";r.on("data",c=>b+=c);
 r.on("end",()=>{try{const j=JSON.parse(b);
  if(j.ok&&j.runId&&j.sourceSha)process.stdout.write(j.runId+" "+j.sourceSha);}catch(e){}});
}).on("error",()=>{});' "$GATEWAY_PORT" 2>/dev/null)
  [ -n "$READY" ] && break
done

if [ -z "$READY" ]; then
  echo "网关未在 10 秒内就绪（拿不到 runId）。拒绝继续，避免把旧服务当成本次结果。"
  exit 3
fi

RUN_ID="${READY%% *}"
SRC_SHA="${READY##* }"
DISK_SHA=$("$NODE" -e '
const c=require("crypto"),f=require("fs");
process.stdout.write(c.createHash("sha256").update(f.readFileSync(process.argv[1])).digest("hex"));' \
  "$ROOT/server/gateway.js")

if [ "$SRC_SHA" != "$DISK_SHA" ]; then
  echo "运行中的网关源码指纹与磁盘不一致，拒绝继续。"
  exit 4
fi

echo "本次服务 runId=$RUN_ID"
echo "代码 hash gateway.js=$SRC_SHA (与磁盘一致)"
echo ""

run_suite() {
  # $1 name  $2 script  $3 expectedTotal  $4 resultJsonBasename
  local name="$1" script="$2" exp="$3" base="$4"
  echo "--- $name ---"
  "$NODE" "$ROOT/test/$script" --stage "$STAGE"
  local rc=$?
  local passed=0 skipped=0
  if [ -n "$base" ] && [ -f "$ROOT/整改记录/第四轮/$base.json" ]; then
    passed=$(json_field "$ROOT/整改记录/第四轮/$base.json" passed)
    skipped=$(json_field "$ROOT/整改记录/第四轮/$base.json" skipped)
  fi
  record "$name" "$rc" "$exp" "$passed" "$skipped"
  echo ""
}

run_suite "离线反例-网关侧" "regress-r4.cjs"        4  ""
run_suite "离线反例-前端"   "regress-r4-fe.js"      10 "regress-r4-fe-$STAGE"
run_suite "网关安全"        "gateway-security.cjs"  17 "gateway-security"
run_suite "纵向流程"        "web-flow.cjs"         16 "web-flow-tests"
run_suite "补充场景"        "web-scenarios.cjs"    4  "web-scenarios"
run_suite "五入口一致性"    "entry-consistency.cjs" 10 "entry-consistency"
run_suite "隐私自检"        "privacy-scan.cjs"     4  "privacy-scan"
run_suite "响应式与缩放"    "responsive.cjs"       6  "响应式与缩放"

echo "--- 报价重算校验 (真实网关) ---"
"$NODE" "$ROOT/test/quote-recheck.cjs"
RC=$?
PASSED=$(json_field "$ROOT/整改记录/第四轮/报价重算校验.json" passed)
record "报价重算校验" "$RC" 3 "$PASSED" 0
echo ""

echo "=============================================="
echo " 汇总"
printf '%s' "$SUMMARY"
echo " 运行身份 runId=$RUN_ID"
echo " 代码 hash gateway.js=$SRC_SHA"
echo "=============================================="

if [ "$FAILED" -ne 0 ]; then
  echo "存在必需测试失败：整体返回非零退出码。"
  exit 1
fi
echo "全部必需测试通过。"
exit 0