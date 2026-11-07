import SwiftUI

enum AppTab: Hashable {
    case home, needs, search, you
}

struct RootTabs: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        TabView(selection: Binding(get: { model.tab }, set: { model.tab = $0 })) {
            Tab("Home", systemImage: "house", value: AppTab.home) {
                HomeTab()
            }
            Tab("Needs You", systemImage: "tray", value: AppTab.needs) {
                NavigationStack {
                    NeedsScreen()
                        .navigationDestination(for: Route.self) { RouteScreen(route: $0) }
                }
            }
            .badge(model.waiting)
            Tab(value: AppTab.search, role: .search) {
                SearchTab()
            }
            Tab("You", systemImage: "person.crop.circle", value: AppTab.you) {
                NavigationStack {
                    SettingsScreen()
                }
            }
        }
        .tint(Tone.accent)
        #if DEBUG
            .onChange(of: model.channels.first?.code, initial: true) { _, code in
                guard let code, model.path.isEmpty, let shot = UserDefaults.standard.string(forKey: "shot") else { return }
                if let text = UserDefaults.standard.string(forKey: "draft") { model.keep(Draft(text: text), code, "main") }
                switch shot {
                case "settings": model.tab = .you
                case "needs": model.tab = .needs
                case "search": model.tab = .search
                case "list": break
                case "board": model.path = [.tasks(code)]
                default: model.path = [.place(Spot(code: code, place: UserDefaults.standard.string(forKey: "place") ?? "main"))]
                }
            }
        #endif
    }
}

struct RouteScreen: View {
    let route: Route

    var body: some View {
        switch route {
        case .place(let spot): ConversationScreen(start: spot)
        case .tasks(let code): TasksScreen(code: code)
        }
    }
}

struct HomeTab: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        NavigationStack(path: Binding(get: { model.path }, set: { model.path = $0 })) {
            List {
                if let unsaved = model.unsaved {
                    Text(unsaved).foregroundStyle(Tone.alert).listRowBackground(Tone.raised)
                }
                if model.channels.isEmpty {
                    ContentUnavailableView {
                        Label(model.joining > 0 ? "Waiting to Be Let In" : "No Channels", systemImage: "bubble.left.and.bubble.right")
                    } description: {
                        Text(emptyDetail)
                    } actions: {
                        if !model.enrolled {
                            Button("Link Again") { model.relinkAsked = true }
                        }
                    }
                    .listRowBackground(Color.clear)
                }
                ForEach(model.channels.sorted { ($0.latest?.at ?? 0) > ($1.latest?.at ?? 0) }, id: \.code) { room in
                    ChannelSection(room: room)
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(Tone.canvas)
            .refreshable { model.nudge() }
            .navigationTitle("Home")
            .toolbar {
                if !model.rows(.unread).isEmpty {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Read All") {
                            withAnimation(Motion.ease) { model.markAllRead() }
                        }
                    }
                }
            }
            .navigationDestination(for: Route.self) { RouteScreen(route: $0) }
        }
    }

    private var emptyDetail: String {
        if model.joining > 0 {
            let channels = model.joining == 1 ? "1 channel" : "\(model.joining) channels"
            return "Asked to join \(channels) as you. Channels you own let this iPhone in while Channels is open on your computer."
        }
        return model.enrolled ? "This iPhone joins the channels your computer had when it approved it." : "Link your Mac again to bring your channels."
    }
}

struct ChannelSection: View {
    let room: RoomView
    @Environment(AppModel.self) private var model

    private var directs: [MemberView] {
        let others = room.members.filter { $0.name != room.me && $0.kind != "computer" }
        let last = { (m: MemberView) in room.placeView(room.dmKey(with: m.name))?.last?.at ?? 0 }
        return others.sorted { a, b in
            if a.lead != b.lead { return a.lead }
            if a.working != b.working { return a.working }
            if last(a) != last(b) { return last(a) > last(b) }
            return a.display < b.display
        }
    }

    private var open: Int { room.tasks.filter { $0.state != "done" && !$0.archived }.count }

    var body: some View {
        Section {
            NavigationLink(value: Route.place(Spot(code: room.code))) {
                PlaceLabel(title: "general", detail: line(room.placeView("main")?.last ?? room.last), unread: model.unread(Spot(code: room.code))) {
                    Image(systemName: "number").foregroundStyle(Tone.ink2)
                }
            }
            .swipeActions(edge: .leading) { readToggle(Spot(code: room.code)) }
            ForEach(directs) { member in
                let spot = Spot(code: room.code, place: room.dmKey(with: member.name))
                NavigationLink(value: Route.place(spot)) {
                    PlaceLabel(title: member.display, detail: status(member, spot), unread: model.unread(spot)) {
                        Face(name: member.name, member: member, size: 28)
                    }
                }
                .swipeActions(edge: .leading) { readToggle(spot) }
            }
            NavigationLink(value: Route.tasks(room.code)) {
                Label("Tasks", systemImage: "checklist")
                    .foregroundStyle(Tone.ink)
                    .badge(open)
            }
        } header: {
            HStack(spacing: 8) {
                ChannelAvatar(room: room, size: 20)
                Text(room.title)
                if room.working > 0 {
                    Text("· \(room.working) working").foregroundStyle(Tone.ink3)
                }
            }
        }
        .listRowBackground(Tone.raised)
    }

