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
    var leadRoom: RoomView? {
        let room = lastCode.flatMap { rooms[$0] }.flatMap { $0.gone == nil ? $0 : nil } ?? channels.first
        return room?.leadSpot == nil ? nil : room
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
    @Namespace private var space

    private var compact: Bool { model.composing != nil || model.leadRoom != nil }

    var body: some View {
        Melt(spacing: Bar.gap) {
            HStack(spacing: Bar.gap) {
                HStack(spacing: 0) {
                    ForEach(AppTab.order, id: \.self) { tab in
                        TabButton(tab: tab, compact: compact, space: space) {
                            Haptic.tap()
                            model.pick(tab)
                        }
                    }
                }
                .padding(4)
                .frame(width: compact ? Bar.icons : nil)
                .frame(maxWidth: compact ? Bar.icons : .infinity, maxHeight: .infinity)
                .melting("tabs", in: space)
                if model.composing != nil {
                    Composer()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .melting("side", in: space)
                        .transition(.blurReplace)
                } else if let room = model.leadRoom {
                    LeadPill(room: room)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .melting("side", in: space)
                        .transition(.blurReplace)
                }
            }
        }
        .frame(height: Bar.height)
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

struct LeadPill: View {
    let room: RoomView
    @Environment(AppModel.self) private var model

    var body: some View {
        if let lead = room.lead, let spot = room.leadSpot {
            let draft = model.draft(spot.code, spot.place).text.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "\n", with: " ")
            let sent = model.leadSent.map { Date.now.timeIntervalSince($0) < 2.5 } ?? false
            Button {
                model.leadOpen = true
            } label: {
                HStack(spacing: 10) {
                    Face(name: lead, member: room.member(lead), size: 34)
                    if sent {
                        Image(systemName: "checkmark").font(.system(size: 13, weight: .bold)).foregroundStyle(Tone.live)
                        Text(spoken("Sent to \(room.display(lead))")).type(.body).foregroundStyle(Tone.ink2).lineLimit(1)
                    } else {
                        Text(draft.isEmpty ? spoken("Message \(room.display(lead)) directly") : draft)
                            .type(.body)
                            .foregroundStyle(draft.isEmpty ? Tone.ink3 : Tone.ink)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 0)
                }
                .padding(.leading, 14)
                .padding(.trailing, 18)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .contentShape(Capsule())
                .animation(.easeOut(duration: 0.2), value: sent)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("lead-composer")
            .accessibilityLabel(draft.isEmpty ? spoken("Message \(room.display(lead)) directly") : draft)
            .task(id: model.leadSent) {
                guard model.leadSent != nil else { return }
                try? await Task.sleep(for: .seconds(2.5))
                model.leadSent = nil
            }
        }
    }
}

struct LeadDock: View {
    let room: RoomView
    let spot: Spot
    @Environment(AppModel.self) private var model
    @State private var replyTo: MessageView?
    @State private var answering: AskView?
    @State private var sendingBack: ReviewView?
    @FocusState private var typing: Bool

    var body: some View {
        Dock(room: room, spot: spot, replyTo: $replyTo, answering: $answering, sendingBack: $sendingBack, typing: $typing) {
            model.leadOpen = false
        }
        .onAppear {
            Task {
                try? await Task.sleep(for: .milliseconds(60))
                typing = true
            }
        }
        .onChange(of: model.pending[spot.id]?.count ?? 0) { old, now in
            guard now > old else { return }
            model.leadSent = .now
            typing = false
            model.leadOpen = false
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
