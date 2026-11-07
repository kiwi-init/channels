import SwiftUI
import UIKit

struct ConversationScreen: View {
    @Environment(AppModel.self) private var model
    @State private var spot: Spot
    @State private var details = ConversationScreen.opensDetails
    @State private var replyTo: MessageView?
    @State private var answering: AskView?
    @State private var sendingBack: ReviewView?
    @State private var position = ScrollPosition(edge: .bottom)
    @State private var follow = Follow()
    @FocusState private var typing: Bool
    @State private var side: CGFloat = 0
    @State private var sideAtStart: CGFloat = 0

    private static let sideWidth: CGFloat = 320
    private static let edge: CGFloat = 24

    init(start: Spot) {
        _spot = State(initialValue: start)
    }

    private static var opensDetails: Bool {
        #if DEBUG
            UserDefaults.standard.string(forKey: "shot") == "tasks"
        #else
            false
        #endif
    }

    var body: some View {
        Group {
            if let room = model.shown(spot) {
                Conversation(
                    room: room, replyTo: $replyTo, position: $position, follow: $follow, typing: $typing, elsewhere: spot.general ? room.elsewhere() : [],
                    reviews: spot.general ? room.reviews : [], needs: spot.general ? room.open : []
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
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            withAnimation(.spring(duration: 0.3, bounce: 0.05)) { side = 1 }
                            sideAtStart = 1
                        } label: {
                            Image(systemName: "sidebar.left")
                        }
                        .accessibilityLabel("Show \(room.title)'s rooms and people")
                    }
                    ToolbarItem(placement: .principal) {
                        Button {
                            details = true
                        } label: {
                            TitlePill(room: room, place: room.placeView(spot.place), fresh: false)
                        }
                        .buttonStyle(.plain)
                        .accessibilityHint("Shows the details")
                    }
                }
                .navigationDestination(isPresented: $details) {
                    DetailsScreen(code: room.code, current: spot.place) { key in
                        details = false
                        switchTo(Spot(code: room.code, place: key))
                    }
                }
                .simultaneousGesture(sideDrag)
                .overlay(alignment: .leading) { sidebar(room) }
                .onAppear(perform: seen)
                .onChange(of: room.placeView(spot.place)?.lastSeq) { _, _ in seen() }
                .onDisappear {
                    side = 0
                    sideAtStart = 0
                }
            } else {
                Centered(title: "This channel is gone", detail: "Its owner closed it, or this phone was removed from it.")
            }
        }
        .background(Tone.canvas)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .toolbar(.hidden, for: .tabBar)
        .task(id: spot) {
            follow = Follow()
            await model.open(spot.code, place: spot.place == model.rooms[spot.code]?.sideKey ? "main" : spot.place)
        }
    }

    private var sideDrag: some Gesture {
        DragGesture(minimumDistance: 16)
            .onChanged { drag in
                let dx = drag.translation.width
                guard abs(dx) > abs(drag.translation.height) * 1.3 else { return }
                if side == 0 && sideAtStart == 0 && (dx < 0 || drag.startLocation.x < Self.edge) { return }
                if sideAtStart == 0 && side == 0 { typing = false }
                side = min(1, max(0, sideAtStart + dx / Self.sideWidth))
            }
            .onEnded { drag in
                let fling = drag.predictedEndTranslation.width / Self.sideWidth
                let open = sideAtStart + fling > 0.5
                withAnimation(.spring(duration: 0.3, bounce: 0.05)) { side = open ? 1 : 0 }
                sideAtStart = open ? 1 : 0
            }
    }

    @ViewBuilder private func sidebar(_ room: RoomView) -> some View {
        if side > 0 {
            ZStack(alignment: .leading) {
                Color.black.opacity(0.35 * side)
                    .ignoresSafeArea()
                    .onTapGesture { close() }
                List {
                    ChannelSection(room: room)
                }
                .listStyle(.insetGrouped)
                .scrollContentBackground(.hidden)
                .background(Tone.canvas)
                .frame(width: Self.sideWidth)
                .offset(x: -Self.sideWidth * (1 - side))
                .simultaneousGesture(sideDrag)
            }
            .accessibilityAddTraits(.isModal)
            .accessibilityAction(.escape) { close() }
        }
    }

    private func close() {
        withAnimation(.spring(duration: 0.3, bounce: 0.05)) { side = 0 }
        sideAtStart = 0
    }

    private func seen() {
        model.markRead(spot)
    }

    private func switchTo(_ next: Spot) {
        guard next != spot else { return }
        replyTo = nil
        answering = nil
        sendingBack = nil
        spot = next
    }
}

