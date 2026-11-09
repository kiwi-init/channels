import SwiftUI

struct ChannelList: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        List {
            if model.demo {
                HStack(spacing: 12) {
                    Text("A sample channel. Sign in to see yours.").font(.subheadline).foregroundStyle(Tone.ink2)
                    Spacer(minLength: 0)
                    Button("Sign In") { model.endDemo() }
                        .font(.subheadline.weight(.semibold))
                        .buttonStyle(.borderless)
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 6)
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
        .refreshable { await model.refresh() }
        .scrollDismissesKeyboard(.interactively)
        .bar(.bottom) { QuickSend() }
        .animation(Motion.ease, value: model.waiting)
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
                let member = room.member(lead)
                Button {
                    model.go(.place(spot))
                } label: {
                    let last = room.placeView(spot.place)?.last
                    ConvoRow(
                        title: room.display(lead), line: leadLine(last), at: last?.date, unread: model.unread(spot), live: live(member),
                        since: member?.working == true ? member?.activity?.since.map { Date(timeIntervalSince1970: $0 / 1000) } : nil
                    ) {
                        Face(name: lead, member: member, size: 44)
                    }
                }
                .flatRow()
                .swipeActions(edge: .leading) { ReadToggle(spot: spot) }
                .contextMenu {
                    RowMenu(spot: spot)
                } preview: {
                    PeekView(spot: spot).environment(model)
                }
            }
            ForEach(rooms, id: \.self) { spot in
                Button {
                    model.go(.place(spot))
                } label: {
                    let last = room.placeView(spot.place)?.last
                    ConvoRow(title: spot.general ? String(localized: "general") : room.spotTitle(spot.place), line: roomLine(last), at: last?.date, unread: model.unread(spot)) {
                        Image(systemName: "number").foregroundStyle(Tone.ink2).iconDisc(Tone.raised)
                    }
                }
                .flatRow()
                .swipeActions(edge: .leading) { ReadToggle(spot: spot) }
                .contextMenu {
                    RowMenu(spot: spot)
                } preview: {
                    PeekView(spot: spot).environment(model)
                }
            }
            Button {
                model.go(.tasks(room.code))
            } label: {
                let counts = TaskCounts(room.tasks)
                ConvoRow(title: String(localized: "Tasks"), line: counts.line, at: nil, unread: false) {
                    Image(systemName: "checklist").foregroundStyle(Tone.ink2).iconDisc(Tone.raised)
                } badge: {
                    EmptyView()
                } below: {
                    if counts.total > 0 { ProgressStrip(counts: counts).padding(.top, 5) }
                }
            }
            .flatRow()
        }
        .buttonStyle(.plain)
    }

    private func live(_ member: MemberView?) -> String? {
        guard let member, member.working else { return nil }
        let task = member.doing.first.map { id in room.tasks.first { $0.id == id }.map { "\(taskLabel(id)) \($0.title)" } ?? taskLabel(id) }
        let tool = member.activity?.tool.flatMap { $0.isEmpty ? nil : $0 }
        return [task.map { String(localized: "Working on \($0)") } ?? String(localized: "Working"), tool].compactMap { $0 }.joined(separator: " · ")
    }

    private func leadLine(_ last: MessageView?) -> String {
        guard let last else { return room.connection == .connecting ? String(localized: "Connecting…") : String(localized: "Message your lead") }
        return last.mine ? String(localized: "You: \(Self.words(last))") : Self.words(last)
    }

    private func roomLine(_ last: MessageView?) -> String {
        guard let last else { return room.connection == .connecting ? String(localized: "Connecting…") : String(localized: "No messages yet") }
        return String(localized: "\(last.mine ? String(localized: "You") : room.display(last.from)): \(Self.words(last))")
    }

    static func words(_ m: MessageView) -> String {
        if m.body.isEmpty && m.images > 0 { return String(localized: "\(m.images) Photos") }
        return m.plain.replacingOccurrences(of: "\n", with: " ")
    }
}

struct TaskCounts {
    let working: Int
    let review: Int
    let todo: Int
    let done: Int

    init(_ tasks: [TaskView]) {
        let live = tasks.filter { !$0.archived }
        working = live.count { $0.state == "doing" }
        review = live.count { $0.state == "review" }
        todo = live.count { $0.state == "todo" }
        done = live.count { $0.state == "done" }
    }

    var total: Int { working + review + todo + done }

