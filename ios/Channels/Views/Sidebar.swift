import SwiftUI

struct RouteScreen: View {
    let route: Route

    var body: some View {
        switch route {
        case .place(let spot): ConversationScreen(start: spot)
        case .tasks(let code): TasksScreen(code: code)
        }
    }
}

struct ChannelSection: View {
    let room: RoomView
    @Environment(AppModel.self) private var model

    private var directs: [MemberView] {
        let others = room.people.filter { !room.isMe($0.name) && $0.kind != "computer" }
        let last = { (m: MemberView) in room.placeView(room.dmKey(with: m.name))?.last?.at ?? 0 }
        return others.sorted { a, b in
            if a.lead != b.lead { return a.lead }
            if a.working != b.working { return a.working }
            if last(a) != last(b) { return last(a) > last(b) }
            return a.display < b.display
        }
    }

    private var open: Int { room.tasks.filter { $0.state != "done" && !$0.archived }.count }

    var body: some View {
        Group {
            let main = Spot(code: room.code)
            Button {
                model.open(.place(main))
            } label: {
                PlaceLabel(title: "general", detail: line(room.placeView("main")?.last ?? room.last), unread: model.unread(main)) {
                    Image(systemName: "number").foregroundStyle(Tone.ink2)
                }
            }
            .sideRow(on: model.showing == .place(main))
            .swipeActions(edge: .leading) { readToggle(main) }
            .contextMenu { readToggle(main) }
            Button {
                model.open(.tasks(room.code))
            } label: {
                PlaceLabel(title: "Tasks", detail: open > 0 ? "\(open) open" : nil, unread: false) {
                    Image(systemName: "checklist").foregroundStyle(Tone.ink2)
                }
            }
            .sideRow(on: model.showing == .tasks(room.code))
            if !directs.isEmpty {
                SideHeading(title: "Direct")
            }
            ForEach(directs) { member in
                let spot = Spot(code: room.code, place: room.dmKey(with: member.name))
                Button {
                    model.open(.place(spot))
                } label: {
                    PlaceLabel(title: member.display, detail: status(member, spot), unread: model.unread(spot)) {
                        Face(name: member.name, member: member, size: 28)
                    }
                }
                .sideRow(on: model.showing == .place(spot))
                .swipeActions(edge: .leading) { readToggle(spot) }
                .contextMenu { readToggle(spot) }
            }
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder private func readToggle(_ spot: Spot) -> some View {
        let unread = model.unread(spot)
        if unread || model.canMarkUnread(spot) {
            Button {
                withAnimation(Motion.ease) {
                    if unread { model.markRead(spot) } else { model.markUnread(spot) }
                }
            } label: {
                Label(unread ? "Read" : "Unread", systemImage: unread ? "envelope.open" : "envelope.badge")
            }
            .tint(Tone.accent)
        }
    }

    private func status(_ member: MemberView, _ spot: Spot) -> String? {
        if member.isAgent && member.working {
            if let id = member.doing.first, let task = room.tasks.first(where: { $0.id == id }) { return "\(taskLabel(task.id)) \(task.title)" }
            return member.activity?.tool ?? "Working"
        }
        if let last = room.placeView(spot.place)?.last { return line(last) }
        if member.lead { return "Lead" }
        return member.isAgent ? (member.here ? "Idle" : "Offline") : (member.here ? "Online" : "Away")
    }

    private func line(_ last: MessageView?) -> String? {
        guard let last else { return nil }
        let body = last.body.isEmpty && last.images > 0 ? "Photo" : last.plain.replacingOccurrences(of: "\n", with: " ")
        return "\(last.mine ? "You" : room.display(last.from)): \(body)"
    }
}

struct SideHeading: View {
    let title: String

    var body: some View {
        Text(title)
            .font(.caption.weight(.semibold))
            .foregroundStyle(Tone.ink3)
            .textCase(.uppercase)
            .padding(.top, 14)
            .listRowInsets(EdgeInsets(top: 0, leading: 18, bottom: 2, trailing: 18))
            .listRowSeparator(.hidden)
            .listRowBackground(Color.clear)
            .accessibilityAddTraits(.isHeader)
    }
}

extension View {
    func sideRow(on: Bool) -> some View {
        self
            .listRowInsets(EdgeInsets(top: 6, leading: 18, bottom: 6, trailing: 18))
            .listRowSeparator(.hidden)
            .listRowBackground(
                RoundedRectangle(cornerRadius: Radius.ctl, style: .continuous)
                    .fill(on ? Tone.wash2 : Color.clear)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 1)
            )
            .accessibilityAddTraits(on ? .isSelected : [])
    }
}

struct PlaceLabel<Icon: View>: View {
    let title: String
    let detail: String?
    let unread: Bool
    @ViewBuilder let icon: () -> Icon

    var body: some View {
        HStack(spacing: 12) {
            icon().frame(width: 28, height: 28)
            VStack(alignment: .leading, spacing: 1) {
                Text(title).fontWeight(unread ? .semibold : .regular).foregroundStyle(Tone.ink).lineLimit(1)
                if let detail {
                    Text(detail).font(.subheadline).foregroundStyle(Tone.ink3).lineLimit(1)
                }
            }
            Spacer(minLength: 0)
            if unread {
                Circle().fill(Tone.accent).frame(width: 9, height: 9).accessibilityLabel("Unread")
            }
        }
    }
}
