import SwiftUI
import UIKit

struct ConversationScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var spot: Spot
    @State private var thread: String?
    @State private var previous: Spot?
    @State private var details = ConversationScreen.opensDetails
    @State private var replyTo: MessageView?
    @State private var position = ScrollPosition(edge: .bottom)
    @State private var follow = Follow()
    @State private var threadPosition = ScrollPosition(edge: .bottom)
    @State private var threadFollow = Follow()
    @State private var late = false
    @FocusState private var typing: Bool

    init(start: Spot) {
        let task = start.place.hasPrefix("task:")
        _spot = State(initialValue: task ? Spot(code: start.code) : start)
        _thread = State(initialValue: task ? start.place : nil)
    }

    private var active: Spot { thread.map { Spot(code: spot.code, place: $0) } ?? spot }

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
                let ready = model.ready(spot)
                Conversation(room: room, replyTo: $replyTo, position: $position, follow: $follow, typing: $typing) { key in
                    openThread(key)
                }
                .id(spot.id)
                .transition(.opacity.combined(with: .offset(y: 6)))
                .opacity(ready ? 1 : 0)
                .overlay {
                    if !ready && late { ProgressView() }
                }
                .overlay {
                    if let thread, let inner = model.shown(Spot(code: spot.code, place: thread)) {
                        ZStack {
                            Rectangle()
                                .fill(.black.opacity(0.35))
                                .background(.ultraThinMaterial)
                                .ignoresSafeArea()
                                .onTapGesture(perform: closeThread)
                            Conversation(room: inner, replyTo: $replyTo, position: $threadPosition, follow: $threadFollow, typing: $typing)
                                .id(thread)
                                .opacity(model.ready(active) ? 1 : 0)
                        }
                        .transition(.opacity.combined(with: .offset(y: 24)))
                    }
                }
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
                    Dock(room: model.shown(active) ?? room, spot: active, replyTo: $replyTo, typing: $typing, follow: thread == nil ? follow : threadFollow) {
                        withAnimation(Motion.ease) {
                            if thread == nil { position.scrollTo(edge: .bottom) } else { threadPosition.scrollTo(edge: .bottom) }
                        }
                    }
                }
                .navigationDestination(isPresented: $details) {
                    DetailsScreen(code: room.code, current: active.place) { key in
                        details = false
                        switchTo(Spot(code: room.code, place: key))
                    }
                }
                .animation(Motion.swap, value: spot)
                .animation(.spring(duration: 0.38, bounce: 0.12), value: thread)
                .onAppear(perform: seen)
                .onChange(of: model.rooms[spot.code]?.messages.last?.seq) { _, _ in seen() }
                .onChange(of: model.rooms[spot.code]?.place) { _, _ in seen() }
            } else {
                Centered(title: "This channel is gone", detail: "Its owner closed it, or this phone was removed from it.")
            }
        }
        .background(Tone.canvas)
        .toolbar(.hidden, for: .navigationBar)
        .task(id: active) {
            model.visit(active)
            late = false
            if thread == nil { follow = Follow() }
            await model.open(active)
            guard (try? await Task.sleep(for: .milliseconds(400))) != nil else { return }
            late = true
        }
    }

    private func seen() {
        guard let room = model.rooms[spot.code] else { return }
        model.markSeen(room, place: active.place)
    }

    private func switchTo(_ next: Spot) {
        guard next != active else { return }
        if next.place.hasPrefix("task:") && next.code == spot.code {
            previous = active
            return openThread(next.place)
        }
        Haptic.tap()
        previous = active
        replyTo = nil
        let task = next.place.hasPrefix("task:")
        withAnimation(Motion.swap) {
            thread = task ? next.place : nil
            spot = task ? Spot(code: next.code) : next
        }
    }

    private func openThread(_ key: String) {
        Haptic.tap()
        replyTo = nil
        threadFollow = Follow()
        threadPosition = ScrollPosition(edge: .bottom)
        withAnimation(.spring(duration: 0.38, bounce: 0.12)) { thread = key }
    }

    private func closeThread() {
        replyTo = nil
        withAnimation(.spring(duration: 0.38, bounce: 0.12)) { thread = nil }
    }

    private var elsewhere: Bool {
        model.rows(.unread).contains { $0.spot != spot }
    }

    private func header(_ room: RoomView) -> some View {
        ZStack {
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
                        HoldButton(label: thread == nil ? "Back" : "Close thread", hint: "Touch and hold for your other conversations") {
                            if thread == nil { dismiss() } else { closeThread() }
                        } menu: {
                            backMenu()
                        }
                    }
                Spacer()
                if !room.asks.isEmpty { asks(room) }
            }
            TitlePill(room: room, place: room.placeView(active.place), fresh: false)
                .overlay {
                    HoldButton(label: room.spotTitle(active.place), hint: "Tap for details, touch and hold to switch conversations") {
                        Haptic.tap()
                        details = true
                    } menu: {
                        pillMenu(room)
                    }
                }
                .frame(maxWidth: 240)
                .contentTransition(.interpolate)
        }
        .padding(.horizontal, 12)
        .padding(.top, 2)
        .padding(.bottom, 6)
    }

    private func asks(_ room: RoomView) -> some View {
        Button {
            guard let ask = room.asks.first else { return }
            let target = Spot(code: room.code, place: ask.task.map { "task:\($0)" } ?? "main")
            switchTo(target)
            Task {
                try? await Task.sleep(for: .milliseconds(350))
                withAnimation(Motion.ease) { position.scrollTo(id: "b\(ask.seq)", anchor: .center) }
            }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: "hand.raised.fill").font(.system(size: 14, weight: .semibold))
                Text("\(room.asks.count)").type(.ui, .bold)
            }
            .foregroundStyle(Tone.decide)
            .padding(.horizontal, 12)
            .frame(height: 44)
            .glassCapsule()
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(room.asks.count) \(room.asks.count == 1 ? "needs" : "need") you")
    }

    private func item(_ row: Row, prefix: String? = nil) -> HoldItem {
        HoldItem(title: row.fullTitle, subtitle: prefix.map { "\($0) · \(row.line)" } ?? row.line, image: MenuArt.row(row)) {
            switchTo(row.spot)
        }
    }

    private func backMenu() -> [HoldSection] {
        var used: Set<Spot> = [spot, active]
        var sections: [HoldSection] = []
        if let last = previous ?? model.visited.first(where: { $0 != active && $0 != spot }), let row = model.row(last) {
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

    private func pillMenu(_ room: RoomView) -> [HoldSection] {
        let code = room.code
        func face(_ name: String) -> UIImage? {
            MenuArt.image("face|\(code)|\(name)|\(room.member(name)?.working == true)") { Face(name: name, member: room.member(name), size: 30) }
        }
        func line(_ place: PlaceView?) -> String? {
            guard let last = place?.last else { return nil }
            return "\(last.mine ? "You" : room.display(last.from)): \(last.body.replacingOccurrences(of: "\n", with: " "))"
        }
        let general = Spot(code: code)
        var sections = [
            HoldSection(items: [
                HoldItem(
                    title: "# general", subtitle: line(room.placeView("main")), image: MenuArt.image("channel|\(code)") { ChannelAvatar(room: room, size: 30) },
                    checked: active == general
                ) { switchTo(general) }
            ])
        ]
        var direct: [HoldItem] = []
        var talked: Set<String> = [room.me]
        if let lead = room.lead, lead != room.me {
            let key = room.dmKey(with: lead)
            talked.insert(lead)
            direct.append(
                HoldItem(title: room.display(lead), subtitle: line(room.placeView(key)) ?? "Lead", image: face(lead), checked: active.place == key) {
                    switchTo(Spot(code: code, place: key))
                })
        }
        let threads = room.places.filter { $0.kind == "dm" && $0.withMe && $0.last != nil }.sorted { $0.lastSeq > $1.lastSeq }
        for place in threads.prefix(6) {
            guard let other = room.other(in: place), !talked.contains(other) else { continue }
            talked.insert(other)
            direct.append(
                HoldItem(title: room.display(other), subtitle: line(place), image: face(other), checked: active.place == place.key) {
                    switchTo(Spot(code: code, place: place.key))
                })
        }
        sections.append(HoldSection(title: "Direct", items: direct))
        let strangers = room.members.filter { !talked.contains($0.name) }
        sections.append(
            HoldSection(
                title: "New Message", nested: true,
                items: strangers.map { m in
                    HoldItem(title: m.display, image: face(m.name)) { switchTo(Spot(code: code, place: room.dmKey(with: m.name))) }
                }))
        let tasks = room.places.filter { $0.kind == "task" && $0.last != nil }.sorted { $0.lastSeq > $1.lastSeq }.prefix(6)
        sections.append(
            HoldSection(
                title: "Tasks",
                items: tasks.map { place in
                    let id = place.task ?? 0
                    let task = room.tasks.first { $0.id == id }
                    return HoldItem(
                        title: "\(taskLabel(id)) \(task?.title ?? "")", subtitle: [task.map { stateWords($0.state) }, line(place)].compactMap { $0 }.joined(separator: " · "),
                        image: MenuArt.image("task|\(code)|\(id)") { PlaceFace(room: room, place: place, size: 30) }, checked: active.place == place.key
                    ) { switchTo(Spot(code: code, place: place.key)) }
                }))
        let along = room.places.filter { $0.kind == "dm" && !$0.withMe }.sorted { $0.lastSeq > $1.lastSeq }.prefix(8)
        sections.append(
            HoldSection(
                title: "Read Along", nested: true,
                items: along.map { place in
                    HoldItem(title: place.with.map { room.display($0) }.joined(separator: " & "), subtitle: line(place), checked: active.place == place.key) {
                        switchTo(Spot(code: code, place: place.key))
                    }
                }))
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
                TasksTab(room: room, current: current, choose: choose)
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
