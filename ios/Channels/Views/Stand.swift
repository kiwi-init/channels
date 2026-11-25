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
            .animation(.smooth(duration: 0.35), value: stand.report?.seq)
            .animation(.smooth(duration: 0.35), value: catchingUp)
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

@Observable @MainActor
final class ZoomState {
    static let travel: CGFloat = 0.55
    static let snap: CGFloat = 0.45

    private(set) var live: CGFloat?
    private(set) var zoomed = false
    private(set) var pinching = false
    private(set) var ticks = 0
    private var ticked = false

    var depth: CGFloat { live ?? (zoomed ? 1 : 0) }
    var active: Bool { pinching || zoomed }

    func move(_ scale: CGFloat) {
        if !pinching {
            pinching = true
            ticked = false
        }
        let size = zoomed ? (1 - Self.travel) * scale : scale
        let depth = min(1, max(0, (1 - size) / Self.travel))
        let past = zoomed ? depth < Self.snap : depth > Self.snap
        if past && !ticked {
            ticked = true
            ticks += 1
        }
        live = depth
    }

    func release(_ velocity: CGFloat, still: Bool) {
        let reached = depth
        let open = velocity < -0.8 ? true : velocity > 0.8 ? false : reached > Self.snap
        let rate = -velocity * (zoomed ? 1 - Self.travel : 1) / Self.travel
        let gap = (open ? 1 : 0) - reached
        if open != zoomed && !ticked { ticks += 1 }
        let spring = Animation.interpolatingSpring(Spring(duration: 0.42, bounce: 0.12), initialVelocity: abs(gap) > 0.01 ? max(-8, min(8, rate / gap)) : 0)
        withAnimation(still ? .easeInOut(duration: 0.25) : spring) {
            zoomed = open
            live = nil
            pinching = false
        }
    }

    func set(_ open: Bool, still: Bool) {
        guard open != zoomed else { return }
        ticks += 1
        withAnimation(still ? .easeInOut(duration: 0.25) : .spring(duration: 0.42, bounce: 0.12)) {
            zoomed = open
            live = nil
            pinching = false
        }
    }
}

struct ZoomOut: ViewModifier {
    let zoom: ZoomState
    @Environment(\.accessibilityReduceMotion) private var still

    func body(content: Content) -> some View {
        let depth = zoom.depth
        content
            .overlay { Tone.canvas.opacity(fade(depth, from: 0.45, to: 0.95)).allowsHitTesting(false) }
            .clipShape(RoundedRectangle(cornerRadius: still ? 0 : 44 * depth, style: .continuous))
            .scaleEffect(still ? 1 : 1 - ZoomState.travel * depth)
            .scrollDisabled(zoom.active)
            .sensoryFeedback(.impact(weight: .light), trigger: zoom.ticks)
    }
}

struct ZoomIn: ViewModifier {
    let zoom: ZoomState
    @Environment(\.accessibilityReduceMotion) private var still

    func body(content: Content) -> some View {
        let depth = zoom.depth
        content
            .opacity(fade(depth, from: 0.35, to: 0.9))
            .offset(y: still ? 0 : 24 * (1 - depth))
    }
}

struct ZoomAway: ViewModifier {
    let zoom: ZoomState

    func body(content: Content) -> some View {
        content.opacity(1 - fade(zoom.depth, from: 0, to: 0.4))
    }
}

private func fade(_ depth: CGFloat, from: CGFloat, to: CGFloat) -> CGFloat {
    min(1, max(0, (depth - from) / (to - from)))
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
