import Foundation
import UIKit

struct Spot: Hashable, Codable, Sendable {
    let code: String
    var place = "main"

    var id: String { "\(code)|\(place)" }
    var general: Bool { place == "main" }
}

enum RowKind: Sendable {
    case group, lead
}

enum Filter: String, CaseIterable, Sendable {
    case all, needs, unread

    var title: String {
        switch self {
        case .all: "Conversations"
        case .needs: "Needs You"
        case .unread: "Unread"
        }
    }

    var symbol: String {
        switch self {
        case .all: "bubble.left.and.bubble.right"
        case .needs: "hand.raised"
        case .unread: "envelope.badge"
        }
    }
}

struct Pending: Identifiable, Equatable {
    let id: UUID
    let body: String
    let re: Int?
    let at: Date
    var seq: Int?
    var failed = false
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
    let reviews: [ReviewView]
    let draft: Draft?

    var id: String { spot.id }
    var last: MessageView? { kind == .group ? room.latest ?? place?.last : place?.last }
    var lastAt: Double { last?.at ?? 0 }
    var needs: Int { asks.count + reviews.count }

    var need: String? {
        let words = asks.first?.plain ?? reviews.first.map { "\(taskLabel($0.task)) \($0.title)" }
        return words?.replacingOccurrences(of: "\n", with: " ")
    }

    private var origin: String {
        guard kind == .group, room.latest != nil else { return "" }
        if room.latestIn.hasPrefix("task:"), let task = Int(room.latestIn.dropFirst(5)) { return " in \(taskLabel(task))" }
        return room.latestIn.hasPrefix("dm:") ? " in a direct thread" : ""
    }
    var lead: String? { kind == .lead ? room.lead : nil }

    var working: Bool {
        switch kind {
        case .group: room.working > 0
        case .lead: lead.flatMap { room.member($0) }?.working ?? false
        }
    }

    var fullTitle: String {
        qualifier.map { "\(title) · \($0)" } ?? title
    }

    var line: String {
        if room.connection == .connecting && last == nil { return "Connecting…" }
        if let need { return "Needs you: \(need)" }
        if let draft { return "Draft: \(draft.text.isEmpty ? "Photo" : draft.text.replacingOccurrences(of: "\n", with: " "))" }
        guard let last else { return kind == .lead ? "Message \(title) directly" : "No messages yet" }
        let body = last.body.isEmpty && last.images > 0 ? (last.images == 1 ? "Photo" : "\(last.images) Photos") : last.plain.replacingOccurrences(of: "\n", with: " ")
        if kind == .lead { return last.mine ? "You: \(body)" : body }
        return "\(last.mine ? "You" : room.display(last.from))\(origin): \(body)"
    }
}

extension RoomView {
    var leadSpot: Spot? { sideKey.map { Spot(code: code, place: $0) } }

    func other(than spot: Spot) -> Spot? {
        spot.general ? leadSpot : Spot(code: code)
    }

    func asks(in key: String) -> [AskView] {
        key == sideKey ? asks.filter { $0.place == key } : asks.filter { $0.place != sideKey }
    }

    func elsewhere() -> [AskView] {
        asks.filter { $0.place != "main" && $0.place != sideKey }
    }

    func showing(_ key: String, _ feed: Feed?) -> RoomView {
        RoomView(
            code: code, title: title, icon: icon, me: me, isOwner: isOwner, connection: connection, gone: gone, error: error, head: head,
            whole: feed?.whole ?? false, hold: hold, charter: charter, lead: lead, members: members, messages: feed?.messages ?? [], side: side,
            sideKey: sideKey, tasks: tasks, asks: asks, reviews: reviews, last: last, latest: latest, latestIn: latestIn, place: key, places: places)
    }

    func spotTitle(_ key: String) -> String {
        guard key != "main", let lead else { return title }
        return display(lead)
    }
}

