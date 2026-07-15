#!/bin/zsh
set -euo pipefail

MODEL="${1:-qwen3:4b-instruct}"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "这个安装脚本只支持 macOS。" >&2
  exit 1
fi

if [[ ! -d /Applications/Ollama.app ]]; then
  if ! command -v brew >/dev/null 2>&1; then
    echo "没有找到 Homebrew。请从 Ollama 官方网站安装 Mac App，或先在用户同意后安装 Homebrew。" >&2
    exit 1
  fi
  echo "即将通过 Homebrew cask 下载并安装官方 Ollama App。"
  brew install --cask ollama
fi

if ! curl --silent --fail --max-time 2 http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
  echo "正在启动 Ollama App……"
  open -a Ollama
  for _ in {1..30}; do
    if curl --silent --fail --max-time 2 http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
fi

if ! curl --silent --fail --max-time 2 http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
  echo "Ollama App 已安装，但本地服务没有在 30 秒内启动。请打开 Ollama 后重试。" >&2
  exit 1
fi

if [[ -x /Applications/Ollama.app/Contents/Resources/ollama ]]; then
  OLLAMA_BIN=/Applications/Ollama.app/Contents/Resources/ollama
elif command -v ollama >/dev/null 2>&1; then
  OLLAMA_BIN="$(command -v ollama)"
else
  echo "找不到 Ollama 命令行程序。请重新安装官方 Ollama App。" >&2
  exit 1
fi

if curl --silent --fail --max-time 5 http://127.0.0.1:11434/api/tags | /usr/bin/grep -q "\"name\":\"${MODEL}\""; then
  echo "模型已存在：$MODEL"
else
  echo "即将下载模型 $MODEL。下载量可能达到数 GB，请保持网络和电源稳定。"
  "$OLLAMA_BIN" pull "$MODEL"
fi

echo "本地翻译环境已准备好：$MODEL"