struct TitlePill: View {
    let room: RoomView
    let place: PlaceView?
    let fresh: Bool
    var body: some View {
        label.contentShape(Rectangle())
    }

    private var label: some View {
        HStack(spacing: 7) {
            if let place, place.kind == "dm", let other = room.other(in: place) {
                Face(name: other, member: room.member(other), size: 26)
            }
            VStack(spacing: 0) {
                HStack(spacing: 3) {
                    Text(title).type(.title).foregroundStyle(Tone.ink).lineLimit(1)
                    Image(systemName: "chevron.right").font(.system(size: 9, weight: .bold)).foregroundStyle(Tone.ink3)
                }
                status
            }
            if fresh {
                Dot(color: Tone.accent, size: 8)
            }
        }
        .frame(minHeight: 44)
    }

    private var title: String {
        room.spotTitle(place?.key ?? "main")
    }

    private var other: MemberView? {
        guard let place, let name = room.other(in: place) else { return nil }
        return room.member(name)
    }

    private var busy: String? {
        guard let other, other.working else { return nil }
        return other.doing.first.map { "working on \(taskLabel($0))" } ?? "working"
    }

    @ViewBuilder private var status: some View {
        let needs = place?.kind == "main" ? room.asks.count + room.reviews.count + room.open.count : 0
        let parts: [String] = [
            place?.kind == "dm" ? (busy ?? (other?.here == true ? "here" : "away")) : nil,
            room.connection == .connecting ? "Connecting…" : nil,
            room.connection == .reconnecting ? "Reconnecting…" : nil,
            place?.kind == "main" && room.working > 0 ? "\(room.working) working" : nil,
            needs > 0 ? "\(needs) \(needs == 1 ? "needs" : "need") you" : nil,
        ].compactMap { $0 }
        if !parts.isEmpty {
            HStack(spacing: 4) {
                if (place?.kind == "main" && room.working > 0) || busy != nil { Dot(color: Tone.doing, size: 5) }
                Text(parts.joined(separator: " · ")).type(.stamp, .medium).foregroundStyle(needs > 0 ? Tone.decide : Tone.ink3).lineLimit(1)
            }
        }
    }
}

struct DetailsScreen: View {
    let code: String
    let current: String
    let choose: (String) -> Void
    @Environment(AppModel.self) private var model

    var body: some View {
        Group {
            if let room = model.rooms[code] {
                ChannelDetails(room: room, current: current, choose: choose)
                    .navigationTitle(room.spotTitle(current))
            } else {
                Centered(title: "This channel is gone", detail: "Its owner closed it, or this phone was removed from it.")
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
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
                Text(room.title.prefix(1).uppercased())
                    .font(.system(size: size * 0.42, weight: .semibold))
                    .foregroundStyle(Tone.ink)
                    .frame(width: size, height: size)
                    .background(Tone.raised)
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .accessibilityHidden(true)
    }
}

extension View {
    @ViewBuilder func bar<Content: View>(_ edge: VerticalEdge, @ViewBuilder content: () -> Content) -> some View {
        if #available(iOS 26.0, *) {
            self.safeAreaBar(edge: edge, spacing: 0, content: content)
        } else {
            self.safeAreaInset(edge: edge, spacing: 0, content: content)
        }
    }
}
