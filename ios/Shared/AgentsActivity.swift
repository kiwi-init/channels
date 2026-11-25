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
    }

    let channel: String
    let title: String

    static let scheme = "kiwichannels"

    var link: URL? {
        URL(string: "\(Self.scheme)://live/\(channel)")
    }
}
