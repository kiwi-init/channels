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
            let shown = LiveShown(AgentsActivity(channel: room?.roomId ?? "", title: room?.title ?? "channels"), state)
            ZStack {
                Color.black.ignoresSafeArea()
                LockScreen(shown: shown)
                    .background(Color(white: 0.12), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
                    .padding(.horizontal, 12)
            }
        }
    }
#endif
