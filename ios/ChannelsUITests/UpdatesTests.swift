import XCTest

final class UpdatesTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    @MainActor
    func testUpdatesLeaveTheFeedForAnIconInTheTopBar() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-demo", "YES", "-shot", "channel", "-language", "system", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        let icon = app.buttons["updates"]
        XCTAssertTrue(icon.waitForExistence(timeout: 15), "an Updates icon in the top bar")
        let rows = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "GitHub: "))
        XCTAssertEqual(rows.count, 0, "no updates rows in the feed")
        add(shot(app, "feed without updates"))

        icon.tap()
        let sheet = app.navigationBars["Updates"]
        XCTAssertTrue(sheet.waitForExistence(timeout: 5), "the Updates sheet opens")
        XCTAssertTrue(rows.firstMatch.waitForExistence(timeout: 5), "the sheet lists the updates")
        XCTAssertEqual(rows.count, 3, "every update is in the sheet")
        XCTAssertTrue(rows.firstMatch.label.contains("5 updates"), "newest first")
        add(shot(app, "updates sheet"))

        app.buttons["Done"].tap()
        XCTAssertTrue(sheet.waitForNonExistence(timeout: 5), "Done closes the sheet")
    }

    @MainActor
    private func shot(_ app: XCUIApplication, _ name: String) -> XCTAttachment {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        return attachment
    }
}
