import AppKit
import ApplicationServices
import Carbon
import Foundation
import Security

enum Provider: String, CaseIterable {
    case ollama
    case deepSeek

    var title: String {
        switch self {
        case .ollama: return "免费本地模型（Ollama）"
        case .deepSeek: return "DeepSeek API"
        }
    }
}

enum Tone: String, CaseIterable {
    case natural
    case casual
    case business

    var title: String {
        switch self {
        case .natural: return "自然日常（推荐）"
        case .casual: return "更口语、轻松"
        case .business: return "礼貌商务"
        }
    }

    var instruction: String {
        switch self {
        case .natural:
            return "natural everyday American English that a native speaker would actually use"
        case .casual:
            return "casual, concise American conversational English, friendly but not slang-heavy"
        case .business:
            return "polite, concise American business English, professional without sounding stiff"
        }
    }
}

final class Settings {
    static let shared = Settings()
    private let defaults = UserDefaults.standard

    var provider: Provider {
        get { Provider(rawValue: defaults.string(forKey: "provider") ?? "ollama") ?? .ollama }
        set { defaults.set(newValue.rawValue, forKey: "provider") }
    }

    var tone: Tone {
        get { Tone(rawValue: defaults.string(forKey: "tone") ?? "natural") ?? .natural }
        set { defaults.set(newValue.rawValue, forKey: "tone") }
    }

    var ollamaModel: String {
        get { defaults.string(forKey: "ollamaModel") ?? "qwen3:4b-instruct" }
        set { defaults.set(newValue.trimmingCharacters(in: .whitespacesAndNewlines), forKey: "ollamaModel") }
    }

    var translateCurrentSentence: Bool {
        get { defaults.object(forKey: "translateCurrentSentence") as? Bool ?? true }
        set { defaults.set(newValue, forKey: "translateCurrentSentence") }
    }
}

enum KeychainStore {
    private static let service = Bundle.main.bundleIdentifier ?? "com.local.zh-en-input-assistant"
    private static let account = "deepseek-api-key"

    static func read() -> String {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data,
              let value = String(data: data, encoding: .utf8) else { return "" }
        return value
    }

    static func save(_ value: String) {
        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        SecItemDelete(base as CFDictionary)
        guard !value.isEmpty, let data = value.data(using: .utf8) else { return }
        var item = base
        item[kSecValueData as String] = data
        SecItemAdd(item as CFDictionary, nil)
    }
}

struct TranslationError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

struct TranslationService {
    static func translate(_ chinese: String) async throws -> String {
        let settings = Settings.shared
        let systemPrompt = """
        You are a precise Chinese-to-English translator for real-time text input.
        Translate the user's Chinese into \(settings.tone.instruction).
        Preserve all names, brands, SKU codes, numbers, URLs, emojis, and factual meaning.
        Do not add facts, explanations, quotation marks, labels, or alternatives.
        Return ONLY the final U.S. English translation.
        """

        switch settings.provider {
        case .ollama:
            return try await translateWithOllama(chinese, systemPrompt: systemPrompt)
        case .deepSeek:
            return try await translateWithDeepSeek(chinese, systemPrompt: systemPrompt)
        }
    }

