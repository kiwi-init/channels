import Foundation

enum Connection: String, Codable, Sendable {
    case connecting, live, reconnecting
}

struct Activity: Codable, Sendable, Hashable {
    let state: String
    let tool: String?
    let since: Double?
}

struct MemberView: Codable, Sendable, Hashable, Identifiable {
    let name: String
    let display: String
    let kind: String
    let role: String?
    let owner: Bool
    let lead: Bool
    let color: String?
    let here: Bool
    let activity: Activity?
    let sponsor: String?
    let model: String?
    let harness: String?
    let mono: Bool
    let doing: [Int]

    var id: String { name }
    var isAgent: Bool { kind == "agent" }
    var working: Bool { activity?.state == "working" }
}

struct QuoteView: Codable, Sendable, Hashable {
    let seq: Int
    let from: String
    let words: String
}

struct Chosen: Codable, Sendable, Hashable {
    let choice: String
    let by: String
}

struct MessageView: Codable, Sendable, Hashable, Identifiable {
    let seq: Int
    let from: String
    let at: Double
    let kind: String
    let body: String
    let event: Bool
    let mine: Bool
    let quote: QuoteView?
    let choices: [String]
    let chosen: Chosen?
    let waiting: Bool
    let images: Int
    let task: Int?
    let reactions: [ReactionView]
    let shown: String
    let plain: String

    var id: Int { seq }
    var myReaction: String? { reactions.first { $0.mine }?.emoji }
    var date: Date { Date(timeIntervalSince1970: at / 1000) }
}

struct ReactionView: Codable, Sendable, Hashable {
    let emoji: String
    let who: [String]
    let mine: Bool
}

struct TaskView: Codable, Sendable, Hashable, Identifiable {
    let id: Int
    let title: String
    let state: String
    let owner: String?
    let review: String?
    let updatedAt: Double
    let createdAt: Double
    let last: String?
    let archived: Bool

    var updated: Date { Date(timeIntervalSince1970: updatedAt / 1000) }
}

struct AskView: Codable, Sendable, Hashable, Identifiable {
    let seq: Int
    let from: String
    let body: String
    let at: Double
    let label: String
    let choices: [String]
    let task: Int?
    let place: String?
    let shown: String
    let plain: String

    var id: Int { seq }
    var date: Date { Date(timeIntervalSince1970: at / 1000) }
}

struct ReviewView: Codable, Sendable, Hashable, Identifiable {
    let task: Int
    let title: String
    let by: String?
    let at: Double

    var id: Int { task }
    var date: Date { Date(timeIntervalSince1970: at / 1000) }
}

struct PlaceView: Codable, Sendable, Hashable, Identifiable {
    let key: String
    let kind: String
    let title: String
    let with: [String]
    let withMe: Bool
    let task: Int?
    let lastSeq: Int
    let last: MessageView?

    var id: String { key }
}

struct IconView: Codable, Sendable, Hashable {
    let kind: String
    let robot: String?
    let emoji: String?
    let mime: String?
    let data: String?
}

struct RoomView: Codable, Sendable, Hashable, Identifiable {
    let code: String
    let title: String
    let icon: IconView?
    let me: String
    let isOwner: Bool
    let connection: Connection
    let gone: String?
    let error: String?
    let head: Int
    let whole: Bool
    let hold: String?
    let charter: String?
    let lead: String?
    let members: [MemberView]
    let messages: [MessageView]
    let side: [MessageView]?
    let sideKey: String?
    let tasks: [TaskView]
    let asks: [AskView]
    let reviews: [ReviewView]
    let last: MessageView?
    let latest: MessageView?
    let latestIn: String
    let place: String
    let places: [PlaceView]

    var id: String { code }

    func placeView(_ key: String) -> PlaceView? {
        places.first { $0.key == key }
    }

    func other(in place: PlaceView) -> String? {
        place.kind == "dm" && place.withMe ? place.with.first { $0 != me } : nil
    }

    func dmKey(with name: String) -> String {
        let pair = [me, name].sorted()
        return "dm:\(pair[0])~\(pair[1])"
    }

    func member(_ name: String) -> MemberView? {
        members.first { $0.name == name }
    }

    func display(_ name: String) -> String {
        member(name)?.display ?? name
    }

    var working: Int {
        members.filter { $0.isAgent && $0.working }.count
    }
}

struct ComputerView: Codable, Sendable, Hashable, Identifiable {
    let key: String
    let xpk: String
    let label: String
    let online: Bool
    let since: Double?
    let seenAt: Double

    var id: String { key }
    var name: String { label.isEmpty ? "Your computer" : label }
    var seen: Date { Date(timeIntervalSince1970: seenAt / 1000) }
}

struct HarnessOptions: Codable, Sendable, Hashable {
    let model: Bool
    let effort: [String]
    let permission: [String]
    let context: [Int]
}

struct HarnessChoice: Codable, Sendable, Hashable, Identifiable {
    let harness: String
    let name: String
    let face: String
    let mono: Bool
    let version: String?
    let start: Bool
    let why: String?
    let options: HarnessOptions?

    var id: String { harness }
}

struct HarnessesOn: Codable, Sendable {
    let harnesses: [HarnessChoice]
    let bypass: Bool
}

struct Launched: Decodable, Sendable {
    let ok: Bool
    let launch: String?
    let detail: String?
}

struct LaunchSeen: Equatable, Sendable {
    let stage: String
    let name: String
}

struct EnrollStart: Codable, Sendable {
    let url: String?
    let code: String
}

struct EnrollDigits: Codable, Sendable {
    let digits: String
}

struct EnrollPerson: Codable, Sendable {
    let name: String
    let fingerprint: String
}

struct Reply: Decodable {
    let ok: Bool
    let error: String?
}
