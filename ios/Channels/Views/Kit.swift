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

    private var role: String {
        member?.face.flatMap { Faces.eyes[$0] == nil ? nil : $0 } ?? "default"
    }

    private var agent: some View {
        let eyes = Faces.eyes[role] ?? Faces.fallback
        let unit = size / 100
        let badge = size * 0.35
        return ZStack(alignment: .topLeading) {
            Image("face-\(role)")
                .resizable()
                .renderingMode(.template)
                .foregroundStyle(Tone.ink)
                .frame(width: size, height: size)
            ForEach([-1.0, 1.0], id: \.self) { side in
                Ellipse()
                    .fill(Tone.canvas)
                    .frame(width: 8.6 * eyes.scale * unit, height: 10.6 * eyes.scale * unit)
                    .position(x: (eyes.x + side * eyes.spacing / 2) * unit, y: eyes.y * unit)
            }
            if let harness = member?.harness, UIImage(named: "harness-\(harness)") != nil {
                Image("harness-\(harness)")
                    .resizable()
                    .renderingMode(member?.mono == true ? .template : .original)
                    .foregroundStyle(Tone.ink)
                    .scaledToFit()
                    .frame(width: badge, height: badge)
                    .padding(size * 0.03)
                    .background(Circle().fill(Tone.canvas))
                    .offset(x: -size * 0.06, y: -size * 0.06)
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

    func raised(_ radius: CGFloat) -> some View {
        self
            .background(Tone.raised, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(Tone.line, lineWidth: 0.5))
    }

    func grouped() -> some View {
        self
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(Tone.canvas)
    }

    func raisedCapsule() -> some View {
        self
            .background(Tone.raised, in: Capsule())
            .overlay(Capsule().strokeBorder(Tone.line, lineWidth: 0.5))
    }

    func raisedCircle() -> some View {
        self
            .background(Tone.raised, in: Circle())
            .overlay(Circle().strokeBorder(Tone.line, lineWidth: 0.5))
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

    static func list(_ date: Date, now: Date = .now) -> String {
        let calendar = Calendar.current
        if calendar.isDateInToday(date) { return date.formatted(.dateTime.hour().minute()) }
        if calendar.isDateInYesterday(date) { return "Yesterday" }
        if now.timeIntervalSince(date) < 6 * 86400 { return date.formatted(.dateTime.weekday(.wide)) }
        return date.formatted(.dateTime.month(.defaultDigits).day().year(.twoDigits))
    }
}

enum Haptic {
    @MainActor static func tap() {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }
}

func taskLabel(_ id: Int) -> String { "T\(id)" }