    private static func translateWithOllama(_ text: String, systemPrompt: String) async throws -> String {
        guard let url = URL(string: "http://127.0.0.1:11434/api/chat") else {
            throw TranslationError(message: "本地模型地址无效。")
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 90
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "model": Settings.shared.ollamaModel,
            "stream": false,
            "think": false,
            "keep_alive": "10m",
            "messages": [
                ["role": "system", "content": systemPrompt],
                ["role": "user", "content": text]
            ],
            "options": ["temperature": 0.2, "num_ctx": 4096, "num_predict": 128]
        ])

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                let detail = String(data: data, encoding: .utf8) ?? ""
                throw TranslationError(message: "本地模型返回错误。\n\(detail)")
            }
            let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
            let message = json?["message"] as? [String: Any]
            guard let content = message?["content"] as? String else {
                throw TranslationError(message: "无法读取本地模型返回结果。")
            }
            return clean(content)
        } catch let error as TranslationError {
            throw error
        } catch {
            throw TranslationError(message: "无法连接免费本地模型。请先安装并运行 Ollama，再下载 \(Settings.shared.ollamaModel)。")
        }
    }

    private static func translateWithDeepSeek(_ text: String, systemPrompt: String) async throws -> String {
        let apiKey = KeychainStore.read().trimmingCharacters(in: .whitespacesAndNewlines)
        guard !apiKey.isEmpty else {
            throw TranslationError(message: "尚未填写 DeepSeek API Key，请先打开设置。")
        }
        guard let url = URL(string: "https://api.deepseek.com/chat/completions") else {
            throw TranslationError(message: "DeepSeek API 地址无效。")
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 45
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "model": "deepseek-v4-flash",
            "thinking": ["type": "disabled"],
            "max_tokens": 512,
            "messages": [
                ["role": "system", "content": systemPrompt],
                ["role": "user", "content": text]
            ]
        ])

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw TranslationError(message: "DeepSeek 没有返回有效响应。")
        }
        guard (200..<300).contains(http.statusCode) else {
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            let error = json?["error"] as? [String: Any]
            let detail = error?["message"] as? String ?? "HTTP \(http.statusCode)"
            throw TranslationError(message: "DeepSeek 调用失败：\(detail)")
        }
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let choices = json?["choices"] as? [[String: Any]]
        let message = choices?.first?["message"] as? [String: Any]
        guard let content = message?["content"] as? String else {
            throw TranslationError(message: "无法读取 DeepSeek 返回结果。")
        }
        return clean(content)
    }

    private static func clean(_ text: String) -> String {
        var result = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if result.hasPrefix("\"") && result.hasSuffix("\"") && result.count >= 2 {
            result.removeFirst()
            result.removeLast()
        }
        if let thinkEnd = result.range(of: "</think>") {
            result = String(result[thinkEnd.upperBound...]).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return result
    }
}

enum ReplacementTarget {
    case accessibility(element: AXUIElement, range: CFRange)
    case keyboard(applicationPID: pid_t)
}

struct TextTarget {
    let source: String
    let replacement: ReplacementTarget
}

