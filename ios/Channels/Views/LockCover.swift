import SwiftUI
import UIKit

@MainActor
final class LockCover {
    private var window: UIWindow?

    func show(_ unlock: @escaping () -> Void) {
        guard window == nil else { return }
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        guard let scene = scenes.first(where: { $0.activationState == .foregroundActive }) ?? scenes.first else {
            Trouble.note("lock: no window scene to cover")
            return
        }
        let host = UIHostingController(rootView: Locked(unlock: unlock).preferredColorScheme(ThemeStore.shared.appearance.scheme))
        let window = UIWindow(windowScene: scene)
        window.windowLevel = .alert + 1
        window.rootViewController = host
        window.isHidden = false
        self.window = window
    }

    func hide() {
        window?.isHidden = true
        window = nil
    }
}
