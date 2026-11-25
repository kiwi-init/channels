import ActivityKit
import Foundation

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

    private static func current(_ m: MemberView, _ room: RoomView) -> TaskView? {
        let doing = room.tasks.filter { m.doing.contains($0.id) && $0.state == "doing" }
        let started: (TaskView) -> Double = { $0.since ?? 0 }
        return doing.max { started($0) == started($1) ? $0.updatedAt < $1.updatedAt : started($0) < started($1) }
    }

    func follow(_ rooms: [String: RoomView]) {
        guard !UserDefaults.standard.bool(forKey: Self.offKey), ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        var shown = Dictionary(AgentsLiveActivity.activities.map { ($0.attributes.channel, $0) }, uniquingKeysWith: { first, _ in first })
        for room in rooms.values where room.gone == nil {
            guard let key = room.roomId else { continue }
            let agents = Self.agents(room)
            if let activity = shown.removeValue(forKey: key) {
                if agents.isEmpty {
                    end(activity, key)
                } else {
                    ending.removeValue(forKey: key)?.cancel()
                    update(activity, agents)
                }
            } else if !agents.isEmpty {
                start(AgentsActivity(channel: key, title: room.title), agents)
            }
        }
        for (key, activity) in shown { end(activity, key) }
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

    private func content(_ agents: [AgentsActivity.Agent]) -> ActivityContent<AgentsActivity.ContentState> {
        ActivityContent(state: AgentsActivity.ContentState(agents: agents), staleDate: .now + Self.stale)
    }

    private func start(_ attributes: AgentsActivity, _ agents: [AgentsActivity.Agent]) {
        do {
            let activity = try AgentsLiveActivity.request(attributes: attributes, content: content(agents), pushType: .token)
            if watching { watch(activity.id, attributes.channel) }
        } catch {
            Trouble.note("live: couldn't start", error)
        }
    }

    private func update(_ activity: AgentsLiveActivity, _ agents: [AgentsActivity.Agent]) {
        guard activity.content.state.agents != agents else { return }
        let next = content(agents)
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
