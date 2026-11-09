import Observation
import SwiftUI
import UIKit

struct ThemeDef: Decodable, Identifiable, Sendable {
    let id: String
    let name: String
    let appearance: String
    let colors: [String: String]

    var dark: Bool { appearance == "dark" }
}

enum AppearanceChoice: String, CaseIterable, Identifiable {
    case system, light, dark

    var id: String { rawValue }

    var label: String {
        switch self {
        case .system: spoken("System")
        case .light: spoken("Light")
        case .dark: spoken("Dark")
        }
    }

    var scheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
}

final class Swatch: @unchecked Sendable {
    let colors: [String: UIColor]

    init(_ def: ThemeDef) {
        colors = def.colors.compactMapValues(Swatch.parse)
    }

    static func parse(_ css: String) -> UIColor? {
        let s = css.trimmingCharacters(in: .whitespaces).lowercased()
        if s.hasPrefix("#"), s.count == 7, let v = UInt32(s.dropFirst(), radix: 16) {
            return Shade(v).ui
        }
        guard s.hasPrefix("rgb("), s.hasSuffix(")") else { return nil }
        let parts = s.dropFirst(4).dropLast().replacingOccurrences(of: "/", with: " ").replacingOccurrences(of: ",", with: " ")
            .split(separator: " ").compactMap { Double($0) }
        guard parts.count >= 3 else { return nil }
        return UIColor(red: parts[0] / 255, green: parts[1] / 255, blue: parts[2] / 255, alpha: parts.count > 3 ? parts[3] : 1)
    }
}

@MainActor
@Observable
final class ThemeStore {
    static let shared = ThemeStore()
    static let darkDefault = "channels-dark"
    static let lightDefault = "channels-light"

    let all: [ThemeDef]

    var appearance: AppearanceChoice {
        didSet { save() }
    }
    var darkTheme: String {
        didSet { save() }
    }
    var lightTheme: String {
        didSet { save() }
    }

    var key: String { "\(appearance.rawValue)|\(darkTheme)|\(lightTheme)" }
    var darks: [ThemeDef] { all.filter(\.dark) }
    var lights: [ThemeDef] { all.filter { !$0.dark } }

    private init() {
        all = ThemeStore.bundled()
        let saved = UserDefaults.standard
        appearance = AppearanceChoice(rawValue: saved.string(forKey: "appearance") ?? "") ?? .system
        darkTheme = saved.string(forKey: "darkTheme") ?? ThemeStore.darkDefault
        lightTheme = saved.string(forKey: "lightTheme") ?? ThemeStore.lightDefault
        Palettes.set(dark: swatch(darkTheme, ThemeStore.darkDefault), light: swatch(lightTheme, ThemeStore.lightDefault))
    }

    private static func bundled() -> [ThemeDef] {
        guard let url = Bundle.main.url(forResource: "themes", withExtension: "json") else {
            Trouble.note("themes.json missing from the app")
            return []
        }
        do {
            return try JSONDecoder().decode([ThemeDef].self, from: Data(contentsOf: url))
        } catch {
            Trouble.note("themes.json unreadable", error)
            return []
        }
    }

    func name(_ id: String) -> String {
        all.first { $0.id == id }?.name ?? id
    }

    private func swatch(_ id: String, _ fallback: String) -> Swatch? {
        (all.first { $0.id == id } ?? all.first { $0.id == fallback }).map(Swatch.init)
    }

    private func save() {
        let saved = UserDefaults.standard
        saved.set(appearance.rawValue, forKey: "appearance")
        saved.set(darkTheme, forKey: "darkTheme")
        saved.set(lightTheme, forKey: "lightTheme")
        Palettes.set(dark: swatch(darkTheme, ThemeStore.darkDefault), light: swatch(lightTheme, ThemeStore.lightDefault))
    }
}

enum Palettes {
    nonisolated(unsafe) private static var dark: Swatch?
    nonisolated(unsafe) private static var light: Swatch?

    static func set(dark: Swatch?, light: Swatch?) {
        Palettes.dark = dark
        Palettes.light = light
    }

    static func color(_ token: String, light fallbackLight: Shade, dark fallbackDark: Shade) -> Color {
        Color(
            uiColor: UIColor { trait in
                let darkMode = trait.userInterfaceStyle == .dark
                return (darkMode ? dark : light)?.colors[token] ?? (darkMode ? fallbackDark : fallbackLight).ui
            })
    }
}

struct AppearanceSection: View {
    @Bindable private var theme = ThemeStore.shared

    var body: some View {
        Section("Appearance") {
            Picker("Appearance", selection: $theme.appearance) {
                ForEach(AppearanceChoice.allCases) { Text($0.label).tag($0) }
            }
            .pickerStyle(.segmented)
            LanguageRow()
            NavigationLink {
                ThemeList(title: "Dark Theme", themes: theme.darks, chosen: $theme.darkTheme)
            } label: {
                LabeledContent("Dark Theme", value: theme.name(theme.darkTheme))
            }
            NavigationLink {
                ThemeList(title: "Light Theme", themes: theme.lights, chosen: $theme.lightTheme)
            } label: {
                LabeledContent("Light Theme", value: theme.name(theme.lightTheme))
            }
        }
        .listRowBackground(Tone.raised)
    }
}

struct ThemeList: View {
    let title: LocalizedStringKey
    let themes: [ThemeDef]
    @Binding var chosen: String

    var body: some View {
        List {
            Section {
                ForEach(themes) { def in
                    Button {
                        chosen = def.id
                    } label: {
                        HStack(spacing: 12) {
                            ThemeChip(def: def)
                            Text(def.name).type(.body).foregroundStyle(Tone.ink)
                            Spacer(minLength: 0)
                            if def.id == chosen {
                                Image(systemName: "checkmark").font(.system(size: 15, weight: .semibold)).foregroundStyle(Tone.accent)
                            }
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            .listRowBackground(Tone.raised)
        }
        .grouped()
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct ThemeChip: View {
    let def: ThemeDef

    private func tone(_ token: String) -> Color {
        def.colors[token].flatMap(Swatch.parse).map { Color(uiColor: $0) } ?? .clear
    }

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            RoundedRectangle(cornerRadius: 7, style: .continuous).fill(tone("bg"))
            HStack(spacing: 3) {
                Circle().fill(tone("ink")).frame(width: 7, height: 7)
                Circle().fill(tone("accent")).frame(width: 7, height: 7)
            }
            .padding(5)
        }
        .frame(width: 34, height: 26)
        .overlay(RoundedRectangle(cornerRadius: 7, style: .continuous).strokeBorder(Tone.line, lineWidth: 0.5))
    }
}
