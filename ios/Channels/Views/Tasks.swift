import SwiftUI

enum Route: Hashable {
    case place(Spot)
    case tasks(String)
}

enum AppTab: Hashable {
    case chats
    case needs
    case you
}

struct TasksScreen: View {
    let code: String
    @Environment(AppModel.self) private var model

    private static let groups: [(state: String, title: String)] = [("doing", "Working"), ("review", "In review"), ("todo", "To do"), ("done", "Done")]

    var body: some View {
        let room = model.rooms[code]
        let tasks = room?.tasks.filter { !$0.archived } ?? []
        List {
            ForEach(Self.groups, id: \.state) { group in
                let shown = tasks.filter { $0.state == group.state }.sorted { $0.updatedAt > $1.updatedAt }.prefix(group.state == "done" ? 20 : 200)
                if !shown.isEmpty {
                    Section {
                        ForEach(Array(shown)) { task in
                            Button {
                                model.go(.place(Spot(code: code, place: "task:\(task.id)")))
                            } label: {
                                TaskRow(task: task, room: room)
                            }
                            .buttonStyle(.plain)
                            .flatRow()
                        }
                    } header: {
                        Text(group.title).font(.subheadline.weight(.semibold)).foregroundStyle(Tone.ink2).textCase(nil)
                    }
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Tone.canvas)
        .overlay {
            if tasks.isEmpty {
                ContentUnavailableView("No tasks yet", systemImage: "checklist")
            }
        }
        .navigationTitle(room.map { "Tasks · \($0.title)" } ?? "Tasks")
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

    private var who: String? {
        task.owner.map { room?.display($0) ?? $0 }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Circle().fill(tone).frame(width: 9, height: 9).padding(.top, 6).frame(width: 20)
            VStack(alignment: .leading, spacing: 2) {
                Text(task.title).font(.body).foregroundStyle(Tone.ink).lineLimit(2)
                if let last = task.last, !last.isEmpty, task.state != "done" {
                    Text(last.replacingOccurrences(of: "\n", with: " ")).font(.subheadline).foregroundStyle(Tone.ink2).lineLimit(2)
                }
                Text([taskLabel(task.id), who, When.list(task.updated)].compactMap { $0 }.joined(separator: " · "))
                    .font(.footnote)
                    .foregroundStyle(Tone.ink3)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}
