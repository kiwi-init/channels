import SwiftUI

#if DEBUG
    struct LivePreview: View {
        @Environment(AppModel.self) private var model

        private static let sample = [
            AgentsActivity.Agent(name: "lead", face: "lead", color: 0x4a8df0, task: "T50 iPhone: Live Activity on the Dynamic Island", since: .now - 754),
            AgentsActivity.Agent(name: "builder-one", face: "builder", color: 0x3fbf74, task: "T52 Relay: Live Activity pushes", since: .now - 95),
        ]

        var body: some View {
            let room = model.rooms.values.first { !LiveAgents.agents($0).isEmpty }
            let state = room.map(LiveAgents.state) ?? AgentsActivity.ContentState(agents: Self.sample, needs: 1, line: "Got it: the island shows the channel, not each agent")
            let key = room?.roomId ?? "sample"
            let marks = room.map { [key: LiveAgents.mark($0)] } ?? [:]
            let shown = LiveShown(AgentsActivity(channel: key, title: room?.title ?? "channels"), state, marks: marks)
            ZStack {
                Color(white: 0.9).ignoresSafeArea()
                VStack(spacing: 28) {
                    HStack {
                        ChannelMark(shown: shown, size: 22)
                        Spacer()
                        Counts(shown: shown).font(.caption.monospacedDigit())
                    }
                    .padding(.horizontal, 14)
                    .frame(width: 250, height: 37)
                    .background(.black, in: Capsule())
                    VStack(spacing: 8) {
                        HStack {
                            ChannelMark(shown: shown, size: 40)
                            Spacer()
                            Text(shown.title).font(.headline).lineLimit(1)
                            Spacer()
                            Counts(shown: shown).font(.headline.monospacedDigit())
                        }
                        VStack(alignment: .leading, spacing: 6) {
                            Status(count: shown.count, needs: shown.needs).font(.subheadline).foregroundStyle(.secondary)
                            if let line = shown.line {
                                Text(line).font(.subheadline).lineLimit(2)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(18)
                    .foregroundStyle(.white)
                    .environment(\.colorScheme, .dark)
                    .background(.black, in: RoundedRectangle(cornerRadius: 44, style: .continuous))
                    .padding(.horizontal, 10)
                    LockScreen(shown: shown)
                        .background(Color(white: 0.12), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
                        .padding(.horizontal, 12)
                }
            }
        }
    }
#endif
