import Foundation

struct AgentsActivity {
    struct Agent {
        let name: String
        let face: String
        let color: UInt32?
        let task: String?
        let since: Date?
    }
}

struct Vector: Decodable {
    let key: String
    let room: String
    let sealed: [[String]]
}

struct Row: Encodable {
    let name: String
    let face: String
    let color: Int
    let task: String
    let since: Double
}

struct Out: Encodable {
    let agents: [Row]
    let title: String
    let needs: Int
    let line: String
    let elsewhere: Int
}

let vector = try JSONDecoder().decode(Vector.self, from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])))
let opened = LiveOpen.open(vector.sealed, room: vector.room, keys: [vector.key])
let elsewhere = LiveOpen.open(vector.sealed, room: "another-room-entirely", keys: [vector.key])
let rows = opened.agents.map { a in
    Row(name: a.name, face: a.face, color: a.color.map { Int($0) } ?? -1, task: a.task ?? "", since: a.since?.timeIntervalSince1970 ?? -1)
}
let out = Out(agents: rows, title: opened.title ?? "", needs: opened.needs ?? -1, line: opened.line ?? "", elsewhere: elsewhere.agents.count)
print(String(decoding: try JSONEncoder().encode(out), as: UTF8.self))
