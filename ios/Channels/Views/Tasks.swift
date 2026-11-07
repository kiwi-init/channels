import SwiftUI

enum Route: Hashable {
    case place(Spot)
    case tasks(String)
    case details(String, String)
}

struct TasksScreen: View {
    let code: String
    @Environment(AppModel.self) private var model

    private static let groups: [(state: String, title: String)] = [("doing", "Working"), ("review", "In review"), ("todo", "To do"), ("done", "Done")]

    var body: some View {
        let room = model.rooms[code]
        let tasks = room?.tasks.filter { !$0.archived } ?? []
        List {
            if tasks.isEmpty {
                Text("No tasks yet").type(.ui).foregroundStyle(Tone.ink3).listRowBackground(Tone.raised)
            }
            ForEach(Self.groups, id: \.state) { group in
                let shown = tasks.filter { $0.state == group.state }.prefix(group.state == "done" ? 20 : 200)
                if !shown.isEmpty {
                    Section(group.title) {
                        ForEach(Array(shown)) { task in
                            Button {
                                model.path.append(.place(Spot(code: code, place: "task:\(task.id)")))
                            } label: {
                                TaskRow(task: task, room: room)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .listRowBackground(Tone.raised)
                }
            }
        }
        .grouped()
        .navigationTitle("Tasks")
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct TaskRow: View {
    let task: TaskView
    let room: RoomView?

    private var tone: Color {
        switch task.state {
        case "doing": Tone.doing
        case "review": Tone.decide
        case "done": Tone.live
        default: Tone.ink3
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Circle().fill(tone).frame(width: 9, height: 9).padding(.top, 6).frame(width: 30)
            VStack(alignment: .leading, spacing: 2) {
                Text(task.title).type(.body).foregroundStyle(Tone.ink).lineLimit(2)
                Text([taskLabel(task.id), task.owner.map { room?.display($0) ?? $0 }, When.list(task.updated)].compactMap { $0 }.joined(separator: " · "))
                    .type(.ui)
                    .foregroundStyle(Tone.ink3)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
    }
}
