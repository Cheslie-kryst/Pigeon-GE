# Privacy and security requirements

Treat these as release-blocking requirements.

## Data boundaries

- Default to local translation through Ollama on `127.0.0.1`. Do not expose Ollama to the LAN or internet.
- Text may leave the Mac only when the user explicitly selects and configures DeepSeek.
- Show the user which provider is active. Never silently fall back from local processing to a cloud service.
- Do not retain source text, translations, prompts, clipboard contents, or usage analytics.
- Do not add crash reporting, telemetry, auto-update frameworks, or third-party SDKs without separate informed consent.

## Credentials

- Store the DeepSeek API key in macOS Keychain.
- Never place credentials in Swift source, plist files, shell scripts, terminal output, screenshots, Git commits, or documentation examples.
- Redact secrets from errors. A connectivity check must not print an authorization header.

## Input access

- React only to the explicit global shortcut. Do not install a keylogger or observe ordinary typing.
- Prefer macOS Accessibility APIs to read and replace the focused editable text.
- The keyboard fallback may issue Copy and Paste only after the shortcut is pressed. It may temporarily replace the clipboard; disclose this limitation in the user guide.
- Refuse password fields and secure-entry controls.
- Re-check that the same app and text target remain active before replacing text. If focus changed, copy the translation to the clipboard instead.

## Permissions and identity

- Request only Accessibility permission. Do not request Full Disk Access, Screen Recording, Contacts, microphone, camera, or location.
- Sign builds with a stable designated requirement based on the bundle identifier so routine rebuilds do not produce repeated Accessibility prompts.
- Install and sign the final copy at its permanent path before asking the user to grant permission.
- Diagnose before using `tccutil reset`; resetting privacy permissions affects user state and requires explicit approval.

## Downloads and installation

- Explain that the local model is a multi-gigabyte download before starting.
- Use official Ollama distribution channels. Prefer the official app or the Homebrew cask, not the formula.
- Do not use `sudo`, modify shell profiles, open ports, or create background login items unless the user separately approves and understands the change.

## Repository hygiene

- Do not commit built app bundles, model weights, API keys, `.DS_Store`, logs, or local build directories.
- Keep third-party model and service names descriptive; do not imply their vendors endorse this project.
- Preserve the privacy defaults when adapting the template.
