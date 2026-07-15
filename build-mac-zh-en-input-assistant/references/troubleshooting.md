# Troubleshooting

## Repeated Accessibility permission requests

1. Confirm the app being launched is the final installed copy, not a different build path.
2. Run `codesign -d -r-` on the app and confirm its designated requirement uses the expected bundle identifier rather than only a changing cdhash.
3. Remove Finder/File Provider extended attributes and re-sign the final installed app.
4. Quit and reopen the app after enabling Accessibility.
5. Reset the app's Accessibility entry only with user approval and only after correcting its signing/path identity.

Normal shortcut handling must use `AXIsProcessTrustedWithOptions` with prompting disabled. Otherwise one unsupported text field can look like a permission failure and produce repeated dialogs.

## “没有找到正在输入的文本框”

- Commit the Chinese text before pressing the shortcut; an active IME composition is not ordinary text yet.
- Ensure the caret remains in the intended editable field.
- Test in TextEdit to separate an application-specific accessibility limitation from a general failure.
- For WeChat and similar apps, retain the keyboard Copy fallback and ensure Accessibility is enabled.
- Password and secure-entry fields are deliberately rejected.

## Shortcut does nothing or opens Spotlight

- The supported default is `Control+Shift+Space`, not `Option+Space`.
- Confirm the app is running in the menu bar.
- Check whether another utility has claimed the same shortcut. Change the registered Carbon modifiers/key only if needed, and update the user guide at the same time.

## Ollama cannot be reached

- Confirm `/Applications/Ollama.app` is installed and running.
- Check `http://127.0.0.1:11434/api/version` locally.
- If the Homebrew formula reports a missing `llama-server`, remove that formula through the user's chosen package-management process and install the official app or Homebrew cask instead.
- Do not bind Ollama to a public network address to solve a local connection problem.

## Model is missing or produces reasoning text

- Pull `qwen3:4b-instruct`.
- Do not substitute the reasoning-oriented `qwen3:4b` tag without validating its output.
- Keep the system prompt explicit: return only the natural American-English translation, with no explanation or analysis.

## Translation feels slow

- A cold local-model start can take roughly 20–30 seconds on some Macs; warm requests are commonly much faster.
- Confirm the Mac has sufficient memory and disk space.
- Do not secretly switch to DeepSeek for speed. Let the user opt in to cloud processing.

## Swift or SDK build errors

- Run `xcrun --sdk macosx --show-sdk-path` and `swiftc --version`.
- Prefer a compatible installed SDK. The template checks `/Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk` before the active SDK because some toolchain/SDK combinations can mismatch.
- Do not download a different Xcode toolchain without explaining the size and obtaining permission.

## Signing fails after copying from a synced folder

Finder or a File Provider can add `com.apple.FinderInfo` or provider attributes after the first signing step. Remove extended attributes from the final installed copy, then sign and verify that copy again. Do not weaken Gatekeeper globally.

## Focus changed while translating

Do not paste automatically. Put the result on the clipboard, display a clear message, and let the user paste it deliberately.
