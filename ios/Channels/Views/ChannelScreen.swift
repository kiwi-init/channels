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
    @State private var fan: FanMode?
    @State private var hover: String?
    @State private var frames: [String: CGRect] = [:]
    @State private var anchor: CGRect = .zero
    @State private var pillFrame: CGRect = .zero
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
                        Dock(room: room, place: place, replyTo: $replyTo, typing: $typing, follow: follow, switcher: control(room)) {
                            withAnimation(Motion.ease) { position.scrollTo(edge: .bottom) }
                        }
                    }
                    .overlay {
                        if let fan {
                            GeometryReader { geo in
                                let box = geo.frame(in: .global)
                                Fan(
                                    room: room, items: Self.fanItems(room, model: model, current: place), current: place, mode: fan, hover: hover,
                                    anchor: anchor.offsetBy(dx: -box.minX, dy: -box.minY), frames: $frames
                                ) { key in
                                    pick(room, key)
                                } dismiss: {
                                    self.fan = nil
                                }
                            }
                            .transition(.opacity)
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
                    .overlay {
                        if details {
                            DetailsMorph(room: room, current: place, pill: pillFrame) { key in
                                go(room, key)
                            } channels: {
                                dismiss()
                            } closed: {
                                details = false
                            }
                        }
                    }
            } else {
                Centered(title: "This channel is gone", detail: "Its owner closed it, or this phone was removed from it.")
            }
        }
        .background(Tone.canvas)
        .toolbar(.hidden, for: .navigationBar)
        .task {
            await model.open(code, place: place)
            #if DEBUG
                if UserDefaults.standard.bool(forKey: "fan") {
                    try? await Task.sleep(for: .seconds(2))
                    if let text = UserDefaults.standard.string(forKey: "draft"), let room = model.rooms[code], let lead = room.lead {
                        model.keep(Draft(text: text), code, room.dmKey(with: lead))
                    }
                    fan = .tapped
                }
            #endif
        }
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
            Button {
                Haptic.tap()
                details = true
            } label: {
                TitlePill(room: room, place: room.placeView(place), fresh: false)
                    .onGeometryChange(for: CGRect.self) {
                        $0.frame(in: .global)
                    } action: {
                        pillFrame = $0
                    }
            }
            .buttonStyle(.plain)
            .frame(maxWidth: 240)
            .opacity(details ? 0 : 1)
            .accessibilityHint("Tasks, people and details")
        }
        .padding(.horizontal, 12)
        .padding(.top, 2)
        .padding(.bottom, 4)
    }

    private func control(_ room: RoomView) -> SwitchControl {
        SwitchControl(
            current: room.placeView(place),
            fresh: model.freshElsewhere(room, than: place),
            open: fan != nil,
            hold: {
                hover = nil
                withAnimation(.snappy(duration: 0.2)) { fan = .held }
            },
            move: { point in
                let hit = frames.first { $0.value.minY - 5 <= point.y && point.y <= $0.value.maxY + 5 }?.key
                if hit != hover {
                    hover = hit
                    if hit != nil { UISelectionFeedbackGenerator().selectionChanged() }
                }
            },
            release: { stayed in
                if let hover {
                    pick(room, hover)
                } else {
                    withAnimation(.snappy(duration: 0.2)) { fan = stayed ? .tapped : nil }
                }
            },
            tap: {
                hover = nil
                withAnimation(.snappy(duration: 0.2)) { fan = fan == nil ? .tapped : nil }
            },
            step: { by in
                let keys = order(room)
                let at = keys.firstIndex(of: place) ?? 0
                guard keys.indices.contains(at + by) else { return false }
                go(room, keys[at + by])
                return true
            },
            placed: { anchor = $0 })
    }

    private func pick(_ room: RoomView, _ key: String) {
        withAnimation(.snappy(duration: 0.2)) { fan = nil }
        hover = nil
        go(room, key)
    }

    private func order(_ room: RoomView) -> [String] {
        let keys = Self.fanItems(room, model: model, current: place).map(\.key)
        return keys.contains(place) ? keys : keys + [place]
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
    var bare = false

    var body: some View {
        if bare {
            label
        } else {
            label.glassCapsule().contentShape(Capsule())
        }
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
        .frame(minHeight: 40)
    }

    private var title: String {
        guard let place, place.kind != "main" else { return room.title }
        if place.kind == "task", let id = place.task { return taskLabel(id) }
        return place.title
    }

    private var busy: String? {
        guard let place, let other = room.other(in: place), let member = room.member(other), member.working else { return nil }
        return member.doing.first.map { "working on \(taskLabel($0))" } ?? "working"
    }

    @ViewBuilder private var status: some View {
        let parts: [String] = [
            place?.kind == "task" ? place?.task.flatMap { id in room.tasks.first { $0.id == id }?.title } : nil,
            place?.kind == "dm" ? (place?.withMe == true ? (busy ?? "in \(room.title)") : "read along") : nil,
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

struct DetailsMorph: View {
    let room: RoomView
    let current: String
    let pill: CGRect
    let choose: (String) -> Void
    let channels: () -> Void
    let closed: () -> Void
    @State private var open = false
    @State private var pull: CGFloat = 0

    private static let spring = Animation.spring(duration: 0.46, bounce: 0.16)

    var body: some View {
        GeometryReader { geo in
            let box = geo.frame(in: .global)
            let from = pill == .zero ? CGRect(x: geo.size.width / 2 - 70, y: 2, width: 140, height: 40) : pill.offsetBy(dx: -box.minX, dy: -box.minY)
            let to = CGRect(x: 8, y: from.minY, width: geo.size.width - 16, height: geo.size.height - from.minY - 4)
            let rect = open ? to.offsetBy(dx: 0, dy: pull * 0.4) : from
            let radius = open ? 44 : from.height / 2
            ZStack(alignment: .topLeading) {
                Rectangle()
                    .fill(.black.opacity(open ? 0.4 : 0))
                    .background(.ultraThinMaterial.opacity(open ? 1 : 0))
                    .ignoresSafeArea()
                    .contentShape(Rectangle())
                    .onTapGesture(perform: collapse)
                ZStack(alignment: .top) {
                    content
                        .frame(width: to.width, height: to.height)
                        .opacity(open ? 1 : 0)
                    TitlePill(room: room, place: room.placeView(current), fresh: false, bare: true)
                        .frame(height: from.height)
                        .opacity(open ? 0 : 1)
                }
                .frame(width: rect.width, height: rect.height, alignment: .top)
                .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
                .glass(radius)
                .offset(x: rect.minX, y: rect.minY)
            }
        }
        .onAppear {
            withAnimation(Self.spring) { open = true }
        }
    }

    private var content: some View {
        VStack(spacing: 0) {
            TasksTab(
                room: room, current: current,
                choose: { key in
                    choose(key)
                    collapse()
                }, channels: channels)
            Capsule()
                .fill(Tone.ink3.opacity(0.6))
                .frame(width: 40, height: 5)
                .frame(maxWidth: .infinity, minHeight: 30)
                .contentShape(Rectangle())
                .gesture(
                    DragGesture()
                        .onChanged { pull = min(0, $0.translation.height) }
                        .onEnded { drag in
                            if drag.translation.height < -50 || drag.predictedEndTranslation.height < -140 {
                                collapse()
                            } else {
                                withAnimation(.spring(duration: 0.3, bounce: 0.3)) { pull = 0 }
                            }
                        }
                )
                .accessibilityHidden(true)
        }
        .overlay(alignment: .topTrailing) {
            Button(action: collapse) {
                Image(systemName: "xmark")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Tone.ink2)
                    .frame(width: 34, height: 34)
                    .background(Tone.wash2, in: Circle())
            }
            .buttonStyle(.plain)
            .padding(14)
            .accessibilityLabel("Close details")
        }
    }

    private func collapse() {
        Haptic.tap()
        withAnimation(Self.spring) {
            open = false
            pull = 0
        } completion: {
            closed()
        }
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
            self.safeAreaInset(edge: edge, spacing: 0) {
                content().background {
                    LinearGradient(colors: [Tone.canvas, Tone.canvas.opacity(0)], startPoint: edge == .top ? .top : .bottom, endPoint: edge == .top ? .bottom : .top)
                        .ignoresSafeArea()
                }
            }
        }
    }
}
