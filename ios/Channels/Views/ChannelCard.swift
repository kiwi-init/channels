import SwiftUI

extension AppModel {
    var cardRoom: RoomView? {
        cardCode.flatMap { rooms[$0] }.flatMap { $0.gone == nil ? $0 : nil } ?? here
    }

    func cardSpot(_ room: RoomView) -> Spot {
        Spot(code: room.code, place: cardAim[room.code] ?? room.sideKey ?? "main")
    }

    func aimCard(_ room: RoomView, at place: String) {
        cardAim[room.code] = place
    }

    func turnCard(by step: Int) -> Bool {
        let order = channels.map(\.code)
        guard let at = order.firstIndex(of: cardRoom?.code ?? ""), order.indices.contains(at + step) else { return false }
        cardCode = order[at + step]
        return true
    }
}

struct ChannelCard: View {
    let close: () -> Void
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var still
    @State private var drag: CGFloat = 0
    @State private var from: Edge = .trailing

    var body: some View {
        ZStack {
            if let room = model.cardRoom {
                CardPage(room: room, close: close, turn: turn)
                    .id(room.code)
                    .transition(still ? .opacity : .push(from: from))
            }
        }
        .offset(x: drag)
        .clipShape(RoundedRectangle(cornerRadius: 30, style: .continuous))
        .simultaneousGesture(swipe)
        .onDisappear { model.cardCode = nil }
    }

    private var swipe: some Gesture {
        DragGesture(minimumDistance: 24)
            .onChanged { value in
                guard abs(value.translation.width) > abs(value.translation.height) else { return }
                drag = value.translation.width / 3
            }
            .onEnded { value in
                let wide = abs(value.translation.width) > abs(value.translation.height)
                let reach = value.predictedEndTranslation.width
                withAnimation(Bar.spring(still)) { drag = 0 }
                guard wide, abs(reach) > 80 else { return }
                turn(reach < 0 ? 1 : -1)
            }
    }

    private func turn(_ step: Int) {
        from = step > 0 ? .trailing : .leading
        withAnimation(Bar.spring(still)) {
            if model.turnCard(by: step) { Haptic.tap() }
        }
    }
}

private struct CardPage: View {
    let room: RoomView
    let close: () -> Void
    let turn: (Int) -> Void
    @Environment(AppModel.self) private var model

    private var aimed: Spot { model.cardSpot(room) }

    private var people: [MemberView] {
        let rank: (MemberView) -> Int = { $0.name == room.lead ? 0 : $0.working ? 1 : $0.isAgent ? 2 : 3 }
        return Array(
            othersOf(room.members, me: room.me).enumerated()
                .sorted { (rank($0.element), $0.offset) < (rank($1.element), $1.offset) }
                .map(\.element)
                .prefix(5))
    }

    private var said: String? {
        guard let lead = room.lead, let key = room.sideKey, let last = room.placeView(key)?.last, last.from == lead else { return nil }
        let words = last.plain.replacingOccurrences(of: "\n", with: " ").trimmingCharacters(in: .whitespaces)
        return words.isEmpty ? nil : words
    }

