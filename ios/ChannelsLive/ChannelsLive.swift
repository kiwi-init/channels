import ActivityKit
import SwiftUI
import WidgetKit

@main
struct ChannelsLive: WidgetBundle {
    var body: some Widget {
        AgentsLive()
    }
}

struct AgentsLive: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: AgentsActivity.self) { context in
            LockScreen(title: context.attributes.title, agents: context.state.agents)
                .activityBackgroundTint(.black)
                .activitySystemActionForegroundColor(.white)
                .widgetURL(context.attributes.link)
        } dynamicIsland: { context in
            let agents = context.state.agents
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    LiveFace(agent: agents.first, size: 40, dot: !agents.isEmpty)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Clock(agents: agents).font(.headline.monospacedDigit())
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.attributes.title).font(.headline).lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Rows(agents: Array(agents.prefix(2)))
                }
            } compactLeading: {
                LiveFace(agent: agents.first, size: 22, dot: !agents.isEmpty)
            } compactTrailing: {
                Clock(agents: agents).font(.caption.monospacedDigit()).frame(maxWidth: 44)
            } minimal: {
                LiveFace(agent: agents.first, size: 22, dot: !agents.isEmpty)
            }
            .widgetURL(context.attributes.link)
            .keylineTint(.green)
        }
    }
}
