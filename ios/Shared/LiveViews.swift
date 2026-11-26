import SwiftUI
import UIKit

struct LiveShown {
    let agents: [AgentsActivity.Agent]
    let count: Int
    let title: String
    let needs: Int
    let line: String?
    let mark: LiveOpen.Mark?

    var lead: AgentsActivity.Agent? { agents.first { $0.face == "lead" } ?? agents.first }

    init(_ attributes: AgentsActivity, _ state: AgentsActivity.ContentState, marks: [String: LiveOpen.Mark] = LiveOpen.marks()) {
        mark = marks[attributes.channel]
        let sealed = state.sealed ?? []
        guard state.agents.isEmpty, !sealed.isEmpty else {
            agents = state.agents
            count = state.agents.count
            title = attributes.title
            needs = state.needs ?? 0
            line = state.line
            return
        }
        let opened = LiveOpen.open(sealed, room: attributes.channel)
        agents = opened.agents
        count = max(opened.agents.count, sealed.count)
        title = attributes.title.isEmpty ? (opened.title ?? "Channels") : attributes.title
        needs = opened.needs ?? state.needs ?? 0
        line = opened.line ?? state.line
    }
}

struct LockScreen: View {
    let shown: LiveShown

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            ChannelMark(shown: shown, size: 44)
            VStack(alignment: .leading, spacing: 4) {
                Text(shown.title).font(.headline).lineLimit(1)
                Status(count: shown.count, needs: shown.needs).font(.subheadline).foregroundStyle(.secondary)
                if let line = shown.line {
                    Text(line).font(.subheadline).lineLimit(2).padding(.top, 4)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 20)
        .foregroundStyle(.white)
        .environment(\.colorScheme, .dark)
    }
}

struct Status: View {
    let count: Int
    let needs: Int

    var body: some View {
        HStack(spacing: 6) {
            if count == 0 {
                Text("Nobody is working")
            } else {
                Circle().fill(.green).frame(width: 7, height: 7)
                Text("\(count) working")
            }
            if needs > 0 {
                Text(verbatim: "·")
                Circle().fill(.orange).frame(width: 7, height: 7)
                Text("\(needs) needs you")
            }
        }
        .lineLimit(1)
    }
}

struct Counts: View {
    let shown: LiveShown

    var body: some View {
        HStack(spacing: 4) {
            Text(shown.count, format: .number).foregroundStyle(.green)
            if shown.needs > 0 {
                Circle().fill(.orange).frame(width: 6, height: 6)
            }
        }
    }
}

struct ChannelMark: View {
    let shown: LiveShown
    let size: CGFloat

    var body: some View {
        if let data = shown.mark?.picture, let image = UIImage(data: data) {
            Image(uiImage: image).resizable().scaledToFill().frame(width: size, height: size).clipShape(Circle())
        } else if let mark = shown.mark {
            let tint = Color(rgb: mark.rgb)
            Text(verbatim: mark.letter)
                .font(.system(size: size * 0.42, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: size, height: size)
                .background(tint.opacity(0.22), in: Circle())
        } else {
            LiveFace(agent: shown.lead, size: size)
        }
    }
}

extension Color {
    init(rgb: UInt32) {
        self.init(red: Double((rgb >> 16) & 0xff) / 255, green: Double((rgb >> 8) & 0xff) / 255, blue: Double(rgb & 0xff) / 255)
    }
}

struct LiveFace: View {
    let agent: AgentsActivity.Agent?
    let size: CGFloat
    var dot = false

    private var role: String {
        agent.map(\.face).flatMap { Faces.eyes[$0] == nil ? nil : $0 } ?? "default"
    }

    private var tint: Color {
        agent?.color.map { Color(rgb: $0) } ?? .white
    }

    var body: some View {
        let eyes = Faces.eyes[role] ?? Faces.fallback
        let unit = size / 100
        ZStack(alignment: .topLeading) {
            Image("face-\(role)")
                .resizable()
                .renderingMode(.template)
                .foregroundStyle(tint)
                .frame(width: size, height: size)
            ForEach([-1.0, 1.0], id: \.self) { side in
                Ellipse()
                    .fill(Color.black)
                    .frame(width: 8.6 * eyes.scale * unit, height: 10.6 * eyes.scale * unit)
                    .position(x: (eyes.x + side * eyes.spacing / 2) * unit, y: eyes.y * unit)
            }
        }
        .frame(width: size, height: size)
        .overlay(alignment: .topTrailing) {
            if dot {
                Circle()
                    .fill(.green)
                    .frame(width: max(6, size * 0.3), height: max(6, size * 0.3))
                    .overlay(Circle().stroke(Color.black, lineWidth: 1.5))
            }
        }
    }
}
