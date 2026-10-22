import SwiftUI
import UIKit

struct Route: Hashable {
    let code: String
    var place = "main"
}

struct ChannelScreen: View {
    let code: String
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var details = Self.opensDetails
    @State private var place: String
    @State private var replyTo: MessageView?
    @State private var position = ScrollPosition(edge: .bottom)
    @State private var follow = Follow()
    @State private var forward = true
    @FocusState private var typing: Bool

    init(route: Route) {
        code = route.code
        #if DEBUG
            _place = State(initialValue: UserDefaults.standard.string(forKey: "place") ?? route.place)
        #else
            _place = State(initialValue: route.place)
        #endif
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
            if let room = model.rooms[code] {
                Conversation(room: room, replyTo: $replyTo, position: $position, follow: $follow, typing: $typing)
                    .id(room.place)
                    .transition(.asymmetric(insertion: .opacity.combined(with: .offset(x: forward ? 40 : -40)), removal: .opacity))
                    .opacity(room.place == place ? 1 : 0)
                    .overlay {
                        if room.place != place { ProgressView() }
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
                        Dock(room: room, place: place, replyTo: $replyTo, typing: $typing, follow: follow) {
                            withAnimation(Motion.ease) { position.scrollTo(edge: .bottom) }
                        }
                    }
                    .animation(.snappy(duration: 0.3), value: room.place)
                    .onAppear { model.markSeen(room, place: place) }
                    .onChange(of: room.messages.last?.seq) { _, _ in model.markSeen(room, place: place) }
                    .onChange(of: room.place) { _, _ in
                        model.markSeen(room, place: place)
                        follow = Follow()
                        position.scrollTo(edge: .bottom)
                    }
                    .sheet(isPresented: $details) {
                        Details(room: room, current: place) { key in
                            details = false
                            go(room, key)
                        } channels: {
                            details = false
                            dismiss()
                        }
                    }
            } else {
                Centered(title: "This channel is gone", detail: "Its owner closed it, or this phone was removed from it.")
            }
        }
        .background(Tone.canvas)
        .toolbar(.hidden, for: .navigationBar)
        .task { await model.open(code, place: place) }
    }

    private func header(_ room: RoomView) -> some View {
        ZStack {
            HStack {
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(Tone.ink)
                        .frame(width: 40, height: 40)
                        .glassCircle()
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Channels")
                Spacer()
            }
            Menu {
                switcher(room)
            } label: {
                TitlePill(room: room, place: room.placeView(place), fresh: model.freshElsewhere(room, than: place))
            } primaryAction: {
                Haptic.tap()
                details = true
            }
            .menuOrder(.fixed)
            .buttonStyle(.plain)
            .frame(maxWidth: 240)
            .accessibilityHint("Tap for tasks and details. Touch and hold, slide and let go to switch conversation.")
        }
        .padding(.horizontal, 12)
        .padding(.top, 2)
        .padding(.bottom, 4)
    }

    @ViewBuilder private func switcher(_ room: RoomView) -> some View {
        let direct = room.places.filter { $0.kind == "dm" && $0.withMe }.sorted { $0.lastSeq > $1.lastSeq }
        let between = room.places.filter { $0.kind == "dm" && !$0.withMe }
        let talked = Set(direct.compactMap { room.other(in: $0) })
        let strangers = room.members.filter { $0.name != room.me && !talked.contains($0.name) }
        let working = room.tasks.filter { $0.state == "doing" || $0.state == "review" }
        Section {
            item(room, "main", title: "# general", line: room.placeView("main")?.last, icon: "number")
            ForEach(direct) { p in
                item(room, p.key, title: p.title, line: p.last, icon: "person.crop.circle")
            }
        }
        if !working.isEmpty {
            Section("Tasks in progress") {
                ForEach(working.prefix(6)) { t in
                    Button {
                        go(room, "task:\(t.id)")
                    } label: {
                        Label("\(taskLabel(t.id)) \(t.title)", systemImage: place == "task:\(t.id)" ? "checkmark" : "checklist")
                        Text(t.owner.map { room.display($0) } ?? "Unassigned")
                    }
                }
            }
        }
        Section {
            if !strangers.isEmpty {
                Menu {
                    ForEach(strangers) { m in
                        Button(m.display) { go(room, room.dmKey(with: m.name)) }
                    }
                } label: {
                    Label("Message someone", systemImage: "square.and.pencil")
                }
            }
            if !between.isEmpty {
                Menu {
                    ForEach(between) { p in
                        Button(p.title) { go(room, p.key) }
                    }
                } label: {
                    Label("Between others", systemImage: "eye")
                }
            }
            Button {
                details = true
            } label: {
                Label("Tasks and details", systemImage: "list.bullet.rectangle")
            }
        }
    }

    private func item(_ room: RoomView, _ key: String, title: String, line: MessageView?, icon: String) -> some View {
        let fresh = model.fresh(room, key)
        return Button {
            go(room, key)
        } label: {
            Label(fresh ? "\(title)  ●" : title, systemImage: place == key ? "checkmark" : icon)
            if let line {
                Text("\(line.mine ? "You" : room.display(line.from)): \(line.body.replacingOccurrences(of: "\n", with: " "))")
            }
        }
    }

    private func order(_ room: RoomView) -> [String] {
        var keys = ["main"] + room.places.filter { $0.kind == "dm" && $0.withMe }.sorted { $0.lastSeq > $1.lastSeq }.map(\.key)
        if !keys.contains(place) { keys.insert(place, at: 1) }
        return keys
    }

    private func go(_ room: RoomView, _ key: String) {
        guard key != place else { return }
        let keys = order(room)
        forward = (keys.firstIndex(of: key) ?? keys.count) >= (keys.firstIndex(of: place) ?? 0)
        replyTo = nil
        Haptic.tap()
        withAnimation(Motion.ease) { place = key }
        Task { await model.open(code, place: key) }
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
        HStack(spacing: 7) {
            if let place, place.kind == "dm", let other = room.other(in: place) {
                Face(name: other, member: room.member(other), size: 26)
            }
            VStack(spacing: 0) {
                HStack(spacing: 3) {
                    Text(title).type(.ui, .semibold).foregroundStyle(Tone.ink).lineLimit(1)
                    Image(systemName: "chevron.down").font(.system(size: 9, weight: .bold)).foregroundStyle(Tone.ink3)
                }
                status
            }
            if fresh {
                Dot(color: Tone.accent, size: 8)
            }
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 40)
        .glassCapsule()
        .contentShape(Capsule())
    }

    private var title: String {
        guard let place, place.kind != "main" else { return room.title }
        if place.kind == "task", let id = place.task { return taskLabel(id) }
        return place.title
    }

    @ViewBuilder private var status: some View {
        let parts: [String] = [
            place?.kind == "task" ? place?.task.flatMap { id in room.tasks.first { $0.id == id }?.title } : nil,
            place?.kind == "dm" ? (place?.withMe == true ? "in \(room.title)" : "read along") : nil,
            room.connection == .connecting ? "Connecting…" : nil,
            room.connection == .reconnecting ? "Reconnecting…" : nil,
            place?.kind == "main" && room.working > 0 ? "\(room.working) working" : nil,
            place?.kind == "main" && !room.asks.isEmpty ? "\(room.asks.count) \(room.asks.count == 1 ? "needs" : "need") you" : nil,
        ].compactMap { $0 }
        if !parts.isEmpty {
            HStack(spacing: 4) {
                if place?.kind == "main" && room.working > 0 { Dot(color: Tone.doing, size: 5) }
                Text(parts.joined(separator: " · ")).type(.stamp, .medium).foregroundStyle(place?.kind == "main" && !room.asks.isEmpty ? Tone.decide : Tone.ink3).lineLimit(1)
            }
        }
    }
}

