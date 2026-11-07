import SwiftUI
import UIKit

struct NeedsScreen: View {
    @Environment(AppModel.self) private var model

    private func open(_ spot: Spot) {
        model.open(.place(spot))
    }

    private var rooms: [RoomView] {
        model.channels.filter { !$0.asks.isEmpty || !$0.reviews.isEmpty || !$0.open.isEmpty }
    }

    var body: some View {
        List {
            ForEach(rooms, id: \.code) { room in
                Section(room.title) {
                    ForEach(room.open) { need in
                        NavigationLink {
                            NeedDetail(need: need, room: room, open: open)
                        } label: {
                            NeedsRow(face: need.kind == "join" ? nil : need.from, room: room, kind: NeedText.label(need), text: NeedText.title(need), at: need.at)
                        }
                    }
                    ForEach(room.asks) { ask in
                        NavigationLink {
                            AskDetail(ask: ask, room: room, open: open)
                        } label: {
                            NeedsRow(face: ask.from, room: room, kind: NeedText.asked(ask, room), text: ask.plain, at: ask.at)
                        }
                    }
                    ForEach(room.reviews) { review in
                        NavigationLink {
                            ReviewDetail(review: review, room: room, open: open)
                        } label: {
                            NeedsRow(face: review.by, room: room, kind: "Review \(taskLabel(review.task))", text: review.title, at: review.at)
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .overlay {
            if rooms.isEmpty {
                ContentUnavailableView("Nothing needs you", systemImage: "checkmark.circle", description: Text("Questions, permissions and reviews for you show up here."))
            }
        }
        .navigationTitle("Needs You")
    }
}

private struct NeedsRow: View {
    let face: String?
    let room: RoomView
    let kind: String
    let text: String
    let at: Double

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            if let face {
                Face(name: face, member: room.member(face), size: 36)
            } else {
                ChannelAvatar(room: room, size: 36)
            }
            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text(kind).type(.meta, .semibold).foregroundStyle(Tone.decide).lineLimit(1)
                    Spacer(minLength: 8)
                    Text(Date(timeIntervalSince1970: at / 1000), format: .relative(presentation: .numeric, unitsStyle: .narrow))
                        .type(.meta)
                        .foregroundStyle(Tone.ink3)
                }
                Text(text).type(.ui).foregroundStyle(Tone.ink).lineLimit(3)
            }
        }
        .padding(.vertical, 2)
    }
}

enum NeedText {
    static func label(_ need: NeedView) -> String {
        switch need.kind {
        case "permission": "Permission"
        case "join": need.who == "human" ? "A person wants to join" : "An agent wants to join"
        default: need.changed == true ? "Spec changed" : "Spec"
        }
    }

    static func title(_ need: NeedView) -> String {
        switch need.kind {
        case "permission": need.title ?? "Use a tool"
        case "join": need.name ?? "Someone"
        default: need.title ?? ""
        }
    }

    static func asked(_ ask: AskView, _ room: RoomView) -> String {
        let place = ask.place.flatMap { $0 == "main" ? nil : room.spotTitle($0) }
        return [room.display(ask.from), place].compactMap { $0 }.joined(separator: " · ")
    }
}

private struct Doing {
    var busy = false
    var failed: String?
}

private struct AskDetail: View {
    let ask: AskView
    let room: RoomView
    let open: (Spot) -> Void
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var doing = Doing()
    @State private var other = ""

    var body: some View {
        Form {
            Section {
                Text(LocalizedStringKey(ask.shown)).type(.body).foregroundStyle(Tone.ink)
            } header: {
                Text(NeedText.asked(ask, room))
            }
            if !ask.choices.isEmpty {
                Section("Answer") {
                    ForEach(ask.choices, id: \.self) { choice in
                        Button(choice) { send(choice) }.disabled(doing.busy)
                    }
                }
            }
            Section {
                TextField("Your answer", text: $other, axis: .vertical)
                Button("Send") { send(other) }.disabled(doing.busy || other.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            } header: {
                Text(ask.choices.isEmpty ? "Answer" : "Something else")
            } footer: {
                if let failed = doing.failed { Text(failed).foregroundStyle(Tone.alert) }
            }
            Section {
                Button("Open the Conversation") { open(Spot(code: room.code, place: ask.place ?? "main")) }
            }
        }
        .navigationTitle(ask.label)
        .navigationBarTitleDisplayMode(.inline)
    }

    private func send(_ text: String) {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        act($doing, dismiss) { try await model.answer(room.code, seq: ask.seq, text: text) }
    }
}

private struct NeedDetail: View {
    let need: NeedView
    let room: RoomView
    let open: (Spot) -> Void
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var doing = Doing()

