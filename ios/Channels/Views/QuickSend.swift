import AudioToolbox
import SwiftUI

struct QuickSend: View {
    @Environment(AppModel.self) private var model
    @State private var text = ""
    @FocusState private var typing: Bool

    private var target: (spot: Spot, lead: String, room: RoomView)? {
        for room in model.channels {
            if let spot = room.leadSpot, let lead = room.lead { return (spot, lead, room) }
        }
        return nil
    }

    var body: some View {
        if let target {
            let ready = target.room.connection == .live && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            HStack(alignment: .bottom, spacing: 8) {
                Face(name: target.lead, member: target.room.member(target.lead), size: 36)
                    .padding(.bottom, 4)
                HStack(alignment: .bottom, spacing: 6) {
                    TextField(placeholder(target), text: $text, axis: .vertical)
                        .type(.body)
                        .foregroundStyle(Tone.ink)
                        .lineLimit(1...4)
                        .focused($typing)
                        .padding(.leading, 15)
                        .padding(.vertical, 11)
                    if ready {
                        Button {
                            send(target.spot)
                        } label: {
                            Image(systemName: "arrow.up")
                                .font(.system(size: 15, weight: .bold))
                                .foregroundStyle(.white)
                                .frame(width: 32, height: 32)
                                .background(Tone.accent, in: Circle())
                                .padding(6)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .transition(.scale.combined(with: .opacity))
                        .accessibilityLabel("Send")
                    }
                }
                .frame(minHeight: 44)
                .glass(22)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .animation(.snappy(duration: 0.2), value: ready)
        }
    }

    private func placeholder(_ target: (spot: Spot, lead: String, room: RoomView)) -> String {
        let name = target.room.display(target.lead)
        return model.channels.count > 1 ? String(localized: "Message \(name) · \(target.room.title)") : String(localized: "Message \(name)")
    }

    private func send(_ spot: Spot) {
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty else { return }
        model.post(spot, body, re: nil)
        text = ""
        typing = false
        Haptic.tap()
        AudioServicesPlaySystemSound(1004)
        model.go(.place(spot))
    }
}
