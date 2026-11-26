import Foundation

enum Demo {
    static let refusal = "This is a sample channel. Sign in to do this for real."

    static func room() throws -> RoomView {
        guard let url = Bundle.main.url(forResource: "sample", withExtension: "json") else { throw EngineError.missing }
        let raw = try JSONSerialization.jsonObject(with: try Data(contentsOf: url))
        let newest = latest(raw) ?? 0
        let shift = newest > 0 ? Date.now.timeIntervalSince1970 * 1000 - newest : 0
        let moved = try JSONSerialization.data(withJSONObject: move(raw, by: shift))
        return try JSONDecoder().decode(RoomView.self, from: moved)
    }

    static func another(_ room: RoomView) -> RoomView {
        RoomView(
            code: "pilot", title: "pilot", icon: nil, me: room.me, isOwner: room.isOwner, connection: room.connection, gone: nil, error: nil, head: 0,
            whole: true, hold: nil, charter: nil, lead: room.lead, members: room.members, messages: [], side: nil, sideKey: room.sideKey, tasks: [], asks: [],
            reviews: [], last: nil, latest: nil, latestIn: "main", place: "main", places: [])
    }

    private static func stamp(_ value: Any) -> Double? {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
        let ms = number.doubleValue
        return ms > 1_500_000_000_000 && ms < 4_000_000_000_000 ? ms : nil
    }

    private static func latest(_ value: Any) -> Double? {
        if let ms = stamp(value) { return ms }
        if let list = value as? [Any] { return list.compactMap(latest).max() }
        if let map = value as? [String: Any] { return map.values.compactMap(latest).max() }
        return nil
    }

    private static func move(_ value: Any, by shift: Double) -> Any {
        if let ms = stamp(value) { return ms + shift }
        if let list = value as? [Any] { return list.map { move($0, by: shift) } }
        if let map = value as? [String: Any] { return map.mapValues { move($0, by: shift) } }
        return value
    }
}
