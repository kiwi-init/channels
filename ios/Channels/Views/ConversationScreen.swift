import SwiftUI
import UIKit

struct ConversationScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var spot: Spot
    @State private var previous: Spot?
    @State private var details = ConversationScreen.opensDetails
    @State private var replyTo: MessageView?
    @State private var answering: AskView?
    @State private var position = ScrollPosition(edge: .bottom)
    @State private var follow = Follow()
    @State private var toLead = true
    @FocusState private var typing: Bool

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
                    room: room, replyTo: $replyTo, position: $position, follow: $follow, typing: $typing, elsewhere: spot.general ? room.elsewhere() : []
                ) { ask in
                    replyTo = nil
                    answering = ask
                    typing = true
                }
                .id(spot.id)
                .transition(
                    .asymmetric(insertion: .move(edge: toLead ? .trailing : .leading), removal: .move(edge: toLead ? .leading : .trailing))
                )
                .overlay(alignment: .top) {
                    GeometryReader { geo in
                        LinearGradient(stops: fade, startPoint: .top, endPoint: .bottom)
                            .frame(height: geo.safeAreaInsets.top + 30)
                            .offset(y: -geo.safeAreaInsets.top)
                    }
                    .allowsHitTesting(false)
                }
                .safeAreaInset(edge: .top, spacing: 0) { header(room) }
                .bar(.bottom) {
                    Dock(room: room, spot: spot, replyTo: $replyTo, answering: $answering, typing: $typing, follow: follow) {
                        withAnimation(Motion.ease) { position.scrollTo(edge: .bottom) }
                    }
                }
                .navigationDestination(isPresented: $details) {
                    DetailsScreen(code: room.code, current: spot.place) { key in
                        details = false
                        switchTo(Spot(code: room.code, place: key))
                    }
                }
                .onAppear(perform: seen)
                .onChange(of: room.placeView(spot.place)?.lastSeq) { _, _ in seen() }
            } else {
                Centered(title: "This channel is gone", detail: "Its owner closed it, or this phone was removed from it.")
            }
        }
        .background(Tone.canvas)
        .toolbar(.hidden, for: .navigationBar)
        .task(id: spot) {
            model.visit(spot)
            follow = Follow()
            await model.open(spot.code, place: "main")
        }
    }

    private func seen() {
        model.markRead(spot)
    }

    private func switchTo(_ next: Spot) {
        guard next != spot else { return }
        Haptic.tap()
        previous = spot
        replyTo = nil
        answering = nil
        toLead = !next.general
        withAnimation(.spring(duration: 0.34, bounce: 0.08)) { spot = next }
    }

    private func header(_ room: RoomView) -> some View {
        let other = room.other(than: spot)
        let elsewhere = model.rows(.unread).contains { $0.spot != spot && $0.spot != other }
        return ZStack {
            HStack {
                Image(systemName: "chevron.left")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(Tone.ink)
                    .frame(width: 44, height: 44)
                    .glassCircle()
                    .overlay(alignment: .topTrailing) {
                        if elsewhere {
                            Circle().fill(Tone.accent).frame(width: 10, height: 10).overlay(Circle().stroke(Tone.canvas, lineWidth: 2))
                        }
                    }
                    .overlay {
                        HoldButton(label: "Back", hint: "Touch and hold for your other channels") {
                            dismiss()
                        } menu: {
                            backMenu()
                        }
                    }
                Spacer()
                if let other { flip(room, to: other) }
            }
            Button {
                Haptic.tap()
                details = true
            } label: {
                TitlePill(room: room, place: room.placeView(spot.place), fresh: false)
            }
            .buttonStyle(.plain)
            .frame(maxWidth: 220)
            .accessibilityHint("Shows the channel's details")
        }
        .padding(.horizontal, 12)
        .padding(.top, 2)
        .padding(.bottom, 6)
    }

    private func flip(_ room: RoomView, to other: Spot) -> some View {
        let asks = !room.asks(in: other.place).isEmpty
        let fresh = model.unread(other)
        return Button {
            switchTo(other)
        } label: {
            Group {
                if other.general {
                    ChannelAvatar(room: room, size: 34)
                } else if let lead = room.lead {
                    Face(name: lead, member: room.member(lead), size: 34)
                }
            }
            .frame(width: 44, height: 44)
            .glassCircle()
            .overlay(alignment: .topTrailing) {
                if asks || fresh {
                    Circle().fill(asks ? Tone.decide : Tone.accent).frame(width: 11, height: 11).overlay(Circle().stroke(Tone.canvas, lineWidth: 2))
                        .offset(x: 1, y: -1)
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(other.general ? "Open # general" : "Open your chat with \(room.spotTitle(other.place))")
        .accessibilityValue(asks ? "needs you" : fresh ? "unread" : "")
    }

    private func item(_ row: Row, prefix: String? = nil) -> HoldItem {
        HoldItem(title: row.fullTitle, subtitle: prefix.map { "\($0) · \(row.line)" } ?? row.line, image: MenuArt.row(row)) {
            switchTo(row.spot)
        }
    }

    private func backMenu() -> [HoldSection] {
        var used: Set<Spot> = [spot]
        var sections: [HoldSection] = []
        if let last = previous ?? model.visited.first(where: { $0 != spot }), let row = model.row(last) {
            used.insert(last)
            sections.append(HoldSection(items: [item(row, prefix: "Previous")]))
        }
        func take(_ rows: [Row], _ count: Int) -> [HoldItem] {
            let picked = Array(rows.filter { !used.contains($0.spot) }.prefix(count))
            picked.forEach { used.insert($0.spot) }
            return picked.map { item($0) }
        }
        sections.append(HoldSection(title: "Needs You", items: take(model.rows(.needs), 3)))
        sections.append(HoldSection(title: "Unread", items: take(model.rows(.unread), 3)))
        sections.append(HoldSection(title: "Recent", items: take(model.rows(.all), 6)))
        return sections
    }

    private var fade: [Gradient.Stop] {
        [
            .init(color: Tone.canvas, location: 0),
            .init(color: Tone.canvas.opacity(0.95), location: 0.62),
            .init(color: Tone.canvas.opacity(0.55), location: 0.82),
            .init(color: Tone.canvas.opacity(0), location: 1),
        ]
    }
}

struct TitlePill: View {
    let room: RoomView
    let place: PlaceView?
    let fresh: Bool
    var body: some View {
        label.glassCapsule().contentShape(Capsule())
    }

    private var label: some View {
        HStack(spacing: 7) {
            if let place, place.kind == "dm", let other = room.other(in: place) {
                Face(name: other, member: room.member(other), size: 26)
            }
            VStack(spacing: 0) {
                HStack(spacing: 3) {
                    Text(title).type(.ui, .semibold).foregroundStyle(Tone.ink).lineLimit(1)
                    Image(systemName: "chevron.right").font(.system(size: 9, weight: .bold)).foregroundStyle(Tone.ink3)
                }
                status
            }
            if fresh {
                Dot(color: Tone.accent, size: 8)
            }
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 44)
    }

    private var title: String {
        guard let place, place.kind != "main" else { return room.title }
        if place.kind == "task", let id = place.task { return taskLabel(id) }
        return place.title
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
        let parts: [String] = [
            place?.kind == "task" ? place?.task.flatMap { id in room.tasks.first { $0.id == id }?.title } : nil,
            place?.kind == "dm" ? (place?.withMe == true ? (busy ?? (other?.here == true ? "here" : "away")) : "read along") : nil,
            room.connection == .connecting ? "Connecting…" : nil,
            room.connection == .reconnecting ? "Reconnecting…" : nil,
            place?.kind == "main" && room.working > 0 ? "\(room.working) working" : nil,
            place?.kind == "main" && !room.asks.isEmpty ? "\(room.asks.count) \(room.asks.count == 1 ? "needs" : "need") you" : nil,
        ].compactMap { $0 }
        if !parts.isEmpty {
            HStack(spacing: 4) {
                if (place?.kind == "main" && room.working > 0) || busy != nil { Dot(color: Tone.doing, size: 5) }
                Text(parts.joined(separator: " · ")).type(.stamp, .medium).foregroundStyle(place?.kind == "main" && !room.asks.isEmpty ? Tone.decide : Tone.ink3).lineLimit(1)
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
            } else if room.icon?.kind == "emoji", let emoji = room.icon?.emoji {
                Text(emoji).font(.system(size: size * 0.52)).frame(width: size, height: size).background(Tone.wash2)
            } else {
                Image("robot-\(room.icon?.robot ?? "blue")").resizable().scaledToFit()
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .accessibilityHidden(true)
    }
}

extension View {
    @ViewBuilder func softEdges() -> some View {
        if #available(iOS 26.0, *) {
            self.scrollEdgeEffectStyle(.soft, for: .top).scrollEdgeEffectHidden(true, for: .bottom)
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
