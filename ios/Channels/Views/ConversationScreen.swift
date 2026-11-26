import SwiftUI
import UIKit

struct ConversationScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(Lock.self) private var lock
    @State private var spot: Spot
    @State private var position = ScrollPosition(edge: .bottom)
    @State private var follow = Follow()
    @State private var visible = false
    @Environment(\.scenePhase) private var scene
    @Environment(\.dismiss) private var dismiss

    private var elsewhereUnread: Int {
        model.channels.filter { $0.code != spot.code && model.unread(Spot(code: $0.code, place: "main")) }.count
    }

    init(start: Spot) {
        _spot = State(initialValue: start)
    }

    var body: some View {
        @Bindable var compose = model.compose(spot)
        Group {
            if let room = model.shown(spot) {
                Conversation(
                    room: room, replyTo: $compose.replyTo, position: $position, follow: $follow, typing: $compose.typing, elsewhere: spot.general ? room.elsewhere() : [],
                    reviews: reviews(room), needs: needs(room), worker: worker(room)
                ) { ask in
                    compose.replyTo = nil
                    compose.sendingBack = nil
                    compose.answering = ask
                    compose.typing = true
                } sendBack: { review in
                    compose.replyTo = nil
                    compose.answering = nil
                    compose.sendingBack = review
                    compose.typing = true
                }
                .id(spot.id)
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    if room.talks(at: spot) || compose.answering != nil || compose.sendingBack != nil {
                        ChatComposer(room: room, spot: spot, compose: compose)
                    }
                }
                .navigationTitle(room.spotTitle(spot.place))
                .navigationBarBackButtonHidden()
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button {
                            dismiss()
                        } label: {
                            HStack(spacing: 4) {
                                Image(systemName: "chevron.left").font(.system(size: 17, weight: .semibold))
                                if elsewhereUnread > 0 {
                                    Text(verbatim: "\(elsewhereUnread)")
                                        .font(.system(size: 13, weight: .semibold))
                                        .foregroundStyle(.white)
                                        .padding(.horizontal, 7)
                                        .frame(minHeight: 22)
                                        .background(Tone.bubbleMine, in: Capsule())
                                }
                            }
                            .foregroundStyle(Tone.bubbleMine)
                        }
                        .accessibilityIdentifier("back")
                        .accessibilityLabel(elsewhereUnread > 0 ? spoken("Back, \(elsewhereUnread) unread") : spoken("Back"))
                    }
                    ToolbarItem(placement: .principal) {
                        Button {
                            Haptic.tap()
                            model.details = spot
                        } label: {
                            VStack(spacing: 1) {
                                ChatMark(room: room, spot: spot)
                                HStack(spacing: 2) {
                                    Text(room.spotTitle(spot.place)).font(.system(size: 11, weight: .medium)).foregroundStyle(Tone.ink).lineLimit(1)
                                    Image(systemName: "chevron.right").font(.system(size: 8, weight: .bold)).foregroundStyle(Tone.ink3)
                                }
                            }
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("chat-title")
                        .accessibilityLabel(room.spotTitle(spot.place))
                    }
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
            model.lastCode = spot.code
            seen()
            if model.focusNext == spot {
                model.focusNext = nil
                Task {
                    try? await Task.sleep(for: .milliseconds(350))
                    model.compose(spot).typing = true
                }
            }
        }
        .onDisappear {
            visible = false
            model.compose(spot).typing = false
        }
        .onChange(of: scene) { _, _ in seen() }
        .onChange(of: lock.locked) { _, _ in seen() }
        .task(id: spot) {
            follow = Follow()
            await model.open(spot.code, place: spot.place == model.rooms[spot.code]?.sideKey ? "main" : spot.place)
        }
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
}
private struct ChatComposer: View {
    let room: RoomView
    let spot: Spot
    @Bindable var compose: Compose
    @FocusState private var typing: Bool

    var body: some View {
        Dock(
            room: room, spot: spot, replyTo: $compose.replyTo, answering: $compose.answering, sendingBack: $compose.sendingBack, typing: $typing
        )
        .background(Tone.canvas)
        .onAppear { typing = compose.typing }
        .onChange(of: compose.typing) { _, now in if typing != now { typing = now } }
        .onChange(of: typing) { _, now in if compose.typing != now { compose.typing = now } }
    }
}
private struct ChatMark: View {
    let room: RoomView
    let spot: Spot

    var body: some View {
        if let place = room.placeView(spot.place), place.kind == "dm", let other = room.other(in: place) {
            Face(name: other, member: room.member(other), size: 30)
        } else {
            ChannelAvatar(room: room, size: 30)
        }
    }
}
