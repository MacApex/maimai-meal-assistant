#!/usr/bin/env bash
# 在干净目录按 README 的精确命令复跑，并记录完整输出。
# 用途：证明待提交包可独立复现，而不是在开发目录跑完再复制报告。
set -u
N="${NODE:-/Users/maxima/.workbuddy/binaries/node/versions/22.22.2-6/bin/node}"
ROOT="/Users/maxima/Desktop/麦当劳创意开发WorkBuddy/07_WorkBuddy独立产出"
PKG="$ROOT/06_GitHub待提交包"
OUT="$ROOT/整改记录/第二轮/证据/干净目录复跑.txt"

CLEAN="$(mktemp -d)/clean-pkg"
cp -R "$PKG" "$CLEAN"

{
  echo "干净目录：$CLEAN"
  echo "Node：$("$N" -v)"
  echo "生成时间：$(date '+%Y-%m-%d %H:%M:%S %Z')"
  echo "================================================================"
  cd "$CLEAN/app" || exit 1

  echo ""
  echo "【1】node --test tests/*.test.cjs"
  "$N" --test tests/*.test.cjs 2>&1 | grep -E "^# (tests|pass|fail)|^not ok"
  echo "  退出码=${PIPESTATUS[0]}"

  echo ""
  echo "【2】node tests/browser-wizard.cjs"
  "$N" tests/browser-wizard.cjs 2>&1 | grep -E '"status"|"checks"|"screenshots"|"failure"'

  echo ""
  echo "【3】node tests/batch1-cart.cjs"
  "$N" tests/batch1-cart.cjs 2>&1 | tail -2

  echo ""
  echo "【4】node --test tests/round2-regressions.test.cjs"
  "$N" --test tests/round2-regressions.test.cjs 2>&1 | grep -E "^# (tests|pass|fail)"

  echo ""
  echo "【5】node build-all.js --check"
  "$N" build-all.js --check 2>&1 | grep -E "漂移"
  echo "  退出码=$?"

  echo ""
  echo "【6】node secret-scan.js"
  "$N" secret-scan.js 2>&1 | tail -2
  echo "  退出码=$?"
} > "$OUT" 2>&1

cat "$OUT"
echo ""
echo "（临时干净目录 $CLEAN 保留在 /tmp，可自行复查）"