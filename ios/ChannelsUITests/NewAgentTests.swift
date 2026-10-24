import XCTest

final class NewAgentTests: XCTestCase {
    private var env: [String: String] { ProcessInfo.processInfo.environment }

    @MainActor
    private func shot(_ app: XCUIApplication, _ name: String) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    @MainActor
    private func tapFirst(_ app: XCUIApplication, _ format: String, _ what: String, timeout: TimeInterval = 30) {
        let found = app.buttons.matching(NSPredicate(format: format)).firstMatch
        XCTAssertTrue(found.waitForExistence(timeout: timeout), "no \(what) showed")
        found.tap()
    }

    @MainActor
    func testNewAgentOnThisPhone() async throws {
        try XCTSkipUnless(env["KIWI_DEVICE_FLOW"] == "1", "walks the real New Agent sheet on a linked phone: run with TEST_RUNNER_KIWI_DEVICE_FLOW=1")
        let channel = env["KIWI_DEVICE_CHANNEL"] ?? "channels-dev"
        let app = XCUIApplication()
        app.launchArguments = ["-shot", "list"]
        app.launch()
        tapFirst(app, "label BEGINSWITH '\(channel)'", "channel row")
        try await Task.sleep(for: .seconds(2))
        tapFirst(app, "label BEGINSWITH '\(channel)'", "title pill")
        tapFirst(app, "label == 'New Agent'", "New Agent action")
        tapFirst(app, "label CONTAINS 'Online'", "online computer")
        shot(app, "1-harness")
        tapFirst(app, "label BEGINSWITH '\(env["KIWI_DEVICE_HARNESS"] ?? "Claude Code")'", "harness")
        tapFirst(app, "label CONTAINS '/'", "folder")
        XCTAssertTrue(app.buttons["Start"].waitForExistence(timeout: 10), "the options never showed")
        shot(app, "2-options")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.navigationBars.buttons.element(boundBy: 0).tap()
        try await Task.sleep(for: .seconds(1))
        shot(app, "0-computers")
        guard env["KIWI_DEVICE_LAUNCH"] == "1" else { return }
        tapFirst(app, "label CONTAINS 'Online'", "online computer")
        tapFirst(app, "label BEGINSWITH '\(env["KIWI_DEVICE_HARNESS"] ?? "Claude Code")'", "harness")
        tapFirst(app, "label CONTAINS '/'", "folder")
        let name = app.textFields["Name"]
        XCTAssertTrue(name.waitForExistence(timeout: 10))
        name.tap()
        name.typeText(env["KIWI_DEVICE_NICK"] ?? "phone-test")
        app.buttons["Start"].tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS ' is in '")).firstMatch.waitForExistence(timeout: 180), "the agent never joined")
        shot(app, "3-joined")
    }
}
