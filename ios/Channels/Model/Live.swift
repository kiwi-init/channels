import ActivityKit
import Foundation
import UIKit

typealias AgentsLiveActivity = ActivityKit.Activity<AgentsActivity>

struct LiveKeys: Decodable, Sendable {
    let room: String
    let keys: [String]
}

struct LiveTokenResult: Decodable, Sendable {
    let room: String
    let ok: Bool
    let error: String?
}

@MainActor
final class LiveAgents {
    struct Token: Sendable {
        var start: String? = nil
        var update: String? = nil
        var room: String? = nil
    }

    static let offKey = "liveOff"
    static var off: Bool { UserDefaults.standard.bool(forKey: offKey) }
    private static let grace: Duration = .seconds(30)
    private static let stale: TimeInterval = 180
    private var ending: [String: Task<Void, Never>] = [:]
    private var watching = false
    private var watched: Set<String> = []
    private var marked: [String: LiveOpen.Mark] = [:]
    private static var thumbs: [String: (key: String, data: Data)] = [:]
    private(set) var startToken: String?
    var told: ((Token) -> Void)?

    static func agents(_ room: RoomView) -> [AgentsActivity.Agent] {
        let order = { (m: MemberView) in (m.name == room.lead ? 0 : 1, m.display) }
        return room.members.filter { $0.isAgent && $0.working }.sorted { order($0) < order($1) }.map { m in
            let task = current(m, room)
            return AgentsActivity.Agent(
                name: m.display,
                face: m.face ?? "default",
                color: m.color.flatMap { Palette.fills[$0] },
                task: task.map { "T\($0.id) \($0.title)" },
                since: task?.since.map { Date(timeIntervalSince1970: $0 / 1000) }
            )
        }
    }

    static func state(_ room: RoomView) -> AgentsActivity.ContentState {
        AgentsActivity.ContentState(agents: agents(room), needs: room.asks.count + room.reviews.count + room.open.count, line: line(room))
    }

    static func line(_ room: RoomView) -> String? {
        guard let lead = room.lead else { return nil }
        let said = room.messages.last { $0.from == lead && !$0.event } ?? room.latest.flatMap { $0.from == lead && !$0.event ? $0 : nil }
        let first = said?.plain.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.first { !$0.isEmpty }
        return first.map { String($0.prefix(90)) }
    }

    static func mark(_ room: RoomView) -> LiveOpen.Mark {
        var mark = LiveOpen.Mark(letter: room.title.prefix(1).uppercased(), rgb: Palette.fills[Palette.tint(for: room.code)] ?? 0x8e8e93)
        guard room.icon?.kind == "image", let data = room.icon?.data else { return mark }
        let key = "\(data.count)|\(data.suffix(32))"
        if let hit = thumbs[room.code], hit.key == key {
            mark.picture = hit.data
        } else if let image = Icons.picture(room), let small = Self.thumb(image) {
            thumbs[room.code] = (key, small)
            mark.picture = small
        }
        return mark
    }

