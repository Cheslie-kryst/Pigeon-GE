#!/bin/zsh
set -u

APP="${1:-$HOME/Applications/中译英输入助手.app}"
fail=0

echo "中译英输入助手：安装验证"
echo ""

if [[ ! -d "$APP" ]]; then
  echo "[失败] 找不到 App：$APP"
  exit 1
fi
echo "[通过] App 存在：$APP"

if codesign --verify --deep --strict "$APP" 2>/dev/null; then
  echo "[通过] 代码签名验证通过。"
else
  echo "[失败] 代码签名验证失败。"
  fail=1
fi

REQ="$(codesign -d -r- "$APP" 2>&1 || true)"
if [[ "$REQ" == *"identifier"* ]] && [[ "$REQ" != *"cdhash H"* ]]; then
  echo "[通过] 使用稳定的 Bundle ID designated requirement。"
else
  echo "[失败] designated requirement 可能仍依赖变化的 cdhash。"
  fail=1
fi

if curl --silent --fail --max-time 2 http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
  echo "[通过] Ollama 本地服务可访问。"
  if curl --silent --fail --max-time 5 http://127.0.0.1:11434/api/tags | /usr/bin/grep -q 'qwen3:4b-instruct'; then
    echo "[通过] qwen3:4b-instruct 已安装。"
  else
    echo "[失败] qwen3:4b-instruct 未安装。"
    fail=1
  fi
else
  echo "[失败] Ollama 本地服务不可访问。"
  fail=1
fi

echo ""
echo "还需要人工验证：菜单栏、辅助功能一次授权、TextEdit、主要聊天软件、密码框和切换焦点测试。"
echo "请按照 references/verification-checklist.md 记录结果。"

exit "$fail"
