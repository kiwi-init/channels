import SwiftUI
import UIKit

extension AppTab {
    static let order: [AppTab] = [.chats, .needs, .you]

    var title: LocalizedStringKey {
        switch self {
        case .chats: "Chats"
        case .needs: "Needs You"
        case .you: "You"
        }
    }

    var symbol: String {
        switch self {
        case .chats: "bubble.left.and.bubble.right.fill"
        case .needs: "hand.raised.fill"
        case .you: "person.crop.circle.fill"
        }
    }

    var key: String {
        switch self {
        case .chats: "chats"
        case .needs: "needs"
        case .you: "you"
        }
    }
}

extension AppModel {
    var here: RoomView? {
        lastCode.flatMap { rooms[$0] }.flatMap { $0.gone == nil ? $0 : nil } ?? channels.first
    }

    func pick(_ next: AppTab) {
        if next == tab, next == .chats { path = [] }
        tab = next
    }
}

enum Bar {
    static let height: CGFloat = 62
    static let gap: CGFloat = 10
    static let compact: CGFloat = 44

    static func spring(_ still: Bool) -> Animation {
        still ? .easeInOut(duration: 0.2) : .interpolatingSpring(mass: 0.9, stiffness: 260, damping: 20)
    }
}

struct TabsPill: View {
    var compact = false
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var still
    @Namespace private var plate

    var body: some View {
        HStack(spacing: 0) {
            ForEach(AppTab.order, id: \.self) { tab in
                TabButton(tab: tab, compact: compact, plate: plate) {
                    Haptic.tap()
                    withAnimation(Bar.spring(still)) { model.pick(tab) }
                }
            }
        }
        .padding(compact ? 2 : 4)
        .frame(width: compact ? Bar.compact * 3 : nil, height: compact ? Bar.compact : Bar.height)
        .frame(maxWidth: compact ? Bar.compact * 3 : .infinity)
    }
}

private struct TabButton: View {
    let tab: AppTab
    let compact: Bool
    let plate: Namespace.ID
    let pick: () -> Void
    @Environment(AppModel.self) private var model

    private var lit: Bool { model.tab == tab }

    var body: some View {
        Button(action: pick) {
            VStack(spacing: 2) {
                Image(systemName: tab.symbol)
                    .font(.system(size: compact ? 17 : 19, weight: .semibold))
                    .frame(height: compact ? 22 : 24)
                    .overlay(alignment: .topTrailing) {
                        if tab == .needs, model.waiting > 0 {
                            Text(verbatim: "\(model.waiting)")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(.white)
                                .padding(.horizontal, 5)
                                .frame(minWidth: 17, minHeight: 17)
                                .background(Capsule().fill(Tone.alert))
                                .offset(x: 11, y: -6)
                        }
                    }
                if !compact {
                    Text(tab.title)
                        .font(.system(size: 11, weight: .medium, design: .rounded))
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
            }
            .foregroundStyle(lit ? Tone.accent : Tone.ink)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background {
                if lit {
                    Color.clear.lens().matchedGeometryEffect(id: "plate", in: plate)
                }
            }
            .contentShape(Capsule())
        }
        .buttonStyle(Squish())
        .accessibilityIdentifier("tab-\(tab.key)")
        .accessibilityLabel(Text(tab.title))
        .accessibilityValue(tab == .needs && model.waiting > 0 ? String(model.waiting) : String())
        .accessibilityAddTraits(lit ? .isSelected : [])
    }
}

struct Squish: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var still

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !still ? 0.84 : 1)
            .animation(configuration.isPressed ? .spring(response: 0.18, dampingFraction: 0.9) : .spring(response: 0.52, dampingFraction: 0.38), value: configuration.isPressed)
    }
}

struct ListBar: View {
    var on: AppTab = .chats
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var still
    @State private var open = false
    @State private var swell = false
    @State private var home: CGFloat = 0
    @Namespace private var space

    var body: some View {
        if model.tab == on { row }
    }

