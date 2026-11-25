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
    let waiting: Int
    let go: (StandTarget) -> Void

    private var catchingUp: Bool {
        guard let asked = stand.asked else { return false }
        return Date.now.timeIntervalSince1970 * 1000 - asked.at < 10 * 60_000
    }

    private var head: StandLine? {
        stand.report.flatMap { StandLine.split($0.shown).first }
    }

    private var lines: [StandLine] {
        if let report = stand.report { return Array(StandLine.split(report.shown).dropFirst()) }
        let rows: [(String, [Int])] = [(spoken("Now"), stand.now), (spoken("Next"), stand.next), (spoken("Done"), stand.done)]
        var out = rows.compactMap { label, ids -> String? in
            let named = ids.compactMap { id in room.tasks.first { $0.id == id } }.map { "\($0.title) (\(taskLabel($0.id)))" }
            return named.isEmpty ? nil : "**\(label):** \(named.joined(separator: ", "))"
        }
        if waiting > 0 { out.insert("**\(spoken("Needs you")):** \(spoken("\(waiting) waiting on you"))", at: min(1, out.count)) }
        return out.enumerated().map { StandLine(id: $0.offset, text: $0.element, target: StandLine.target(of: $0.element)) }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text("Where things stand")
                    .type(.ui, .medium)
                    .foregroundStyle(Tone.ink3)
                    .padding(.bottom, 14)
                if let head {
                    Button {
                        go(head.target)
                    } label: {
                        Text(plain(head.text))
                            .font(.system(.title2, weight: .semibold))
                            .foregroundStyle(Tone.ink)
                            .multilineTextAlignment(.leading)
                    }
                    .buttonStyle(.plain)
                } else if catchingUp {
                    Text("The lead is catching up…")
                        .font(.system(.title2, weight: .semibold))
                        .foregroundStyle(Tone.ink3)
                }
                VStack(alignment: .leading, spacing: 18) {
                    ForEach(lines) { line in
                        Button {
                            go(line.target)
                        } label: {
                            Prose(text: line.text, ink: Tone.ink2)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.top, head == nil && !catchingUp ? 0 : 28)
                if lines.isEmpty && head == nil && !catchingUp {
                    Text("Nothing going on here yet")
                        .font(.system(.title2, weight: .semibold))
                        .foregroundStyle(Tone.ink3)
                }
                footer.padding(.top, 36)
            }
            .padding(.horizontal, 28)
            .padding(.top, 64)
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

    private func plain(_ markdown: String) -> AttributedString {
        let options = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace, failurePolicy: .returnPartiallyParsedIfPossible)
        do {
            return try AttributedString(markdown: markdown, options: options)
        } catch {
            Trouble.note("markdown", error)
            return AttributedString(markdown)
        }
    }
}

struct Pinch: UIGestureRecognizerRepresentable {
    let changed: (CGFloat) -> Void
    let ended: (CGFloat) -> Void

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
        case .ended, .cancelled, .failed: ended(pinch.scale)
        default: break
        }
    }

    final class Alongside: NSObject, UIGestureRecognizerDelegate {
        func gestureRecognizer(_ recognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
            true
        }
    }
}
