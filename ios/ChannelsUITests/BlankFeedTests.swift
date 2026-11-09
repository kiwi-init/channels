import XCTest

final class BlankFeedTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = true
    }

    @MainActor
    func testTheFeedStaysWhileTyping() async throws {
        try await typeAndWatch([])
    }

    @MainActor
    func testTheFeedStaysWhileTypingInABusyChannel() async throws {
        try await typeAndWatch(["-busy", "YES"])
    }

    @MainActor
    private func typeAndWatch(_ extra: [String]) async throws {
        let screen = try Screen.list(extra)
        try await screen.enter(after: .milliseconds(800))
        let app = screen.app
        let field = app.descendants(matching: .any).matching(identifier: "composer").firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10), "the composer")
        field.tap()
        try await Task.sleep(for: .milliseconds(900))
        try look(screen, field, "the keyboard opened")
        let steps = [
            "thats fine, can we keep working or was", " all done ?", "\nand a third line", "\nfour", "\nfive", "\nsix", "\nseven, past the field's six lines", " @",
            String(repeating: XCUIKeyboardKey.delete.rawValue, count: 2),
        ]
        for (at, words) in steps.enumerated() {
            field.typeText(words)
            for wait in [150, 600] {
                try await Task.sleep(for: .milliseconds(wait))
                try look(screen, field, "step \(at + 1) (\(words.debugDescription.prefix(24))) after \(wait) ms")
            }
            if at == 1 {
                let shot = XCTAttachment(screenshot: app.screenshot())
                shot.name = "typing two lines\(extra.isEmpty ? "" : " in a busy channel")"
                shot.lifetime = .keepAlways
                add(shot)
            }
        }
        let start = CGPoint(x: screen.window.midX, y: screen.window.height * 0.35)
        screen.drag(from: start, by: CGVector(dx: 0, dy: 260), hold: 0.1)
        try await Task.sleep(for: .milliseconds(900))
        try look(screen, field, "after a drag down that hides the keyboard")
        field.tap()
        try await Task.sleep(for: .milliseconds(900))
        try look(screen, field, "the keyboard back")
    }

    @MainActor
    private func look(_ screen: Screen, _ field: XCUIElement, _ moment: String) throws {
        let top = screen.app.navigationBars.firstMatch.frame.maxY
        let bottom = field.frame.minY - 8
        let feed = try screen.texts().filter { $0.label.count > 12 && $0.frame.midY > top && $0.frame.midY < bottom }
        print(
            "FEED \(moment): \(feed.count) texts between y \(Int(top)) and \(Int(bottom)), composer focused \(field.hasFocus) at \(Date.now.formatted(.iso8601.time(includingFractionalSeconds: true)))"
        )
        if feed.isEmpty {
            let shot = XCTAttachment(screenshot: screen.app.screenshot())
            shot.name = "blank feed: \(moment)"
            shot.lifetime = .keepAlways
            add(shot)
        }
        XCTAssertFalse(feed.isEmpty, "the feed went blank: \(moment)")
    }
}
