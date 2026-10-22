import SwiftUI

struct TasksTab: View {
    let room: RoomView
    let current: String
    let choose: (String) -> Void
    @Environment(AppModel.self) private var model

    private var direct: [PlaceView] {
        room.places.filter { $0.kind == "dm" && $0.withMe }.sorted { $0.lastSeq > $1.lastSeq }
    }

    private var between: [PlaceView] {
        room.places.filter { $0.kind == "dm" && !$0.withMe }.sorted { $0.lastSeq > $1.lastSeq }
    }

    private var people: [MemberView] {
        let lead = room.members.filter { $0.lead }
        let rest = room.members.filter { !$0.lead && $0.name != room.me }.sorted { ($0.working ? 0 : 1, $0.display) < ($1.working ? 0 : 1, $1.display) }
        let me = room.members.filter { $0.name == room.me && !$0.lead }
        return lead + rest + me
    }

    private var doing: [TaskView] { room.tasks.filter { $0.state == "doing" || $0.state == "review" } }
    private var next: [TaskView] { room.tasks.filter { $0.state == "todo" } }
    private var done: [TaskView] {
        room.tasks.filter { $0.state == "done" && Date.now.timeIntervalSince($0.updated) < 7 * 86400 }
    }

    var body: some View {
        List {
            Section {
                header
            }
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: 8, leading: 0, bottom: 6, trailing: 0))
            if !room.asks.isEmpty {
                Section {
                    ForEach(room.asks) { ask in NeedsYouRow(ask: ask, room: room) }
                } header: {
                    Text("Needs you").foregroundStyle(Tone.decide)
                }
            }
            Section("Conversations") {
                if let general = room.placeView("main") { place(general) }
                ForEach(direct) { place($0) }
            }
            if !between.isEmpty {
                Section {
                    ForEach(between) { place($0) }
                } header: {
                    Text("Between others")
                } footer: {
                    Text("You can read along.")
                }
            }
            Section("\(room.members.count) people") {
                ForEach(people) { person($0) }
            }
            tasks("In progress", doing)
            tasks("Up next", next)
            tasks("Done this week", done)
        }
        .listStyle(.insetGrouped)
    }

    private var header: some View {
        VStack(spacing: 4) {
            ChannelAvatar(room: room, size: 96).padding(.bottom, 8)
            Text(room.title).font(.title2.weight(.bold)).foregroundStyle(Tone.ink).multilineTextAlignment(.center)
            Text(summary).type(.ui).foregroundStyle(Tone.ink3)
            HStack(spacing: 10) {
                Menu {
                    ForEach(people.filter { $0.name != room.me }) { m in
                        Button(m.display) { choose(room.dmKey(with: m.name)) }
                    }
                } label: {
                    Action(symbol: "message.fill", title: "Message")
                }
                Button {
                    Haptic.tap()
                    withAnimation(Motion.ease) { model.togglePin(Spot(code: room.code, place: current)) }
                } label: {
                    Action(symbol: pinned ? "pin.slash.fill" : "pin.fill", title: pinned ? "Unpin" : "Pin")
                }
            }
            .buttonStyle(.plain)
            .padding(.top, 16)
        }
        .frame(maxWidth: .infinity)
    }

    private var pinned: Bool { model.isPinned(Spot(code: room.code, place: current)) }

    private var summary: String {
        let count = "\(room.members.count) \(room.members.count == 1 ? "person" : "people")"
        return room.working > 0 ? "\(count) · \(room.working) working" : count
    }

    private func place(_ place: PlaceView) -> some View {
        Button {
            choose(place.key)
        } label: {
            PlaceRow(room: room, place: place, current: current == place.key, fresh: place.withMe || place.kind != "dm" ? model.fresh(room, place.key) : false)
        }
        .tint(Tone.ink)
    }

    private func person(_ m: MemberView) -> some View {
        Button {
            choose(room.dmKey(with: m.name))
        } label: {
            HStack(spacing: 12) {
                Face(name: m.name, member: m, size: 36)
                VStack(alignment: .leading, spacing: 1) {
                    HStack(spacing: 6) {
                        Text(m.display).type(.body).foregroundStyle(Tone.ink).lineLimit(1)
                        if m.name == room.me { Text("you").type(.meta).foregroundStyle(Tone.ink3) }
                    }
                    Text(status(m)).type(.meta).foregroundStyle(m.working ? Tone.doing : Tone.ink3).lineLimit(1)
                }
                Spacer(minLength: 0)
                if m.name != room.me {
                    Image(systemName: "message").font(.system(size: 15)).foregroundStyle(Tone.accent)
                }
            }
        }
        .tint(Tone.ink)
        .disabled(m.name == room.me)
    }

    private func status(_ m: MemberView) -> String {
        let what = m.lead ? "Lead" : m.owner ? "Owner" : m.isAgent ? "Agent" : "Person"
        let now: String
        if m.working {
            now = m.doing.first.map { "working on \(taskLabel($0))" } ?? "working"
        } else {
            now = m.here ? "here" : "away"
        }
        return "\(what) · \(now)"
    }

    @ViewBuilder private func tasks(_ title: String, _ list: [TaskView]) -> some View {
        if !list.isEmpty {
            Section(title) {
                ForEach(list) { task in
                    Button {
                        choose("task:\(task.id)")
                    } label: {
                        TaskRow(task: task, room: room)
                    }
                    .tint(Tone.ink)
                }
            }
        }
    }
}

