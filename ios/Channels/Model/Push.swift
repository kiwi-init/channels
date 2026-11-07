import UIKit
import UserNotifications

struct PushSeat: Codable, Sendable {
    let tag: String
    let code: String
    let label: String
    let ok: Bool
    let error: String?
}

final class PushDelegate: NSObject, UIApplicationDelegate {
    @MainActor static var onToken: ((String) -> Void)?

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        Task { @MainActor in PushDelegate.onToken?(hex) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NSLog("push: couldn't register: \(error.localizedDescription)")
    }
}

@MainActor
final class PushTags {
    private(set) var byTag: [String: String] = UserDefaults.standard.dictionary(forKey: "pushTags") as? [String: String] ?? [:]
    private(set) var token: String?
    private var registered: Set<String> = []

    func take(_ seats: [PushSeat], token: String) {
        let kept = seats.filter(\.ok)
        byTag = Dictionary(kept.map { ($0.tag, $0.code) }, uniquingKeysWith: { _, last in last })
        registered = Set(kept.map(\.code))
        self.token = token
        UserDefaults.standard.set(byTag, forKey: "pushTags")
    }

    func stale(_ codes: Set<String>) -> Bool {
        token != nil && codes != registered
    }

    func forget() {
        byTag = [:]
        registered = []
        UserDefaults.standard.removeObject(forKey: "pushTags")
    }

    static func ask() async {
        let center = UNUserNotificationCenter.current()
        let granted = (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        if granted { UIApplication.shared.registerForRemoteNotifications() }
    }
}
