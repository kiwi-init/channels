import SwiftUI

enum StandTarget: Equatable {
    case chat(Int?)
    case task(Int)
}

struct StandLine: Identifiable {
    let id: Int
    let text: String
    let target: StandTarget

    static func split(_ shown: String) -> [StandLine] {
        shown.split(separator: "\n", omittingEmptySubsequences: true)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .enumerated()
            .map { index, line in
                let text = line.replacing(#/^[-*+]\s+/#, with: "")
                return StandLine(id: index, text: text, target: target(of: text))
            }
    }

    static func target(of text: String) -> StandTarget {
        if let task = text.firstMatch(of: #/\bT(\d+)\b/#).flatMap({ Int($0.1) }) { return .task(task) }
        if let seq = text.firstMatch(of: #/(?:^|\s|\()#(\d+)\b/#).flatMap({ Int($0.1) }) { return .chat(seq) }
        return .chat(nil)
    }
}

struct StandPage: View {
    let room: RoomView
    let stand: StandView
    let needs: [NeedView]
    let asks: [AskView]
    let reviews: [ReviewView]
    let go: (StandTarget) -> Void
    var answer: (AskView) -> Void = { _ in }
    var sendBack: (ReviewView) -> Void = { _ in }

    private var catchingUp: Bool {
        guard let asked = stand.asked else { return false }
        return Date.now.timeIntervalSince1970 * 1000 - asked.at < 10 * 60_000
    }

    private var waitsOnYou: Bool { !needs.isEmpty || !asks.isEmpty || !reviews.isEmpty }

    private var board: Bool { stand.report == nil && !(stand.now.isEmpty && stand.next.isEmpty && stand.done.isEmpty) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                header
                if let report = stand.report {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(StandLine.split(report.shown)) { line in
                            Button {
                                go(line.target)
                            } label: {
                                Prose(text: line.text, step: line.id == 0 ? .title : .body, weight: line.id == 0 ? .semibold : .regular)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(.vertical, 9)
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            if line.id == 0 { Rectangle().fill(Tone.line).frame(height: 0.5).padding(.vertical, 4) }
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .background(Tone.raised, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
                }
                if waitsOnYou {
                    heading("Needs you")
                    ForEach(asks, id: \.seq) { ask in AskLine(ask: ask, room: room) { answer(ask) } }
                    ForEach(reviews, id: \.task) { review in ReviewLine(review: review, room: room) { sendBack(review) } }
                    ForEach(needs, id: \.id) { need in NeedLine(need: need, room: room) }
                }
                if board {
                    tasks("Working on now", stand.now)
                    tasks("Next", stand.next)
                    tasks("Done", stand.done)
                }
                if stand.report == nil && !waitsOnYou && !board && !catchingUp {
                    Text("Nothing going on here yet")
                        .type(.ui)
                        .foregroundStyle(Tone.ink3)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 60)
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
        }
        .background(Tone.canvas)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(stand.label).type(.display, .bold).foregroundStyle(Tone.ink).lineLimit(1)
            HStack(spacing: 6) {
                if catchingUp {
                    ProgressView().controlSize(.mini)
                    Text("The lead is catching up…")
                } else if let report = stand.report {
                    Text(spoken("From the lead · \(When.short(Date(timeIntervalSince1970: report.at / 1000)))"))
                } else if stand.lead == nil {
                    Text("From the board")
                }
            }
            .type(.ui)
            .foregroundStyle(Tone.ink3)
        }
        .padding(.top, 8)
        .padding(.bottom, 16)
    }

    private func heading(_ title: LocalizedStringKey) -> some View {
        Text(title)
            .type(.ui, .semibold)
            .foregroundStyle(Tone.ink2)
            .padding(.top, 24)
            .padding(.bottom, 2)
    }

    @ViewBuilder private func tasks(_ title: LocalizedStringKey, _ ids: [Int]) -> some View {
        let rows = ids.compactMap { id in room.tasks.first { $0.id == id } }
        if !rows.isEmpty {
            heading(title)
            ForEach(rows, id: \.id) { task in
                Button {
                    go(.task(task.id))
                } label: {
                    TaskRow(task: task, room: room).padding(.vertical, 8)
                }
                .buttonStyle(.plain)
            }
        }
    }
}
