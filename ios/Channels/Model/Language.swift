import Foundation
import Observation
import SwiftUI

enum Language: String, CaseIterable, Identifiable {
    case system
    case en
    case ptBR = "pt-BR"
    case ja
    case ko
    case zhHans = "zh-Hans"

    var id: String { rawValue }

    var name: String {
        switch self {
        case .system: spoken("System")
        case .en: "English"
        case .ptBR: "Português (Brasil)"
        case .ja: "日本語"
        case .ko: "한국어"
        case .zhHans: "简体中文"
        }
    }
}

@MainActor
@Observable
final class LanguageStore {
    static let shared = LanguageStore()
    static let key = "language"

    var chosen: Language {
        didSet { apply() }
    }

    var locale: Locale {
        chosen == .system ? Locale.autoupdatingCurrent : Locale(identifier: chosen.rawValue)
    }

    private init() {
        chosen = Language(rawValue: UserDefaults.standard.string(forKey: LanguageStore.key) ?? "") ?? .system
        Speech.use(chosen)
    }

    private func apply() {
        let saved = UserDefaults.standard
        if chosen == .system {
            saved.removeObject(forKey: LanguageStore.key)
            saved.removeObject(forKey: "AppleLanguages")
        } else {
            saved.set(chosen.rawValue, forKey: LanguageStore.key)
            saved.set([chosen.rawValue], forKey: "AppleLanguages")
        }
        Speech.use(chosen)
    }
}

func spoken(_ words: LocalizedStringResource) -> String {
    var words = words
    words.locale = Speech.locale
    return String(localized: words)
}

enum Speech {
    nonisolated(unsafe) private(set) static var bundle: Bundle = .main
    nonisolated(unsafe) private(set) static var locale: Locale = .current

    static func use(_ language: Language) {
        locale = language == .system ? .current : Locale(identifier: language.rawValue)
        bundle = language == .system ? .main : (Bundle.main.path(forResource: lproj(language), ofType: "lproj").flatMap(Bundle.init(path:)) ?? .main)
        object_setClass(Bundle.main, SpokenBundle.self)
    }

    private static func lproj(_ language: Language) -> String {
        Bundle.main.localizations.first { $0.caseInsensitiveCompare(language.rawValue) == .orderedSame } ?? language.rawValue
    }
}

private final class SpokenBundle: Bundle, @unchecked Sendable {
    override func localizedString(forKey key: String, value: String?, table tableName: String?) -> String {
        let chosen = Speech.bundle
        return chosen === Bundle.main ? super.localizedString(forKey: key, value: value, table: tableName) : chosen.localizedString(forKey: key, value: value, table: tableName)
    }
}

struct LanguageRow: View {
    @Bindable private var language = LanguageStore.shared

    var body: some View {
        Picker(selection: $language.chosen) {
            ForEach(Language.allCases) { Text(verbatim: $0.name).tag($0) }
        } label: {
            Setting(symbol: "globe", tint: Tone.accent, title: "Language")
        }
        .accessibilityIdentifier("language")
    }
}
