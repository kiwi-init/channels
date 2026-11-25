import XCTest

final class TitleTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    @MainActor
    func testTheTitleOpensWhoIsWorkingAndHoldingItJumps() throws {
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
        app.buttons["Done"].tap()
        XCTAssertTrue(working.waitForNonExistence(timeout: 5), "Done closes the sheet")

        pill.press(forDuration: 0.8)
        XCTAssertTrue(app.buttons["lead"].waitForExistence(timeout: 5), "holding the title opens the jump menu, with the lead chat in it")
        add(shot(app, "jump menu"))
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.9)).tap()

        let updates = app.buttons["updates"]
        XCTAssertTrue(updates.waitForExistence(timeout: 5), "an Updates icon in the top bar")
        updates.press(forDuration: 0.8)
        let first = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "GitHub")).firstMatch
        XCTAssertTrue(first.waitForExistence(timeout: 5), "holding Updates lists the latest few")
        add(shot(app, "updates menu"))
    }

    @MainActor
    private func shot(_ app: XCUIApplication, _ name: String) -> XCTAttachment {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        return attachment
    }
}
