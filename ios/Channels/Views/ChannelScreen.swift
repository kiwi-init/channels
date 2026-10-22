import SwiftUI

struct ChannelScreen: View {
    let code: String
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var details = Self.opensDetails
    @State private var place = Self.firstPlace
    @State private var replyTo: MessageView?
    @State private var position = ScrollPosition(edge: .bottom)
    @State private var follow = Follow()
    @FocusState private var typing: Bool

    private static var firstPlace: String {
        #if DEBUG
            UserDefaults.standard.string(forKey: "place") ?? "main"
        #else
            "main"
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
                    .opacity(room.place == place ? 1 : 0)
                    .overlay {
                        if room.place != place { ProgressView() }
                    }
                    .overlay(alignment: .top) {
                        GeometryReader { geo in
                            LinearGradient(stops: fade, startPoint: .top, endPoint: .bottom)
                                .frame(height: geo.safeAreaInsets.top + 24)
                                .offset(y: -geo.safeAreaInsets.top)
                        }
                        .allowsHitTesting(false)
                    }
                    .safeAreaInset(edge: .top, spacing: 0) { header(room) }
                    .bar(.bottom) { bottom(room) }
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
                            go(key)
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

    private func go(_ key: String) {
        guard key != place else { return }
        replyTo = nil
        withAnimation(Motion.ease) { place = key }
        Task { await model.open(code, place: key) }
    }

    @ViewBuilder private func bottom(_ room: RoomView) -> some View {
        if let here = room.placeView(place), here.kind == "dm", !here.withMe {
            Text("Between \(here.with.map { room.display($0) }.joined(separator: " and ")). You can read along.")
                .type(.meta)
                .foregroundStyle(Tone.ink3)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 32)
                .padding(.vertical, 14)
        } else {
            Composer(room: room, replyTo: $replyTo, typing: $typing, follow: follow) {
                withAnimation(Motion.ease) { position.scrollTo(edge: .bottom) }
            }
            .animation(Motion.ease, value: follow.atBottom)
        }
    }

    private func header(_ room: RoomView) -> some View {
        let here = room.placeView(place)
        let other = here.flatMap { room.other(in: $0) }
        return ZStack {
            HStack {
                Button {
                    if place != "main" {
                        go("main")
                    } else {
                        dismiss()
                    }
                } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 19, weight: .semibold))
                        .foregroundStyle(Tone.ink)
                        .frame(width: 44, height: 44)
                        .glassCircle()
                }
                .buttonStyle(.plain)
                .accessibilityLabel(place == "main" ? "Channels" : "# general")
                Spacer()
            }
            Button {
                details = true
            } label: {
                HStack(spacing: 8) {
                    if let other {
                        Face(name: other, member: room.member(other), size: 28)
                    }
                    VStack(spacing: 0) {
                        HStack(spacing: 3) {
                            Text(title(room, here)).type(.ui, .semibold).foregroundStyle(Tone.ink).lineLimit(1)
                            Image(systemName: "chevron.right").font(.system(size: 10, weight: .bold)).foregroundStyle(Tone.ink3)
                        }
                        subtitle(room, here)
                    }
                    if model.freshElsewhere(room, than: place) {
                        Dot(color: Tone.accent, size: 8)
                    }
                }
                .padding(.leading, other == nil ? 14 : 8)
                .padding(.trailing, 14)
                .frame(minHeight: 44)
                .glassCapsule()
            }
            .buttonStyle(.plain)
            .frame(maxWidth: 250)
            .accessibilityLabel("\(title(room, here)), conversations and tasks")
        }
        .padding(.horizontal, 12)
        .padding(.top, 2)
        .padding(.bottom, 6)
    }

    private func title(_ room: RoomView, _ here: PlaceView?) -> String {
        guard let here, here.kind != "main" else { return room.title }
        if here.kind == "task", let id = here.task { return taskLabel(id) }
        return here.title
    }

    @ViewBuilder private func subtitle(_ room: RoomView, _ here: PlaceView?) -> some View {
        if let here, here.kind == "task", let id = here.task {
            let task = room.tasks.first { $0.id == id }
            Text(task?.title ?? room.title).type(.stamp, .medium).foregroundStyle(Tone.ink3).lineLimit(1)
        } else if let here, here.kind == "dm" {
            Text(here.withMe ? "in \(room.title)" : "read along · \(room.title)").type(.stamp, .medium).foregroundStyle(Tone.ink3).lineLimit(1)
        } else {
            status(room)
        }
    }

    private var fade: [Gradient.Stop] {
        [
            .init(color: Tone.canvas.opacity(0.97), location: 0),
            .init(color: Tone.canvas.opacity(0.9), location: 0.5),
            .init(color: Tone.canvas.opacity(0.6), location: 0.75),
            .init(color: Tone.canvas.opacity(0), location: 1),
        ]
    }

    @ViewBuilder private func status(_ room: RoomView) -> some View {
        let parts: [String] = [
            room.connection == .connecting ? "Connecting…" : nil,
            room.connection == .reconnecting ? "Reconnecting…" : nil,
            room.working > 0 ? "\(room.working) working" : nil,
            room.asks.isEmpty ? nil : "\(room.asks.count) \(room.asks.count == 1 ? "needs" : "need") you",
            room.hold != nil ? "paused" : nil,
        ].compactMap { $0 }
        if !parts.isEmpty {
            HStack(spacing: 4) {
                if room.working > 0 { Dot(color: Tone.doing, size: 5) }
                Text(parts.joined(separator: " · ")).type(.stamp, .medium).foregroundStyle(room.asks.isEmpty ? Tone.ink3 : Tone.decide).lineLimit(1)
            }
        }
    }
}

struct Details: View {
    let room: RoomView
    let current: String
    let choose: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            TasksTab(room: room, current: current, choose: choose)
                .background(Tone.canvas)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { dismiss() }
                    }
                }
        }
        .presentationDetents([.large])
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