    private var row: some View {
        Melt(spacing: 6) {
            if open, let room = model.here {
                ChannelCard(room: room) { open = false }
                    .melting("side", in: space, RoundedRectangle(cornerRadius: 30, style: .continuous))
                    .transition(.blurReplace)
            } else {
                HStack(spacing: Bar.gap) {
                    TabsPill()
                        .melting("tabs", in: space, Capsule())
                    if let room = model.here {
                        Button {
                            Haptic.tap()
                            grow()
                        } label: {
                            HStack(spacing: 8) {
                                ChannelAvatar(room: room, size: 34)
                                Text(room.title)
                                    .font(.system(size: 15, weight: .semibold))
                                    .foregroundStyle(Tone.ink)
                                    .lineLimit(1)
                            }
                            .padding(.leading, 14)
                            .padding(.trailing, 18)
                            .frame(maxWidth: 160, maxHeight: .infinity)
                            .fixedSize(horizontal: true, vertical: false)
                            .contentShape(Capsule())
                        }
                        .buttonStyle(Squish())
                        .scaleEffect(swell ? 1.18 : 1)
                        .frame(height: Bar.height)
                        .melting("side", in: space, Capsule())
                        .accessibilityIdentifier("channel")
                        .accessibilityLabel(room.title)
                        .accessibilityValue(room.status(of: "main") ?? "")
                        .transition(.blurReplace)
                    }
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, open || home <= 20 ? 12 : -12)
        .onGeometryChange(for: CGFloat.self) {
            $0.safeAreaInsets.bottom
        } action: {
            home = $0
        }
        .background {
            if open {
                Color.black.opacity(0.001)
                    .frame(width: 3000, height: 3000)
                    .onTapGesture { open = false }
                    .accessibilityHidden(true)
            }
        }
        .animation(Bar.spring(still), value: open)
        .onChange(of: model.tab) { _, _ in open = false }
    }

    private func grow() {
        guard !still else {
            open = true
            return
        }
        withAnimation(.easeOut(duration: 0.14)) { swell = true }
        Task {
            try? await Task.sleep(for: .milliseconds(140))
            swell = false
            open = true
        }
    }
}

private struct ChannelCard: View {
    let room: RoomView
    let close: () -> Void
    @Environment(AppModel.self) private var model

    private var working: [MemberView] {
        Array(room.members.filter { $0.isAgent && $0.working }.prefix(4))
    }

    private var said: String? {
        guard let lead = room.lead, let key = room.sideKey, let last = room.placeView(key)?.last, last.from == lead else { return nil }
        let words = last.plain.replacingOccurrences(of: "\n", with: " ").trimmingCharacters(in: .whitespaces)
        return words.isEmpty ? nil : words
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Button {
                Haptic.tap()
                close()
            } label: {
                HStack(spacing: 10) {
                    ChannelAvatar(room: room, size: 36)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(room.title).font(.system(size: 16, weight: .semibold)).foregroundStyle(Tone.ink).lineLimit(1)
                        if let line = room.status(of: "main") {
                            Text(line).type(.meta).foregroundStyle(Tone.ink3).lineLimit(1)
                        }
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.down").font(.system(size: 13, weight: .bold)).foregroundStyle(Tone.ink3)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("channel-card")
            .accessibilityLabel(room.title)
            if let said, let lead = room.lead {
                HStack(alignment: .top, spacing: 8) {
                    Face(name: lead, member: room.member(lead), size: 22)
                    Text(said).type(.ui).foregroundStyle(Tone.ink).lineLimit(3)
                }
            }
            ForEach(working) { member in
                HStack(spacing: 8) {
                    Face(name: member.name, member: member, size: 22)
                    Text(member.display).type(.ui, .semibold).foregroundStyle(Tone.ink).lineLimit(1)
                    if let task = member.doing.first {
                        Text(verbatim: "\(taskLabel(task)) \(room.tasks.first { $0.id == task }?.title ?? "")")
                            .type(.meta)
                            .foregroundStyle(Tone.ink3)
                            .lineLimit(1)
                    }
                }
            }
            if let spot = room.leadSpot {
                LeadDock(room: room, spot: spot, done: close)
                    .padding(.horizontal, -12)
                    .padding(.bottom, -6)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 14)
        .padding(.bottom, 8)
    }
}

private struct LeadDock: View {
    let room: RoomView
    let spot: Spot
    let done: () -> Void
    @Environment(AppModel.self) private var model
    @State private var replyTo: MessageView?
    @State private var answering: AskView?
    @State private var sendingBack: ReviewView?
    @FocusState private var typing: Bool

    var body: some View {
        Dock(room: room, spot: spot, replyTo: $replyTo, answering: $answering, sendingBack: $sendingBack, typing: $typing)
            .onChange(of: model.pending[spot.id]?.count ?? 0) { old, now in
                guard now > old else { return }
                typing = false
                done()
            }
    }
}

struct Melt<Content: View>: View {
    let spacing: CGFloat
    @ViewBuilder let content: () -> Content

    var body: some View {
        if #available(iOS 26.0, *) {
            GlassEffectContainer(spacing: spacing) { content() }
        } else {
            content()
        }
    }
}

extension View {
    @ViewBuilder func lens() -> some View {
        if #available(iOS 26.0, *) {
            self.glassEffect(.regular.tint(Tone.accentWash).interactive(), in: Capsule())
        } else {
            self.background(Tone.accentWash, in: Capsule())
        }
    }

    @ViewBuilder func melting<S: Shape>(_ id: String, in space: Namespace.ID, _ shape: S) -> some View {
        if #available(iOS 26.0, *) {
            self.glassEffect(.regular.tint(Tone.glassTint).interactive(), in: shape).glassEffectID(id, in: space)
        } else {
            self
                .background(Tone.raised, in: shape)
                .overlay(shape.stroke(Tone.line, lineWidth: 0.5))
        }
    }
}
