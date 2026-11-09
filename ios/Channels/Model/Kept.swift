import CryptoKit
import Foundation

enum Kept {
    private static var folder: URL? {
        do {
            return try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
                .appendingPathComponent("kept", isDirectory: true)
        } catch {
            Trouble.note("kept: no Application Support", error)
            return nil
        }
    }

    private static func file(_ code: String) -> URL? {
        let name = SHA256.hash(data: Data(code.utf8)).map { String(format: "%02x", $0) }.joined()
        return folder?.appendingPathComponent("\(name).json")
    }

    static func save(_ code: String, _ sealed: Data) {
        guard let folder, let file = file(code) else { return }
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            try sealed.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        } catch {
            Trouble.note("kept: couldn't save", error)
        }
    }

    static func load(_ codes: [String]) -> [String: Any] {
        var kept: [String: Any] = [:]
        for code in codes {
            guard let file = file(code), FileManager.default.fileExists(atPath: file.path) else { continue }
            do {
                kept[code] = try JSONSerialization.jsonObject(with: Data(contentsOf: file))
            } catch {
                Trouble.note("kept: couldn't read", error)
            }
        }
        return kept
    }

    static func drop(_ code: String) {
        guard let file = file(code) else { return }
        remove(file)
    }

    static func wipe() {
        guard let folder else { return }
        remove(folder)
    }

    private static func remove(_ url: URL) {
        guard FileManager.default.fileExists(atPath: url.path) else { return }
        do {
            try FileManager.default.removeItem(at: url)
        } catch {
            Trouble.note("kept: couldn't delete", error)
        }
    }
}
