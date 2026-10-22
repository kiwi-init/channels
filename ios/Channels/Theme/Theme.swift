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
    static let canvas = Color(Shade(0xffffff), Shade(0x000000))
    static let rail = Color(Shade(0xf2f2f5), Shade(0x000000))
    static let ink = Color(Shade(0x0f0f11), Shade(0xf3f3f5))
    static let ink2 = Color(Shade(0x4a4a52), Shade(0xbcbcc3))
    static let ink3 = Color(Shade(0x6b6b73), Shade(0x8f8f97))
    static let line = Color(Shade(0x0f0f11, 0.08), Shade(0xffffff, 0.08))
    static let wash = Color(Shade(0x0f0f11, 0.045), Shade(0xffffff, 0.055))
    static let wash2 = Color(Shade(0x0f0f11, 0.075), Shade(0xffffff, 0.09))
    static let edgeStrong = Color(Shade(0x0f0f11, 0.14), Shade(0xffffff, 0.14))
    static let pick = Color(Shade(0x0f0f11, 0.07), Shade(0xffffff, 0.08))
    static let segment = Color(Shade(0xffffff), Shade(0x3a3a3c))
    static let accent = Color(Shade(0x007aff), Shade(0x0a84ff))
    static let accentWash = Color(Shade(0x007aff, 0.1), Shade(0x0a84ff, 0.18))
    static let alert = Color(Shade(0xd1342a), Shade(0xff6259))
    static let alertFill = Color(Shade(0xd1342a), Shade(0xd1342a))
    static let decide = Color(Shade(0xa35a00), Shade(0xf5b041))
    static let decideWash = Color(Shade(0xd67d00, 0.12), Shade(0xf5b041, 0.14))
    static let live = Color(Shade(0x1f9a55), Shade(0x32d074))
    static let doing = Color(Shade(0x2f6fe4), Shade(0x5b9bff))
    static let bubbleThem = Color(Shade(0xe9e9eb), Shade(0x262628))
    static let bubbleMine = Color(Shade(0x007aff), Shade(0x0b84fe))
    static let faceTop = Color(Shade(0xf2f2f4), Shade(0x323236))
    static let faceBottom = Color(Shade(0xe4e4e8), Shade(0x26262a))
    static let avatarTop = Color(Shade(0xa8a8b0), Shade(0x78787f))
    static let avatarBottom = Color(Shade(0x8a8a92), Shade(0x55555c))
    static let glassFill = Color(Shade(0xffffff, 0.64), Shade(0x28282c, 0.52))
    static let glassRim = Color(Shade(0xffffff, 0.95), Shade(0xffffff, 0.11))
    static let glassEdge = Color(Shade(0x0f0f11, 0.07), Shade(0xffffff, 0.07))
    static let popEdge = Color(Shade(0x0f0f11, 0.08), Shade(0xffffff, 0.09))
    static let popShade = Color(Shade(0x0f0f11, 0.16), Shade(0x000000, 0.65))
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
    static let rise = Animation.timingCurve(0.2, 0.8, 0.2, 1, duration: 0.18)
    static let sent = Animation.timingCurve(0.3, 1.35, 0.5, 1, duration: 0.24)
    static let morph = Animation.spring(duration: 0.46, bounce: 0.16)
    static let swap = Animation.easeOut(duration: 0.18)
}
