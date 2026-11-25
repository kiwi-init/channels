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
        try look(screen, "the channel opened")
        let field = app.descendants(matching: .any).matching(identifier: "composer").firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10), "the composer")
        field.tap()
        try await Task.sleep(for: .milliseconds(1200))
        try look(screen, "the keyboard opened")
        field.typeText("a short one from the phone")
        app.buttons["Send"].firstMatch.tap()
        try await Task.sleep(for: .milliseconds(1500))
        try look(screen, "a message sent")
        field.typeText("and a second, long enough to wrap onto another line of the bubble")
        app.buttons["Send"].firstMatch.tap()
        try await Task.sleep(for: .milliseconds(1500))
        try look(screen, "a second message sent")
        XCUIDevice.shared.press(.home)
        try await Task.sleep(for: .seconds(2))
        app.activate()
        try await Task.sleep(for: .milliseconds(1500))
        try look(screen, "back from the home screen")
        let start = CGPoint(x: screen.window.midX, y: screen.window.height * 0.35)
        screen.drag(from: start, by: CGVector(dx: 0, dy: 260), hold: 0.1)
        try await Task.sleep(for: .milliseconds(1200))
        try look(screen, "the keyboard closed")
    }

    @MainActor
    func testNoJumpButtonWhileMessagesArrive() async throws {
        let screen = try Screen.list(["-busy", "YES"])
        try await screen.enter(after: .milliseconds(1500))
        let app = screen.app
        try await watch(screen, "messages arriving", for: .seconds(8))
        let field = app.descendants(matching: .any).matching(identifier: "composer").firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10), "the composer")
        field.tap()
        try await watch(screen, "messages arriving with the keyboard open", for: .seconds(8))
        field.typeText("sent while they keep talking")
        app.buttons["Send"].firstMatch.tap()
        try await watch(screen, "messages arriving after a send", for: .seconds(8))
        XCUIDevice.shared.press(.home)
        try await Task.sleep(for: .seconds(4))
        app.activate()
        try await watch(screen, "messages arriving after coming back to the app", for: .seconds(8))
        let start = CGPoint(x: screen.window.midX, y: screen.window.height * 0.35)
        screen.drag(from: start, by: CGVector(dx: 0, dy: 260), hold: 0.1)
        try await watch(screen, "messages arriving after the keyboard closed", for: .seconds(8))
    }

    @MainActor
    func testNoJumpButtonAfterHistoryArrives() async throws {
        let screen = try Screen.list(["-history", "YES"])
        try await screen.enter(after: .milliseconds(300))
        let app = screen.app
        let field = app.descendants(matching: .any).matching(identifier: "composer").firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10), "the composer")
        field.tap()
        try await watch(screen, "history arriving with the keyboard open", for: .seconds(5))
        field.typeText("done this message is from my iphone")
        app.buttons["Send"].firstMatch.tap()
        try await watch(screen, "the first message sent after the history", for: .seconds(4))
    }

    @MainActor
    private func watch(_ screen: Screen, _ moment: String, for span: Duration) async throws {
        let end = ContinuousClock.now + span
        var run = 0
        var worst = 0
        while ContinuousClock.now < end {
            try await Task.sleep(for: .milliseconds(400))
            run = try wrong(screen) ? run + 1 : 0
            if run == 3 { attach(screen.app, moment) }
            worst = max(worst, run)
        }
        print("JUMP \(moment): shown with nothing below for \(worst) looks in a row")
        XCTAssertLessThan(worst, 3, "the jump button stayed with nothing below: \(moment)")
    }

    @MainActor
    private func look(_ screen: Screen, _ moment: String) throws {
        let bad = try wrong(screen)
        print("JUMP \(moment): \(bad ? "shown with nothing below" : "fine")")
        if bad { attach(screen.app, moment) }
        XCTAssertFalse(bad, "the jump button shows with nothing below: \(moment)")
    }

    @MainActor
    private func wrong(_ screen: Screen) throws -> Bool {
        let app = screen.app
        let jump = app.buttons.matching(NSPredicate(format: "label ENDSWITH 'jump to the latest' OR label == 'Jump to the latest'")).firstMatch
        guard jump.exists else { return false }
        let field = app.descendants(matching: .any).matching(identifier: "composer").firstMatch
        let top = app.navigationBars.firstMatch.frame.maxY
        let floor = field.exists ? field.frame.minY - 6 : screen.window.maxY
        let feed = try screen.texts().filter { $0.label.count > 12 && $0.frame.maxY > top && $0.frame.minX < jump.frame.minX }
        return !feed.isEmpty && feed.allSatisfy { $0.frame.maxY <= floor }
    }

    @MainActor
    private func attach(_ app: XCUIApplication, _ moment: String) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "jump button at the bottom: \(moment)"
        shot.lifetime = .keepAlways
        add(shot)
    }
}
