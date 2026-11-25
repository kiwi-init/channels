import XCTest

final class TitleTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    @MainActor
    func testTheTitleOpensWhoIsWorking() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-demo", "YES", "-shot", "channel", "-language", "system", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        let pill = app.buttons["titlePill"]
        XCTAssertTrue(pill.waitForExistence(timeout: 15), "the chat title is a button")
        add(shot(app, "title pill"))

        pill.tap()
        let working = app.staticTexts["Working"]
        XCTAssertTrue(working.waitForExistence(timeout: 5), "a tap opens who is working")
        XCTAssertTrue(app.staticTexts["Rooms"].exists, "the sheet lists the rooms")
        add(shot(app, "title sheet"))
        app.navigationBars["channels-dev"].buttons["Done"].tap()
        XCTAssertTrue(working.waitForNonExistence(timeout: 5), "Done closes the sheet")
    }

    @MainActor
    private func shot(_ app: XCUIApplication, _ name: String) -> XCTAttachment {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        return attachment
    }
}
