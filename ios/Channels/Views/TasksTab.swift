import SwiftUI

struct TasksTab: View {
    let room: RoomView
    @State private var open: TaskView?

    private var doing: [TaskView] { room.tasks.filter { $0.state == "doing" || $0.state == "review" } }
    private var next: [TaskView] { room.tasks.filter { $0.state == "todo" } }
    private var done: [TaskView] {
        room.tasks.filter { $0.state == "done" && Date.now.timeIntervalSince($0.updated) < 7 * 86400 }
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                card
                if !room.asks.isEmpty {
                    section("Needs you", count: room.asks.count, tone: Tone.decide)
                    ForEach(room.asks) { ask in NeedsYouRow(ask: ask, room: room) }
                }
                group("In progress", doing)
                group("Up next", next)
                group("Done this week", done)
                if room.tasks.isEmpty && room.asks.isEmpty {
                    Text("No tasks yet").type(.ui).foregroundStyle(Tone.ink3).frame(maxWidth: .infinity).padding(.top, 60)
                }
            }
            .padding(.bottom, 24)
        }
        .sheet(item: $open) { task in TaskSheet(task: task, room: room) }
    }

    private var card: some View {
        VStack(spacing: 8) {
            ChannelAvatar(room: room, size: 84)
            Text(room.title).type(.title).foregroundStyle(Tone.ink)
            HStack(spacing: -6) {
                ForEach(room.members.prefix(8)) { m in
                    Face(name: m.name, member: m, size: 26)
                        .overlay(Circle().stroke(Tone.canvas, lineWidth: 2))
                }
            }
            Text(people).type(.meta).foregroundStyle(Tone.ink3).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 8)
        .padding(.bottom, 4)
        .padding(.horizontal, 24)
    }

    private var people: String {
        let names = room.members.map { $0.name == room.me ? "you" : $0.display }
        return names.count <= 5 ? names.joined(separator: ", ") : "\(names.prefix(4).joined(separator: ", ")) and \(names.count - 4) more"
    }

    @ViewBuilder private func group(_ title: String, _ tasks: [TaskView]) -> some View {
        if !tasks.isEmpty {
            section(title, count: tasks.count, tone: Tone.ink3)
            ForEach(tasks) { task in
                Button {
                    open = task
                } label: {
                    TaskRow(task: task, room: room)
                }
                .buttonStyle(RowPress())
            }
        }
    }

    private func section(_ title: String, count: Int, tone: Color) -> some View {
        HStack(spacing: 6) {
            Text(title).type(.meta, .semibold).foregroundStyle(tone == Tone.decide ? Tone.decide : Tone.ink2)
            Text("\(count)").type(.meta).foregroundStyle(Tone.ink3)
        }
        .padding(.horizontal, 16)
        .padding(.top, 20)
        .padding(.bottom, 6)
    }
}

struct TaskRow: View {
    let task: TaskView
    let room: RoomView

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            if let owner = task.owner {
                Face(name: owner, member: room.member(owner), size: 28)
            } else {
                Circle().strokeBorder(Tone.edgeStrong, style: StrokeStyle(lineWidth: 1, dash: [3, 3])).frame(width: 28, height: 28)
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(task.title).type(.body).foregroundStyle(Tone.ink).multilineTextAlignment(.leading).lineLimit(2)
                HStack(spacing: 5) {
                    Text(taskLabel(task.id)).type(.meta).foregroundStyle(Tone.ink3)
                    Text("·").type(.meta).foregroundStyle(Tone.ink3)
                    Text(task.owner.map { room.display($0) } ?? "Unassigned").type(.meta).foregroundStyle(Tone.ink3)
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
        .padding(.horizontal, 16)
        .padding(.vertical, 11)
        .overlay(alignment: .bottom) { Rectangle().fill(Tone.line).frame(height: 1).padding(.leading, 56) }
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
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: ask.choices.isEmpty ? "questionmark" : "arrow.triangle.branch")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Tone.decide)
                .frame(width: 36, height: 36)
                .outlined(Radius.row)
            VStack(alignment: .leading, spacing: 4) {
                Text(ask.label).type(.meta, .semibold).foregroundStyle(Tone.decide)
                Prose(text: ask.body)
                Text([ask.task.map(taskLabel), room.display(ask.from), When.short(ask.date)].compactMap { $0 }.joined(separator: " · "))
                    .type(.meta)
                    .foregroundStyle(Tone.ink3)
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
                                .outlined(Radius.ctl)
                            Button("Send") { submit(text) }
                                .type(.ui, .semibold)
                                .disabled(text.trimmingCharacters(in: .whitespaces).isEmpty || sending != nil)
                        }
                    } else {
                        Button {
                            replying = true
                        } label: {
                            Text(ask.choices.isEmpty ? "Answer" : "Something else")
                                .type(.ui, .medium)
                                .foregroundStyle(Tone.ink)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 8)
                                .outlined(Radius.row, Tone.edgeStrong)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.top, 6)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .overlay(alignment: .bottom) { Rectangle().fill(Tone.line).frame(height: 1) }
    }

    private func answer(_ choice: String) -> some View {
        Button {
            submit(choice)
        } label: {
            HStack {
                Text(choice).type(.ui).foregroundStyle(Tone.ink).multilineTextAlignment(.leading)
                Spacer(minLength: 0)
                if sending == choice { ProgressView().controlSize(.small) }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .outlined(Radius.row, Tone.edgeStrong)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
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

struct TaskSheet: View {
    let task: TaskView
    let room: RoomView

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 6) {
                    Text(taskLabel(task.id)).type(.meta, .semibold).foregroundStyle(Tone.ink3)
                    Text("·").type(.meta).foregroundStyle(Tone.ink3)
                    Text(stateWords(task.state)).type(.meta, .semibold).foregroundStyle(stateColor(task.state))
                }
                Text(task.title).type(.display, .semibold).foregroundStyle(Tone.ink)
                VStack(spacing: 0) {
                    line("Owner", task.owner.map { room.display($0) } ?? "Unassigned")
                    if let review = task.review { line("Review", review == "*" ? "Anyone" : room.display(review)) }
                    line("Opened", task.createdAt > 0 ? When.short(Date(timeIntervalSince1970: task.createdAt / 1000)) : "—")
                    line("Updated", When.short(task.updated))
                }
                if let last = task.last {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Last note").type(.meta, .semibold).foregroundStyle(Tone.ink2)
                        Prose(text: last)
                    }
                    .padding(.top, 6)
                }
            }
            .padding(24)
        }
        .background(Tone.canvas)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private func line(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).type(.ui).foregroundStyle(Tone.ink2)
            Spacer()
            Text(value).type(.ui).foregroundStyle(Tone.ink)
        }
        .padding(.vertical, 10)
        .overlay(alignment: .bottom) { Rectangle().fill(Tone.line).frame(height: 1) }
    }
}
