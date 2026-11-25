import SwiftUI
import UIKit

struct ConversationScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(Lock.self) private var lock
    @State private var spot: Spot
    @State private var replyTo: MessageView?
    @State private var answering: AskView?
    @State private var sendingBack: ReviewView?
    @State private var position = ScrollPosition(edge: .bottom)
    @State private var follow = Follow()
    @State private var visible = false
    @State private var open = false
    @FocusState private var typing: Bool
    @Environment(\.scenePhase) private var scene

    init(start: Spot) {
        _spot = State(initialValue: start)
    }

    var body: some View {
        Group {
            if let room = model.shown(spot) {
                Conversation(
                    room: room, replyTo: $replyTo, position: $position, follow: $follow, typing: $typing, elsewhere: spot.general ? room.elsewhere() : [],
                    reviews: reviews(room), needs: needs(room), worker: worker(room)
                ) { ask in
                    replyTo = nil
                    sendingBack = nil
                    answering = ask
                    focus()
                } sendBack: { review in
                    replyTo = nil
                    answering = nil
                    sendingBack = review
                    focus()
                }
                .id(spot.id)
                .overlay(alignment: .bottomTrailing) {
                    if !follow.atBottom {
                        JumpButton(follow: follow) { follow.jumps += 1 }
                            .padding(.trailing, 16)
                            .padding(.bottom, 4)
                            .transition(.scale(scale: 0.5).combined(with: .opacity))
                    }
                }
                .animation(.snappy(duration: 0.25), value: follow.atBottom)
                .bar(.bottom) {
                    if docks(room) {
                        Dock(room: room, spot: spot, replyTo: $replyTo, answering: $answering, sendingBack: $sendingBack, typing: $typing) {
                            if RestingComposer.available { open = false }
                        }
                    }
                }
                .onChange(of: resting(room), initial: true) { _, now in rest(now) }
                .navigationTitle(room.spotTitle(spot.place))
                .subtitle(room.status(of: spot.place))
                .toolbar {
                    if room.messages.contains(where: \.event) {
                        ToolbarItem(placement: .topBarTrailing) { UpdatesButton(room: room) }
                    }
                }
                .onChange(of: room.placeView(spot.place)?.lastSeq) { _, _ in seen() }
            } else {
                Centered(title: "This channel is gone", detail: spoken("Its owner closed it, or this phone was removed from it."))
            }
        }
        .background(Tone.canvas)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .onAppear {
            visible = true
            seen()
            if model.focusNext == spot {
                model.focusNext = nil
                open = true
                Task {
                    try? await Task.sleep(for: .milliseconds(350))
                    typing = true
                }
            }
        }
        .onDisappear {
            visible = false
            rest(false)
        }
        .onChange(of: model.openComposer) { _, asked in
            guard asked == spot else { return }
            model.openComposer = nil
            focus()
        }
        .onChange(of: replyTo != nil) { _, now in if now { focus() } }
        .onChange(of: scene) { _, _ in seen() }
        .onChange(of: lock.locked) { _, _ in seen() }
        .task(id: spot) {
            follow = Follow()
            await model.open(spot.code, place: spot.place == model.rooms[spot.code]?.sideKey ? "main" : spot.place)
        }
    }

    private func docks(_ room: RoomView) -> Bool {
        if answering != nil || sendingBack != nil { return true }
        return talks(room) && (!RestingComposer.available || open || replyTo != nil)
    }

    private func resting(_ room: RoomView) -> Bool {
        visible && RestingComposer.available && talks(room) && !docks(room)
    }

    private func rest(_ now: Bool) {
        if now {
            model.composing = spot
        } else if model.composing == spot {
            model.composing = nil
        }
    }

    private func focus() {
        open = true
        Task {
            try? await Task.sleep(for: .milliseconds(60))
            typing = true
        }
    }

    private func talks(_ room: RoomView) -> Bool {
        spot.general || spot.place == room.sideKey || room.placeView(spot.place)?.kind == "room"
    }

    private func needs(_ room: RoomView) -> [NeedView] {
        if spot.general { return room.open }
        let place = room.placeView(spot.place)
        if let task = place?.task ?? room.taskIn(spot.place) { return room.open.filter { $0.task == task } }
        if let other = place.flatMap({ room.other(in: $0) }) ?? room.dmWith(spot.place) { return room.open.filter { $0.from == other } }
        return []
    }

    private func reviews(_ room: RoomView) -> [ReviewView] {
        if spot.general { return room.reviews }
        guard let task = room.placeView(spot.place)?.task ?? room.taskIn(spot.place) else { return [] }
        return room.reviews.filter { $0.task == task }
    }

    private func worker(_ room: RoomView) -> MemberView? {
        let place = room.placeView(spot.place)
        let task = place?.task ?? room.taskIn(spot.place)
        let name = task.flatMap { id in room.tasks.first { $0.id == id }?.owner } ?? place.flatMap { room.other(in: $0) } ?? room.dmWith(spot.place)
        return name.flatMap { room.member($0) }.flatMap { $0.isAgent ? $0 : nil }
    }

    private func seen() {
        guard visible, scene == .active, !lock.hides else { return }
        model.markRead(spot)
    }
}

