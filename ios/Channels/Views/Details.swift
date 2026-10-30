import SwiftUI

struct ChannelDetails: View {
    let room: RoomView
    let current: String
    let choose: (String) -> Void
    @Environment(AppModel.self) private var model
    @State private var newAgent = false

    private var crew: [MemberView] {
        let lead = room.members.filter { $0.lead }
        let rest = room.members.filter { !$0.lead && $0.name != room.me }.sorted { ($0.working ? 0 : 1, $0.display) < ($1.working ? 0 : 1, $1.display) }
        let me = room.members.filter { $0.name == room.me && !$0.lead }
        return lead + rest + me
    }

    private var spot: Spot { Spot(code: room.code, place: current) }
    private var pinned: Bool { model.isPinned(spot) }

    private var summary: String {
        let count = "\(room.members.count) \(room.members.count == 1 ? "person" : "people")"
        return room.working > 0 ? "\(count) · \(room.working) working" : count
    }

    var body: some View {
        List {
            Section {
                header
            }
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: 8, leading: 0, bottom: 6, trailing: 0))
            if !room.asks.isEmpty {
                Section {
                    ForEach(room.asks) { ask in NeedsYouRow(ask: ask, room: room) }
                } header: {
                    Text("Needs you").foregroundStyle(Tone.decide)
                }
            }
            Section("Crew") {
                ForEach(crew) { person($0) }
            }
            if room.hold != nil || room.charter != nil {
                Section("About") {
                    if let hold = room.hold {
                        Text(hold.isEmpty ? "On hold" : "On hold: \(hold)").type(.ui).foregroundStyle(Tone.decide)
                    }
                    if let charter = room.charter {
                        Text(charter).type(.ui).foregroundStyle(Tone.ink2).lineLimit(8)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .sheet(isPresented: $newAgent) {
            NewAgentSheet(room: room)
        }
    }

    private var header: some View {
        VStack(spacing: 4) {
            ChannelAvatar(room: room, size: 96).padding(.bottom, 8)
            Text(room.title).font(.title2.weight(.bold)).foregroundStyle(Tone.ink).multilineTextAlignment(.center)
            Text(summary).type(.ui).foregroundStyle(Tone.ink3)
            HStack(spacing: 10) {
                if let other = room.other(than: spot) {
                    Button {
                        choose(other.place)
                    } label: {
                        Action(symbol: other.general ? "number" : "bubble.left.fill", title: other.general ? "# general" : room.spotTitle(other.place))
                    }
                }
                Button {
                    Haptic.tap()
                    withAnimation(Motion.ease) { model.togglePin(spot) }
                } label: {
                    Action(symbol: pinned ? "pin.slash.fill" : "pin.fill", title: pinned ? "Unpin" : "Pin")
                }
                if room.isOwner {
                    Button {
                        Haptic.tap()
                        newAgent = true
                    } label: {
                        Action(symbol: "plus", title: "New Agent")
                    }
                }
            }
            .buttonStyle(.plain)
            .padding(.top, 16)
        }
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder private func person(_ m: MemberView) -> some View {
        let row = HStack(spacing: 12) {
            Face(name: m.name, member: m, size: 36)
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 6) {
                    Text(m.display).type(.body).foregroundStyle(Tone.ink).lineLimit(1)
                    if m.name == room.me { Text("you").type(.meta).foregroundStyle(Tone.ink3) }
                }
                Text(status(m)).type(.meta).foregroundStyle(m.working ? Tone.doing : Tone.ink3).lineLimit(1)
            }
            Spacer(minLength: 0)
            if m.lead && m.name != room.me {
                Image(systemName: "bubble.left").font(.system(size: 15)).foregroundStyle(Tone.accent)
            }
        }
        if m.lead && m.name != room.me, let key = room.sideKey {
            Button {
                choose(key)
            } label: {
                row
            }
            .tint(Tone.ink)
        } else {
            row
        }
    }

    private func status(_ m: MemberView) -> String {
        let what = m.lead ? "Lead" : m.owner ? "Owner" : m.isAgent ? "Agent" : "Person"
        let now: String
        if m.working {
            let task = m.doing.first.flatMap { id in room.tasks.first { $0.id == id } }
            now = task.map { "working on \(taskLabel($0.id)) \($0.title)" } ?? "working"
        } else {
            now = m.here ? "here" : "away"
        }
        return "\(what) · \(now)"
    }
}

struct Action: View {
    let symbol: String
    let title: String

    var body: some View {
        VStack(spacing: 5) {
            Image(systemName: symbol).font(.system(size: 18, weight: .medium))
            Text(title).type(.meta, .medium).lineLimit(1)
        }
        .foregroundStyle(Tone.accent)
        .frame(maxWidth: .infinity, minHeight: 60)
        .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

struct NeedsYouRow: View {
    let ask: AskView
    let room: RoomView
    @Environment(AppModel.self) private var model
    @State private var sending: String?
    @State private var replying = false
    @State private var text = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Face(name: ask.from, member: room.member(ask.from), size: 24)
                Text([room.display(ask.from), ask.task.map(taskLabel), When.short(ask.date)].compactMap { $0 }.joined(separator: " · "))
                    .type(.meta)
                    .foregroundStyle(Tone.ink3)
                Spacer(minLength: 0)
                Text(ask.label).type(.meta, .semibold).foregroundStyle(Tone.decide)
            }
            Markdown(text: ask.shown)
            VStack(alignment: .leading, spacing: 6) {
                ForEach(ask.choices, id: \.self) { choice in
                    answer(choice)
                }
                if replying {
                    HStack(spacing: 8) {
                        TextField("Your answer", text: $text, axis: .vertical)
                            .type(.body)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 9)
                            .background(Tone.wash2, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        Button {
                            submit(text)
                        } label: {
                            Image(systemName: "arrow.up").font(.system(size: 15, weight: .bold)).foregroundStyle(.white).frame(width: 34, height: 34).background(
                                Tone.accent, in: Circle())
                        }
                        .disabled(text.trimmingCharacters(in: .whitespaces).isEmpty || sending != nil)
                        .accessibilityLabel("Send answer")
                    }
                } else {
                    Button {
                        replying = true
                    } label: {
                        Text(ask.choices.isEmpty ? "Answer" : "Something else").type(.ui, .medium).foregroundStyle(Tone.accent).padding(.vertical, 6)
                    }
                }
            }
            .buttonStyle(.plain)
            .padding(.top, 2)
        }
        .padding(.vertical, 4)
    }

    private func answer(_ choice: String) -> some View {
        Button {
            submit(choice)
        } label: {
            HStack {
                Text(choice).type(.ui, .medium).foregroundStyle(Tone.ink).multilineTextAlignment(.leading)
                Spacer(minLength: 0)
                if sending == choice { ProgressView().controlSize(.small) }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(Tone.wash2, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .contentShape(Rectangle())
        }
        .disabled(sending != nil)
    }

    private func submit(_ words: String) {
        let said = words.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !said.isEmpty else { return }
        sending = said
        Haptic.tap()
        Task {
            try? await model.answer(room.code, seq: ask.seq, text: said)
            sending = nil
            text = ""
            replying = false
        }
    }
}
