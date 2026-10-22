import Foundation
import LocalAuthentication
import Observation

@MainActor
@Observable
final class Lock {
    private static let grace: TimeInterval = 30

    var locked = Lock.startsLocked
    @ObservationIgnored private var leftAt: Date?
    @ObservationIgnored private var asking = false

    private static var startsLocked: Bool {
        #if DEBUG
            if UserDefaults.standard.string(forKey: "shot") != nil { return false }
        #endif
        return Vault.load() != nil
    }

    var available: Bool {
        LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: nil)
    }

    func left() {
        leftAt = .now
    }

    func back() async {
        if let leftAt, Date.now.timeIntervalSince(leftAt) > Lock.grace { locked = true }
        leftAt = nil
        await unlock()
    }

    func unlock() async {
        guard locked, !asking else { return }
        guard available else {
            locked = false
            return
        }
        asking = true
        defer { asking = false }
        let context = LAContext()
        do {
            locked = !(try await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Unlock your channels"))
        } catch {
            locked = true
        }
    }
}