extension RoomView {
    func status(of key: String) -> String? {
        let place = placeView(key)
        let main = key == "main"
        let other = (place.flatMap { self.other(in: $0) } ?? dmWith(key)).flatMap { member($0) }
        let busy = other.flatMap { o in o.working ? (o.doing.first.map { spoken("working on \(taskLabel($0))") } ?? spoken("working")) : nil }
        let needs = main ? asks.count + reviews.count + open.count : 0
        let parts: [String] = [
            key.hasPrefix("dm:") ? (busy ?? (other?.here == true ? spoken("here") : spoken("away"))) : nil,
            connection == .connecting ? spoken("Connecting…") : nil,
            connection == .reconnecting ? spoken("Reconnecting…") : nil,
            main && working > 0 ? spoken("\(working) working") : nil,
            needs > 0 ? spoken("\(needs) need you") : nil,
        ].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

@MainActor
enum Icons {
    private static let decoded = NSCache<NSString, UIImage>()

    static func picture(_ room: RoomView) -> UIImage? {
        guard let data = room.icon?.data else { return nil }
        let key = "\(room.code)|\(data.count)|\(data.suffix(32))" as NSString
        if let hit = decoded.object(forKey: key) { return hit }
        guard let raw = Data(base64Encoded: data), let image = UIImage(data: raw) else { return nil }
        decoded.setObject(image, forKey: key)
        return image
    }
}

struct ChannelAvatar: View {
    let room: RoomView
    var size: CGFloat = 50

    var body: some View {
        Group {
            if room.icon?.kind == "image", let picture = Icons.picture(room) {
                Image(uiImage: picture).resizable().scaledToFill().background(Tone.wash2)
            } else {
                let tint = Tone.member(Palette.tint(for: room.code))
                Text(room.title.prefix(1).uppercased())
                    .font(.system(size: size * 0.42, weight: .semibold))
                    .foregroundStyle(tint)
                    .frame(width: size, height: size)
                    .background(tint.opacity(0.18))
                    .background(Tone.raised)
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .accessibilityHidden(true)
    }
}

extension View {
    @ViewBuilder func subtitle(_ text: String?) -> some View {
        if #available(iOS 26.0, *), let text {
            self.navigationSubtitle(text)
        } else {
            self
        }
    }

    @ViewBuilder func softBars() -> some View {
        if #available(iOS 26.0, *) {
            self.scrollEdgeEffectStyle(.soft, for: .all)
        } else {
            self
        }
    }

    @ViewBuilder func shrinkingTabBar(inChat: Bool) -> some View {
        if #available(iOS 26.0, *) {
            self.tabBarMinimizeBehavior(inChat ? .onScrollUp : .onScrollDown)
        } else {
            self
        }
    }

    @ViewBuilder func restingComposer(_ shown: Bool) -> some View {
        if #available(iOS 26.1, *) {
            self.tabViewBottomAccessory(isEnabled: shown) { RestingComposer() }
        } else {
            self
        }
    }

    @ViewBuilder func bar<Content: View>(_ edge: VerticalEdge, @ViewBuilder content: () -> Content) -> some View {
        if #available(iOS 26.0, *) {
            self.safeAreaBar(edge: edge, spacing: 0, content: content)
        } else {
            self.safeAreaInset(edge: edge, spacing: 0, content: content)
        }
    }
}

struct RestingComposer: View {
    static var available: Bool {
        if #available(iOS 26.1, *) { true } else { false }
    }

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
                .padding(.horizontal, 16)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("composer")
            .accessibilityLabel(text.isEmpty ? spoken("Message") : text)
            .onGeometryChange(for: CGFloat.self) {
                $0.frame(in: .global).minY
            } action: {
                model.restingTop = $0
            }
            .onDisappear { model.restingTop = nil }
        }
    }
}