enum TextAccess {
    static func isTrusted(prompt: Bool) -> Bool {
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: prompt] as CFDictionary
        return AXIsProcessTrustedWithOptions(options)
    }

    static func capture() throws -> TextTarget {
        guard isTrusted(prompt: false) else {
            throw TranslationError(message: "请先在系统设置的“隐私与安全性 → 辅助功能”中允许本程序。")
        }

        if let target = captureUsingAccessibility() {
            return target
        }
        return try captureUsingKeyboard()
    }

    private static func captureUsingAccessibility() -> TextTarget? {
        guard let element = focusedElement() else { return nil }

        var rangeValue: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXSelectedTextRangeAttribute as CFString, &rangeValue) == .success,
              let rangeValue,
              CFGetTypeID(rangeValue) == AXValueGetTypeID() else { return nil }
        let axValue = rangeValue as! AXValue
        var selectedRange = CFRange()
        guard AXValueGetValue(axValue, .cfRange, &selectedRange) else { return nil }

        var selectedValue: CFTypeRef?
        if selectedRange.length > 0,
           AXUIElementCopyAttributeValue(element, kAXSelectedTextAttribute as CFString, &selectedValue) == .success,
           let selected = selectedValue as? String,
           !selected.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return TextTarget(source: selected, replacement: .accessibility(element: element, range: selectedRange))
        }

        guard Settings.shared.translateCurrentSentence else { return nil }

        var fullValue: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXValueAttribute as CFString, &fullValue) == .success,
              let fullText = fullValue as? String else { return nil }
        let nsText = fullText as NSString
        let cursor = min(max(selectedRange.location, 0), nsText.length)
        guard cursor > 0 else { return nil }

        let prefix = nsText.substring(to: cursor) as NSString
        let separators = CharacterSet(charactersIn: "。！？!?；;\n")
        var start = 0
        if prefix.length > 0 {
            let found = prefix.rangeOfCharacter(from: separators, options: .backwards)
            if found.location != NSNotFound { start = found.location + found.length }
        }
        while start < cursor {
            let scalar = nsText.substring(with: NSRange(location: start, length: 1))
            if scalar.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { start += 1 } else { break }
        }
        let range = CFRange(location: start, length: cursor - start)
        let source = nsText.substring(with: NSRange(location: range.location, length: range.length))
        guard !source.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return TextTarget(source: source, replacement: .accessibility(element: element, range: range))
    }

    private static func focusedElement() -> AXUIElement? {
        let system = AXUIElementCreateSystemWide()
        var focused: CFTypeRef?
        if AXUIElementCopyAttributeValue(system, kAXFocusedUIElementAttribute as CFString, &focused) == .success,
           let focused,
           CFGetTypeID(focused) == AXUIElementGetTypeID() {
            return (focused as! AXUIElement)
        }

        guard let application = NSWorkspace.shared.frontmostApplication else { return nil }
        let appElement = AXUIElementCreateApplication(application.processIdentifier)
        focused = nil
        if AXUIElementCopyAttributeValue(appElement, kAXFocusedUIElementAttribute as CFString, &focused) == .success,
           let focused,
           CFGetTypeID(focused) == AXUIElementGetTypeID() {
            return (focused as! AXUIElement)
        }
        return nil
    }

    private static func captureUsingKeyboard() throws -> TextTarget {
        guard let application = NSWorkspace.shared.frontmostApplication,
              application.bundleIdentifier != Bundle.main.bundleIdentifier else {
            throw TranslationError(message: "没有找到正在输入的文本框。")
        }

        if let selected = copySelection(), !selected.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return TextTarget(source: selected, replacement: .keyboard(applicationPID: application.processIdentifier))
        }

        guard Settings.shared.translateCurrentSentence else {
            throw TranslationError(message: "请先选中要翻译的中文。")
        }

        postKey(keyCode: CGKeyCode(kVK_LeftArrow), flags: [.maskCommand, .maskShift])
        Thread.sleep(forTimeInterval: 0.08)
        guard let source = copySelection(), !source.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            postKey(keyCode: CGKeyCode(kVK_RightArrow), flags: [])
            throw TranslationError(message: "当前软件没有提供可读取的文字。请先选中中文，再按快捷键重试。")
        }
        return TextTarget(source: source, replacement: .keyboard(applicationPID: application.processIdentifier))
    }

    private static func copySelection() -> String? {
        let pasteboard = NSPasteboard.general
        let sentinel = "zh-en-input-\(UUID().uuidString)"
        pasteboard.clearContents()
        pasteboard.setString(sentinel, forType: .string)
        let initialChangeCount = pasteboard.changeCount
        postKey(keyCode: CGKeyCode(kVK_ANSI_C), flags: .maskCommand)

        for _ in 0..<12 {
            Thread.sleep(forTimeInterval: 0.025)
            if pasteboard.changeCount != initialChangeCount {
                let copied = pasteboard.string(forType: .string)
                return copied == sentinel ? nil : copied
            }
        }
        return nil
    }

    private static func postKey(keyCode: CGKeyCode, flags: CGEventFlags) {
        guard let down = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: true),
              let up = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: false) else { return }
        down.flags = flags
        up.flags = flags
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
    }

    static func replace(_ target: TextTarget, with translation: String) -> Bool {
        switch target.replacement {
        case let .accessibility(element, originalRange):
            var range = originalRange
            guard let rangeValue = AXValueCreate(.cfRange, &range) else { return false }
            guard AXUIElementSetAttributeValue(element, kAXSelectedTextRangeAttribute as CFString, rangeValue) == .success else {
                return false
            }
            return AXUIElementSetAttributeValue(element, kAXSelectedTextAttribute as CFString, translation as CFTypeRef) == .success
        case let .keyboard(applicationPID):
            guard NSWorkspace.shared.frontmostApplication?.processIdentifier == applicationPID else { return false }
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(translation, forType: .string)
            postKey(keyCode: CGKeyCode(kVK_ANSI_V), flags: .maskCommand)
            return true
        }
    }
}