struct Details: View {
    let room: RoomView
    let current: String
    let choose: (String) -> Void
    let channels: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            TasksTab(room: room, current: current, choose: choose, channels: channels)
                .background(Tone.canvas)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { dismiss() }
                    }
                }
        }
        .presentationDetents([.medium, .large])
        .presentationBackgroundInteraction(.enabled(upThrough: .medium))
        .presentationDragIndicator(.visible)
    }
}

struct ChannelAvatar: View {
    let room: RoomView
    var size: CGFloat = 50

    var body: some View {
        Group {
            if let lead = room.lead, let member = room.member(lead) {
                Face(name: lead, member: member, size: size)
            } else {
                Text(String(room.title.prefix(1)).uppercased())
                    .font(.system(size: size * 0.42, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white)
                    .frame(width: size, height: size)
                    .background(Circle().fill(LinearGradient(colors: [Tone.avatarTop, Tone.avatarBottom], startPoint: .top, endPoint: .bottom)))
            }
        }
        .frame(width: size, height: size)
    }
}

extension View {
    @ViewBuilder func softEdges() -> some View {
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
            self.safeAreaInset(edge: edge, spacing: 0) {
                content().background {
                    LinearGradient(colors: [Tone.canvas, Tone.canvas.opacity(0)], startPoint: edge == .top ? .top : .bottom, endPoint: edge == .top ? .bottom : .top)
                        .ignoresSafeArea()
                }
            }
        }
    }
}
