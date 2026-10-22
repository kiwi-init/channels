import Foundation

struct Spot: Hashable, Codable, Sendable {
    let code: String
    var place = "main"

    var id: String { "\(code)|\(place)" }
}

enum RowKind: Sendable {
    case group, direct, along
}

enum Filter: String, CaseIterable, Sendable {
    case all, needs, unread, drafts, along

    var title: String {
        switch self {
        case .all: "Conversations"
        case .needs: "Needs You"
        case .unread: "Unread"
        case .drafts: "Drafts"
        case .along: "Read Along"
        }
    }

    var symbol: String {
        switch self {
        case .all: "bubble.left.and.bubble.right"
        case .needs: "hand.raised"
        case .unread: "envelope.badge"
        case .drafts: "pencil"
        case .along: "eyeglasses"
        }
    }
}

struct Feed {
    let messages: [MessageView]
    let whole: Bool
}

struct Row: Identifiable {
    let spot: Spot
    let kind: RowKind
    let room: RoomView
    let place: PlaceView?
    let title: String
    let qualifier: String?
    let unread: Bool
    let asks: [AskView]
    let draft: Draft?

    var id: String { spot.id }
    var last: MessageView? { place?.last }
    var lastAt: Double { last?.at ?? 0 }
    var other: String? { place.flatMap { room.other(in: $0) } }

    var working: Bool {
        switch kind {
        case .group: room.working > 0
        case .direct: other.flatMap { room.member($0) }?.working ?? false
        case .along: false
        }
    }

    var fullTitle: String {
        qualifier.map { "\(title) · \($0)" } ?? title
    }

    var line: String {
        if room.connection == .connecting && last == nil { return "Connecting…" }
        if let ask = asks.first { return "Needs you: \(ask.body.replacingOccurrences(of: "\n", with: " "))" }
        if let draft { return "Draft: \(draft.text.isEmpty ? "Photo" : draft.text.replacingOccurrences(of: "\n", with: " "))" }
        guard let last else { return "No messages yet" }
        let body = last.body.isEmpty && last.images > 0 ? (last.images == 1 ? "Photo" : "\(last.images) Photos") : last.body.replacingOccurrences(of: "\n", with: " ")
        if kind == .direct { return last.mine ? "You: \(body)" : body }
        return "\(last.mine ? "You" : room.display(last.from)): \(body)"
    }
}

extension RoomView {
    func showing(_ key: String, _ feed: Feed?) -> RoomView {
        RoomView(
            code: code, title: title, icon: icon, me: me, isOwner: isOwner, connection: connection, gone: gone, error: error, head: head,
            whole: feed?.whole ?? false, hold: hold, charter: charter, lead: lead, members: members, messages: feed?.messages ?? [], tasks: tasks,
            asks: asks, last: last, place: key, places: places)
    }

    func spotTitle(_ key: String) -> String {
        guard let place = placeView(key), key != "main" else { return title }
        if place.kind == "task", let id = place.task { return taskLabel(id) }
        if let other = other(in: place) { return display(other) }
        return place.title
    }
}

extension AppModel {
    func rows(_ filter: Filter = .all) -> [Row] {
        let live = channels
        let many = live.count > 1
        var out: [Row] = []
        for room in live {
            let main = room.placeView("main")
            out.append(
                Row(
                    spot: Spot(code: room.code), kind: .group, room: room, place: main, title: room.title, qualifier: nil,
                    unread: fresh(room, "main"), asks: room.asks, draft: drafts["\(room.code)|main"]))
            for place in room.places where place.kind == "dm" {
                let spot = Spot(code: room.code, place: place.key)
                let draft = drafts[spot.id]
                if let mark = hidden[spot.id], place.lastSeq <= mark, draft == nil { continue }
                if place.withMe {
                    guard place.last != nil || draft != nil else { continue }
                    let other = room.other(in: place) ?? place.title
                    out.append(
                        Row(
                            spot: spot, kind: .direct, room: room, place: place, title: room.display(other), qualifier: many ? room.title : nil,
                            unread: fresh(room, place.key), asks: [], draft: draft))
                } else {
                    out.append(
                        Row(
                            spot: spot, kind: .along, room: room, place: place, title: place.with.map { room.display($0) }.joined(separator: " & "),
                            qualifier: many ? room.title : nil, unread: false, asks: [], draft: nil))
                }
            }
        }
        let kept: [Row] =
            switch filter {
            case .all: out.filter { $0.kind != .along }
            case .needs: out.filter { !$0.asks.isEmpty }
            case .unread: out.filter { $0.unread }
            case .drafts: out.filter { $0.draft != nil }
            case .along: out.filter { $0.kind == .along }
            }
        return kept.sorted { ($0.lastAt, $0.title) > ($1.lastAt, $1.title) }
    }

    func row(_ spot: Spot) -> Row? {
        rows(.all).first { $0.spot == spot } ?? rows(.along).first { $0.spot == spot }
    }

    var waiting: Int { channels.reduce(0) { $0 + $1.asks.count } }

    func isPinned(_ spot: Spot) -> Bool { pinned.contains(spot.id) }

    func togglePin(_ spot: Spot) {
        if isPinned(spot) {
            pinned.removeAll { $0 == spot.id }
        } else {
            pinned.append(spot.id)
        }
        UserDefaults.standard.set(pinned, forKey: "pinned")
    }

    func pins() -> [Row] {
        let all = rows(.all) + rows(.along)
        return pinned.compactMap { id in all.first { $0.id == id } }
    }

    func unread(_ spot: Spot) -> Bool {
        guard let room = rooms[spot.code] else { return false }
        return fresh(room, spot.place)
    }

    func markRead(_ spot: Spot) {
        guard let room = rooms[spot.code], let top = room.placeView(spot.place)?.lastSeq else { return }
        if spot.place == "main" {
            seen[spot.code] = max(seen[spot.code] ?? 0, top)
            UserDefaults.standard.set(seen, forKey: "seen")
        } else {
            placeSeen[spot.id] = max(placeSeen[spot.id] ?? 0, top)
            UserDefaults.standard.set(placeSeen, forKey: "placeSeen")
        }
    }

    func markUnread(_ spot: Spot) {
        guard let room = rooms[spot.code], let last = room.placeView(spot.place)?.last, !last.mine else { return }
        if spot.place == "main" {
            seen[spot.code] = last.seq - 1
            UserDefaults.standard.set(seen, forKey: "seen")
        } else {
            placeSeen[spot.id] = last.seq - 1
            UserDefaults.standard.set(placeSeen, forKey: "placeSeen")
        }
    }

    func markAllRead() {
        for row in rows(.unread) { markRead(row.spot) }
    }

    func hide(_ spot: Spot) {
        guard let top = rooms[spot.code]?.placeView(spot.place)?.lastSeq else { return }
        hidden[spot.id] = top
        pinned.removeAll { $0 == spot.id }
        UserDefaults.standard.set(hidden, forKey: "hidden")
        UserDefaults.standard.set(pinned, forKey: "pinned")
    }

    func shown(_ spot: Spot) -> RoomView? {
        guard let room = rooms[spot.code] else { return nil }
        return room.place == spot.place ? room : room.showing(spot.place, feeds[spot.id])
    }

    func ready(_ spot: Spot) -> Bool {
        rooms[spot.code]?.place == spot.place || feeds[spot.id] != nil
    }

    func visit(_ spot: Spot) {
        visited.removeAll { $0 == spot }
        visited.insert(spot, at: 0)
        if visited.count > 12 { visited.removeLast() }
    }

    func open(_ spot: Spot) async {
        await open(spot.code, place: spot.place)
    }
}