final class SettingsWindowController: NSWindowController {
    private let providerPopup = NSPopUpButton()
    private let tonePopup = NSPopUpButton()
    private let modelField = NSTextField()
    private let apiKeyField = NSSecureTextField()
    private let currentSentenceCheckbox = NSButton(checkboxWithTitle: "未选中文字时，翻译光标前的当前一句", target: nil, action: nil)

    convenience init() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 520, height: 330),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        window.title = "中译英输入助手设置"
        window.center()
        self.init(window: window)
        buildUI()
        loadValues()
    }

    private func buildUI() {
        guard let content = window?.contentView else { return }
        let grid = NSGridView(views: [
            [label("翻译方式"), providerPopup],
            [label("英语风格"), tonePopup],
            [label("本地模型"), modelField],
            [label("DeepSeek Key"), apiKeyField]
        ])
        grid.rowSpacing = 14
        grid.columnSpacing = 16
        grid.translatesAutoresizingMaskIntoConstraints = false
        grid.column(at: 0).xPlacement = .trailing
        grid.column(at: 1).width = 330

        Provider.allCases.forEach { providerPopup.addItem(withTitle: $0.title) }
        Tone.allCases.forEach { tonePopup.addItem(withTitle: $0.title) }
        modelField.placeholderString = "qwen3:4b-instruct"
        apiKeyField.placeholderString = "sk-…（保存在 macOS 钥匙串）"

        currentSentenceCheckbox.translatesAutoresizingMaskIntoConstraints = false

        let shortcut = NSTextField(labelWithString: "全局快捷键：Control + Shift + Space。翻译期间菜单栏图标会显示 …")
        shortcut.textColor = .secondaryLabelColor
        shortcut.translatesAutoresizingMaskIntoConstraints = false

        let save = NSButton(title: "保存", target: self, action: #selector(saveSettings))
        save.keyEquivalent = "\r"
        save.translatesAutoresizingMaskIntoConstraints = false

        content.addSubview(grid)
        content.addSubview(currentSentenceCheckbox)
        content.addSubview(shortcut)
        content.addSubview(save)

        NSLayoutConstraint.activate([
            grid.topAnchor.constraint(equalTo: content.topAnchor, constant: 30),
            grid.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 30),
            grid.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -30),
            currentSentenceCheckbox.topAnchor.constraint(equalTo: grid.bottomAnchor, constant: 22),
            currentSentenceCheckbox.leadingAnchor.constraint(equalTo: grid.leadingAnchor, constant: 116),
            shortcut.topAnchor.constraint(equalTo: currentSentenceCheckbox.bottomAnchor, constant: 18),
            shortcut.leadingAnchor.constraint(equalTo: grid.leadingAnchor, constant: 116),
            save.topAnchor.constraint(equalTo: shortcut.bottomAnchor, constant: 24),
            save.trailingAnchor.constraint(equalTo: grid.trailingAnchor)
        ])
    }

    private func label(_ string: String) -> NSTextField {
        NSTextField(labelWithString: string)
    }

    private func loadValues() {
        let settings = Settings.shared
        providerPopup.selectItem(at: Provider.allCases.firstIndex(of: settings.provider) ?? 0)
        tonePopup.selectItem(at: Tone.allCases.firstIndex(of: settings.tone) ?? 0)
        modelField.stringValue = settings.ollamaModel
        apiKeyField.stringValue = KeychainStore.read()
        currentSentenceCheckbox.state = settings.translateCurrentSentence ? .on : .off
    }

    @objc private func saveSettings() {
        let settings = Settings.shared
        settings.provider = Provider.allCases[providerPopup.indexOfSelectedItem]
        settings.tone = Tone.allCases[tonePopup.indexOfSelectedItem]
        settings.ollamaModel = modelField.stringValue.isEmpty ? "qwen3:4b-instruct" : modelField.stringValue
        settings.translateCurrentSentence = currentSentenceCheckbox.state == .on
        KeychainStore.save(apiKeyField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines))
        window?.close()
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    static let shared = AppDelegate()
    private var statusItem: NSStatusItem!
    private var settingsWindow: SettingsWindowController?
    private var hotKeyRef: EventHotKeyRef?
    private var eventHandler: EventHandlerRef?
    private var translating = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        configureMenu()
        registerHotKey()
        _ = TextAccess.isTrusted(prompt: true)
        DispatchQueue.main.async { [weak self] in
            self?.openSettings()
        }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        openSettings()
        return true
    }

    private func configureMenu() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem.button?.title = "译"
        statusItem.button?.toolTip = "中译英输入助手"

        let menu = NSMenu()
        let translateItem = NSMenuItem(title: "翻译选中内容／当前一句", action: #selector(translateNow), keyEquivalent: "")
        translateItem.target = self
        menu.addItem(translateItem)

        let hint = NSMenuItem(title: "快捷键：Control + Shift + Space", action: nil, keyEquivalent: "")
        hint.isEnabled = false
        menu.addItem(hint)
        menu.addItem(.separator())

        let settings = NSMenuItem(title: "设置…", action: #selector(openSettings), keyEquivalent: ",")
        settings.target = self
        menu.addItem(settings)

        let access = NSMenuItem(title: "打开辅助功能授权", action: #selector(requestAccess), keyEquivalent: "")
        access.target = self
        menu.addItem(access)
        menu.addItem(.separator())

        let quit = NSMenuItem(title: "退出", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        menu.addItem(quit)
        statusItem.menu = menu
    }

    private func registerHotKey() {
        var eventType = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        let callback: EventHandlerUPP = { _, event, _ in
            var hotKeyID = EventHotKeyID()
            GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID), nil, MemoryLayout<EventHotKeyID>.size, nil, &hotKeyID)
            if hotKeyID.id == 1 {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) { AppDelegate.shared.translateNow() }
            }
            return noErr
        }
        InstallEventHandler(GetApplicationEventTarget(), callback, 1, &eventType, nil, &eventHandler)
        let id = EventHotKeyID(signature: OSType(0x5A454E47), id: 1) // ZENG
        RegisterEventHotKey(UInt32(kVK_Space), UInt32(controlKey | shiftKey), id, GetApplicationEventTarget(), 0, &hotKeyRef)
    }

    @objc func translateNow() {
        guard !translating else { return }
        do {
            let target = try TextAccess.capture()
            translating = true
            statusItem.button?.title = "…"
            Task {
                do {
                    let result = try await TranslationService.translate(target.source)
                    await MainActor.run {
                        if !TextAccess.replace(target, with: result) {
                            NSPasteboard.general.clearContents()
                            NSPasteboard.general.setString(result, forType: .string)
                            showError("当前软件不允许直接替换，英文已复制到剪贴板，请粘贴使用。")
                        }
                        finishTranslation()
                    }
                } catch {
                    await MainActor.run {
                        finishTranslation()
                        showError(error.localizedDescription)
                    }
                }
            }
        } catch {
            showError(error.localizedDescription)
        }
    }

    private func finishTranslation() {
        translating = false
        statusItem.button?.title = "译"
    }

    @objc private func openSettings() {
        if settingsWindow == nil { settingsWindow = SettingsWindowController() }
        settingsWindow?.showWindow(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc private func requestAccess() {
        _ = TextAccess.isTrusted(prompt: true)
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") {
            NSWorkspace.shared.open(url)
        }
    }

    private func showError(_ message: String) {
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = "中译英输入助手"
        alert.informativeText = message
        alert.alertStyle = .informational
        alert.runModal()
    }
}

@main
struct Main {
    @MainActor
    static func main() {
        let app = NSApplication.shared
        app.delegate = AppDelegate.shared
        app.run()
    }
}
