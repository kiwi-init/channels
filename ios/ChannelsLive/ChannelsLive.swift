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
            LockScreen(shown: LiveShown(context.attributes, context.state))
                .activityBackgroundTint(.black)
                .activitySystemActionForegroundColor(.white)
                .widgetURL(context.attributes.link)
        } dynamicIsland: { context in
            let shown = LiveShown(context.attributes, context.state)
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    ChannelMark(shown: shown, size: 40).padding(.leading, 6)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Counts(shown: shown).font(.headline.monospacedDigit()).padding(.trailing, 6)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(shown.title).font(.headline).lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 6) {
                        Status(count: shown.count, needs: shown.needs).font(.subheadline).foregroundStyle(.secondary)
                        if let line = shown.line {
                            Text(line).font(.subheadline).lineLimit(2)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 6)
                    .padding(.top, 8)
                    .padding(.bottom, 4)
                }
            } compactLeading: {
                ChannelMark(shown: shown, size: 22)
            } compactTrailing: {
                Counts(shown: shown).font(.caption.monospacedDigit())
            } minimal: {
                ChannelMark(shown: shown, size: 22)
            }
            .widgetURL(context.attributes.link)
            .keylineTint(.green)
        }
    }
}
