import XCTest

final class JumpTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = true
    }

    @MainActor
    func testNoJumpButtonAtTheBottom() async throws {
        let screen = try Screen.list()
        try await screen.enter(after: .milliseconds(1500))
        let app = screen.app
        try look(app, "the channel opened")
        let field = app.descendants(matching: .any).matching(identifier: "composer").firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10), "the composer")
        field.tap()
        try await Task.sleep(for: .milliseconds(1200))
        try look(app, "the keyboard opened")
        field.typeText("a short one from the phone")
        app.buttons["Send"].firstMatch.tap()
        try await Task.sleep(for: .milliseconds(1500))
        try look(app, "a message sent")
        field.typeText("and a second, long enough to wrap onto another line of the bubble")
        app.buttons["Send"].firstMatch.tap()
        try await Task.sleep(for: .milliseconds(1500))
        try look(app, "a second message sent")
        let start = CGPoint(x: screen.window.midX, y: screen.window.height * 0.35)
        screen.drag(from: start, by: CGVector(dx: 0, dy: 260), hold: 0.1)
        try await Task.sleep(for: .milliseconds(1200))
        try look(app, "the keyboard closed")
    }

    @MainActor
    private func look(_ app: XCUIApplication, _ moment: String) throws {
        let jump = app.buttons.matching(NSPredicate(format: "label ENDSWITH 'jump to the latest' OR label == 'Jump to the latest'")).firstMatch
        let shown = jump.exists
        print("JUMP \(moment): \(shown ? "shown" : "hidden")")
        if shown {
            let shot = XCTAttachment(screenshot: app.screenshot())
            shot.name = "jump button at the bottom: \(moment)"
            shot.lifetime = .keepAlways
            add(shot)
        }
        XCTAssertFalse(shown, "the jump button shows with nothing below: \(moment)")
    }
}
