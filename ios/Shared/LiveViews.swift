import SwiftUI

struct LockScreen: View {
    let title: String
    let agents: [AgentsActivity.Agent]

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 6) {
                Text(title).font(.headline).lineLimit(1)
                Spacer(minLength: 8)
                if agents.isEmpty {
                    Text("Nobody is working").font(.subheadline).foregroundStyle(.secondary)
                } else {
                    Circle().fill(.green).frame(width: 7, height: 7)
                    Text("\(agents.count) working").font(.subheadline).foregroundStyle(.secondary)
                }
            }
            Rows(agents: Array(agents.prefix(3)))
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 20)
        .foregroundStyle(.white)
        .environment(\.colorScheme, .dark)
    }
}

struct Rows: View {
    let agents: [AgentsActivity.Agent]

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(agents, id: \.self) { agent in
                HStack(alignment: .top, spacing: 12) {
                    LiveFace(agent: agent, size: 30)
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text(agent.name).font(.subheadline.weight(.semibold)).lineLimit(1)
                            Spacer(minLength: 8)
                            if let since = agent.since {
                                Text(since, style: .timer)
                                    .font(.caption.monospacedDigit())
                                    .foregroundStyle(.secondary)
                                    .multilineTextAlignment(.trailing)
                                    .frame(width: 60, alignment: .trailing)
                            }
                        }
                        if let task = agent.task {
                            Text(task).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        }
                    }
                }
            }
        }
    }
}

struct Clock: View {
    let agents: [AgentsActivity.Agent]

    var body: some View {
        if agents.count > 1 {
            Text("\(agents.count)").foregroundStyle(.green)
        } else if let since = agents.first?.since {
            Text(since, style: .timer).multilineTextAlignment(.trailing).foregroundStyle(.green)
        }
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
        guard let rgb = agent?.color else { return .white }
        return Color(red: Double((rgb >> 16) & 0xff) / 255, green: Double((rgb >> 8) & 0xff) / 255, blue: Double(rgb & 0xff) / 255)
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
