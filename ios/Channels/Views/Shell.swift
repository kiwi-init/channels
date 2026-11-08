import SwiftUI
import UIKit

enum Drawer: Equatable {
    case closed, left
}

@MainActor
enum Drawers {
    static var motion: Animation? {
        UIAccessibility.isReduceMotionEnabled ? nil : .spring(duration: 0.32, bounce: 0.04)
    }
}

enum Pane: Hashable {
    case channel(String)
    case needs
}

extension AppModel {
    func open(_ route: Route) {
        showing = route
        path = []
        if case .place(let spot) = route {
            pane = .channel(spot.code)
            UserDefaults.standard.set("\(spot.code)|\(spot.place)", forKey: "front")
        }
        if case .tasks(let code) = route { pane = .channel(code) }
        withAnimation(Drawers.motion) { drawer = .closed }
    }

    static func savedFront() -> Route? {
        guard let saved = UserDefaults.standard.string(forKey: "front"), let bar = saved.firstIndex(of: "|") else { return nil }
        return .place(Spot(code: String(saved[..<bar]), place: String(saved[saved.index(after: bar)...])))
    }

    var frontCode: String? {
        switch showing {
        case .place(let spot): spot.code
        case .tasks(let code): code
        case nil: nil
        }
    }

    var elsewhereUnread: Bool {
        channels.contains { room in
            room.places.contains { place in
                place.withMe && fresh(room, place.key) && !(showing == .place(Spot(code: room.code, place: place.key)))
            }
        }
    }
}

struct Shell: View {
    @Environment(AppModel.self) private var model
    @State private var drag: CGFloat = 0
    @State private var settings = false
    @State private var axis: Axis?
    @GestureState private var touching = false

    private static let peek: CGFloat = 64

