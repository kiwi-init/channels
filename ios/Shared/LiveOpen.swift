import CryptoKit
import Foundation
import Security

enum LiveOpen {
    private static let service = "com.kiwiinit.channels.live"
    private static let account = "keys"

    private static var group: String? {
        Bundle.main.object(forInfoDictionaryKey: "KiwiLiveKeychain") as? String
    }

    private static func query() -> [String: Any] {
        var q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        if let group { q[kSecAttrAccessGroup as String] = group }
        return q
    }

    static func save(_ keys: [String: [String]]) {
        guard let data = try? JSONEncoder().encode(keys) else { return }
        SecItemDelete(query() as CFDictionary)
        var add = query()
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(add as CFDictionary, nil)
    }

    static func wipe() {
        SecItemDelete(query() as CFDictionary)
    }

    static func keys(_ room: String) -> [String] {
        var q = query()
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data,
            let all = try? JSONDecoder().decode([String: [String]].self, from: data)
        else { return [] }
        return all[room] ?? []
    }

    struct Opened {
        let agents: [AgentsActivity.Agent]
        let title: String?
    }

    private struct Sealed: Decodable {
        let v: Int
        let n: String
        let f: String
        let c: String?
        let t: String?
        let s: Double
        let h: String
    }

    static func open(_ sealed: [[String]], room: String) -> Opened {
        open(sealed, room: room, keys: keys(room))
    }

    static func open(_ sealed: [[String]], room: String, keys raw: [String]) -> Opened {
        let keys = raw.compactMap(bytes).filter { $0.count == 32 }.map { SymmetricKey(data: $0) }
        let aad = Data(room.utf8)
        var title: String?
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
        return Opened(agents: agents.sorted { order($0) < order($1) }, title: title)
    }

    static func bytes(_ s: String) -> Data? {
        var b = s.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        b += String(repeating: "=", count: (4 - b.count % 4) % 4)
        return Data(base64Encoded: b)
    }
}
