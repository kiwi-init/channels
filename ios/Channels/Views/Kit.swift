import SwiftUI
import UIKit

struct Face: View {
    let name: String
    let member: MemberView?
    var size: CGFloat = 32

    private var initials: String {
        let words = (member?.display ?? name).split(whereSeparator: { $0 == " " || $0 == "-" || $0 == "_" || $0 == "." })
        let letters = words.prefix(2).compactMap(\.first).map { String($0).uppercased() }
        return letters.joined().isEmpty ? "?" : letters.joined()
    }

    var body: some View {
        ZStack(alignment: .topTrailing) {
            if member?.isAgent == true {
                agent
            } else {
                person
            }
            if member?.isAgent == true && member?.working == true {
                Circle()
                    .fill(Tone.doing)
                    .frame(width: max(8, size * 0.28), height: max(8, size * 0.28))
                    .overlay(Circle().stroke(Tone.canvas, lineWidth: 2))
                    .offset(x: 1, y: -1)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }

    @ViewBuilder private var agent: some View {
        ZStack {
            Circle().fill(LinearGradient(colors: [Tone.faceTop, Tone.faceBottom], startPoint: .top, endPoint: .bottom))
            if let harness = member?.harness, UIImage(named: "harness-\(harness)") != nil {
                Image("harness-\(harness)")
                    .resizable()
                    .renderingMode(member?.mono == true ? .template : .original)
                    .foregroundStyle(Tone.ink)
                    .scaledToFit()
                    .frame(width: size * 0.56, height: size * 0.56)
            } else {
                Image(systemName: "terminal")
                    .font(.system(size: size * 0.4, weight: .medium))
                    .foregroundStyle(Tone.ink2)
            }
        }
        .frame(width: size, height: size)
    }

    private var person: some View {
        let tone = member?.color.flatMap { Palette.fills[$0] }
        let top = tone.map { Color(hex: $0.fill) } ?? Tone.avatarTop
        let bottom = tone.map { Color(hex: $0.fill).mix(with: .black, by: 0.28) } ?? Tone.avatarBottom
        let ink = tone.map { Color(hex: $0.ink) } ?? .white
        return Text(initials)
            .font(.system(size: (size * (initials.count > 1 ? 0.4 : 0.46)).rounded(), weight: .semibold, design: .rounded))
            .foregroundStyle(ink)
            .frame(width: size, height: size)
            .background(Circle().fill(LinearGradient(colors: [top, bottom], startPoint: .top, endPoint: .bottom)))
    }
}

struct Outlined: ViewModifier {
    var radius: CGFloat = Radius.row
    var color: Color = Tone.line
    var width: CGFloat = 1

    func body(content: Content) -> some View {
        content.overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(color, lineWidth: width))
    }
}

extension View {
    func outlined(_ radius: CGFloat = Radius.row, _ color: Color = Tone.line, width: CGFloat = 1) -> some View {
        modifier(Outlined(radius: radius, color: color, width: width))
    }

    @ViewBuilder func glass(_ radius: CGFloat) -> some View {
        if #available(iOS 26.0, *) {
            self.glassEffect(.regular, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
        } else {
            self
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(Tone.glassEdge, lineWidth: 0.5))
        }
    }

    @ViewBuilder func glassCapsule() -> some View {
        if #available(iOS 26.0, *) {
            self.glassEffect(.regular.interactive(), in: Capsule())
        } else {
            self
                .background(.ultraThinMaterial, in: Capsule())
                .overlay(Capsule().strokeBorder(Tone.glassEdge, lineWidth: 0.5))
        }
    }

    @ViewBuilder func glassCircle() -> some View {
        if #available(iOS 26.0, *) {
            self.glassEffect(.regular.interactive(), in: Circle())
        } else {
            self
                .background(.ultraThinMaterial, in: Circle())
                .overlay(Circle().strokeBorder(Tone.glassEdge, lineWidth: 0.5))
        }
    }
}

struct PrimaryButton: View {
    let title: String
    var busy = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                Text(title).opacity(busy ? 0 : 1)
                if busy { ProgressView().tint(.white) }
            }
            .type(.body, .semibold)
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: 50)
            .background(Tone.accent, in: RoundedRectangle(cornerRadius: Radius.ctl, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(busy)
    }
}

struct QuietButton: View {
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .type(.body, .medium)
                .foregroundStyle(Tone.ink)
                .frame(maxWidth: .infinity, minHeight: 50)
                .outlined(Radius.ctl, Tone.edgeStrong)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

struct Dot: View {
    let color: Color
    var size: CGFloat = 6

    var body: some View {
        Circle().fill(color).frame(width: size, height: size)
    }
}

enum When {
    static func short(_ date: Date, now: Date = .now) -> String {
        let s = now.timeIntervalSince(date)
        if s < 60 { return "now" }
        if s < 3600 { return "\(Int(s / 60))m" }
        if s < 86400 && Calendar.current.isDate(date, inSameDayAs: now) { return date.formatted(.dateTime.hour().minute()) }
        if s < 6 * 86400 { return date.formatted(.dateTime.weekday(.abbreviated)) }
        return date.formatted(.dateTime.month(.abbreviated).day())
    }

    static func dayWord(_ date: Date, now: Date = .now) -> String {
        if Calendar.current.isDateInToday(date) { return "Today" }
        if Calendar.current.isDateInYesterday(date) { return "Yesterday" }
        if now.timeIntervalSince(date) < 6 * 86400 { return date.formatted(.dateTime.weekday(.wide)) }
        return "\(date.formatted(.dateTime.day().month(.abbreviated).year())) at"
    }

    static func clock(_ date: Date) -> String {
        date.formatted(.dateTime.hour().minute())
    }

    static func day(_ date: Date, now: Date = .now) -> String {
        if Calendar.current.isDateInToday(date) { return "Today" }
        if Calendar.current.isDateInYesterday(date) { return "Yesterday" }
        if now.timeIntervalSince(date) < 6 * 86400 { return date.formatted(.dateTime.weekday(.wide)) }
        return date.formatted(.dateTime.weekday(.wide).month(.wide).day())
    }

    static func since(_ date: Date, now: Date = .now) -> String {
        let s = max(0, now.timeIntervalSince(date))
        if s < 60 { return "just now" }
        if s < 3600 { return "\(Int(s / 60)) min" }
        if s < 86400 { return "\(Int(s / 3600)) h" }
        return "\(Int(s / 86400)) d"
    }
}

enum Haptic {
    @MainActor static func tap() {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }
}

func taskLabel(_ id: Int) -> String { "T\(id)" }

func stateWords(_ state: String) -> String {
    switch state {
    case "doing": "in progress"
    case "review": "in review"
    case "done": "done"
    default: "open"
    }
}

func stateColor(_ state: String) -> Color {
    switch state {
    case "doing", "review": Tone.doing
    case "done": Tone.live
    default: Tone.ink3
    }
}
