import SwiftUI
import UIKit

extension AppTab {
    static let order: [AppTab] = [.chats, .needs]

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
    static let icons: CGFloat = 112

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
        .padding(4)
        .frame(width: compact ? Bar.icons : nil, height: Bar.height)
        .frame(maxWidth: compact ? Bar.icons : .infinity)
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
                    .font(.system(size: compact ? 20 : 19, weight: .semibold))
                    .frame(height: 24)
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

struct YouButton: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Button {
            Haptic.tap()
            model.showYou = true
        } label: {
            Face(name: model.person, member: nil, size: 36)
                .frame(width: 44, height: 44)
                .contentShape(Circle())
        }
        .buttonStyle(Squish())
        .accessibilityIdentifier("you")
        .accessibilityLabel(Text("You"))
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

@MainActor
@Observable
final class Compose {
    var replyTo: MessageView?
    var answering: AskView?
    var sendingBack: ReviewView?
    var typing = false
}

extension AppModel {
    func compose(_ spot: Spot) -> Compose {
        if let found = chats[spot] { return found }
        let made = Compose()
        chats[spot] = made
        return made
    }
}

extension RoomView {
    func talks(at spot: Spot) -> Bool {
        spot.general || spot.place == sideKey || placeView(spot.place)?.kind == "room"
    }
}

struct RootBar: View {
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var still
    @Namespace private var space

    private var chat: Spot? {
        guard model.tab == .chats, case .place(let spot)? = model.path.last, let room = model.shown(spot) else { return nil }
        let compose = model.compose(spot)
        return room.talks(at: spot) || compose.answering != nil || compose.sendingBack != nil ? spot : nil
    }

    var body: some View {
        Melt(spacing: 6) {
            if let spot = chat, let room = model.shown(spot) {
                ChatBar(room: room, spot: spot, compose: model.compose(spot), space: space)
            } else {
                ListRow(space: space)
            }
        }
        .animation(Bar.spring(still), value: chat)
    }
}

private struct ChatBar: View {
    let room: RoomView
    let spot: Spot
    @Bindable var compose: Compose
    let space: Namespace.ID
    @FocusState private var typing: Bool

    var body: some View {
        Dock(
            room: room, spot: spot, replyTo: $compose.replyTo, answering: $compose.answering, sendingBack: $compose.sendingBack, typing: $typing, tabs: true,
            space: space
        )
        .onAppear { typing = compose.typing }
        .onChange(of: spot) { _, _ in typing = compose.typing }
        .onChange(of: compose.typing) { _, now in if typing != now { typing = now } }
        .onChange(of: typing) { _, now in if compose.typing != now { compose.typing = now } }
    }
}

private struct ListRow: View {
    let space: Namespace.ID
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var still
    @State private var swell = false
    @State private var home: CGFloat = 0

    private var open: Bool { model.cardOpen }

    var body: some View {
        HStack(alignment: .bottom, spacing: Bar.gap) {
            if open {
                Button {
                    Haptic.tap()
                    close()
                } label: {
                    Image(systemName: model.tab.symbol)
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(Tone.accent)
                        .frame(width: Bar.height, height: Bar.height)
                        .contentShape(Circle())
                }
                .buttonStyle(Squish())
                .melting("tabs", in: space, Circle())
                .accessibilityIdentifier("tab-current")
                .accessibilityLabel(Text(model.tab.title))
            } else {
                TabsPill()
                    .melting("tabs", in: space, Capsule())
            }
            if let room = model.here {
                if open {
                    ChannelCard(room: room) { close() }
                        .melting("side", in: space, RoundedRectangle(cornerRadius: 30, style: .continuous))
                        .transition(.blurReplace)
                } else {
                    Button {
                        Haptic.tap()
                        grow()
                    } label: {
                        ChannelAvatar(room: room, size: 34)
                            .frame(width: Bar.height, height: Bar.height)
                            .contentShape(Circle())
                    }
                    .buttonStyle(Squish())
                    .scaleEffect(swell ? 1.18 : 1)
                    .melting("side", in: space, Circle())
                    .accessibilityIdentifier("channel")
                    .accessibilityLabel(room.title)
                    .accessibilityValue(room.status(of: "main") ?? "")
                    .transition(.blurReplace)
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
        .animation(Bar.spring(still), value: open)
    }

    private func close() {
        withAnimation(Bar.spring(still)) { model.cardOpen = false }
    }

    private func grow() {
        guard !still else {
            model.cardOpen = true
            return
        }
        withAnimation(.easeOut(duration: 0.14)) { swell = true }
        Task {
            try? await Task.sleep(for: .milliseconds(140))
            swell = false
            withAnimation(Bar.spring(still)) { model.cardOpen = true }
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

    @ViewBuilder func sideGlass(_ space: Namespace.ID?, radius: CGFloat) -> some View {
        if let space {
            self.melting("side", in: space, RoundedRectangle(cornerRadius: radius, style: .continuous))
        } else {
            self.glass(radius)
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
