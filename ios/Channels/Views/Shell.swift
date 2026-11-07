import SwiftUI
import UIKit

enum Drawer: Equatable {
    case closed, left, right
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
        withAnimation(.spring(duration: 0.32, bounce: 0.04)) { drawer = .closed }
    }

    static func savedFront() -> Route? {
        guard let saved = UserDefaults.standard.string(forKey: "front"), let bar = saved.firstIndex(of: "|") else { return nil }
        return .place(Spot(code: String(saved[..<bar]), place: String(saved[saved.index(after: bar)...])))
    }

    var frontCode: String? {
        switch showing {
        case .place(let spot): spot.code
        case .tasks(let code): code
        case .details(let code, _): code
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
    @State private var search = false
    @State private var settings = false
    @State private var axis: Axis?

    private static let peek: CGFloat = 64
    private static let members: CGFloat = 300

    var body: some View {
        GeometryReader { geo in
            let width = geo.size.width
            let left = width - Self.peek
            let base: CGFloat =
                switch model.drawer {
                case .closed: 0
                case .left: left
                case .right: -Self.members
                }
            let x = min(left, max(-Self.members, base + drag))
            ZStack(alignment: .topLeading) {
                Tone.rail.ignoresSafeArea()
                if x > 0 {
                    HStack(spacing: 0) {
                        Rail(search: $search, settings: $settings)
                        SidePane()
                    }
                    .frame(width: left)
                    .transition(.identity)
                    .simultaneousGesture(swipe(left: left))
                }
                if x < 0, let code = model.frontCode, let room = model.rooms[code] {
                    MembersPane(room: room)
                        .frame(width: Self.members)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                        .simultaneousGesture(swipe(left: left))
                }
                front
                    .frame(width: width)
                    .clipShape(RoundedRectangle(cornerRadius: x == 0 ? 0 : 24, style: .continuous))
                    .shadow(color: .black.opacity(x == 0 ? 0 : 0.25), radius: 18)
                    .offset(x: x)
                    .overlay {
                        if model.drawer != .closed {
                            Color.clear
                                .contentShape(Rectangle())
                                .frame(width: model.drawer == .left ? Self.peek : width - Self.members)
                                .frame(maxWidth: .infinity, alignment: model.drawer == .left ? .trailing : .leading)
                                .onTapGesture { close() }
                        }
                    }
                    .simultaneousGesture(swipe(left: left))
            }
        }
        .sheet(isPresented: $search) {
            SearchScreen()
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
        .onChange(of: model.channels.first?.code) { _, _ in start() }
    }

    private var front: some View {
        NavigationStack(path: Binding(get: { model.path }, set: { model.path = $0 })) {
            Group {
                switch model.showing {
                case .place(let spot): ConversationScreen(start: spot).id(spot.id)
                case .tasks(let code): TasksScreen(code: code)
                case .details(let code, let place): RouteScreen(route: .details(code, place))
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
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        withAnimation(.spring(duration: 0.32, bounce: 0.04)) { model.drawer = .left }
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
            .onChanged { value in
                if axis == nil {
                    axis = abs(value.translation.width) > abs(value.translation.height) * 1.4 ? .horizontal : .vertical
                    if axis == .horizontal && model.drawer == .closed {
                        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                    }
                }
                guard axis == .horizontal, model.path.isEmpty else { return }
                if model.drawer == .closed && value.translation.width < 0 && model.frontCode == nil { return }
                drag = value.translation.width
            }
            .onEnded { value in
                defer { axis = nil }
                guard axis == .horizontal, drag != 0 else {
                    drag = 0
                    return
                }
                let moved = value.predictedEndTranslation.width
                let next: Drawer =
                    switch model.drawer {
                    case .closed: moved > left * 0.35 ? .left : moved < -Self.members * 0.35 ? .right : .closed
                    case .left: moved < -left * 0.3 ? .closed : .left
                    case .right: moved > Self.members * 0.3 ? .closed : .right
                    }
                if next != model.drawer { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
                withAnimation(.spring(duration: 0.32, bounce: 0.04)) {
                    model.drawer = next
                    drag = 0
                }
            }
    }

    private func close() {
        withAnimation(.spring(duration: 0.32, bounce: 0.04)) { model.drawer = .closed }
    }

    private func start() {
        guard model.showing == nil, let first = model.channels.first else { return }
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
                case "members": model.drawer = .right
                case "board": model.showing = .tasks(first.code)
                case "settings": settings = true
                case "tasks": model.path = [.details(first.code, "main")]
                default: break
                }
            }
        #endif
    }
}

struct Rail: View {
    @Binding var search: Bool
    @Binding var settings: Bool
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(spacing: 10) {
                    RailButton(on: model.pane == .needs, news: false, label: "Needs You") {
                        model.pane = .needs
                    } face: {
                        Image(systemName: "tray.fill")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundStyle(model.waiting > 0 ? Tone.onInk : Tone.ink2)
                            .frame(width: 46, height: 46)
                            .background(model.waiting > 0 ? Tone.decide : Tone.raised, in: Circle())
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
                    }
                }
                .padding(.vertical, 8)
            }
            .scrollIndicators(.hidden)
            VStack(spacing: 10) {
                Button {
                    search = true
                } label: {
                    Image(systemName: "magnifyingglass").font(.system(size: 18, weight: .semibold)).foregroundStyle(Tone.ink2).frame(width: 46, height: 46)
                        .background(Tone.raised, in: Circle())
                }
                .accessibilityLabel("Search")
                Button {
                    settings = true
                } label: {
                    Face(name: model.person, member: nil, size: 40)
                }
                .accessibilityLabel("You")
            }
            .padding(.bottom, 8)
        }
        .frame(width: 72)
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
        Button(action: pick) {
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
                        ChannelSection(room: room, titled: false)
                    }
                    .listStyle(.insetGrouped)
                    .scrollContentBackground(.hidden)
                    .safeAreaInset(edge: .top) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(room.title).font(.title3.weight(.bold)).foregroundStyle(Tone.ink).lineLimit(1)
                            if room.working > 0 {
                                Text("\(room.working) working").font(.subheadline).foregroundStyle(Tone.ink3)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 20)
                        .padding(.top, 10)
                    }
                } else {
                    Color.clear
                }
            }
        }
        .background(Tone.canvas, in: UnevenRoundedRectangle(topLeadingRadius: 20, style: .continuous))
    }
}

struct MembersPane: View {
    let room: RoomView
    @Environment(AppModel.self) private var model

    private var crew: [MemberView] {
        room.members.filter { $0.kind != "computer" }
            .sorted { ($0.lead ? 0 : $0.working ? 1 : 2, $0.display) < ($1.lead ? 0 : $1.working ? 1 : 2, $1.display) }
    }

    var body: some View {
        List {
            Section("Members · \(crew.count)") {
                ForEach(crew) { member in
                    Button {
                        if member.name != room.me { model.open(.place(Spot(code: room.code, place: room.dmKey(with: member.name)))) }
                    } label: {
                        PlaceLabel(title: member.display, detail: detail(member), unread: false) {
                            Face(name: member.name, member: member, size: 28)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .listRowBackground(Tone.raised)
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Tone.canvas)
    }

    private func detail(_ member: MemberView) -> String {
        if member.name == room.me { return "You" }
        if member.working, let id = member.doing.first, let task = room.tasks.first(where: { $0.id == id }) { return "\(taskLabel(task.id)) \(task.title)" }
        if member.lead { return "Lead" }
        return member.isAgent ? (member.here ? "Idle" : "Offline") : (member.here ? "Online" : "Away")
    }
}