    var body: some View {
        GeometryReader { geo in
            let width = geo.size.width
            let left = width - Self.peek
            let base: CGFloat = model.drawer == .left ? left : 0
            let x = min(left, max(0, base + drag))
            ZStack(alignment: .topLeading) {
                Tone.canvas.ignoresSafeArea()
                if x > 0 {
                    HStack(spacing: 0) {
                        Rail(settings: $settings)
                        SidePane()
                            .disabled(abs(drag) > 30)
                    }
                    .frame(width: left)
                    .transition(.identity)
                    .simultaneousGesture(swipe(left: left))
                }
                front
                    .accessibilityHidden(model.drawer != .closed)
                    .disabled(abs(drag) > 30)
                    .frame(width: width)
                    .background(Tone.canvas.ignoresSafeArea())
                    .offset(x: x)
                    .overlay {
                        if model.drawer != .closed {
                            Color.clear
                                .contentShape(Rectangle())
                                .frame(width: Self.peek)
                                .frame(maxWidth: .infinity, alignment: .trailing)
                                .onTapGesture { close() }
                                .accessibilityElement()
                                .accessibilityLabel("Close Channels")
                                .accessibilityAddTraits(.isButton)
                                .accessibilityAction { close() }
                        }
                    }
                    .simultaneousGesture(swipe(left: left))
            }
            .accessibilityAction(.escape) { close() }
        }
        .sheet(isPresented: $settings) {
            NavigationStack {
                SettingsScreen()
                    .toolbar {
                        ToolbarItem(placement: .topBarTrailing) {
                            Button("Done") { settings = false }
                        }
                    }
            }
        }
        .onAppear(perform: start)
        .onChange(of: touching) { _, _ in settle() }
        .onChange(of: model.channels.map(\.code)) { _, _ in start() }
        .alert("Sign-in not saved", isPresented: Binding(get: { model.unsaved != nil }, set: { if !$0 { model.unsaved = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(model.unsaved ?? "")
        }
    }

    private var front: some View {
        NavigationStack(path: Binding(get: { model.path }, set: { model.path = $0 })) {
            Group {
                switch model.showing {
                case .place(let spot): ConversationScreen(start: spot).id(spot.id)
                case .tasks(let code): TasksScreen(code: code)
                case nil:
                    ContentUnavailableView {
                        Label(model.joining > 0 ? "Waiting to Be Let In" : "No Channels", systemImage: "bubble.left.and.bubble.right")
                    } description: {
                        Text(model.enrolled ? "This iPhone joins the channels your computer had when it approved it." : "Link your Mac again to bring your channels.")
                    } actions: {
                        if !model.enrolled {
                            Button("Link Again") { model.relinkAsked = true }
                        }
                    }
                }
            }
            .toolbarBackground(.hidden, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        withAnimation(Drawers.motion) { model.drawer = .left }
                    } label: {
                        Image(systemName: "line.3.horizontal")
                            .overlay(alignment: .topTrailing) {
                                if model.waiting > 0 || model.elsewhereUnread {
                                    Circle().fill(model.waiting > 0 ? Tone.decide : Tone.accent).frame(width: 8, height: 8).offset(x: 4, y: -3)
                                }
                            }
                    }
                    .accessibilityLabel("Channels")
                }
            }
            .navigationDestination(for: Route.self) { RouteScreen(route: $0) }
        }
    }

    private func swipe(left: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 14)
            .updating($touching) { _, touching, _ in touching = true }
            .onChanged { value in
                if axis == nil {
                    axis = abs(value.translation.width) > abs(value.translation.height) * 1.4 ? .horizontal : .vertical
                    if axis == .horizontal && model.drawer == .closed {
                        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                    }
                }
                guard axis == .horizontal else { return }
                if model.drawer == .closed && (!model.path.isEmpty || value.translation.width < 0) { return }
                drag = value.translation.width
            }
            .onEnded { value in
                defer { axis = nil }
                guard axis == .horizontal else { return }
                let moved = value.predictedEndTranslation.width
                if model.drawer == .closed && !model.path.isEmpty {
                    if moved > 120 && value.startLocation.x > 30 { model.path.removeLast() }
                    return
                }
                guard drag != 0 else { return }
                let next: Drawer =
                    switch model.drawer {
                    case .closed: moved > left * 0.35 ? .left : .closed
                    case .left: moved < -left * 0.3 ? .closed : .left
                    }
                if next != model.drawer { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
                withAnimation(Drawers.motion) {
                    model.drawer = next
                    drag = 0
                }
            }
    }

    private func settle() {
        guard !touching, drag != 0 || axis != nil else { return }
        axis = nil
        withAnimation(Drawers.motion) { drag = 0 }
    }

    private func close() {
        withAnimation(Drawers.motion) { model.drawer = .closed }
    }

    private func start() {
        if let code = model.frontCode, model.rooms[code] != nil { return }
        guard let first = model.channels.first else { return }
        model.path = []
        if let saved = AppModel.savedFront(), case .place(let spot) = saved, model.rooms[spot.code] != nil {
            model.showing = saved
            model.pane = .channel(spot.code)
        } else {
            model.showing = .place(Spot(code: first.code))
            model.pane = .channel(first.code)
        }
        #if DEBUG
            if let shot = UserDefaults.standard.string(forKey: "shot") {
                if let text = UserDefaults.standard.string(forKey: "draft") { model.keep(Draft(text: text), first.code, "main") }
                model.showing = .place(Spot(code: first.code, place: UserDefaults.standard.string(forKey: "place") ?? "main"))
                switch shot {
                case "list", "channel": model.drawer = .left
                case "needs":
                    model.pane = .needs
                    model.drawer = .left
                case "board": model.showing = .tasks(first.code)
                case "settings": settings = true
                default: break
                }
            }
        #endif
    }
}

struct Rail: View {
    @Binding var settings: Bool
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(spacing: 10) {
                    RailButton(on: model.pane == .needs, news: false, label: "Needs You") {
                        model.pane = .needs
                    } face: {
                        Image(systemName: model.pane == .needs ? "tray.fill" : "tray")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundStyle(model.pane == .needs ? Tone.ink : Tone.ink2)
                            .frame(width: 46, height: 46)
                            .background(model.pane == .needs ? Tone.wash2 : Tone.raised)
                    }
                    .overlay(alignment: .bottomTrailing) { Count(n: model.waiting) }
                    Rectangle().fill(Tone.line).frame(width: 30, height: 1)
                    ForEach(model.channels, id: \.code) { room in
                        let needs = room.asks.count + room.reviews.count + room.open.count
                        RailButton(on: model.pane == .channel(room.code), news: room.places.contains { $0.withMe && model.fresh(room, $0.key) }, label: room.title) {
                            model.pane = .channel(room.code)
                        } face: {
                            ChannelAvatar(room: room, size: 46)
                        }
                        .overlay(alignment: .bottomTrailing) { Count(n: needs) }
                        .contextMenu {
                            Button("Mark All as Read", systemImage: "envelope.open") {
                                for place in room.places where place.withMe { model.markRead(Spot(code: room.code, place: place.key)) }
                            }
                        }
                    }
                }
                .padding(.vertical, 8)
            }
            .scrollIndicators(.hidden)
            VStack(spacing: 10) {
                Button {
                    settings = true
                } label: {
                    if let me = model.channels.first.flatMap({ $0.member($0.me) }) {
                        Face(name: me.name, member: me, size: 40)
                    } else {
                        Image(systemName: "person.crop.circle.fill").font(.system(size: 36)).foregroundStyle(Tone.ink3).frame(width: 46, height: 46)
                    }
                }
                .accessibilityLabel("You")
            }
            .padding(.bottom, 8)
        }
        .frame(width: 72)
        .background(Tone.rail.ignoresSafeArea())
        .buttonStyle(.plain)
    }
}

