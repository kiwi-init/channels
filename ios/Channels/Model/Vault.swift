import Foundation
import Security

struct VaultError: LocalizedError {
    let status: OSStatus

    var errorDescription: String? {
        if status == errSecInteractionNotAllowed { return "the keychain stays shut until this iPhone is unlocked" }
        let said = SecCopyErrorMessageString(status, nil) as String? ?? "keychain error"
        return "\(said) (\(status))"
    }
}

enum Vault {
    enum Read {
        case found(Data)
        case empty
        case shut(VaultError)
    }

    private static let service = "com.kiwiinit.channels"
    private static let account = "linked"

    private static var query: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    static func load() -> Read {
        var q = query
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &out)
        if status == errSecItemNotFound { return .empty }
        guard status == errSecSuccess else { return .shut(VaultError(status: status)) }
        guard let data = out as? Data else { return .empty }
        return .found(data)
    }

    static func save(_ data: Data) throws {
        let update: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let status = SecItemUpdate(query as CFDictionary, update as CFDictionary)
        if status == errSecSuccess { return }
        guard status == errSecItemNotFound else { throw VaultError(status: status) }
        var add = query
        add.merge(update) { _, new in new }
        let added = SecItemAdd(add as CFDictionary, nil)
        guard added == errSecSuccess else { throw VaultError(status: added) }
    }

    static func wipe() {
        SecItemDelete(query as CFDictionary)
    }
}
