import SwiftUI
import UIKit

struct HoldItem {
    var title: String
    var subtitle: String?
    var image: UIImage?
    var checked = false
    var action: () -> Void
}

struct HoldSection {
    var title: String?
    var nested = false
    var items: [HoldItem]
}

struct HoldButton: UIViewRepresentable {
    let label: String
    var hint: String?
    let tap: () -> Void
    let menu: () -> [HoldSection]

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> UIButton {
        let button = UIButton(type: .custom)
        let coordinator = context.coordinator
        button.addAction(UIAction { _ in coordinator.tap() }, for: .primaryActionTriggered)
        button.menu = UIMenu(children: [
            UIDeferredMenuElement.uncached { done in
                MainActor.assumeIsolated { done(coordinator.build()) }
            }
        ])
        button.showsMenuAsPrimaryAction = false
        button.isAccessibilityElement = true
        button.accessibilityTraits = .button
        return button
    }

    func updateUIView(_ button: UIButton, context: Context) {
        context.coordinator.tap = tap
        context.coordinator.sections = menu
        button.accessibilityLabel = label
        button.accessibilityHint = hint
    }

    @MainActor
    final class Coordinator {
        var tap: () -> Void = {}
        var sections: () -> [HoldSection] = { [] }

        func build() -> [UIMenuElement] {
            sections().filter { !$0.items.isEmpty }.map { section in
                let actions: [UIMenuElement] = section.items.map { item in
                    UIAction(title: item.title, subtitle: item.subtitle, image: item.image, state: item.checked ? .on : .off) { _ in item.action() }
                }
                return UIMenu(title: section.title ?? "", options: section.nested ? [] : .displayInline, children: actions)
            }
        }
    }
}

@MainActor
enum MenuArt {
    private static let cache = NSCache<NSString, UIImage>()

    static func image<Content: View>(_ key: String, @ViewBuilder _ content: () -> Content) -> UIImage? {
        if let hit = cache.object(forKey: key as NSString) { return hit }
        let renderer = ImageRenderer(content: content().frame(width: 30, height: 30).environment(\.colorScheme, .dark))
        renderer.scale = 3
        guard let image = renderer.uiImage?.withRenderingMode(.alwaysOriginal) else { return nil }
        cache.setObject(image, forKey: key as NSString)
        return image
    }

    static func row(_ row: Row) -> UIImage? {
        image("\(row.id)|\(row.unread)|\(row.asks.count)") {
            RowAvatar(row: row, size: 30)
        }
    }
}
