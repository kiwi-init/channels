import UIKit
import UserNotifications

struct PushSeat: Codable, Sendable {
    let tag: String
    let code: String
    let label: String
    let ok: Bool
    let error: String?
}

struct PushDrop: Codable, Sendable {
    let label: String
    let ok: Bool
    let error: String?
}

final class PushDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    @MainActor static var onToken: ((String) -> Void)?
    @MainActor static var onTap: ((String) -> Void)? {
        didSet {
            guard let onTap, let tag = waiting else { return }
            waiting = nil
            onTap(tag)
        }
    }
    @MainActor private static var waiting: String?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        Task { @MainActor in PushDelegate.onToken?(hex) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        Trouble.note("push: couldn't register", error)
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        guard let tag = response.notification.request.content.userInfo["k"] as? String else { return }
        await PushDelegate.tapped(tag)
    }

    @MainActor private static func tapped(_ tag: String) {
        if let onTap {
            onTap(tag)
        } else {
            waiting = tag
        }
    }
}

@MainActor
final class PushTags {
    private(set) var byTag: [String: String] = UserDefaults.standard.dictionary(forKey: "pushTags") as? [String: String] ?? [:]
    private(set) var token: String?
    private var registered: Set<String> = []

    func take(_ seats: [PushSeat], token: String) {
        let kept = seats.filter(\.ok)
        registered = Set(kept.map(\.code))
        let fresh = Dictionary(kept.map { ($0.tag, $0.code) }, uniquingKeysWith: { _, last in last })
        byTag = byTag.filter { registered.contains($0.value) }.merging(fresh) { _, new in new }
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
        do {
            if try await center.requestAuthorization(options: [.alert, .sound, .badge]) { UIApplication.shared.registerForRemoteNotifications() }
        } catch {
            Trouble.note("push: authorization", error)
        }
    }
}