    @ViewBuilder private func readToggle(_ spot: Spot) -> some View {
        let unread = model.unread(spot)
        Button {
            withAnimation(Motion.ease) {
                if unread { model.markRead(spot) } else { model.markUnread(spot) }
            }
        } label: {
            Label(unread ? "Read" : "Unread", systemImage: unread ? "envelope.open" : "envelope.badge")
        }
        .tint(Tone.accent)
    }

    private func status(_ member: MemberView, _ spot: Spot) -> String? {
        if member.isAgent && member.working {
            if let id = member.doing.first, let task = room.tasks.first(where: { $0.id == id }) { return "\(taskLabel(task.id)) \(task.title)" }
            return member.activity?.tool ?? "Working"
        }
        if let last = room.placeView(spot.place)?.last { return line(last) }
        if member.lead { return "Lead" }
        return member.isAgent ? (member.here ? "Idle" : "Offline") : (member.here ? "Online" : "Away")
    }

    private func line(_ last: MessageView?) -> String? {
        guard let last else { return nil }
        let body = last.body.isEmpty && last.images > 0 ? "Photo" : last.plain.replacingOccurrences(of: "\n", with: " ")
        return "\(last.mine ? "You" : room.display(last.from)): \(body)"
    }
}

struct PlaceLabel<Icon: View>: View {
    let title: String
    let detail: String?
    let unread: Bool
    @ViewBuilder let icon: () -> Icon

    var body: some View {
        HStack(spacing: 12) {
            icon().frame(width: 28, height: 28)
            VStack(alignment: .leading, spacing: 1) {
                Text(title).fontWeight(unread ? .semibold : .regular).foregroundStyle(Tone.ink).lineLimit(1)
                if let detail {
                    Text(detail).font(.subheadline).foregroundStyle(Tone.ink3).lineLimit(1)
                }
            }
            Spacer(minLength: 0)
            if unread {
                Circle().fill(Tone.accent).frame(width: 9, height: 9).accessibilityLabel("Unread")
            }
        }
    }
}

struct SearchTab: View {
    @Environment(AppModel.self) private var model
    @State private var query = ""
    @State private var path: [Route] = []

    private var words: String { query.trimmingCharacters(in: .whitespaces).lowercased() }

    private var places: [(String, RoomView, PlaceView)] {
        guard !words.isEmpty else { return [] }
        return model.channels.flatMap { room in
            room.places.filter { place in
                let title = place.kind == "main" ? "general \(room.title)" : place.title
                return place.withMe && title.lowercased().contains(words)
            }
            .map { ("\(room.code)|\($0.key)", room, $0) }
        }
    }

    private var hits: [Found] {
        guard words.count > 1 else { return [] }
        return model.channels.flatMap { room in
            room.places.flatMap { place in
                (model.shown(Spot(code: room.code, place: place.key))?.messages ?? [])
                    .filter { !$0.event && $0.plain.lowercased().contains(words) }
                    .map { Found(room: room, key: place.key, message: $0) }
            }
        }
        .sorted { $0.message.at > $1.message.at }
        .prefix(40)
        .map { $0 }
    }

    var body: some View {
        NavigationStack(path: $path) {
            List {
                if !places.isEmpty {
                    Section("Conversations") {
                        ForEach(places, id: \.0) { found in
                            let (room, place) = (found.1, found.2)
                            NavigationLink(value: Route.place(Spot(code: room.code, place: place.key))) {
                                Label(
                                    place.kind == "main" ? "general · \(room.title)" : place.title,
                                    systemImage: place.kind == "main" ? "number" : place.kind == "task" ? "checklist" : "person")
                            }
                        }
                    }
                    .listRowBackground(Tone.raised)
                }
                if !hits.isEmpty {
                    Section("Messages") {
                        ForEach(hits, id: \.id) { hit in
                            let (room, key, message) = (hit.room, hit.key, hit.message)
                            NavigationLink(value: Route.place(Spot(code: room.code, place: key))) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("\(message.mine ? "You" : room.display(message.from)) · \(When.list(message.date))")
                                        .font(.subheadline).foregroundStyle(Tone.ink3)
                                    Text(message.plain).foregroundStyle(Tone.ink).lineLimit(3)
                                }
                            }
                        }
                    }
                    .listRowBackground(Tone.raised)
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(Tone.canvas)
            .overlay {
                if !words.isEmpty && places.isEmpty && hits.isEmpty {
                    ContentUnavailableView.search(text: query)
                }
            }
            .navigationTitle("Search")
            .searchable(text: $query, prompt: "Conversations and messages")
            .navigationDestination(for: Route.self) { RouteScreen(route: $0) }
        }
    }
}

struct Found: Identifiable {
    let room: RoomView
    let key: String
    let message: MessageView

    var id: String { "\(room.code)|\(key)|\(message.seq)" }
}
