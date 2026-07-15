#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h}"
APP="$ROOT/build/中译英输入助手.app"
CONTENTS="$APP/Contents"
MACOS="$CONTENTS/MacOS"
RESOURCES="$CONTENTS/Resources"
SOURCE="$ROOT/Sources/main.swift"
TMP_SOURCE="/tmp/zh-en-input-main.swift"
BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$ROOT/Info.plist")"

SDK="/Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk"
if [[ ! -d "$SDK" ]]; then
  SDK="$(xcrun --sdk macosx --show-sdk-path)"
fi

mkdir -p "$MACOS" "$RESOURCES" /tmp/zh-en-input-clang-cache
cp "$SOURCE" "$TMP_SOURCE"

CLANG_MODULE_CACHE_PATH=/tmp/zh-en-input-clang-cache \
swiftc \
  -sdk "$SDK" \
  -parse-as-library \
  -O \
  -framework AppKit \
  -framework Carbon \
  -framework ApplicationServices \
  -framework Security \
  "$TMP_SOURCE" \
  -o "$MACOS/中译英输入助手"

cp "$ROOT/Info.plist" "$CONTENTS/Info.plist"
chmod +x "$MACOS/中译英输入助手"

for attempt in 1 2 3; do
  xattr -cr "$APP"
  xattr -d com.apple.FinderInfo "$APP" 2>/dev/null || true
  xattr -d 'com.apple.fileprovider.fpfs#P' "$APP" 2>/dev/null || true
  if codesign --force --deep --sign - --requirements "=designated => identifier \"$BUNDLE_ID\"" "$APP"; then
    break
  fi
  if [[ "$attempt" == "3" ]]; then
    exit 1
  fi
done

echo "构建完成：$APP"