    var body: some View {
        Form {
            Section {
                Text(NeedText.title(need)).type(.body, .semibold)
                if need.kind == "permission", let summary = need.summary, !summary.isEmpty {
                    Text(summary).type(.ui).foregroundStyle(Tone.ink2)
                }
                if need.kind == "join" {
                    let about = [need.runs, need.machine, need.sponsor.map { "from \(room.display($0))'s computer" }].compactMap { $0 }.filter { !$0.isEmpty }
                    if !about.isEmpty { Text(about.joined(separator: " · ")).type(.ui).foregroundStyle(Tone.ink2) }
                }
                if need.kind != "permission" && need.kind != "join", let text = need.text, !text.isEmpty {
                    Text(LocalizedStringKey(text)).type(.ui).foregroundStyle(Tone.ink2)
                }
            } header: {
                Text(need.from.map { room.display($0) } ?? room.title)
            }
            if let code = need.code, !code.isEmpty {
                Section(need.kind == "join" ? "Their screen shows" : "Command") {
                    Text(code).font(.system(.callout, design: .monospaced)).textSelection(.enabled)
                }
            }
            Section {
                ForEach(actions, id: \.title) { action in
                    Button(role: action.role) {
                        act($doing, dismiss, action.go)
                    } label: {
                        Text(action.title)
                    }
                    .disabled(doing.busy)
                }
            } footer: {
                if let failed = doing.failed {
                    Text(failed).foregroundStyle(Tone.alert)
                } else if let note {
                    Text(note)
                }
            }
            if let task = need.task {
                Section {
                    Button("Open \(taskLabel(task))") { open(Spot(code: room.code, place: "task:\(task)")) }
                }
            }
        }
        .navigationTitle(NeedText.label(need))
        .navigationBarTitleDisplayMode(.inline)
    }

    private var note: String? {
        switch need.kind {
        case "permission" where need.canAllow != true:
            need.allower.map { "Only \(room.display($0)) can allow this one." } ?? "You can deny this one."
        case "join" where need.pinned == true: "Invited with a personality: let them in on your computer."
        case "join" where !room.isOwner: "Only the channel's owner can let them in."
        case "join" where !(need.code ?? "").isEmpty: "Let them in only if their screen shows the same code."
        default: nil
        }
    }

    private struct Action {
        let title: String
        let role: ButtonRole?
        let go: () async throws -> Void
    }

    private var actions: [Action] {
        let code = room.code
        switch need.kind {
        case "permission":
            var out: [Action] = []
            if need.canAllow == true { out.append(Action(title: "Allow Once", role: nil) { try await model.allow(code, id: need.id, allow: true) }) }
            out.append(Action(title: "Deny", role: .destructive) { try await model.allow(code, id: need.id, allow: false) })
            return out
        case "join":
            guard need.pinned != true, room.isOwner else { return [] }
            return [Action(title: "Let In", role: nil) { try await model.letIn(code, id: need.id) }]
        default:
            guard let ask = need.ask, let v = need.v else { return [] }
            return [Action(title: "Approve", role: nil) { try await model.approveSpec(code, ask: ask, v: v) }]
        }
    }
}

private struct ReviewDetail: View {
    let review: ReviewView
    let room: RoomView
    let open: (Spot) -> Void
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var doing = Doing()
    @State private var why = ""

    var body: some View {
        Form {
            Section {
                Text(review.title).type(.body, .semibold)
            } header: {
                Text([taskLabel(review.task), review.by.map { "by \(room.display($0))" }].compactMap { $0 }.joined(separator: " · "))
            }
            Section {
                Button("Approve") { act($doing, dismiss) { try await model.approve(room.code, task: review.task) } }.disabled(doing.busy)
            }
            Section {
                TextField("What needs to change", text: $why, axis: .vertical)
                Button("Send Back", role: .destructive) {
                    act($doing, dismiss) { try await model.sendBack(room.code, task: review.task, why: why) }
                }
                .disabled(doing.busy || why.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            } header: {
                Text("Send back")
            } footer: {
                if let failed = doing.failed { Text(failed).foregroundStyle(Tone.alert) }
            }
            Section {
                Button("Open \(taskLabel(review.task))") { open(Spot(code: room.code, place: "task:\(review.task)")) }
            }
        }
        .navigationTitle("Review")
        .navigationBarTitleDisplayMode(.inline)
    }
}

@MainActor
private func act(_ doing: Binding<Doing>, _ dismiss: DismissAction, _ go: @escaping () async throws -> Void) {
    guard !doing.wrappedValue.busy else { return }
    doing.wrappedValue = Doing(busy: true)
    UIImpactFeedbackGenerator(style: .medium).impactOccurred()
    Task {
        do {
            try await go()
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            doing.wrappedValue = Doing()
            dismiss()
        } catch {
            doing.wrappedValue = Doing(failed: error.localizedDescription)
            UINotificationFeedbackGenerator().notificationOccurred(.error)
        }
    }
}
