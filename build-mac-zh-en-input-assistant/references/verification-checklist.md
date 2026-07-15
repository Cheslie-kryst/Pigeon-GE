# Verification checklist

Record actual pass/fail evidence. Do not infer success from a zero-exit build alone.

## Automated checks

- The `.app` exists at the reported installed path.
- `codesign --verify --deep --strict` passes.
- The designated requirement contains the app bundle identifier and is not only a cdhash.
- Ollama answers on `127.0.0.1:11434` when local mode is selected.
- `qwen3:4b-instruct` appears in the local model list.
- A direct local test translates a simple Chinese sentence and returns English without analysis text.

## Manual functional checks

1. Launch the final installed copy and confirm the menu-bar item appears.
2. Enable Accessibility once, quit, and reopen the app.
3. In TextEdit, type and commit `今天下午三点开会。` then press `Control+Shift+Space`.
4. Confirm the Chinese is replaced with natural English and no permission dialog repeats.
5. In WeChat or the user's main chat app, repeat with `我晚点把文件发给你。`.
6. Test business language: `这个SKU今天先不要补货，等利润核算完成。`.
7. Confirm a password field is not read or replaced.
8. Switch focus immediately after invoking translation; confirm the result is not pasted into the wrong app.

## Privacy checks

- Local mode remains selected after restart.
- No API key exists in project files or console output.
- No translation-history or analytics files are created.
- Ollama remains bound to loopback for this workflow.
- DeepSeek is not contacted unless explicitly configured and selected.

## Handoff record

Provide:

- app path;
- project path;
- active provider and model;
- shortcut;
- location of `使用说明.md`;
- which automated and manual checks passed;
- any unverified application or remaining limitation.