    var line: String {
        let parts = [
            working > 0 ? String(localized: "\(working) working") : nil, review > 0 ? String(localized: "\(review) in review") : nil,
            todo > 0 ? String(localized: "\(todo) to do") : nil,
        ].compactMap { $0 }
        return parts.isEmpty ? String(localized: "Nothing open") : parts.joined(separator: " · ")
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

struct ConvoRow<Icon: View, Badge: View, Below: View>: View {
    let title: String
    let line: String
    let at: Date?
    let unread: Bool
    var live: String?
    var since: Date?
    @ViewBuilder let icon: () -> Icon
    @ViewBuilder let badge: () -> Badge
    @ViewBuilder let below: () -> Below

    init(
        title: String, line: String, at: Date?, unread: Bool, live: String? = nil, since: Date? = nil, @ViewBuilder icon: @escaping () -> Icon,
        @ViewBuilder badge: @escaping () -> Badge = { EmptyView() }, @ViewBuilder below: @escaping () -> Below = { EmptyView() }
    ) {
        self.title = title
        self.line = line
        self.at = at
        self.unread = unread
        self.live = live
        self.since = since
        self.icon = icon
        self.badge = badge
        self.below = below
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
                if let live {
                    HStack(spacing: 6) {
                        Pulse()
                        Text(live).font(.subheadline).foregroundStyle(Tone.doing).lineLimit(1)
                        if let since {
                            TimelineView(.periodic(from: .now, by: 1)) { context in
                                Text(When.elapsed(from: since, to: context.date)).font(.subheadline.monospacedDigit()).foregroundStyle(Tone.ink3)
                            }
                            .fixedSize()
                        }
                    }
                } else {
                    Text(line).font(.subheadline).foregroundStyle(Tone.ink3).lineLimit(2)
                }
                below()
            }
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
        .accessibilityValue(unread ? String(localized: "Unread") : "")
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

struct Pulse: View {
    @Environment(\.accessibilityReduceMotion) private var still

    var body: some View {
        if still {
            Circle().fill(Tone.doing).frame(width: 7, height: 7)
        } else {
            Circle().fill(Tone.doing).frame(width: 7, height: 7)
                .phaseAnimator([0.35, 1.0]) { dot, phase in
                    dot.opacity(phase).scaleEffect(0.8 + phase * 0.2)
                } animation: { _ in
                    .easeInOut(duration: 0.9)
                }
        }
    }
}

struct ProgressStrip: View {
    let counts: TaskCounts

    var body: some View {
        GeometryReader { geo in
            HStack(spacing: 2) {
                ForEach(parts, id: \.0) { part in
                    Capsule().fill(part.1).frame(width: max(4, geo.size.width * CGFloat(part.2) / CGFloat(max(1, counts.total)) - 2))
                }
            }
        }
        .frame(height: 4)
        .accessibilityHidden(true)
    }

    private var parts: [(String, Color, Int)] {
        [("done", Tone.live, counts.done), ("review", Tone.decide, counts.review), ("doing", Tone.doing, counts.working), ("todo", Tone.wash2, counts.todo)]
            .filter { $0.2 > 0 }
    }
}

struct RowMenu: View {
    let spot: Spot
    @Environment(AppModel.self) private var model

    var body: some View {
        Button("Reply", systemImage: "arrowshape.turn.up.left") {
            model.focusNext = spot
            model.go(.place(spot))
        }
        ReadToggle(spot: spot)
    }
}

struct PeekView: View {
    let spot: Spot
    @Environment(AppModel.self) private var model

    var body: some View {
        let room = model.shown(spot)
        let messages = Array((room?.messages ?? []).filter { !$0.event }.suffix(8))
        VStack(alignment: .leading, spacing: 0) {
            Text(room?.spotTitle(spot.place) ?? "").font(.headline).foregroundStyle(Tone.ink).padding(.bottom, 8)
            if let room, !messages.isEmpty {
                Spacer(minLength: 0)
                ForEach(Array(messages.enumerated()), id: \.element.seq) { index, m in
                    let first = index == 0 || messages[index - 1].from != m.from
                    let last = index == messages.count - 1 || messages[index + 1].from != m.from
                    BubbleRow(message: m, first: first, last: last, room: room, solo: spot.place == room.sideKey, reply: { _ in }, jump: { _ in }, answer: { _ in })
                }
            } else {
                Spacer(minLength: 0)
                Text("Open it to load the messages").font(.subheadline).foregroundStyle(Tone.ink3).frame(maxWidth: .infinity)
                Spacer(minLength: 0)
            }
        }
        .padding(14)
        .frame(width: 340, height: 440, alignment: .bottom)
        .clipped()
        .background(Tone.canvas)
    }
}
