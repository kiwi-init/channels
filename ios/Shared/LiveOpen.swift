import CryptoKit
import Foundation
import Security

enum LiveOpen {
    private static let service = "com.kiwiinit.channels.live"
    private static let account = "keys"
    private static let marksAccount = "marks"

    private static var group: String? {
        Bundle.main.object(forInfoDictionaryKey: "KiwiLiveKeychain") as? String
    }

    private static func query(_ account: String = account) -> [String: Any] {
        var q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        if let group { q[kSecAttrAccessGroup as String] = group }
        return q
    }

    struct Mark: Codable, Hashable, Sendable {
        let letter: String
        let rgb: UInt32
        var picture: Data? = nil
    }

    private static func put(_ data: Data, _ account: String) {
        SecItemDelete(query(account) as CFDictionary)
        var add = query(account)
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(add as CFDictionary, nil)
    }

    private static func read(_ account: String) -> Data? {
        var q = query(account)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess else { return nil }
        return out as? Data
    }

    static func save(_ keys: [String: [String]]) {
        guard let data = try? JSONEncoder().encode(keys) else { return }
        put(data, account)
    }

    static func save(marks: [String: Mark]) {
        guard let data = try? JSONEncoder().encode(marks) else { return }
        put(data, marksAccount)
    }

    static func wipe() {
        SecItemDelete(query() as CFDictionary)
        SecItemDelete(query(marksAccount) as CFDictionary)
    }

    static func keys(_ room: String) -> [String] {
        guard let data = read(account), let all = try? JSONDecoder().decode([String: [String]].self, from: data) else { return [] }
        return all[room] ?? []
    }

    static func marks() -> [String: Mark] {
        guard let data = read(marksAccount), let all = try? JSONDecoder().decode([String: Mark].self, from: data) else { return [:] }
        return all
    }

    struct Opened {
        let agents: [AgentsActivity.Agent]
        let title: String?
        var needs: Int? = nil
        var line: String? = nil
    }

    private struct Sealed: Decodable {
        let v: Int
        let n: String
        let f: String
        let c: String?
        let t: String?
        let s: Double
        let h: String
        let w: Int?
        let r: String?
    }

    static func open(_ sealed: [[String]], room: String) -> Opened {
        open(sealed, room: room, keys: keys(room))
    }

    static func open(_ sealed: [[String]], room: String, keys raw: [String]) -> Opened {
        let keys = raw.compactMap(bytes).filter { $0.count == 32 }.map { SymmetricKey(data: $0) }
        let aad = Data(room.utf8)
        var title: String?
        var needs: Int?
        var line: String?
        var agents: [AgentsActivity.Agent] = []
        for pair in sealed {
            guard pair.count == 2, let iv = bytes(pair[0]), let ct = bytes(pair[1]), ct.count > 16,
                let nonce = try? AES.GCM.Nonce(data: iv),
                let box = try? AES.GCM.SealedBox(nonce: nonce, ciphertext: ct.dropLast(16), tag: ct.suffix(16))
            else { continue }
            for key in keys {
                guard let plain = try? AES.GCM.open(box, using: key, authenticating: aad),
                    let s = try? JSONDecoder().decode(Sealed.self, from: plain), s.v == 1
                else { continue }
                title = title ?? s.h
                if let w = s.w { needs = max(needs ?? 0, w) }
                if let r = s.r, line == nil || s.f == "lead" { line = r }
                agents.append(
                    AgentsActivity.Agent(
                        name: s.n,
                        face: s.f,
                        color: s.c.flatMap { Fills.rgb[$0] },
                        task: s.t,
                        since: Date(timeIntervalSince1970: s.s / 1000)
                    )
                )
                break
            }
        }
        let order = { (a: AgentsActivity.Agent) in (a.face == "lead" ? 0 : 1, a.name) }
        return Opened(agents: agents.sorted { order($0) < order($1) }, title: title, needs: needs, line: line)
    }

    static func bytes(_ s: String) -> Data? {
        var b = s.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        b += String(repeating: "=", count: (4 - b.count % 4) % 4)
        return Data(base64Encoded: b)
    }
}
