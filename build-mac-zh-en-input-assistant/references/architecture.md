# Architecture

## Product boundary

This is a native macOS menu-bar helper, not a system input method. The user first commits Chinese text in an ordinary text field, then presses `Control+Shift+Space`. The helper translates and replaces that text. This approach is substantially simpler and safer than an InputMethodKit implementation while still working across many applications.

## Main flow

1. A Carbon global hotkey wakes the app.
2. `TextAccess` finds the real frontmost application and focused accessibility element.
3. It reads the selected text, or the editable value/current line when no selection exists.
4. If Accessibility reading is unavailable, an explicit-hotkey keyboard Copy fallback supports applications such as WeChat.
5. `TranslationService` sends only that text to the selected provider.
6. The result replaces the original range through Accessibility, or through the keyboard Paste fallback.
7. If the target is no longer safe, the result is placed on the clipboard instead of being pasted into another app.

## Components in the template

- `Sources/main.swift`: AppKit menu-bar UI, shortcut registration, Accessibility access, clipboard fallback, provider settings, Keychain storage, Ollama and DeepSeek requests.
- `Info.plist`: bundle metadata and menu-bar-only application configuration.
- `构建程序.command`: Swift compilation, app-bundle assembly, extended-attribute cleanup, and stable ad-hoc signing.
- `使用说明.md`: end-user setup and operation instructions.

## Translation providers

### Ollama

- Endpoint: loopback-only local Ollama API.
- Default model: `qwen3:4b-instruct`.
- Goal: natural, concise American conversational English without commentary.
- The first request after the model is unloaded can be materially slower than later requests.

### DeepSeek

- Optional cloud provider.
- API key is retrieved from macOS Keychain.
- Treat endpoint and model names as time-sensitive. Verify official documentation before modifying them.

## Build and compatibility

- The project deliberately avoids an Xcode project and external code dependencies.
- It compiles with the Swift toolchain and macOS SDK supplied by Xcode Command Line Tools.
- The build script uses an installed SDK fallback when the active toolchain reports an incompatible newest SDK.
- Stable designated signing requirements keep the Accessibility identity consistent across ad-hoc rebuilds.

## Intentional limitations

- It does not translate uncommitted text still inside a Chinese IME candidate/composition window.
- Accessibility support varies by application; the keyboard fallback is therefore retained.
- Secure fields are unsupported by design.
- Clipboard contents can be temporarily changed by fallback mode.
- It is a Mac-only implementation.
