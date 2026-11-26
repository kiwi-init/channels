import ActivityKit
import SwiftUI
import WidgetKit

@main
struct ChannelsLive: WidgetBundle {
    var body: some Widget {
        AgentsLive()
    }
}

struct Shown {
    let agents: [AgentsActivity.Agent]
    let count: Int
    let title: String

    init(_ attributes: AgentsActivity, _ state: AgentsActivity.ContentState) {
        let sealed = state.sealed ?? []
        guard state.agents.isEmpty, !sealed.isEmpty else {
            agents = state.agents
            count = state.agents.count
            title = attributes.title
            return
        }
        let opened = LiveOpen.open(sealed, room: attributes.channel)
        agents = opened.agents
        count = max(opened.agents.count, sealed.count)
        title = attributes.title.isEmpty ? (opened.title ?? "Channels") : attributes.title
    }
}

struct AgentsLive: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: AgentsActivity.self) { context in
            let shown = Shown(context.attributes, context.state)
            LockScreen(title: shown.title, agents: shown.agents, count: shown.count)
                .activityBackgroundTint(.black)
                .activitySystemActionForegroundColor(.white)
                .widgetURL(context.attributes.link)
        } dynamicIsland: { context in
            let shown = Shown(context.attributes, context.state)
            let agents = shown.agents
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    LiveFace(agent: agents.first, size: 40, dot: shown.count > 0).padding(.leading, 6)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Clock(agents: agents, count: shown.count).font(.headline.monospacedDigit()).padding(.trailing, 6)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(shown.title).font(.headline).lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Rows(agents: Array(agents.prefix(2))).padding(.horizontal, 6).padding(.top, 8).padding(.bottom, 4)
                }
            } compactLeading: {
                LiveFace(agent: agents.first, size: 22, dot: shown.count > 0)
            } compactTrailing: {
                Clock(agents: agents, count: shown.count).font(.caption.monospacedDigit()).frame(maxWidth: 44)
            } minimal: {
                LiveFace(agent: agents.first, size: 22, dot: shown.count > 0)
            }
            .widgetURL(context.attributes.link)
            .keylineTint(.green)
        }
    }
}
