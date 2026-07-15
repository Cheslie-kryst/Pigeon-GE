#!/bin/zsh
set -u

fail=0

echo "中译英输入助手：只读环境检查"
echo ""

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "[失败] 当前系统不是 macOS。"
  fail=1
else
  echo "[通过] 系统：macOS $(sw_vers -productVersion)"
fi

echo "[信息] 架构：$(uname -m)"

if command -v swiftc >/dev/null 2>&1; then
  echo "[通过] Swift：$(swiftc --version | head -n 1)"
else
  echo "[失败] 没有找到 Swift 编译器。需要先安装 Xcode Command Line Tools。"
  fail=1
fi

if SDK_PATH="$(xcrun --sdk macosx --show-sdk-path 2>/dev/null)"; then
  echo "[通过] macOS SDK：$SDK_PATH"
else
  echo "[提示] 无法读取当前 macOS SDK。"
fi

AVAILABLE_KB="$(df -Pk "$HOME" | awk 'NR==2 {print $4}')"
if [[ -n "$AVAILABLE_KB" ]]; then
  AVAILABLE_GB=$((AVAILABLE_KB / 1024 / 1024))
  echo "[信息] 用户磁盘可用空间：约 ${AVAILABLE_GB} GB"
  if (( AVAILABLE_GB < 5 )); then
    echo "[警告] 建议至少预留 5 GB 用于 Ollama、模型和构建文件。"
  fi
fi

if [[ -d /Applications/Ollama.app ]]; then
  echo "[通过] 已安装官方 Ollama App。"
elif command -v ollama >/dev/null 2>&1; then
  echo "[提示] 找到了 ollama 命令，但没有发现 /Applications/Ollama.app。请确认不是功能不完整的 Homebrew formula。"
else
  echo "[缺少] 尚未安装 Ollama。"
fi

if curl --silent --fail --max-time 2 http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
  echo "[通过] Ollama 本地服务正在运行。"
  if curl --silent --fail --max-time 5 http://127.0.0.1:11434/api/tags | /usr/bin/grep -q 'qwen3:4b-instruct'; then
    echo "[通过] 已安装 qwen3:4b-instruct。"
  else
    echo "[缺少] Ollama 中没有 qwen3:4b-instruct。"
  fi
else
  echo "[提示] Ollama 本地服务当前未运行。"
fi

exit "$fail"
