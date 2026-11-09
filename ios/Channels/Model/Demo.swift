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
