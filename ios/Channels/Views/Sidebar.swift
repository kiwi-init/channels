import SwiftUI

struct RouteScreen: View {
    let route: Route
    @Environment(AppModel.self) private var model

    var body: some View {
        switch route {
        case .place(let spot): ConversationScreen(start: spot)
        case .tasks(let code): TasksScreen(code: code)
        case .details(let code, let place):
            DetailsScreen(code: code, current: place) { key in
                model.path.removeAll()
                model.open(.place(Spot(code: code, place: key)))
            }
        }
    }
}

struct ChannelSection: View {
    let room: RoomView
    @Environment(AppModel.self) private var model

    private var directs: [MemberView] {
        let others = room.people.filter { !room.isMe($0.name) && $0.kind != "computer" }
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
        Group {
            let main = Spot(code: room.code)
            Button {
                model.open(.place(main))
            } label: {
                PlaceLabel(title: "general", detail: line(room.placeView("main")?.last ?? room.last), unread: model.unread(main)) {
                    Image(systemName: "number").foregroundStyle(Tone.ink2)
                }
            }
            .sideRow(on: model.showing == .place(main))
            .swipeActions(edge: .leading) { readToggle(main) }
            .contextMenu { readToggle(main) }
            Button {
                model.open(.tasks(room.code))
            } label: {
                PlaceLabel(title: "Tasks", detail: open > 0 ? "\(open) open" : nil, unread: false) {
                    Image(systemName: "checklist").foregroundStyle(Tone.ink2)
                }
            }
            .sideRow(on: model.showing == .tasks(room.code))
            if !directs.isEmpty {
                SideHeading(title: "Direct")
            }
            ForEach(directs) { member in
                let spot = Spot(code: room.code, place: room.dmKey(with: member.name))
                Button {
                    model.open(.place(spot))
                } label: {
                    PlaceLabel(title: member.display, detail: status(member, spot), unread: model.unread(spot)) {
                        Face(name: member.name, member: member, size: 28)
                    }
                }
                .sideRow(on: model.showing == .place(spot))
                .swipeActions(edge: .leading) { readToggle(spot) }
                .contextMenu { readToggle(spot) }
            }
        }
        .buttonStyle(.plain)
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

struct SideHeading: View {
    let title: String

    var body: some View {
        Text(title)
            .font(.caption.weight(.semibold))
            .foregroundStyle(Tone.ink3)
            .textCase(.uppercase)
            .padding(.top, 14)
            .listRowInsets(EdgeInsets(top: 0, leading: 18, bottom: 2, trailing: 18))
            .listRowSeparator(.hidden)
            .listRowBackground(Color.clear)
            .accessibilityAddTraits(.isHeader)
    }
}

extension View {
    func sideRow(on: Bool) -> some View {
        self
            .listRowInsets(EdgeInsets(top: 6, leading: 18, bottom: 6, trailing: 18))
            .listRowSeparator(.hidden)
            .listRowBackground(
                RoundedRectangle(cornerRadius: Radius.ctl, style: .continuous)
                    .fill(on ? Tone.wash2 : Color.clear)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 1)
            )
            .accessibilityAddTraits(on ? .isSelected : [])
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

struct SearchScreen: View {
    @Environment(AppModel.self) private var model
    @State private var query = ""
    @Environment(\.dismiss) private var dismiss

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

    private func go(_ spot: Spot) {
        dismiss()
        model.open(.place(spot))
    }

    var body: some View {
        NavigationStack {
            List {
                if !places.isEmpty {
                    Section("Conversations") {
                        ForEach(places, id: \.0) { found in
                            let (room, place) = (found.1, found.2)
                            Button {
                                go(Spot(code: room.code, place: place.key))
                            } label: {
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
                            Button {
                                go(Spot(code: room.code, place: key))
                            } label: {
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
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Conversations and messages")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}

struct Found: Identifiable {
    let room: RoomView
    let key: String
    let message: MessageView

    var id: String { "\(room.code)|\(key)|\(message.seq)" }
}
