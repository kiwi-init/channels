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
    static let canvas = Color(Shade(0xffffff), Shade(0x151011))
    static let rail = Color(Shade(0xf7f7f8), Shade(0x1c1718))
    static let raised = Color(Shade(0xefeff1), Shade(0x252021))
    static let ink = Color(Shade(0x18181b), Shade(0xddccc6))
    static let ink2 = Color(Shade(0x56565e), Shade(0xa39591))
    static let ink3 = Color(Shade(0x6c6c74), Shade(0x8a7e7b))
    static let onInk = Color(Shade(0xffffff), Shade(0x151011))
    static let line = Color(Shade(0x000000, 0.06), Shade(0xddccc6, 0.075))
    static let wash = Color(Shade(0x000000, 0.035), Shade(0xddccc6, 0.056))
    static let wash2 = Color(Shade(0x000000, 0.06), Shade(0xddccc6, 0.1))
    static let edgeStrong = Color(Shade(0x000000, 0.13), Shade(0xddccc6, 0.162))
    static let pick = Color(Shade(0x000000, 0.06), Shade(0xddccc6, 0.1))
    static let segment = Color(Shade(0xffffff), Shade(0x252021))
    static let accent = Color(Shade(0x1a56db), Shade(0xff6b4a))
    static let accentWash = Color(Shade(0x1a56db, 0.08), Shade(0xff6b4a, 0.14))
    static let alert = Color(Shade(0xd1342a), Shade(0xf25c4a))
    static let alertFill = Color(Shade(0xd1342a), Shade(0xf25c4a))
    static let decide = Color(Shade(0xa35a00), Shade(0xf0a04f))
    static let decideWash = Color(Shade(0xa35a00, 0.1), Shade(0xf0a04f, 0.12))
    static let live = Color(Shade(0x1f9a55), Shade(0x97ad72))
    static let doing = Color(Shade(0x2f6fe4), Shade(0x9188c4))
    static let bubbleThem = Color(Shade(0xefeff1), Shade(0x252021))
    static let bubbleMine = Color(Shade(0x18181b), Shade(0xddccc6))
    static let faceTop = Color(Shade(0xefeff1), Shade(0x252021))
    static let faceBottom = Color(Shade(0xefeff1), Shade(0x252021))
    static let avatarTop = Color(Shade(0x8a8a92), Shade(0x4a403e))
    static let avatarBottom = Color(Shade(0x8a8a92), Shade(0x4a403e))
    static let popEdge = Color(Shade(0x000000, 0.08), Shade(0xddccc6, 0.11))
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
