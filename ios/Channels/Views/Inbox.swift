import SwiftUI

struct Waiting: Identifiable {
    let room: RoomView
    let ask: AskView

    var id: String { "\(room.code)/\(ask.seq)" }
}

struct Inbox: View {
    let open: (String, String) -> Void
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    private var waiting: [Waiting] {
        model.channels.flatMap { room in room.asks.map { Waiting(room: room, ask: $0) } }.sorted { $0.ask.at > $1.ask.at }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(spacing: 14) {
                    if waiting.isEmpty {
                        VStack(spacing: 8) {
                            Image(systemName: "checkmark.circle").font(.system(size: 34)).foregroundStyle(Tone.live)
                            Text("Nothing waits on you").type(.title).foregroundStyle(Tone.ink)
                            Text("When an agent asks you something, it lands here, from every channel.").type(.ui).foregroundStyle(Tone.ink3).multilineTextAlignment(.center)
                        }
                        .padding(.top, 60)
                        .padding(.horizontal, 32)
                    }
                    ForEach(waiting) { w in
                        AskCard(room: w.room, ask: w.ask) {
                            dismiss()
                            open(w.room.code, w.ask.task.map { "task:\($0)" } ?? "main")
                        }
                        .transition(.asymmetric(insertion: .opacity, removal: .move(edge: .trailing).combined(with: .opacity)))
                    }
                }
                .padding(16)
                .animation(.snappy, value: waiting.map(\.id))
            }
            .background(Tone.canvas)
            .navigationTitle("Needs you")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}

struct AskCard: View {
    let room: RoomView
    let ask: AskView
    let open: () -> Void
    @Environment(AppModel.self) private var model
    @State private var sending: String?
    @State private var writing = false
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Face(name: ask.from, member: room.member(ask.from), size: 26)
                (Text(room.display(ask.from)).fontWeight(.semibold) + Text(" in \(room.title)"))
                    .type(.meta)
                    .foregroundStyle(Tone.ink2)
                    .lineLimit(1)
                Spacer()
                Text(When.short(ask.date)).type(.meta).foregroundStyle(Tone.ink3)
            }
            Text(ask.label).type(.meta, .semibold).foregroundStyle(Tone.decide)
            Prose(text: ask.body)
            VStack(spacing: 8) {
                ForEach(ask.choices, id: \.self) { choice in
                    Button {
                        answer(choice)
                    } label: {
                        HStack {
                            Text(choice).type(.body, .medium).foregroundStyle(Tone.ink).multilineTextAlignment(.leading)
                            Spacer(minLength: 0)
                            if sending == choice { ProgressView().controlSize(.small) }
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 13)
                        .frame(maxWidth: .infinity)
                        .glass(16)
                    }
                    .buttonStyle(.plain)
                    .disabled(sending != nil)
                }
                if writing {
                    HStack(spacing: 8) {
                        TextField("Your answer", text: $text, axis: .vertical)
                            .type(.body)
                            .focused($focused)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 11)
                            .glass(16)
                        Button {
                            answer(text)
                        } label: {
                            Image(systemName: "arrow.up").font(.system(size: 15, weight: .bold)).foregroundStyle(.white).frame(width: 40, height: 40).background(
                                Tone.accent, in: Circle())
                        }
                        .buttonStyle(.plain)
                        .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || sending != nil)
                        .accessibilityLabel("Send answer")
                    }
                }
                HStack(spacing: 8) {
                    if !writing {
                        Button {
                            writing = true
                            focused = true
                        } label: {
                            Text(ask.choices.isEmpty ? "Answer" : "Something else").type(.ui, .medium).foregroundStyle(Tone.accent).frame(maxWidth: .infinity).padding(
                                .vertical, 11
                            ).glass(14)
                        }
                        .buttonStyle(.plain)
                    }
                    Button(action: open) {
                        Text("Open").type(.ui, .medium).foregroundStyle(Tone.ink2).frame(maxWidth: .infinity).padding(.vertical, 11).glass(14)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(16)
        .background(Tone.wash, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private func answer(_ words: String) {
        let said = words.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !said.isEmpty else { return }
        sending = said
        Haptic.tap()
        Task {
            try? await model.answer(room.code, seq: ask.seq, text: said)
            sending = nil
            writing = false
            text = ""
        }
    }
}