struct Action: View {
    let symbol: String
    let title: String

    var body: some View {
        VStack(spacing: 5) {
            Image(systemName: symbol).font(.system(size: 18, weight: .medium))
            Text(title).type(.meta, .medium)
        }
        .foregroundStyle(Tone.accent)
        .frame(maxWidth: .infinity, minHeight: 60)
        .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

struct PlaceRow: View {
    let room: RoomView
    let place: PlaceView
    let current: Bool
    let fresh: Bool

    var body: some View {
        HStack(spacing: 12) {
            PlaceFace(room: room, place: place, size: 36)
            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text(place.kind == "main" ? "# general" : place.title).type(.body, fresh ? .semibold : .regular).foregroundStyle(Tone.ink).lineLimit(1)
                    Spacer()
                    if let last = place.last {
                        Text(When.short(last.date)).type(.meta).foregroundStyle(fresh ? Tone.accent : Tone.ink3)
                    }
                }
                Text(preview).type(.ui).foregroundStyle(Tone.ink3).lineLimit(1)
            }
            if current {
                Image(systemName: "checkmark").font(.system(size: 14, weight: .semibold)).foregroundStyle(Tone.accent)
            } else if fresh {
                Dot(color: Tone.accent, size: 9)
            }
        }
    }

    private var preview: String {
        guard let last = place.last else { return "No messages yet" }
        let who = last.mine ? "You" : room.display(last.from)
        return "\(who): \(last.body.replacingOccurrences(of: "\n", with: " "))"
    }
}

struct TaskRow: View {
    let task: TaskView
    let room: RoomView

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            if let owner = task.owner {
                Face(name: owner, member: room.member(owner), size: 30)
            } else {
                Circle().strokeBorder(Tone.edgeStrong, style: StrokeStyle(lineWidth: 1, dash: [3, 3])).frame(width: 30, height: 30)
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(task.title).type(.body).foregroundStyle(Tone.ink).multilineTextAlignment(.leading).lineLimit(2)
                HStack(spacing: 5) {
                    Text([taskLabel(task.id), task.owner.map { room.display($0) } ?? "Unassigned"].joined(separator: " · ")).type(.meta).foregroundStyle(Tone.ink3)
                    Text("·").type(.meta).foregroundStyle(Tone.ink3)
                    if task.state == "doing", let owner = task.owner, room.member(owner)?.working == true {
                        Dot(color: Tone.doing, size: 5)
                    }
                    Text(stateWords(task.state)).type(.meta).foregroundStyle(stateColor(task.state))
                    Spacer(minLength: 0)
                    Text(When.short(task.updated)).type(.meta).foregroundStyle(Tone.ink3)
                }
            }
        }
        .padding(.vertical, 2)
    }
}

struct NeedsYouRow: View {
    let ask: AskView
    let room: RoomView
    @Environment(AppModel.self) private var model
    @State private var sending: String?
    @State private var replying = false
    @State private var text = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Face(name: ask.from, member: room.member(ask.from), size: 24)
                Text([room.display(ask.from), ask.task.map(taskLabel), When.short(ask.date)].compactMap { $0 }.joined(separator: " · "))
                    .type(.meta)
                    .foregroundStyle(Tone.ink3)
                Spacer(minLength: 0)
                Text(ask.label).type(.meta, .semibold).foregroundStyle(Tone.decide)
            }
            Prose(text: ask.body)
            VStack(alignment: .leading, spacing: 6) {
                ForEach(ask.choices, id: \.self) { choice in
                    answer(choice)
                }
                if replying {
                    HStack(spacing: 8) {
                        TextField("Your answer", text: $text, axis: .vertical)
                            .type(.body)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 9)
                            .background(Tone.wash2, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        Button {
                            submit(text)
                        } label: {
                            Image(systemName: "arrow.up").font(.system(size: 15, weight: .bold)).foregroundStyle(.white).frame(width: 34, height: 34).background(
                                Tone.accent, in: Circle())
                        }
                        .disabled(text.trimmingCharacters(in: .whitespaces).isEmpty || sending != nil)
                        .accessibilityLabel("Send answer")
                    }
                } else {
                    Button {
                        replying = true
                    } label: {
                        Text(ask.choices.isEmpty ? "Answer" : "Something else").type(.ui, .medium).foregroundStyle(Tone.accent).padding(.vertical, 6)
                    }
                }
            }
            .buttonStyle(.plain)
            .padding(.top, 2)
        }
        .padding(.vertical, 4)
    }

    private func answer(_ choice: String) -> some View {
        Button {
            submit(choice)
        } label: {
            HStack {
                Text(choice).type(.ui, .medium).foregroundStyle(Tone.ink).multilineTextAlignment(.leading)
                Spacer(minLength: 0)
                if sending == choice { ProgressView().controlSize(.small) }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(Tone.wash2, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .contentShape(Rectangle())
        }
        .disabled(sending != nil)
    }

    private func submit(_ words: String) {
        let said = words.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !said.isEmpty else { return }
        sending = said
        Haptic.tap()
        Task {
            try? await model.answer(room.code, seq: ask.seq, text: said)
            sending = nil
            text = ""
            replying = false
        }
    }
}
