import SwiftUI

struct TitlePill: View {
    let room: RoomView
    let spot: Spot
    let go: (Spot) -> Void
    let answer: (AskView) -> Void
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var still
    @State private var overview = false
    @State private var drag: CGFloat = 0
    @State private var armed = false

    private static let commit: CGFloat = 56

    private var neighbors: [RoomView] { model.channels }

    var body: some View {
        VStack(spacing: 1) {
            title
            if let status = room.status(of: spot.place) {
                line(status)
            }
        }
        .offset(x: still ? 0 : drag)
        .opacity(1 - min(abs(drag) / 160, 0.6))
        .simultaneousGesture(
            DragGesture(minimumDistance: 12)
                .onChanged { value in
                    guard abs(value.translation.width) > abs(value.translation.height) else { return }
                    drag = band(value.translation.width)
                    armed = several && abs(value.translation.width) > Self.commit
                }
                .onEnded { value in
                    let fling = value.predictedEndTranslation.width
                    let go = several && (armed || abs(fling) > Self.commit * 2.5)
                    armed = false
                    guard go else {
                        withAnimation(.spring(response: 0.32, dampingFraction: 0.82)) { drag = 0 }
                        return
                    }
                    swipe(fling < 0 ? 1 : -1)
                }
        )
        .sensoryFeedback(.selection, trigger: armed) { _, now in now }
        .sheet(isPresented: $overview) {
            Overview(room: room, spot: spot) { next in
                overview = false
                go(next)
            }
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
    }

    private var several: Bool { neighbors.count > 1 }

    private func band(_ x: CGFloat) -> CGFloat {
        let limit: CGFloat = several ? 120 : 28
        return limit * tanh(x / (limit * 1.6))
    }

    private var title: some View {
        Menu {
            jumps
        } label: {
            Text(room.spotTitle(spot.place))
                .font(.headline)
                .foregroundStyle(Tone.ink)
                .lineLimit(1)
                .frame(maxWidth: 240)
                .contentShape(Rectangle())
        } primaryAction: {
            overview = true
        }
        .accessibilityIdentifier("titlePill")
        .accessibilityHint(spoken("Shows who is working. Touch and hold to jump."))
    }

    @ViewBuilder private func line(_ status: String) -> some View {
        if let ask = room.asks(in: spot.place).first {
            Button {
                answer(ask)
            } label: {
                Text(status).font(.caption).foregroundStyle(Tone.decide).lineLimit(1)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("titleNeeds")
        } else {
            Text(status).font(.caption).foregroundStyle(Tone.ink3).lineLimit(1)
        }
    }

    @ViewBuilder private var jumps: some View {
        Section(room.title) {
            ForEach(Overview.places(room), id: \.self) { key in
                jump(Spot(code: room.code, place: key), room.spotTitle(key), Overview.symbol(room, key))
            }
        }
        let others = neighbors.filter { $0.code != room.code }
        if !others.isEmpty {
            Section("Channels") {
                ForEach(others, id: \.code) { other in
                    jump(Spot(code: other.code), other.title, "number")
                }
            }
        }
    }

    private func jump(_ to: Spot, _ title: String, _ symbol: String) -> some View {
        Button {
            go(to)
        } label: {
            Label(title, systemImage: to == spot ? "checkmark" : symbol)
        }
    }

    private func swipe(_ step: Int) {
        let list = neighbors
        guard list.count > 1, let at = list.firstIndex(where: { $0.code == room.code }) else { return }
        let next = Spot(code: list[(at + step + list.count) % list.count].code)
        guard !still else {
            withAnimation(.easeInOut(duration: 0.2)) {
                drag = 0
                go(next)
            }
            return
        }
        let away: CGFloat = step > 0 ? -160 : 160
        withAnimation(.easeIn(duration: 0.12)) {
            drag = away
        } completion: {
            go(next)
            drag = -away
            withAnimation(.spring(response: 0.34, dampingFraction: 0.86)) { drag = 0 }
        }
    }
}

struct Overview: View {
    let room: RoomView
    let spot: Spot
    let go: (Spot) -> Void
    @Environment(\.dismiss) private var dismiss

    static func places(_ room: RoomView) -> [String] {
        ["main"] + (room.sideKey.map { [$0] } ?? []) + room.places.filter { $0.kind == "room" }.map(\.key)
    }

    static func symbol(_ room: RoomView, _ key: String) -> String {
        key == "main" ? "number" : key == room.sideKey ? "person.fill" : "bubble.left.and.bubble.right"
    }

    private var working: [MemberView] {
        room.members.filter { $0.isAgent && $0.working }.sorted { ($0.lead ? 0 : 1, $0.display) < ($1.lead ? 0 : 1, $1.display) }
    }

    private var tasks: [TaskView] {
        room.tasks.filter { !$0.archived && ($0.state == "doing" || $0.state == "review") }
    }

    var body: some View {
        NavigationStack {
            List {
                Section("Working") {
                    if working.isEmpty {
                        Text("Nobody is working").foregroundStyle(Tone.ink3)
                    }
                    ForEach(working) { member in
                        HStack(spacing: 12) {
                            Face(name: member.name, member: member, size: 30)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(member.display).font(.body.weight(.semibold)).foregroundStyle(Tone.ink)
                                if let task = current(member) {
                                    Text("\(taskLabel(task.id)) \(task.title)").font(.subheadline).foregroundStyle(Tone.ink3).lineLimit(1)
                                }
                            }
                            Spacer(minLength: 8)
                            if let since = member.activity?.since {
                                Text(Date(timeIntervalSince1970: since / 1000), style: .timer)
                                    .font(.caption.monospacedDigit())
                                    .foregroundStyle(Tone.ink3)
                            }
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
                if !tasks.isEmpty {
                    Section("Tasks") {
                        ForEach(tasks) { task in
                            Button {
                                go(Spot(code: room.code, place: "task:\(task.id)"))
                            } label: {
                                HStack(spacing: 10) {
                                    Text(taskLabel(task.id)).font(.subheadline.monospacedDigit()).foregroundStyle(Tone.ink3)
                                    Text(task.title).foregroundStyle(Tone.ink).lineLimit(1)
                                    Spacer(minLength: 8)
                                    if task.state == "review" {
                                        Text("In review").font(.caption).foregroundStyle(Tone.decide)
                                    }
                                }
                            }
                        }
                    }
                }
                Section("Rooms") {
                    ForEach(Self.places(room), id: \.self) { key in
                        Button {
                            go(Spot(code: room.code, place: key))
                        } label: {
                            Label(room.spotTitle(key), systemImage: Self.symbol(room, key)).foregroundStyle(Tone.ink)
                        }
                    }
                }
            }
            .navigationTitle(room.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(spoken("Done")) { dismiss() }
                }
            }
        }
    }

    private func current(_ member: MemberView) -> TaskView? {
        room.tasks.filter { member.doing.contains($0.id) && $0.state == "doing" }.max { $0.updatedAt < $1.updatedAt }
    }
}
