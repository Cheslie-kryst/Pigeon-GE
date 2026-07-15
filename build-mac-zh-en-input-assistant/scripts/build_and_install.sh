#!/bin/zsh
set -euo pipefail

if (( $# < 1 || $# > 2 )); then
  echo "用法：$0 /绝对路径/项目文件夹 [安装目录]" >&2
  exit 2
fi

PROJECT="$1"
INSTALL_DIR="${2:-$HOME/Applications}"
BUILD_SCRIPT="$PROJECT/构建程序.command"
BUILT_APP="$PROJECT/build/中译英输入助手.app"
INSTALLED_APP="$INSTALL_DIR/中译英输入助手.app"

if [[ ! -x "$BUILD_SCRIPT" ]]; then
  echo "找不到可执行的构建程序：$BUILD_SCRIPT" >&2
  exit 1
fi

BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$PROJECT/Info.plist")"

"$BUILD_SCRIPT"

if [[ ! -d "$BUILT_APP" ]]; then
  echo "构建结束后没有找到 App：$BUILT_APP" >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR"
if [[ -e "$INSTALLED_APP" ]]; then
  BACKUP="$INSTALL_DIR/中译英输入助手.app.backup-$(date +%Y%m%d-%H%M%S)"
  mv "$INSTALLED_APP" "$BACKUP"
  echo "旧版本已备份：$BACKUP"
fi

/usr/bin/ditto "$BUILT_APP" "$INSTALLED_APP"
xattr -cr "$INSTALLED_APP"
xattr -d com.apple.FinderInfo "$INSTALLED_APP" 2>/dev/null || true
xattr -d 'com.apple.fileprovider.fpfs#P' "$INSTALLED_APP" 2>/dev/null || true
codesign --force --deep --sign - --requirements "=designated => identifier \"$BUNDLE_ID\"" "$INSTALLED_APP"
codesign --verify --deep --strict "$INSTALLED_APP"

echo "安装完成：$INSTALLED_APP"
echo "尚未自动启动。启动前请先征得用户同意。"
