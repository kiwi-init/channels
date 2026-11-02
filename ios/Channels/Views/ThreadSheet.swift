import SwiftUI

struct ThreadSheet: View {
    let code: String
    let place: String
    let root: MessageView
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var sending = false
    @State private var failed: String?
    @State private var position = ScrollPosition(edge: .bottom)
    @FocusState private var typing: Bool

    private var room: RoomView? { model.rooms[code] }

    private var shown: ThreadView? {
        guard let thread = room?.thread, thread.root.seq == root.seq else { return nil }
        return thread
    }

    private var ready: Bool {
        !sending && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        NavigationStack {
            Group {
                if let room {
                    let solo = room.placeView(place).map { $0.kind == "dm" && $0.withMe } ?? false
                    ScrollView {
                        LazyVStack(spacing: 0) {
                            ForEach(Line.build([shown?.root ?? root] + (shown?.replies ?? []))) { line in
                                LineView(line: line, room: room, reveal: 0, solo: solo) { _ in
                                    typing = true
                                } jump: { seq in
                                    withAnimation(Motion.ease) { position.scrollTo(id: "b\(seq)", anchor: .center) }
                                } answer: { _ in
                                } sendBack: { _ in
                                }
                                .id(line.id)
                            }
                            Color.clear.frame(height: 6).id("bottom")
                        }
                        .scrollTargetLayout()
                        .padding(.horizontal, 12)
                    }
                    .scrollPosition($position)
                    .defaultScrollAnchor(.bottom)
                    .scrollDismissesKeyboard(.interactively)
                } else {
                    Centered(title: "This channel is gone", detail: "Its owner closed it, or this phone was removed from it.")
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Tone.canvas)
            .safeAreaInset(edge: .bottom, spacing: 0) { composer }
            .navigationTitle("Thread")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDragIndicator(.visible)
        .task { await model.openThread(code, seq: root.seq) }
        .onDisappear {
            Task { await model.openThread(code, seq: nil) }
        }
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let failed {
                Text(failed)
                    .type(.meta)
                    .foregroundStyle(Tone.alert)
                    .padding(.horizontal, 18)
            }
            HStack(alignment: .bottom, spacing: 8) {
                TextField("Reply in thread", text: $text, axis: .vertical)
                    .type(.body)
                    .lineLimit(1...6)
                    .focused($typing)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 9)
                    .background(Tone.wash2, in: RoundedRectangle(cornerRadius: 19, style: .continuous))
                Button(action: send) {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 32))
                        .foregroundStyle(ready ? Tone.accent : Tone.ink3)
                }
                .buttonStyle(.plain)
                .disabled(!ready)
                .accessibilityLabel("Send")
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
        .background(Tone.canvas)
    }

    private func send() {
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty, !sending else { return }
        sending = true
        failed = nil
        text = ""
        Task {
            do {
                _ = try await model.send(Spot(code: code, place: place), body, re: root.seq, side: true)
                withAnimation(Motion.ease) { position.scrollTo(edge: .bottom) }
            } catch {
                text = body
                failed = "Not delivered: \(error.localizedDescription)"
            }
            sending = false
        }
    }
}