extension AppModel {
    func rows(_ filter: Filter = .all) -> [Row] {
        let live = channels
        let many = live.count > 1
        var out: [Row] = []
        for room in live {
            let general = Spot(code: room.code)
            out.append(
                Row(
                    spot: general, kind: .group, room: room, place: room.placeView("main"), title: room.title, qualifier: nil,
                    unread: fresh(room, "main"), asks: room.asks(in: "main"), reviews: room.reviews, draft: drafts[general.id]))
            if let spot = room.leadSpot, let lead = room.lead {
                out.append(
                    Row(
                        spot: spot, kind: .lead, room: room, place: room.placeView(spot.place), title: room.display(lead), qualifier: many ? room.title : nil,
                        unread: fresh(room, spot.place), asks: room.asks(in: spot.place), reviews: [], draft: drafts[spot.id]))
            }
        }
        let kept: [Row] =
            switch filter {
            case .all: out
            case .needs: out.filter { $0.needs > 0 }
            case .unread: out.filter { $0.unread }
            }
        return kept.sorted { ($0.lastAt, $0.title) > ($1.lastAt, $1.title) }
    }

    func row(_ spot: Spot) -> Row? {
        rows(.all).first { $0.spot == spot }
    }

    var waiting: Int { channels.reduce(0) { $0 + $1.asks.count + $1.reviews.count } }

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
        let all = rows(.all)
        return pinned.compactMap { id in all.first { $0.id == id } }
    }

    func unread(_ spot: Spot) -> Bool {
        guard let room = rooms[spot.code] else { return false }
        return fresh(room, spot.place)
    }

    func markRead(_ spot: Spot) {
        guard let room = rooms[spot.code], let top = room.placeView(spot.place)?.lastSeq else { return }
        if spot.general {
            guard top > (seen[spot.code] ?? 0) else { return }
            seen[spot.code] = top
            UserDefaults.standard.set(seen, forKey: "seen")
        } else {
            guard top > (placeSeen[spot.id] ?? 0) else { return }
            placeSeen[spot.id] = top
            UserDefaults.standard.set(placeSeen, forKey: "placeSeen")
        }
    }

    func markUnread(_ spot: Spot) {
        guard let room = rooms[spot.code], let last = room.placeView(spot.place)?.last, !last.mine else { return }
        if spot.general {
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

    func shown(_ spot: Spot) -> RoomView? {
        guard let room = rooms[spot.code] else { return nil }
        if spot.place == room.sideKey { return room.showing(spot.place, Feed(messages: room.side ?? [], whole: room.whole)) }
        return room.place == "main" ? room : room.showing("main", feeds[spot.id])
    }

    func visit(_ spot: Spot) {
        visited.removeAll { $0 == spot }
        visited.insert(spot, at: 0)
        if visited.count > 12 { visited.removeLast() }
    }

    func post(_ spot: Spot, _ body: String, re: Int?) {
        let item = Pending(id: UUID(), body: body, re: re, at: .now)
        pending[spot.id, default: []].append(item)
        deliver(item, spot)
    }

    func retry(_ item: Pending, _ spot: Spot) {
        guard let at = pending[spot.id]?.firstIndex(where: { $0.id == item.id }) else { return }
        pending[spot.id]?[at].failed = false
        deliver(item, spot)
    }

    func drop(_ item: Pending, _ spot: Spot) {
        pending[spot.id]?.removeAll { $0.id == item.id }
    }

    private func deliver(_ item: Pending, _ spot: Spot) {
        Task {
            do {
                let seq = try await send(spot, item.body, re: item.re)
                sentAs[seq] = item.id
                if let at = pending[spot.id]?.firstIndex(where: { $0.id == item.id }) { pending[spot.id]?[at].seq = seq }
                settle(spot.code)
            } catch {
                if let at = pending[spot.id]?.firstIndex(where: { $0.id == item.id }) { pending[spot.id]?[at].failed = true }
                UINotificationFeedbackGenerator().notificationOccurred(.error)
            }
        }
    }

    func settle(_ code: String) {
        guard let room = rooms[code] else { return }
        let have = Set(room.messages.map(\.seq) + (room.side ?? []).map(\.seq))
        for key in ["main"] + (room.sideKey.map { [$0] } ?? []) {
            let id = "\(code)|\(key)"
            guard let list = pending[id], !list.isEmpty else { continue }
            pending[id] = list.filter { item in item.seq.map { !have.contains($0) } ?? true }
        }
    }
}
