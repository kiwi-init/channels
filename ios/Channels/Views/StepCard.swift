import SwiftUI

struct StepCard: View {
    let message: MessageView
    let step: StepView
    let room: RoomView
    let tail: Bool
    let other: () -> Void
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    @State private var sending: StepOutcome?
    @State private var failed = false
    @State private var reasonFor: StepOutcome?
    @State private var note = ""

    private var open: Bool { message.waiting && message.stepAnswer == nil }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(open ? spoken("A step for you") : spoken("Step"))
                .type(.meta, .semibold)
                .foregroundStyle(open ? Tone.decide : Tone.ink3)
            Markdown(text: message.shown)
            Text("Needs a person: \(step.needsPerson)").type(.meta).foregroundStyle(Tone.ink3)
            Text(verbatim: step.why).type(.ui).foregroundStyle(Tone.ink)
            ForEach(Array((step.todo ?? []).enumerated()), id: \.offset) { i, line in
                Text(verbatim: "\(i + 1). \(line)").type(.ui).foregroundStyle(Tone.ink)
            }
            ForEach(step.run ?? [], id: \.self) { command in
                Text(verbatim: command)
                    .font(.system(.footnote, design: .monospaced))
                    .foregroundStyle(Tone.ink)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 6)
                    .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Tone.wash2))
            }
            if let expected = step.expect {
                Text("Expected").type(.meta).foregroundStyle(Tone.ink3)
                Text(verbatim: expected).type(.ui).foregroundStyle(Tone.ink)
            }
            ForEach(step.links ?? [], id: \.self) { link in
                Button {
                    if let url = URL(string: link) { openURL(url) }
                } label: {
                    Text(verbatim: link).type(.meta).underline().foregroundStyle(Tone.accent).multilineTextAlignment(.leading)
                }
                .buttonStyle(.plain)
            }
            if open { actions }
            if let answer = message.stepAnswer {
                let who = answer.by == room.me ? spoken("You") : room.display(answer.by)
                Group {
                    if let outcome = answer.outcome {
                        Text("\(who) · \(words(outcome))")
                    } else {
                        Text("\(who) replied")
                    }
                }
                .type(.meta)
                .foregroundStyle(Tone.ink3)
            } else if failed {
                Text("Couldn't send · Try again").type(.meta).foregroundStyle(Tone.alert)
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .frame(maxWidth: 300, alignment: .leading)
        .background {
            ZStack {
                RoundedRectangle(cornerRadius: 19, style: .continuous).fill(Tone.bubbleThem)
                if tail {
                    Tail().fill(Tone.bubbleThem).scaleEffect(x: -1, anchor: .center)
                }
            }
        }
    }

    private var actions: some View {
        VStack(alignment: .leading, spacing: 8) {
            Rectangle().fill(Tone.line).frame(height: 0.5)
            TextField(text: $note, axis: .vertical) {
                switch reasonFor {
                case .cant: Text("Why can't you do it?")
                case .notNeeded: Text("Why isn't it needed?")
                default: Text("Output (optional)")
                }
            }
            .type(.ui)
            .accessibilityIdentifier("step-note")
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Tone.wash2))
            if let asking = reasonFor, asking != .done {
                HStack(spacing: 8) {
                    Button("Send") { send(asking) }
                        .buttonStyle(.borderedProminent)
                        .disabled(sending != nil || note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    Button("Cancel") { reasonFor = nil }
                        .buttonStyle(.bordered)
                        .disabled(sending != nil)
                }
            } else {
                HStack(spacing: 8) {
                    Button(words(.done)) { send(.done) }
                        .buttonStyle(.borderedProminent)
                        .disabled(sending != nil)
                    Button(words(.cant)) { reasonFor = .cant }
                        .buttonStyle(.bordered)
                        .disabled(sending != nil)
                    Button(words(.notNeeded)) { reasonFor = .notNeeded }
                        .buttonStyle(.bordered)
                        .disabled(sending != nil)
                }
                .controlSize(.small)
            }
            Button(action: other) {
                HStack(spacing: 10) {
                    Image(systemName: "arrowshape.turn.up.left").font(.system(size: 13, weight: .semibold)).frame(width: 22)
                    Text("Something else…").type(.ui, .medium)
                    Spacer(minLength: 0)
                }
                .foregroundStyle(Tone.accent)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
    }

    private func words(_ outcome: StepOutcome) -> String {
        switch outcome {
        case .done: spoken("Done")
        case .cant: spoken("Can't do it")
        case .notNeeded: spoken("Not needed")
        }
    }

    private func send(_ outcome: StepOutcome) {
        guard sending == nil else { return }
        sending = outcome
        failed = false
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        Task {
            do {
                try await model.answerStep(room.code, seq: message.seq, outcome: outcome, note: note)
                UINotificationFeedbackGenerator().notificationOccurred(.success)
            } catch {
                failed = true
                UINotificationFeedbackGenerator().notificationOccurred(.error)
            }
            sending = nil
        }
    }
}
