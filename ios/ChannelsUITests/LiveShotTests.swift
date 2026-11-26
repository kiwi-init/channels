import XCTest

final class LiveShotTests: XCTestCase {
    @MainActor
    func testTheLiveActivityShowsTheChannel() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-demo", "YES", "-lockOff", "YES", "-shot", "live", "-language", "system", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        let working = app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'working'")).firstMatch
        XCTAssertTrue(working.waitForExistence(timeout: 15), "the island and Lock Screen say how many work")
        sleep(2)
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "live activity"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