    private static func thumb(_ image: UIImage) -> Data? {
        let side: CGFloat = 96
        guard image.size.width > 0, image.size.height > 0 else { return nil }
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let scale = max(side / image.size.width, side / image.size.height)
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let out = UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: format).image { _ in
            image.draw(in: CGRect(x: (side - size.width) / 2, y: (side - size.height) / 2, width: size.width, height: size.height))
        }
        return out.jpegData(compressionQuality: 0.8)
    }

    private static func current(_ m: MemberView, _ room: RoomView) -> TaskView? {
        let doing = room.tasks.filter { m.doing.contains($0.id) && $0.state == "doing" }
        let started: (TaskView) -> Double = { $0.since ?? 0 }
        return doing.max { started($0) == started($1) ? $0.updatedAt < $1.updatedAt : started($0) < started($1) }
    }

    func follow(_ rooms: [String: RoomView]) {
        guard !UserDefaults.standard.bool(forKey: Self.offKey), ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        var shown = Dictionary(AgentsLiveActivity.activities.map { ($0.attributes.channel, $0) }, uniquingKeysWith: { first, _ in first })
        var marks: [String: LiveOpen.Mark] = [:]
        for room in rooms.values where room.gone == nil {
            guard let key = room.roomId else { continue }
            marks[key] = Self.mark(room)
            let state = Self.state(room)
            if let activity = shown.removeValue(forKey: key) {
                if state.agents.isEmpty {
                    end(activity, key)
                } else {
                    ending.removeValue(forKey: key)?.cancel()
                    update(activity, state)
                }
            } else if !state.agents.isEmpty {
                start(AgentsActivity(channel: key, title: room.title), state)
            }
        }
        for (key, activity) in shown { end(activity, key) }
        if marks != marked {
            marked = marks
            LiveOpen.save(marks: marks)
        }
    }

    func stop() {
        for task in ending.values { task.cancel() }
        ending = [:]
        for id in AgentsLiveActivity.activities.map(\.id) {
            Task.detached { await Self.find(id)?.end(nil, dismissalPolicy: .immediate) }
        }
    }

    func watchTokens() {
        guard !watching else { return }
        watching = true
        Task.detached { [weak self] in
            for await data in AgentsLiveActivity.pushToStartTokenUpdates {
                await self?.heard(Token(start: Self.hex(data)))
            }
        }
        Task.detached { [weak self] in
            for await activity in AgentsLiveActivity.activityUpdates {
                let id = activity.id
                let room = activity.attributes.channel
                await self?.watch(id, room)
            }
        }
        for activity in AgentsLiveActivity.activities { watch(activity.id, activity.attributes.channel) }
    }

    private func watch(_ id: String, _ room: String) {
        guard watched.insert(id).inserted else { return }
        Task.detached { [weak self] in
            guard let activity = Self.find(id) else { return }
            for await data in activity.pushTokenUpdates {
                await self?.heard(Token(update: Self.hex(data), room: room))
            }
        }
    }

    private func heard(_ token: Token) {
        if let start = token.start { startToken = start }
        told?(token)
    }

    nonisolated private static func hex(_ data: Data) -> String {
        data.map { String(format: "%02x", $0) }.joined()
    }

    nonisolated private static func find(_ id: String) -> AgentsLiveActivity? {
        AgentsLiveActivity.activities.first { $0.id == id }
    }

    func code(for key: String, in rooms: [String: RoomView]) -> String? {
        rooms.values.first { $0.roomId == key }?.code
    }

    private func content(_ state: AgentsActivity.ContentState) -> ActivityContent<AgentsActivity.ContentState> {
        ActivityContent(state: state, staleDate: .now + Self.stale)
    }

    private func start(_ attributes: AgentsActivity, _ state: AgentsActivity.ContentState) {
        do {
            let activity = try AgentsLiveActivity.request(attributes: attributes, content: content(state), pushType: .token)
            if watching { watch(activity.id, attributes.channel) }
        } catch {
            Trouble.note("live: couldn't start", error)
        }
    }

    private func update(_ activity: AgentsLiveActivity, _ state: AgentsActivity.ContentState) {
        guard activity.content.state != state else { return }
        let next = content(state)
        let id = activity.id
        Task.detached { await Self.find(id)?.update(next) }
    }

    private func end(_ activity: AgentsLiveActivity, _ key: String) {
        guard ending[key] == nil else { return }
        let last = ActivityContent(state: AgentsActivity.ContentState(agents: []), staleDate: nil)
        let id = activity.id
        ending[key] = Task { [weak self] in
            try? await Task.sleep(for: Self.grace)
            if Task.isCancelled { return }
            await Task.detached { await Self.find(id)?.end(last, dismissalPolicy: .after(.now + 60)) }.value
            self?.ending[key] = nil
        }
    }
}
