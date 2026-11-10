import SwiftUI

struct UpdatesButton: View {
    let room: RoomView
    @State private var open = false

    var body: some View {
        Button {
            open = true
        } label: {
            Image(systemName: "waveform.path.ecg")
        }
        .accessibilityLabel(spoken("Updates"))
        .accessibilityIdentifier("updates")
        .sheet(isPresented: $open) {
            UpdatesSheet(room: room)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
    }
}

struct UpdatesDay: Identifiable {
    let day: Date
    var list: [MessageView]
    var id: Date { day }

    static func of(_ messages: [MessageView]) -> [UpdatesDay] {
        var out: [UpdatesDay] = []
        for m in messages.reversed() where m.event {
            if let last = out.last, Calendar.current.isDate(last.day, inSameDayAs: m.date) {
                out[out.count - 1].list.append(m)
            } else {
                out.append(UpdatesDay(day: m.date, list: [m]))
            }
        }
        return out
    }
}

struct UpdatesSheet: View {
    let room: RoomView
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                ForEach(UpdatesDay.of(room.messages)) { group in
                    Section(When.dayWord(group.day)) {
                        ForEach(group.list, id: \.seq) { m in
                            HStack(alignment: .firstTextBaseline, spacing: 12) {
                                Text("\(room.display(m.from)) \(m.body)")
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                Text(When.clock(m.date))
                                    .type(.meta)
                                    .foregroundStyle(Tone.ink3)
                            }
                        }
                    }
                }
            }
            .navigationTitle(spoken("Updates"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(spoken("Done")) { dismiss() }
                }
            }
        }
    }
}
