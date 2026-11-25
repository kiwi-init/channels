import SwiftUI
import UIKit

enum StandTarget: Equatable {
    case chat(Int?)
    case task(Int)
}

struct StandLine: Identifiable {
    let id: Int
    let text: String
    let target: StandTarget
}

struct StandPage: View {
    let room: RoomView
    let stand: StandView
    let waiting: Int
    let go: (StandTarget) -> Void

    private var catchingUp: Bool {
        guard let asked = stand.asked else { return false }
        return Date.now.timeIntervalSince1970 * 1000 - asked.at < 10 * 60_000
    }

    private var reported: [StandLine] {
        (stand.report?.lines ?? []).enumerated().map { index, line in
            StandLine(id: index, text: line.text, target: line.task.map { .task($0) } ?? .chat(line.seq))
        }
    }

    private var head: StandLine? { reported.first }

    private var lines: [StandLine] {
        if stand.report != nil { return Array(reported.dropFirst()) }
        let rows: [(String, [Int])] = [(spoken("Now"), stand.now), (spoken("Next"), stand.next), (spoken("Done"), stand.done)]
        var out: [(String, StandTarget)] = rows.compactMap { label, ids in
            let tasks = ids.compactMap { id in room.tasks.first { $0.id == id } }
            guard let first = tasks.first else { return nil }
            return ("\(label): \(tasks.map { "\($0.title) \(taskLabel($0.id))" }.joined(separator: ", "))", .task(first.id))
        }
        if waiting > 0 { out.insert(("\(spoken("Needs you")): \(spoken("\(waiting) waiting on you"))", .chat(nil)), at: min(1, out.count)) }
        return out.enumerated().map { StandLine(id: $0.offset, text: $0.element.0, target: $0.element.1) }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text("Where things stand")
                    .type(.ui, .medium)
                    .foregroundStyle(Tone.ink3)
                    .padding(.bottom, 12)
                if let head {
                    Button {
                        go(head.target)
                    } label: {
                        Text(quiet(head.text, label: false))
                            .font(.system(.title2, weight: .semibold))
                            .foregroundStyle(Tone.ink)
                            .multilineTextAlignment(.leading)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                } else if catchingUp {
                    Text("The lead is catching up…")
                        .font(.system(.title2, weight: .semibold))
                        .foregroundStyle(Tone.ink3)
                } else if lines.isEmpty {
                    Text("Nothing going on here yet")
                        .font(.system(.title2, weight: .semibold))
                        .foregroundStyle(Tone.ink3)
                }
                VStack(alignment: .leading, spacing: 16) {
                    ForEach(lines) { line in
                        Button {
                            go(line.target)
                        } label: {
                            Text(quiet(line.text, label: true))
                                .type(.body)
                                .foregroundStyle(Tone.ink2)
                                .multilineTextAlignment(.leading)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.top, 24)
                footer.padding(.top, 32)
            }
            .padding(.horizontal, 28)
            .padding(.top, 56)
            .padding(.bottom, 40)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .scrollBounceBehavior(.basedOnSize)
        .background(Tone.canvas)
    }

    @ViewBuilder private var footer: some View {
        HStack(spacing: 6) {
            if let report = stand.report {
                Text(spoken("From the lead · \(When.short(Date(timeIntervalSince1970: report.at / 1000)))"))
                if catchingUp { ProgressView().controlSize(.mini) }
            } else if stand.lead == nil {
                Text("From the board")
            }
        }
        .type(.meta)
        .foregroundStyle(Tone.ink3)
    }

    private func quiet(_ text: String, label: Bool) -> AttributedString {
        var out = AttributedString(text)
        if label, let colon = text.firstIndex(of: ":"), text.distance(from: text.startIndex, to: colon) <= 16 {
            let end = out.index(out.startIndex, offsetByCharacters: text.distance(from: text.startIndex, to: colon) + 1)
            out[out.startIndex..<end].foregroundColor = Tone.ink
        }
        for match in text.matches(of: #/\bT\d+\b/#) {
            let start = out.index(out.startIndex, offsetByCharacters: text.distance(from: text.startIndex, to: match.range.lowerBound))
            let end = out.index(start, offsetByCharacters: text.distance(from: match.range.lowerBound, to: match.range.upperBound))
            out[start..<end].underlineStyle = Text.LineStyle(pattern: .solid, color: Tone.ink3)
        }
        return out
    }
}

struct Pinch: UIGestureRecognizerRepresentable {
    let changed: (CGFloat) -> Void
    let ended: (CGFloat, CGFloat) -> Void

    func makeCoordinator(converter: CoordinateSpaceConverter) -> Alongside {
        Alongside()
    }

    func makeUIGestureRecognizer(context: Context) -> UIPinchGestureRecognizer {
        let pinch = UIPinchGestureRecognizer()
        pinch.delegate = context.coordinator
        return pinch
    }

    func handleUIGestureRecognizerAction(_ pinch: UIPinchGestureRecognizer, context: Context) {
        switch pinch.state {
        case .began, .changed: changed(pinch.scale)
        case .ended, .cancelled, .failed: ended(pinch.scale, pinch.velocity)
        default: break
        }
    }

    final class Alongside: NSObject, UIGestureRecognizerDelegate {
        func gestureRecognizer(_ recognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
            true
        }
    }
}
