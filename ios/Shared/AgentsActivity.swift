import ActivityKit
import Foundation

struct AgentsActivity: ActivityAttributes {
    struct Agent: Codable, Hashable, Sendable {
        let name: String
        let face: String
        let color: UInt32?
        let task: String?
        let since: Date?
    }

    struct ContentState: Codable, Hashable, Sendable {
        var agents: [Agent]
        var sealed: [[String]]? = nil

        enum CodingKeys: String, CodingKey {
            case agents
            case sealed = "s"
        }
    }

    let channel: String
    let title: String

    static let scheme = "kiwichannels"

    var link: URL? {
        URL(string: "\(Self.scheme)://live/\(channel)")
    }
}

extension AgentsActivity.ContentState {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        agents = try c.decodeIfPresent([AgentsActivity.Agent].self, forKey: .agents) ?? []
        sealed = try c.decodeIfPresent([[String]].self, forKey: .sealed)
    }
}