struct RailButton<Face: View>: View {
    let on: Bool
    let news: Bool
    let label: String
    let pick: () -> Void
    @ViewBuilder let face: () -> Face

    var body: some View {
        Button {
            if !on { UISelectionFeedbackGenerator().selectionChanged() }
            pick()
        } label: {
            face()
                .clipShape(RoundedRectangle(cornerRadius: on ? 16 : 23, style: .continuous))
                .animation(.snappy(duration: 0.2), value: on)
        }
        .frame(width: 72)
        .overlay(alignment: .leading) {
            if on || news {
                Capsule().fill(Tone.ink).frame(width: 4, height: on ? 34 : 9).offset(x: -1)
            }
        }
        .accessibilityLabel(label)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

struct Count: View {
    let n: Int

    var body: some View {
        if n > 0 {
            Text("\(n)")
                .font(.caption2.weight(.bold))
                .foregroundStyle(.white)
                .padding(.horizontal, 5)
                .frame(minWidth: 18, minHeight: 18)
                .background(Tone.alert, in: Capsule())
                .overlay(Capsule().stroke(Tone.rail, lineWidth: 3))
                .offset(x: -8, y: 2)
        }
    }
}

struct SidePane: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Group {
            switch model.pane {
            case .needs:
                NavigationStack {
                    NeedsScreen()
                        .scrollContentBackground(.hidden)
                        .background(Tone.canvas)
                }
            case .channel(let code):
                if let room = model.rooms[code] {
                    List {
                        ChannelSection(room: room)
                    }
                    .listStyle(.plain)
                    .scrollContentBackground(.hidden)
                    .contentMargins(.top, 6, for: .scrollContent)
                    .safeAreaInset(edge: .top, spacing: 0) {
                        SideHeader(room: room)
                    }
                } else {
                    Color.clear
                }
            }
        }
    }
}

struct SideHeader: View {
    let room: RoomView

    var body: some View {
        HStack(spacing: 10) {
            ChannelAvatar(room: room, size: 30)
            VStack(alignment: .leading, spacing: 1) {
                Text(room.title).font(.headline).foregroundStyle(Tone.ink).lineLimit(1)
                if room.working > 0 {
                    Text("\(room.working) working").font(.caption).foregroundStyle(Tone.ink3)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 18)
        .padding(.top, 14)
        .padding(.bottom, 12)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}
