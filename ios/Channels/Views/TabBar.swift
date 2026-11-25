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
        let code: String? =
            switch path.last {
            case .place(let spot): spot.code
            case .tasks(let code): code
            case nil: nil
            }
        return code.flatMap { rooms[$0] } ?? channels.first
    }

    func pick(_ next: AppTab) {
        if next == tab, next == .chats { path = [] }
        tab = next
    }
}

enum Bar {
    static let height: CGFloat = 62
    static let gap: CGFloat = 10
    static let icons: CGFloat = 150

    static func spring(_ still: Bool) -> Animation {
        still ? .easeInOut(duration: 0.2) : .interpolatingSpring(mass: 0.9, stiffness: 260, damping: 20)
    }
}

struct TabBar: View {
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var still
    @Binding var picking: Bool
    @Namespace private var space

    private var compact: Bool { picking || model.composing != nil }

    var body: some View {
        Melt(spacing: Bar.gap) {
            HStack(spacing: Bar.gap) {
                HStack(spacing: 0) {
                    ForEach(AppTab.order, id: \.self) { tab in
                        TabButton(tab: tab, compact: compact, space: space) {
                            Haptic.tap()
                            picking = false
                            model.pick(tab)
                        }
                    }
                }
                .padding(4)
                .frame(width: compact ? Bar.icons : nil)
                .frame(maxWidth: compact ? Bar.icons : .infinity, maxHeight: .infinity)
                .melting("tabs", in: space)
                if model.composing != nil, !picking {
                    Composer()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .melting("side", in: space)
                        .transition(.blurReplace)
                } else if let room = model.here {
                    ChannelCapsule(room: room, open: picking) {
                        Haptic.tap()
                        picking.toggle()
                    }
                    .frame(maxWidth: compact ? .infinity : 170, maxHeight: .infinity)
                    .fixedSize(horizontal: !compact, vertical: false)
                    .melting("side", in: space)
                    .transition(.blurReplace)
                }
            }
        }
        .frame(height: Bar.height)
        .animation(Bar.spring(still), value: picking)
        .animation(Bar.spring(still), value: model.composing)
        .animation(Bar.spring(still), value: model.tab)
    }

}

private struct TabButton: View {
    let tab: AppTab
    let compact: Bool
    let space: Namespace.ID
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
                            Text("\(model.waiting)")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(.white)
                                .padding(.horizontal, 5)
                                .frame(minWidth: 17, minHeight: 17)
                                .background(Capsule().fill(Tone.alert))
                                .offset(x: 12, y: -5)
                        }
                    }
                if !compact {
                    Text(tab.title)
                        .font(.system(size: 11, weight: .medium))
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .transition(.opacity)
                }
            }
            .foregroundStyle(lit ? Tone.ink : Tone.ink2)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background {
                if lit {
                    Capsule().fill(Tone.ink.opacity(0.09)).matchedGeometryEffect(id: "lit", in: space)
                }
            }
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("tab-\(tab.key)")
        .accessibilityLabel(Text(tab.title))
        .accessibilityValue(tab == .needs && model.waiting > 0 ? String(model.waiting) : String())
        .accessibilityAddTraits(lit ? .isSelected : [])
    }
}

private struct ChannelCapsule: View {
    let room: RoomView
    let open: Bool
    let toggle: () -> Void

    var body: some View {
        Button(action: toggle) {
            HStack(spacing: 10) {
                ChannelAvatar(room: room, size: 40)
                VStack(alignment: .leading, spacing: 1) {
                    Text(room.title)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Tone.ink)
                        .lineLimit(1)
                    if open, let line = room.status(of: "main") {
                        Text(line).type(.meta).foregroundStyle(Tone.ink3).lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.up")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Tone.ink3)
                    .rotationEffect(.degrees(open ? 180 : 0))
            }
            .padding(.leading, 11)
            .padding(.trailing, 16)
            .frame(maxHeight: .infinity)
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("fold-channel")
        .accessibilityLabel(room.title)
        .accessibilityValue(room.status(of: "main") ?? "")
        .accessibilityAddTraits(open ? .isSelected : [])
    }
}

struct Composer: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        if let spot = model.composing {
            let draft = model.draft(spot.code, spot.place)
            let text = draft.text.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "\n", with: " ")
            Button {
                model.openComposer = spot
            } label: {
                HStack(spacing: 10) {
                    if !draft.attached.isEmpty {
                        Image(systemName: "photo").foregroundStyle(Tone.ink2)
                    }
                    Text(text.isEmpty ? spoken("Message") : text)
                        .type(.body)
                        .foregroundStyle(text.isEmpty ? Tone.ink3 : Tone.ink)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 20)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("composer")
            .accessibilityLabel(text.isEmpty ? spoken("Message") : text)
        }
    }
}

struct ChannelMenu: View {
    @Environment(AppModel.self) private var model
    @Binding var picking: Bool

    var body: some View {
        DragMenu(
            choices: model.channels.prefix(6).map { room in
                Choice(id: "channel-\(room.code)", title: room.title, line: room.status(of: "main"), room: room) {
                    picking = false
                    model.jump(.place(Spot(code: room.code)))
                }
            })
    }
}

struct Choice: Identifiable {
    let id: String
    let title: String
    let line: String?
    let room: RoomView
    let run: () -> Void
}

struct DragMenu: View {
    let choices: [Choice]
    @State private var hover: Int?

    private static let row: CGFloat = 56
    private static let inset: CGFloat = 6

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(choices.enumerated()), id: \.element.id) { at, choice in
                HStack(spacing: 12) {
                    ChannelAvatar(room: choice.room, size: 36)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(choice.title).type(.body).foregroundStyle(Tone.ink).lineLimit(1)
                        if let line = choice.line {
                            Text(line).type(.meta).foregroundStyle(Tone.ink3).lineLimit(1)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 12)
                .frame(height: Self.row)
                .background {
                    if hover == at {
                        RoundedRectangle(cornerRadius: 20, style: .continuous).fill(Tone.ink.opacity(0.09)).padding(.horizontal, 6)
                    }
                }
                .contentShape(Rectangle())
                .accessibilityElement(children: .combine)
                .accessibilityAddTraits(.isButton)
                .accessibilityIdentifier("menu-\(choice.id)")
                .accessibilityAction { choice.run() }
            }
        }
        .padding(.vertical, Self.inset)
        .glass(28)
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { drag in
                    let now = index(drag.location.y)
                    guard now != hover else { return }
                    hover = now
                    if now != nil { Haptic.tick() }
                }
                .onEnded { drag in
                    hover = nil
                    guard let at = index(drag.location.y) else { return }
                    Haptic.tap()
                    choices[at].run()
                }
        )
    }

    private func index(_ y: CGFloat) -> Int? {
        let at = Int(((y - Self.inset) / Self.row).rounded(.down))
        return choices.indices.contains(at) ? at : nil
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
    @ViewBuilder func melting(_ id: String, in space: Namespace.ID) -> some View {
        if #available(iOS 26.0, *) {
            self.glassEffect(.regular.tint(Tone.glassTint).interactive(), in: Capsule()).glassEffectID(id, in: space)
        } else {
            self
                .background(Tone.raised, in: Capsule())
                .overlay(Capsule().strokeBorder(Tone.line, lineWidth: 0.5))
        }
    }
}
