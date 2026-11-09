import SwiftUI
import UIKit

struct NeedLine: View {
    let need: NeedView
    let room: RoomView

    private var taskWhere: String? {
        need.task.map { spoken("in \(taskLabel($0))") }
    }

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            if let asker = need.asker, need.kind != "join" {
                Face(name: asker, member: room.member(asker), size: 30)
            } else {
                Color.clear.frame(width: 30, height: 30)
            }
            VStack(alignment: .leading, spacing: 3) {
                let head = [need.kind == "join" ? nil : need.asker.map { room.display($0) }, taskWhere].compactMap { $0 }
                if !head.isEmpty {
                    Text(head.joined(separator: " · "))
                        .type(.meta)
                        .foregroundStyle(Tone.ink3)
                        .padding(.leading, 12)
                }
                NeedCard(need: need, room: room)
            }
            Spacer(minLength: 40)
        }
        .padding(.top, 10)
    }
}

struct NeedCard: View {
    let need: NeedView
    let room: RoomView
    @Environment(AppModel.self) private var model
    @State private var busy: String?
    @State private var failed: String?
    @State private var whole = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(label)
                .type(.meta, .semibold)
                .foregroundStyle(Tone.decide)
                .padding(.bottom, 4)
            content
            ForEach(Array(actions.enumerated()), id: \.offset) { index, action in
                Rectangle().fill(Tone.line).frame(height: 0.5).padding(.leading, index == 0 ? 0 : 32)
                Button {
                    run(action)
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: action.symbol).font(.system(size: 16, weight: .medium)).frame(width: 22)
                        Text(action.title).type(.ui, .medium)
                        Spacer(minLength: 0)
                        if busy == action.title { ProgressView().controlSize(.mini) }
                    }
                    .foregroundStyle(action.tone)
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(busy != nil)
            }
            if let failed {
                Text(failed).type(.meta).foregroundStyle(Tone.alert).padding(.top, 2).padding(.bottom, 4)
            } else if let note {
                Text(note).type(.meta).foregroundStyle(Tone.ink3).padding(.top, 2).padding(.bottom, 4)
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .frame(maxWidth: 300, alignment: .leading)
        .background {
            ZStack {
                RoundedRectangle(cornerRadius: 19, style: .continuous).fill(Tone.bubbleThem)
                Tail().fill(Tone.bubbleThem).scaleEffect(x: -1, anchor: .center)
            }
        }
    }

    private var label: String {
        switch need.kind {
        case "permission": spoken("Permission for you")
        case "join": need.who == "human" ? spoken("A person wants to join") : spoken("An agent wants to join")
        default: need.changed == true ? spoken("Spec changed: approve again") : spoken("Spec ready for you")
        }
    }

    @ViewBuilder private var content: some View {
        switch need.kind {
        case "permission":
            Text(need.title ?? spoken("Use a tool")).type(.body).foregroundStyle(Tone.ink).padding(.bottom, 6)
            if let summary = need.summary, !summary.isEmpty {
                Text(summary).type(.ui).foregroundStyle(Tone.ink2).padding(.bottom, 6)
            }
            if let code = need.code, !code.isEmpty {
                Text(code)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(Tone.ink2)
                    .lineLimit(whole ? nil : 6)
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Tone.wash, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .onTapGesture { withAnimation(Motion.ease) { whole.toggle() } }
                    .padding(.bottom, 10)
            }
        case "join":
            Text(need.name ?? spoken("Someone")).type(.body, .semibold).foregroundStyle(Tone.ink).padding(.bottom, 2)
            let about = [need.runs, need.machine, need.sponsor.map { spoken("from \($0)'s computer") }].compactMap { $0 }.filter { !$0.isEmpty }
            if !about.isEmpty {
                Text(about.joined(separator: " · ")).type(.ui).foregroundStyle(Tone.ink2).padding(.bottom, 6)
            }
            if let code = need.code, !code.isEmpty {
                (Text("Code ").foregroundStyle(Tone.ink3) + Text(digits(code)).font(.system(.body, design: .monospaced)).foregroundStyle(Tone.ink))
                    .type(.ui)
                    .padding(.bottom, 10)
            } else {
                Spacer().frame(height: 4)
            }
        default:
            (Text("#\(need.ask ?? 0) ").foregroundStyle(Tone.ink3) + Text(need.title ?? "").foregroundStyle(Tone.ink))
                .type(.body)
                .padding(.bottom, 6)
            if let text = need.text, !text.isEmpty {
                Text(LocalizedStringKey(text))
                    .type(.ui)
                    .foregroundStyle(Tone.ink2)
                    .lineLimit(whole ? nil : 8)
                    .onTapGesture { withAnimation(Motion.ease) { whole.toggle() } }
                    .padding(.bottom, 10)
            }
        }
    }

    private var note: String? {
        switch need.kind {
        case "permission" where need.canAllow != true:
            need.allower.map { spoken("Only \(room.display($0)) can allow this one") } ?? spoken("You can deny this one")
        case "join" where need.pinned == true:
            spoken("Invited with a personality: let them in on your computer")
        case "join" where !(need.code ?? "").isEmpty:
            spoken("Let them in only if their screen shows the same code")
        default: nil
        }
    }

    private struct Action {
        let title: String
        let symbol: String
        let tone: Color
        let go: () async throws -> Void
    }

    private var actions: [Action] {
        let code = room.code
        switch need.kind {
        case "permission":
            var out: [Action] = []
            if need.canAllow == true {
                out.append(Action(title: spoken("Allow once"), symbol: "checkmark.circle", tone: Tone.ink) { try await model.allow(code, id: need.id, allow: true) })
            }
            out.append(Action(title: spoken("Deny"), symbol: "xmark.circle", tone: Tone.alert) { try await model.allow(code, id: need.id, allow: false) })
            return out
        case "join":
            guard need.pinned != true, room.isOwner else { return [] }
            return [Action(title: spoken("Let in"), symbol: "person.crop.circle.badge.checkmark", tone: Tone.ink) { try await model.letIn(code, id: need.id) }]
        default:
            guard let ask = need.ask, let v = need.v else { return [] }
            return [Action(title: spoken("Approve"), symbol: "checkmark.circle", tone: Tone.ink) { try await model.approveSpec(code, ask: ask, v: v) }]
        }
    }

    private func digits(_ code: String) -> String {
        code.count == 6 ? "\(code.prefix(3))-\(code.suffix(3))" : code
    }

    private func run(_ action: Action) {
        guard busy == nil else { return }
        busy = action.title
        failed = nil
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        Task {
            do {
                try await action.go()
                UINotificationFeedbackGenerator().notificationOccurred(.success)
            } catch {
                failed = error.localizedDescription
                UINotificationFeedbackGenerator().notificationOccurred(.error)
            }
            busy = nil
        }
    }
}
