import SwiftUI
import UIKit

struct Shade: Sendable {
    let hex: UInt32
    let alpha: CGFloat

    init(_ hex: UInt32, _ alpha: CGFloat = 1) {
        self.hex = hex
        self.alpha = alpha
    }

    var ui: UIColor {
        UIColor(
            red: CGFloat((hex >> 16) & 0xff) / 255,
            green: CGFloat((hex >> 8) & 0xff) / 255,
            blue: CGFloat(hex & 0xff) / 255,
            alpha: alpha)
    }
}

extension Color {
    init(_ light: Shade, _ dark: Shade) {
        self.init(uiColor: UIColor { $0.userInterfaceStyle == .dark ? dark.ui : light.ui })
    }

    init(hex: UInt32) {
        self.init(uiColor: Shade(hex).ui)
    }
}

enum Tone {
    static var canvas: Color { Palettes.color("bg", light: Shade(0xffffff), dark: Shade(0x151011)) }
    static var rail: Color { Palettes.color("bg-2", light: Shade(0xf7f7f8), dark: Shade(0x1c1718)) }
    static var raised: Color { Palettes.color("bg-3", light: Shade(0xefeff1), dark: Shade(0x252021)) }
    static var ink: Color { Palettes.color("ink", light: Shade(0x18181b), dark: Shade(0xddccc6)) }
    static var ink2: Color { Palettes.color("ink-2", light: Shade(0x56565e), dark: Shade(0xa39591)) }
    static var ink3: Color { Palettes.color("ink-3", light: Shade(0x6c6c74), dark: Shade(0x8a7e7b)) }
    static var onInk: Color { Palettes.color("on-ink", light: Shade(0xffffff), dark: Shade(0x151011)) }
    static var line: Color { Palettes.color("line", light: Shade(0x000000, 0.06), dark: Shade(0xddccc6, 0.075)) }
    static var wash: Color { Palettes.color("wash", light: Shade(0x000000, 0.035), dark: Shade(0xddccc6, 0.056)) }
    static var wash2: Color { Palettes.color("wash-2", light: Shade(0x000000, 0.06), dark: Shade(0xddccc6, 0.1)) }
    static var edgeStrong: Color { Palettes.color("line-3", light: Shade(0x000000, 0.13), dark: Shade(0xddccc6, 0.162)) }
    static var pick: Color { Palettes.color("wash-2", light: Shade(0x000000, 0.06), dark: Shade(0xddccc6, 0.1)) }
    static var segment: Color { Palettes.color("bg-3", light: Shade(0xffffff), dark: Shade(0x252021)) }
    static var accent: Color { Palettes.color("accent", light: Shade(0x1a56db), dark: Shade(0xff6b4a)) }
    static var accentWash: Color { Palettes.color("accent-wash", light: Shade(0x1a56db, 0.08), dark: Shade(0xff6b4a, 0.14)) }
    static var alert: Color { Palettes.color("alert", light: Shade(0xd1342a), dark: Shade(0xf25c4a)) }
    static var alertFill: Color { Palettes.color("alert", light: Shade(0xd1342a), dark: Shade(0xf25c4a)) }
    static var decide: Color { Palettes.color("decide", light: Shade(0xa35a00), dark: Shade(0xf0a04f)) }
    static var decideWash: Color { Palettes.color("decide-wash", light: Shade(0xa35a00, 0.1), dark: Shade(0xf0a04f, 0.12)) }
    static var live: Color { Palettes.color("live", light: Shade(0x1f9a55), dark: Shade(0x97ad72)) }
    static var doing: Color { Palettes.color("doing", light: Shade(0x2f6fe4), dark: Shade(0x9188c4)) }
    static var bubbleThem: Color { Palettes.color("bg-3", light: Shade(0xefeff1), dark: Shade(0x252021)) }
    static var bubbleMine: Color { Palettes.color("ink", light: Shade(0x18181b), dark: Shade(0xddccc6)) }
    static var faceTop: Color { Palettes.color("bg-3", light: Shade(0xefeff1), dark: Shade(0x252021)) }
    static var faceBottom: Color { Palettes.color("bg-3", light: Shade(0xefeff1), dark: Shade(0x252021)) }
    static var avatarTop: Color { Palettes.color("ink-3", light: Shade(0x8a8a92), dark: Shade(0x4a403e)) }
    static var avatarBottom: Color { Palettes.color("ink-3", light: Shade(0x8a8a92), dark: Shade(0x4a403e)) }
    static var popEdge: Color { Palettes.color("line-2", light: Shade(0x000000, 0.08), dark: Shade(0xddccc6, 0.11)) }
    static let popShade = Color(Shade(0x000000, 0.16), Shade(0x000000, 0.55))
}

enum Palette {
    static let fills: [String: (fill: UInt32, ink: UInt32)] = [
        "red": (0xf0605d, 0xffffff),
        "orange": (0xff9a3c, 0xffffff),
        "yellow": (0xf5c542, 0x1a1a1a),
        "green": (0x3fbf74, 0xffffff),
        "teal": (0x2fb8b0, 0xffffff),
        "blue": (0x4a8df0, 0xffffff),
        "indigo": (0x6f74f2, 0xffffff),
        "violet": (0x9a63f0, 0xffffff),
        "pink": (0xf2559a, 0xffffff),
        "brown": (0xb08463, 0xffffff),
    ]
}

enum Radius {
    static let row: CGFloat = 8
    static let ctl: CGFloat = 10
    static let card: CGFloat = 16
    static let bubble: CGFloat = 20
    static let dock: CGFloat = 26
}

enum Step {
    case stamp, meta, ui, body, title, display

    var style: Font.TextStyle {
        switch self {
        case .stamp: .caption2
        case .meta: .caption
        case .ui: .subheadline
        case .body: .body
        case .title: .headline
        case .display: .largeTitle
        }
    }
}

extension Font {
    static func mono(_ step: Step) -> Font {
        .system(step.style, design: .monospaced)
    }
}

extension View {
    func type(_ step: Step, _ weight: Font.Weight = .regular) -> some View {
        font(.system(step.style, weight: weight)).monospacedDigit()
    }
}

enum Motion {
    static let ease = Animation.timingCurve(0.2, 0.8, 0.2, 1, duration: 0.2)
    static let sent = Animation.timingCurve(0.3, 1.35, 0.5, 1, duration: 0.24)
}