    private let general = "#general"
    private var count: Int { model.channels.count }
    private var index: Int { model.channels.firstIndex { $0.code == room.code } ?? 0 }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            header
            VStack(spacing: 2) {
                Aim(on: aimed.general, title: general, line: room.status(of: "main"), id: "aim-general") {
                    ZStack {
                        Circle().fill(Tone.accentWash)
                        Image(systemName: "number").font(.system(size: 11, weight: .bold)).foregroundStyle(Tone.accent)
                    }
                    .frame(width: 22, height: 22)
                } pick: {
                    pick("main")
                }
                ForEach(people) { member in
                    let key = member.name == room.lead ? (room.sideKey ?? room.dmKey(with: member.name)) : room.dmKey(with: member.name)
                    Aim(on: aimed.place == key, title: member.display, line: line(member), id: "aim-\(member.name)") {
                        Face(name: member.name, member: member, size: 22)
                    } pick: {
                        pick(key)
                    }
                }
            }
            .padding(.horizontal, -8)
            CardDock(room: room, spot: aimed, prompt: prompt, done: close)
                .padding(.horizontal, -12)
                .padding(.bottom, -6)
        }
        .padding(.horizontal, 16)
        .padding(.top, 14)
        .padding(.bottom, 8)
    }

    private var header: some View {
        Button {
            Haptic.tap()
            close()
        } label: {
            HStack(spacing: 10) {
                ChannelAvatar(room: room, size: 36)
                VStack(alignment: .leading, spacing: 1) {
                    Text(room.title).font(.system(size: 16, weight: .semibold)).foregroundStyle(Tone.ink).lineLimit(1)
                    if let line = room.status(of: "main") {
                        Text(line).type(.meta).foregroundStyle(Tone.ink3).lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
                if count > 1 {
                    HStack(spacing: 4) {
                        ForEach(0..<min(count, 6), id: \.self) { at in
                            Circle().fill(at == min(index, 5) ? Tone.accent : Tone.ink3.opacity(0.35)).frame(width: 5, height: 5)
                        }
                    }
                    .accessibilityHidden(true)
                }
                Image(systemName: "chevron.down").font(.system(size: 13, weight: .bold)).foregroundStyle(Tone.ink3)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("channel-card")
        .accessibilityLabel(room.title)
        .accessibilityValue(Text(verbatim: count > 1 ? "\(index + 1)/\(count)" : ""))
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: turn(1)
            case .decrement: turn(-1)
            @unknown default: break
            }
        }
    }

    private var prompt: String {
        if aimed.general { return spoken("Message \(general)") }
        if aimed.place == room.sideKey, let lead = room.lead { return spoken("Message \(room.display(lead))") }
        return room.dmWith(aimed.place).map { spoken("Message \(room.display($0))") } ?? spoken("Message")
    }

    private func line(_ member: MemberView) -> String? {
        if member.name == room.lead, let said { return said }
        if let task = member.doing.first {
            return "\(taskLabel(task)) \(room.tasks.first { $0.id == task }?.title ?? "")".trimmingCharacters(in: .whitespaces)
        }
        return nil
    }

    private func pick(_ key: String) {
        Haptic.tap()
        withAnimation(.snappy(duration: 0.2)) { model.aimCard(room, at: key) }
    }
}

private struct Aim<Mark: View>: View {
    let on: Bool
    let title: String
    let line: String?
    let id: String
    @ViewBuilder let mark: () -> Mark
    let pick: () -> Void

    var body: some View {
        Button(action: pick) {
            HStack(alignment: line == nil ? .center : .top, spacing: 8) {
                mark()
                VStack(alignment: .leading, spacing: 1) {
                    Text(title).type(.ui, .semibold).foregroundStyle(on ? Tone.accent : Tone.ink).lineLimit(1)
                    if let line {
                        Text(line).type(.meta).foregroundStyle(Tone.ink3).lineLimit(2)
                    }
                }
                Spacer(minLength: 0)
                if on {
                    Image(systemName: "checkmark").font(.system(size: 12, weight: .bold)).foregroundStyle(Tone.accent)
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(on ? Tone.accentWash : .clear, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(id)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

private struct CardDock: View {
    let room: RoomView
    let spot: Spot
    let prompt: String
    let done: () -> Void
    @Environment(AppModel.self) private var model
    @State private var replyTo: MessageView?
    @State private var answering: AskView?
    @State private var sendingBack: ReviewView?
    @FocusState private var typing: Bool

    var body: some View {
        Dock(room: room, spot: spot, replyTo: $replyTo, answering: $answering, sendingBack: $sendingBack, typing: $typing, prompt: prompt)
            .onChange(of: model.pending[spot.id]?.count ?? 0) { old, now in
                guard now > old else { return }
                typing = false
                done()
            }
    }
}
