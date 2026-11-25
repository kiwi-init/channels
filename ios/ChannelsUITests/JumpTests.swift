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
    func testNoJumpButtonWhileMessagesArrive() async throws {
        let screen = try Screen.list(["-busy", "YES"])
        try await screen.enter(after: .milliseconds(1500))
        let app = screen.app
        try await watch(app, "messages arriving", for: .seconds(8))
        let field = app.descendants(matching: .any).matching(identifier: "composer").firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10), "the composer")
        field.tap()
        try await watch(app, "messages arriving with the keyboard open", for: .seconds(8))
        field.typeText("sent while they keep talking")
        app.buttons["Send"].firstMatch.tap()
        try await watch(app, "messages arriving after a send", for: .seconds(8))
        let start = CGPoint(x: screen.window.midX, y: screen.window.height * 0.35)
        screen.drag(from: start, by: CGVector(dx: 0, dy: 260), hold: 0.1)
        try await watch(app, "messages arriving after the keyboard closed", for: .seconds(8))
    }

    @MainActor
    private func watch(_ app: XCUIApplication, _ moment: String, for span: Duration) async throws {
        let end = ContinuousClock.now + span
        var run = 0
        var worst = 0
        while ContinuousClock.now < end {
            try await Task.sleep(for: .milliseconds(400))
            run = jump(app).exists ? run + 1 : 0
            if run == 3 { attach(app, moment) }
            worst = max(worst, run)
        }
        print("JUMP \(moment): shown for \(worst) looks in a row")
        XCTAssertLessThan(worst, 3, "the jump button stayed with nothing below: \(moment)")
    }

    @MainActor
    private func look(_ app: XCUIApplication, _ moment: String) throws {
        let shown = jump(app).exists
        print("JUMP \(moment): \(shown ? "shown" : "hidden")")
        if shown { attach(app, moment) }
        XCTAssertFalse(shown, "the jump button shows with nothing below: \(moment)")
    }

    @MainActor
    private func jump(_ app: XCUIApplication) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label ENDSWITH 'jump to the latest' OR label == 'Jump to the latest'")).firstMatch
    }

    @MainActor
    private func attach(_ app: XCUIApplication, _ moment: String) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "jump button at the bottom: \(moment)"
        shot.lifetime = .keepAlways
        add(shot)
    }
}
