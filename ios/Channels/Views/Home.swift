import SwiftUI
import UIKit

struct HomeAction: Identifiable {
    let title: String
    let primary: Bool
    let run: () async throws -> Void

    var id: String { title }
}

struct HomeNeed: Identifiable {
    let id: String
    let code: String
    let room: RoomView
    let spot: Spot
    let at: Double
    let asker: String?
    let what: String
    let detail: String?
    let actions: [HomeAction]
}

extension AppModel {
    var homeNeeds: [HomeNeed] {
        channels.flatMap { needs(in: $0) }.sorted { $0.at < $1.at }
    }

    private func needs(in room: RoomView) -> [HomeNeed] {
        let code = room.code
        let main = Spot(code: code)
        let open = room.open.map { need -> HomeNeed in
            switch need.kind {
            case "permission":
                let allow: [HomeAction] =
                    need.canAllow == true
                    ? [
                        HomeAction(title: "Allow once", primary: true) { try await self.allow(code, id: need.id, allow: true) },
                        HomeAction(title: "Deny", primary: false) { try await self.allow(code, id: need.id, allow: false) },
                    ] : []
                return HomeNeed(
                    id: "\(code)|\(need.id)", code: code, room: room, spot: main, at: need.at, asker: need.from,
                    what: need.title ?? "Wants to use a tool", detail: [need.summary, need.code].compactMap { $0 }.joined(separator: "\n"),
                    actions: allow)
            case "join":
                return HomeNeed(
                    id: "\(code)|\(need.id)", code: code, room: room, spot: main, at: need.at, asker: nil,
                    what: "\(need.name ?? "Someone") wants to join", detail: need.runs,
                    actions: [HomeAction(title: "Let in", primary: true) { try await self.letIn(code, id: need.id) }])
            default:
                let approve: [HomeAction] =
                    need.ask.flatMap { ask in
                        need.v.map { v in [HomeAction(title: "Approve", primary: true) { try await self.approveSpec(code, ask: ask, v: v) }] }
                    } ?? []
                return HomeNeed(
                    id: "\(code)|\(need.id)", code: code, room: room, spot: main, at: need.at, asker: need.by,
                    what: need.changed == true ? "Spec #\(need.ask ?? 0) changed" : "Approve spec #\(need.ask ?? 0)",
                    detail: need.title, actions: approve)
            }
        }
        let asks = room.asks.map { ask in
            HomeNeed(
                id: "\(code)|ask\(ask.seq)", code: code, room: room, spot: Spot(code: code, place: ask.place ?? "main"), at: ask.at,
                asker: ask.from, what: ask.label, detail: ask.plain,
                actions: ask.choices.count <= 4
                    ? ask.choices.map { choice in
                        HomeAction(title: choice, primary: false) { try await self.answer(code, seq: ask.seq, text: choice) }
                    } : [])
        }
        let reviews = room.reviews.map { review in
            HomeNeed(
                id: "\(code)|review\(review.task)", code: code, room: room, spot: main, at: review.at, asker: review.by,
                what: "Review \(taskLabel(review.task))", detail: review.title,
                actions: [HomeAction(title: "Approve", primary: true) { try await self.approve(code, task: review.task) }])
        }
        return open + asks + reviews
    }
}

extension RoomView {
    var moving: TaskView? {
        tasks.filter { $0.state == "doing" && !$0.archived }.max { $0.updatedAt < $1.updatedAt }
    }

    var movingLine: String? {
        guard let task = moving else { return nil }
        let tool = task.owner.flatMap { member($0) }?.activity.flatMap { $0.state == "working" ? $0.tool : nil }
        return [task.owner.map { display($0) }, "\(taskLabel(task.id)) \(task.title)", tool].compactMap { $0 }.joined(separator: " · ")
    }
}

struct HomeNeedCard: View {
    let need: HomeNeed
    let open: (Spot) -> Void
    @State private var busy: String?

    private var head: String {
        [need.asker.map { need.room.display($0) }, need.room.title].compactMap { $0 }.joined(separator: " · ")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                open(need.spot)
            } label: {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        if let asker = need.asker {
                            Face(name: asker, member: need.room.member(asker), size: 22)
                        }
                        Text(head).type(.meta).foregroundStyle(Tone.ink3).lineLimit(1)
                        Spacer(minLength: 8)
                        Text(When.list(Date(timeIntervalSince1970: need.at / 1000))).type(.meta).foregroundStyle(Tone.ink3)
                    }
                    Text(need.what).type(.ui, .semibold).foregroundStyle(Tone.ink).lineLimit(2)
                    if let detail = need.detail, !detail.isEmpty {
                        Text(detail)
                            .type(.ui)
                            .foregroundStyle(Tone.ink2)
                            .lineLimit(3)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if !need.actions.isEmpty {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 8) { buttons }
                    VStack(alignment: .leading, spacing: 8) { buttons }
                }
                .padding(.top, 2)
            }
        }
        .padding(14)
        .background(Tone.raised, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Radius.card, style: .continuous).strokeBorder(Tone.line, lineWidth: 0.5))
    }

    @ViewBuilder private var buttons: some View {
        ForEach(need.actions) { action in
            Button {
                run(action)
            } label: {
                HStack(spacing: 6) {
                    if busy == action.title { ProgressView().controlSize(.mini) }
                    Text(action.title).type(.ui, .semibold).lineLimit(1)
                }
                .foregroundStyle(action.primary ? Tone.onInk : Tone.ink)
                .padding(.horizontal, 14)
                .frame(height: 34)
                .background(action.primary ? Tone.accent : Tone.wash2, in: Capsule())
            }
            .buttonStyle(.plain)
            .disabled(busy != nil)
        }
    }

    private func run(_ action: HomeAction) {
        Haptic.tap()
        busy = action.title
        Task {
            do {
                try await action.run()
                UINotificationFeedbackGenerator().notificationOccurred(.success)
            } catch {
                UINotificationFeedbackGenerator().notificationOccurred(.error)
            }
            busy = nil
        }
    }
}
