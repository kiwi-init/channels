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
                    .transition(.push(from: forward ? .trailing : .leading))
                    .opacity(room.place == place ? 1 : 0)
                    .overlay {
                        if room.place != place { ProgressView() }
                    }
                    .overlay(alignment: .top) {
                        GeometryReader { geo in
                            LinearGradient(stops: fade, startPoint: .top, endPoint: .bottom)
                                .frame(height: geo.safeAreaInsets.top + 18)
                                .offset(y: -geo.safeAreaInsets.top)
                        }
                        .allowsHitTesting(false)
                    }
                    .bar(.bottom) {
                        Dock(
                            room: room, place: place, replyTo: $replyTo, typing: $typing, follow: follow,
                            act: DockActions(
                                jump: { withAnimation(Motion.ease) { position.scrollTo(edge: .bottom) } },
                                switcher: { details = true },
                                step: { step(room, $0) },
                                go: { go($0) },
                                channels: { dismiss() }
                            ))
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
                            go(key)
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

    private func order(_ room: RoomView) -> [String] {
        var keys = ["main"] + room.places.filter { $0.kind == "dm" && $0.withMe }.sorted { $0.lastSeq > $1.lastSeq }.map(\.key)
        if !keys.contains(place) { keys.insert(place, at: 1) }
        return keys
    }

    private func step(_ room: RoomView, _ by: Int) {
        let keys = order(room)
        let at = keys.firstIndex(of: place) ?? 0
        let next = at + by
        guard keys.indices.contains(next) else {
            UIImpactFeedbackGenerator(style: .rigid).impactOccurred(intensity: 0.6)
            return
        }
        forward = by > 0
        Haptic.tap()
        go(keys[next])
    }

    private func go(_ key: String) {
        guard key != place else { return }
        replyTo = nil
        withAnimation(Motion.ease) { place = key }
        Task { await model.open(code, place: key) }
    }

    private var fade: [Gradient.Stop] {
        [
            .init(color: Tone.canvas.opacity(0.97), location: 0),
            .init(color: Tone.canvas.opacity(0.85), location: 0.6),
            .init(color: Tone.canvas.opacity(0), location: 1),
        ]
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
