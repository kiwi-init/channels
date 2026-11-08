import SwiftUI

struct ChannelList: View {
    @Binding var settings: Bool
    @Environment(AppModel.self) private var model

    var body: some View {
        List {
            if model.waiting > 0 {
                Button {
                    model.go(.needs)
                } label: {
                    ConvoRow(title: "Needs You", line: needsLine, at: nil, unread: false) {
                        Image(systemName: "hand.raised.fill").foregroundStyle(Tone.decide).iconDisc(Tone.decideWash)
                    } badge: {
                        Text("\(model.waiting)").type(.meta, .semibold).foregroundStyle(Tone.decide)
                    }
                }
                .flatRow()
            }
            ForEach(model.channels, id: \.code) { room in
                Section {
                    ChannelRows(room: room)
                } header: {
                    ChannelHeader(room: room)
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Tone.canvas)
        .overlay {
            if model.channels.isEmpty {
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
        .navigationTitle("Channels")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    settings = true
                } label: {
                    if let me = model.channels.first.flatMap({ $0.member($0.me) }) {
                        Face(name: me.name, member: me, size: 32)
                    } else {
                        Image(systemName: "person.crop.circle")
                    }
                }
                .accessibilityLabel("You")
            }
        }
    }

    private var needsLine: String {
        let first = model.channels.lazy.compactMap { room in
            room.open.first.map(NeedText.title) ?? room.asks.first?.plain ?? room.reviews.first.map { "\(taskLabel($0.task)) \($0.title)" }
        }.first
        return (first ?? "").replacingOccurrences(of: "\n", with: " ")
    }
}

struct ChannelHeader: View {
    let room: RoomView

    var body: some View {
        HStack(spacing: 6) {
            Text(room.title).font(.subheadline.weight(.semibold)).foregroundStyle(Tone.ink2)
            if room.working > 0 {
                Text("· \(room.working) working").font(.subheadline).foregroundStyle(Tone.ink3)
            }
            Spacer(minLength: 0)
        }
        .textCase(nil)
        .accessibilityAddTraits(.isHeader)
    }
}

struct ChannelRows: View {
    let room: RoomView
    @Environment(AppModel.self) private var model

    private var rooms: [Spot] {
        [Spot(code: room.code)] + room.places.filter { $0.kind == "room" }.map { Spot(code: room.code, place: $0.key) }
    }

    var body: some View {
        Group {
            if let spot = room.leadSpot, let lead = room.lead {
                Button {
                    model.go(.place(spot))
                } label: {
                    let last = room.placeView(spot.place)?.last
                    ConvoRow(title: room.display(lead), line: leadLine(last), at: last?.date, unread: model.unread(spot)) {
                        Face(name: lead, member: room.member(lead), size: 44)
                    }
                }
                .flatRow()
                .swipeActions(edge: .leading) { ReadToggle(spot: spot) }
                .contextMenu { ReadToggle(spot: spot) }
            }
            ForEach(rooms, id: \.self) { spot in
                Button {
                    model.go(.place(spot))
                } label: {
                    let last = room.placeView(spot.place)?.last
                    ConvoRow(title: spot.general ? "general" : room.spotTitle(spot.place), line: roomLine(last), at: last?.date, unread: model.unread(spot)) {
                        Image(systemName: "number").foregroundStyle(Tone.ink2).iconDisc(Tone.raised)
                    }
                }
                .flatRow()
                .swipeActions(edge: .leading) { ReadToggle(spot: spot) }
                .contextMenu { ReadToggle(spot: spot) }
            }
            Button {
                model.go(.tasks(room.code))
            } label: {
                ConvoRow(title: "Tasks", line: TaskCounts(room.tasks).line, at: nil, unread: false) {
                    Image(systemName: "checklist").foregroundStyle(Tone.ink2).iconDisc(Tone.raised)
                }
            }
            .flatRow()
        }
        .buttonStyle(.plain)
    }

    private func leadLine(_ last: MessageView?) -> String {
        guard let last else { return room.connection == .connecting ? "Connecting…" : "Message your lead" }
        return last.mine ? "You: \(Self.words(last))" : Self.words(last)
    }

    private func roomLine(_ last: MessageView?) -> String {
        guard let last else { return room.connection == .connecting ? "Connecting…" : "No messages yet" }
        return "\(last.mine ? "You" : room.display(last.from)): \(Self.words(last))"
    }

    static func words(_ m: MessageView) -> String {
        if m.body.isEmpty && m.images > 0 { return m.images == 1 ? "Photo" : "\(m.images) Photos" }
        return m.plain.replacingOccurrences(of: "\n", with: " ")
    }
}

struct TaskCounts {
    let working: Int
    let review: Int
    let todo: Int

    init(_ tasks: [TaskView]) {
        let live = tasks.filter { !$0.archived }
        working = live.count { $0.state == "doing" }
        review = live.count { $0.state == "review" }
        todo = live.count { $0.state == "todo" }
    }

    var line: String {
        let parts = [working > 0 ? "\(working) working" : nil, review > 0 ? "\(review) in review" : nil, todo > 0 ? "\(todo) to do" : nil].compactMap { $0 }
        return parts.isEmpty ? "Nothing open" : parts.joined(separator: " · ")
    }
}

struct ReadToggle: View {
    let spot: Spot
    @Environment(AppModel.self) private var model

    var body: some View {
        let unread = model.unread(spot)
        if unread || model.canMarkUnread(spot) {
            Button {
                withAnimation(Motion.ease) {
                    if unread { model.markRead(spot) } else { model.markUnread(spot) }
                }
            } label: {
                Label(unread ? "Mark as Read" : "Mark as Unread", systemImage: unread ? "envelope.open" : "envelope.badge")
            }
            .tint(Tone.accent)
        }
    }
}

struct ConvoRow<Icon: View, Badge: View>: View {
    let title: String
    let line: String
    let at: Date?
    let unread: Bool
    @ViewBuilder let icon: () -> Icon
    @ViewBuilder let badge: () -> Badge

    init(title: String, line: String, at: Date?, unread: Bool, @ViewBuilder icon: @escaping () -> Icon, @ViewBuilder badge: @escaping () -> Badge = { EmptyView() }) {
        self.title = title
        self.line = line
        self.at = at
        self.unread = unread
        self.icon = icon
        self.badge = badge
    }

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            Circle().fill(unread ? Tone.accent : .clear).frame(width: 9, height: 9)
            icon().frame(width: 44, height: 44)
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(title).font(.body.weight(.semibold)).foregroundStyle(Tone.ink).lineLimit(1)
                    Spacer(minLength: 0)
                    if let at {
                        Text(When.list(at)).font(.subheadline).foregroundStyle(Tone.ink3)
                    }
                    badge()
                }
                Text(line).font(.subheadline).foregroundStyle(Tone.ink3).lineLimit(2)
            }
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
        .accessibilityValue(unread ? "Unread" : "")
    }
}

extension View {
    func flatRow() -> some View {
        self
            .listRowInsets(EdgeInsets(top: 7, leading: 6, bottom: 7, trailing: 16))
            .listRowSeparator(.hidden)
            .listRowBackground(Color.clear)
    }

    func iconDisc(_ fill: Color) -> some View {
        self
            .font(.system(size: 18, weight: .semibold))
            .frame(width: 44, height: 44)
            .background(Circle().fill(fill))
    }
}
