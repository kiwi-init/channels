import SwiftUI
import UIKit

struct ConversationScreen: View {
    @Environment(AppModel.self) private var model
    @State private var spot: Spot
    @State private var replyTo: MessageView?
    @State private var answering: AskView?
    @State private var sendingBack: ReviewView?
    @State private var position = ScrollPosition(edge: .bottom)
    @State private var follow = Follow()
    @State private var visible = false
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
                    typing = true
                } sendBack: { review in
                    replyTo = nil
                    answering = nil
                    sendingBack = review
                    typing = true
                }
                .id(spot.id)
                .bar(.bottom) {
                    Dock(room: room, spot: spot, replyTo: $replyTo, answering: $answering, sendingBack: $sendingBack, typing: $typing, follow: follow) {
                        withAnimation(Motion.ease) { position.scrollTo(edge: .bottom) }
                    }
                }
                .navigationTitle(room.spotTitle(spot.place))
                .subtitle(room.status(of: spot.place))
                .onChange(of: room.placeView(spot.place)?.lastSeq) { _, _ in seen() }
            } else {
                Centered(title: "This channel is gone", detail: "Its owner closed it, or this phone was removed from it.")
            }
        }
        .background(Tone.canvas)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .onAppear {
            visible = true
            seen()
        }
        .onDisappear { visible = false }
        .onChange(of: scene) { _, _ in seen() }
        .onChange(of: model.drawer) { _, _ in seen() }
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
        guard visible, scene == .active, model.drawer == .closed else { return }
        model.markRead(spot)
    }
}

extension RoomView {
    func status(of key: String) -> String? {
        let place = placeView(key)
        let main = key == "main"
        let other = (place.flatMap { self.other(in: $0) } ?? dmWith(key)).flatMap { member($0) }
        let busy = other.flatMap { o in o.working ? (o.doing.first.map { "working on \(taskLabel($0))" } ?? "working") : nil }
        let needs = main ? asks.count + reviews.count + open.count : 0
        let parts: [String] = [
            key.hasPrefix("dm:") ? (busy ?? (other?.here == true ? "here" : "away")) : nil,
            connection == .connecting ? "Connecting…" : nil,
            connection == .reconnecting ? "Reconnecting…" : nil,
            main && working > 0 ? "\(working) working" : nil,
            needs > 0 ? "\(needs) \(needs == 1 ? "needs" : "need") you" : nil,
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

    @ViewBuilder func bar<Content: View>(_ edge: VerticalEdge, @ViewBuilder content: () -> Content) -> some View {
        if #available(iOS 26.0, *) {
            self.safeAreaBar(edge: edge, spacing: 0, content: content)
        } else {
            self.safeAreaInset(edge: edge, spacing: 0, content: content)
        }
    }
}
