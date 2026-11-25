import SwiftUI
import UIKit

enum Fold: Hashable {
    case tabs, channel, me
}

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
    static let pair: CGFloat = 112

    static func spring(_ still: Bool) -> Animation {
        still ? .easeInOut(duration: 0.2) : .interpolatingSpring(mass: 0.9, stiffness: 260, damping: 20)
    }
}

struct TabBar: View {
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var still
    @Binding var fold: Fold?
    @Namespace private var space

    private var wide: Bool { fold == .tabs || (fold == nil && model.composing == nil) }

    var body: some View {
        Melt(spacing: Bar.gap) {
            HStack(spacing: Bar.gap) {
                left
                    .frame(width: wide ? nil : Bar.height)
                    .frame(maxWidth: wide ? .infinity : Bar.height, maxHeight: .infinity)
                    .melting("left", in: space)
                right
                    .frame(width: wide ? Bar.pair : nil)
                    .frame(maxWidth: wide ? Bar.pair : .infinity, maxHeight: .infinity)
                    .melting("right", in: space)
            }
        }
        .frame(height: Bar.height)
        .animation(Bar.spring(still), value: fold)
        .animation(Bar.spring(still), value: model.composing)
        .animation(Bar.spring(still), value: model.tab)
    }

    @ViewBuilder private var left: some View {
        if wide {
            HStack(spacing: 0) {
                ForEach(AppTab.order, id: \.self) { tab in
                    TabButton(tab: tab, space: space) {
                        Haptic.tap()
                        fold = nil
                        model.pick(tab)
                    }
                }
            }
            .padding(4)
            .transition(.blurReplace)
        } else {
            Button {
                Haptic.tap()
                fold = fold == nil ? .tabs : nil
            } label: {
                Image(systemName: model.tab.symbol)
                    .font(.system(size: 21, weight: .semibold))
                    .foregroundStyle(Tone.ink)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("tabs")
            .accessibilityLabel(Text("Show Tabs"))
            .transition(.blurReplace)
        }
    }

    @ViewBuilder private var right: some View {
        let room = model.here
        switch fold {
        case .channel:
            if let room {
                Unfolded(title: room.title, line: room.status(of: "main")) {
                    ChannelAvatar(room: room, size: 46)
                } close: {
                    fold = nil
                }
                .transition(.blurReplace)
            }
        case .me:
            Unfolded(title: model.person, line: mine) {
                Face(name: model.person, member: room?.member(room?.me ?? ""), size: 46)
            } close: {
                fold = nil
            }
            .transition(.blurReplace)
        case nil where model.composing != nil:
            Composer()
                .transition(.blurReplace)
        default:
            HStack(spacing: 4) {
                if let room {
                    Button {
                        Haptic.tap()
                        fold = .channel
                    } label: {
                        ChannelAvatar(room: room, size: 46)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("fold-channel")
                    .accessibilityLabel(room.title)
                }
                Button {
                    Haptic.tap()
                    fold = .me
                } label: {
                    Face(name: model.person, member: room?.member(room?.me ?? ""), size: 46)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("fold-me")
                .accessibilityLabel(model.person)
            }
            .padding(.horizontal, 8)
            .transition(.blurReplace)
        }
    }

    private var mine: String {
        if model.waiting > 0 { return spoken("\(model.waiting) need you") }
        return model.enrolled ? spoken("One of your devices") : spoken("Linked to your Mac")
    }
}

private struct TabButton: View {
    let tab: AppTab
    let space: Namespace.ID
    let pick: () -> Void
    @Environment(AppModel.self) private var model

    private var lit: Bool { model.tab == tab }

    var body: some View {
        Button(action: pick) {
            VStack(spacing: 2) {
                Image(systemName: tab.symbol)
                    .font(.system(size: 19, weight: .semibold))
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
                Text(tab.title)
                    .font(.system(size: 11, weight: .medium))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
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

private struct Unfolded<Mark: View>: View {
    let title: String
    let line: String?
    @ViewBuilder let mark: () -> Mark
    let close: () -> Void

    var body: some View {
        Button {
            Haptic.tap()
            close()
        } label: {
            HStack(spacing: 10) {
                mark()
                VStack(alignment: .leading, spacing: 1) {
                    Text(title)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Tone.ink)
                        .lineLimit(1)
                    if let line {
                        Text(line).type(.meta).foregroundStyle(Tone.ink3).lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 8)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("unfolded")
    }
}

struct Composer: View {
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var still
    @State private var swipe: CGFloat = 0

    var body: some View {
        if let spot = model.composing {
            let draft = model.draft(spot.code, spot.place)
            let text = draft.text.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "\n", with: " ")
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
            .offset(x: swipe * 0.5)
            .opacity(1 - min(abs(swipe) / 240, 0.5))
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .contentShape(Capsule())
            .onTapGesture { model.openComposer = spot }
            .gesture(
                DragGesture(minimumDistance: 14)
                    .onChanged { swipe = $0.translation.width }
                    .onEnded { end in
                        let dx = end.translation.width + (end.predictedEndTranslation.width - end.translation.width) * 0.3
                        withAnimation(Bar.spring(still)) { swipe = 0 }
                        if abs(dx) > 80 { hop(spot, dx < 0 ? 1 : -1) }
                    }
            )
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isButton)
            .accessibilityIdentifier("composer")
            .accessibilityLabel(text.isEmpty ? spoken("Message") : text)
            .accessibilityAction { model.openComposer = spot }
        }
    }

    private func hop(_ spot: Spot, _ by: Int) {
        let spots = model.rows(.all).map(\.spot)
        guard let at = spots.firstIndex(of: spot), spots.indices.contains(at + by) else { return }
        Haptic.tap()
        model.jump(.place(spots[at + by]))
    }
}

struct FoldMenu: View {
    @Environment(AppModel.self) private var model
    @Binding var fold: Fold?

    var body: some View {
        switch fold {
        case .channel: DragMenu(choices: rooms)
        case .me: DragMenu(choices: mine)
        default: EmptyView()
        }
    }

    private var rooms: [Choice] {
        model.channels.prefix(6).map { room in
            Choice(id: "channel-\(room.code)", title: room.title, line: room.status(of: "main"), mark: .room(room)) {
                fold = nil
                model.jump(.place(Spot(code: room.code)))
            }
        }
    }

    private var mine: [Choice] {
        var out: [Choice] = []
        if let room = model.here, let lead = room.lead, let spot = room.leadSpot {
            out.append(
                Choice(id: "lead", title: spoken("Message \(room.display(lead)) directly"), line: room.title, mark: .face(lead, room.member(lead))) {
                    fold = nil
                    model.jump(.place(spot))
                })
        }
        out.append(
            Choice(id: "needs", title: spoken("Needs You"), line: model.waiting > 0 ? spoken("\(model.waiting) need you") : nil, mark: .symbol(AppTab.needs.symbol)) {
                fold = nil
                model.tab = .needs
            })
        out.append(
            Choice(id: "you", title: spoken("You"), line: nil, mark: .symbol(AppTab.you.symbol)) {
                fold = nil
                model.tab = .you
            })
        return out
    }
}

struct Choice: Identifiable {
    enum Mark {
        case room(RoomView)
        case face(String, MemberView?)
        case symbol(String)
    }

    let id: String
    let title: String
    let line: String?
    let mark: Mark
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
                    mark(choice.mark)
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

    @ViewBuilder private func mark(_ mark: Choice.Mark) -> some View {
        switch mark {
        case .room(let room): ChannelAvatar(room: room, size: 36)
        case .face(let name, let member): Face(name: name, member: member, size: 36)
        case .symbol(let symbol):
            Image(systemName: symbol)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Tone.ink2)
                .frame(width: 36, height: 36)
                .background(Circle().fill(Tone.raised))
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
