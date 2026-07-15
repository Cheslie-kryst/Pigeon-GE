#!/bin/zsh
set -euo pipefail

if (( $# < 1 || $# > 2 )); then
  echo "用法：$0 /绝对路径/项目文件夹 [反向域名BundleID]" >&2
  exit 2
fi

SCRIPT_DIR="${0:A:h}"
SKILL_DIR="${SCRIPT_DIR:h}"
TEMPLATE_DIR="$SKILL_DIR/assets/template"
DEST="$1"
BUNDLE_ID="${2:-com.local.zh-en-input-assistant}"

if [[ "$DEST" != /* ]]; then
  echo "请使用绝对路径，避免把项目创建到错误位置：$DEST" >&2
  exit 2
fi

if [[ ! "$BUNDLE_ID" =~ '^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$' ]]; then
  echo "Bundle ID 格式无效：$BUNDLE_ID" >&2
  exit 2
fi

if [[ -e "$DEST" ]] && [[ -n "$(find "$DEST" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]; then
  echo "目标文件夹不是空的，已停止以免覆盖文件：$DEST" >&2
  exit 1
fi

mkdir -p "$DEST"
/bin/cp -R "$TEMPLATE_DIR/." "$DEST/"
/usr/bin/plutil -replace CFBundleIdentifier -string "$BUNDLE_ID" "$DEST/Info.plist"
chmod +x "$DEST/构建程序.command"

echo "项目已创建：$DEST"
echo "Bundle ID：$BUNDLE_ID"
echo "用户说明：$DEST/使用说明.md"
