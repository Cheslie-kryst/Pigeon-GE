---
name: build-mac-zh-en-input-assistant
description: Build, install, verify, debug, or package a privacy-first macOS Chinese-to-natural-American-English input assistant using Swift/AppKit, a global shortcut, local Ollama translation, and an optional DeepSeek provider. Use when an AI needs to reproduce this Mac-only utility, install it for a user, fix Accessibility, shortcut, text-field, Ollama, or signing problems, or prepare a shareable GitHub-ready project.
---

# Build a Mac Chinese-to-English Input Assistant

Build a native menu-bar utility that replaces committed Chinese text with natural American conversational English after the user presses a global shortcut.

## Fixed defaults

- Support macOS only. Do not claim iPhone, iPad, Windows, or Android support.
- Use `Control+Shift+Space` as the default shortcut.
- Prefer local Ollama with `qwen3:4b-instruct` so text stays on the Mac.
- Offer DeepSeek only after the user explicitly chooses cloud translation.
- Store any API key in macOS Keychain, never in source, configuration files, logs, or shell history.
- Do not record keystrokes, translation history, analytics, or clipboard history.

Read [privacy-security.md](references/privacy-security.md) before changing or installing anything. Read [architecture.md](references/architecture.md) before modifying the template. Load [troubleshooting.md](references/troubleshooting.md) only when diagnosing a failure. Complete [verification-checklist.md](references/verification-checklist.md) before handoff.

## Workflow

### 1. Inspect without changing the Mac

Run:

```bash
scripts/preflight.sh
```

Report macOS version, CPU architecture, Swift availability, free disk space, Ollama state, and whether the required model is already present. Stop if the host is not macOS or Swift is unavailable.

### 2. Obtain consent for state-changing actions

Explain the size and purpose before downloading Ollama or a model. Ask before:

- downloading packages or models;
- installing software or copying an app into Applications;
- launching a GUI application;
- opening System Settings or resetting macOS privacy permissions;
- enabling DeepSeek or sending text to any remote service.

Do not bundle Ollama, a model, or an API key into this repository.

### 3. Create the project

Create a fresh project from the tested template:

```bash
scripts/create_project.sh "/absolute/output/folder"
```

Optionally pass a reverse-domain bundle identifier as the second argument. Do not overwrite a non-empty destination. Preserve `使用说明.md` in the generated project.

### 4. Prepare local translation

If Ollama or the model is missing and the user approved the download, run:

```bash
scripts/install_local_model.sh
```

Prefer the official Ollama macOS app or Homebrew cask. Do not install the Homebrew formula: some versions lack the required model runner. Use `qwen3:4b-instruct`, not a reasoning-oriented `qwen3:4b` tag.

### 5. Build and install

Build the generated project and install it to the user's Applications folder:

```bash
scripts/build_and_install.sh "/absolute/output/folder"
```

The default destination is `~/Applications`. Pass `/Applications` only when the user requests a system-wide install and approves any required privilege escalation. Keep a timestamped backup if an older app exists.

Use stable ad-hoc signing requirements tied to the bundle identifier. Removing extended attributes and re-signing the final installed copy is part of the install, not an optional cleanup.

### 6. Launch and grant permission

After obtaining approval, launch the installed app. Guide the user to:

1. Open System Settings → Privacy & Security → Accessibility.
2. Enable the installed `中译英输入助手` app once.
3. Quit and reopen the app after changing permission.

Never repeatedly prompt for Accessibility on every shortcut press. The template intentionally performs a silent trust check during normal use.

### 7. Verify with evidence

Run:

```bash
scripts/verify_installation.sh "/absolute/path/中译英输入助手.app"
```

Then perform the manual tests in [verification-checklist.md](references/verification-checklist.md). Report actual results, failures, app path, selected provider, model name, and the location of `使用说明.md`. Do not state that installation or translation works without evidence.

## Cloud provider rule

Enable DeepSeek only when the user asks for it or accepts that selected Chinese text will leave the Mac. Because API endpoints, models, and pricing can change, verify current details from DeepSeek's official documentation before altering the implementation. Keep the local provider as the default and retain a visible provider selector.

## Failure handling

- Do not reset Accessibility permissions as a first response. Diagnose signing identity, installed path, and actual trust state first.
- Do not ask for Accessibility again when the real problem is an unsupported text field.
- If a native accessibility text read fails, allow the explicit-hotkey keyboard copy/paste fallback already included in the template.
- Never attempt to read or replace text in password or secure-entry fields.
- If focus changes while translation is running, preserve the result in the clipboard and tell the user rather than pasting into the wrong app.
- If a test requires network access, installation, GUI control, or privacy-setting changes, obtain the appropriate approval.

## Repository user entry point

For a person who downloaded this skill from GitHub, use [how-to-use-this-skill.md](references/how-to-use-this-skill.md) as the human-facing starting guide. The user should be able to give the folder and the sample prompt to a capable coding AI, then let that AI follow this workflow with explicit confirmations.
