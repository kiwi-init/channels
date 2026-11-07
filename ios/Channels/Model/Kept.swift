import CryptoKit
import Foundation

enum Kept {
    private static var folder: URL? {
        try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent("kept", isDirectory: true)
    }

    private static func file(_ code: String) -> URL? {
        let name = SHA256.hash(data: Data(code.utf8)).map { String(format: "%02x", $0) }.joined()
        return folder?.appendingPathComponent("\(name).json")
    }

    static func save(_ code: String, _ sealed: Data) {
        guard let folder, let file = file(code) else { return }
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try? sealed.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    static func load(_ codes: [String]) -> [String: Any] {
        var kept: [String: Any] = [:]
        for code in codes {
            guard let file = file(code), let data = try? Data(contentsOf: file), let sealed = try? JSONSerialization.jsonObject(with: data) else { continue }
            kept[code] = sealed
        }
        return kept
    }

    static func drop(_ code: String) {
        guard let file = file(code) else { return }
        try? FileManager.default.removeItem(at: file)
    }

    static func wipe() {
        guard let folder else { return }
        try? FileManager.default.removeItem(at: folder)
    }
}
