import XCTest

final class DemoTests: XCTestCase {
    @MainActor
    func testSampleChannel() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-demo", "YES", "-lockOff", "YES", "-language", "system", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        XCTAssertTrue(app.staticTexts["A sample channel. Sign in to see yours."].waitForExistence(timeout: 15))
        add(shot(app, "demo list"))

        let general = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'general'")).firstMatch
        XCTAssertTrue(general.waitForExistence(timeout: 5))
        general.tap()
        let composer = NSPredicate(format: "placeholderValue == 'Message'")
        let field = app.textViews.matching(composer).firstMatch.exists ? app.textViews.matching(composer).firstMatch : app.textFields.matching(composer).firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5), "the chat's message field")
        field.tap()
        field.typeText("hello")
        app.buttons["Send"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["hello"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["Not Delivered"].exists, "a send in the sample looks sent")
        add(shot(app, "demo send"))

        app.navigationBars.buttons.firstMatch.tap()
        app.buttons["Sign In"].firstMatch.tap()
        XCTAssertTrue(app.buttons["Look Around First"].waitForExistence(timeout: 5))
        add(shot(app, "back to sign in"))
    }

    @MainActor
    func testAChatIsTheWholeScreen() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-demo", "YES", "-lockOff", "YES", "-language", "system", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        let general = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'general'")).firstMatch
        XCTAssertTrue(general.waitForExistence(timeout: 15))
        XCTAssertTrue(app.tabBars.buttons["Needs You"].isHittable, "the tabs on the list")
        XCTAssertTrue(app.descendants(matching: .any).matching(identifier: "lead-row").firstMatch.exists, "the lead, the first row of the channel")
        add(shot(app, "chats"))
        general.tap()
        let field = app.descendants(matching: .any).matching(identifier: "composer").firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 15), "the composer")
        XCTAssertFalse(app.tabBars.firstMatch.isHittable, "in a chat the tab bar steps away")
        let newest = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Something else'")).firstMatch
        XCTAssertTrue(newest.waitForExistence(timeout: 5), "the newest item, the step's Something else")
        sleep(1)
        XCTAssertLessThanOrEqual(newest.frame.maxY, field.frame.minY + 1, "the newest item ends above the composer")
        add(shot(app, "chat at rest"))
        let elsewhere = app.buttons["needs-elsewhere"]
        if elsewhere.exists {
            add(shot(app, "chat with something waiting elsewhere"))
            elsewhere.tap()
            XCTAssertTrue(app.navigationBars["Needs You"].waitForExistence(timeout: 5), "the hand opens Needs You")
            app.tabBars.buttons["Chats"].firstMatch.tap()
            XCTAssertTrue(field.waitForExistence(timeout: 5), "and the chat is still open on Chats")
        }
        field.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        field.typeText("hi")
        add(shot(app, "chat typing"))
        app.navigationBars.buttons.firstMatch.tap()
        XCTAssertTrue(app.tabBars.buttons["Needs You"].waitForHittable(timeout: 5), "back on the list, the tabs come back")
    }

    @MainActor
    func testSampleOffersNoLinkAgain() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-demo", "YES", "-lockOff", "YES", "-language", "system", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        XCTAssertTrue(app.staticTexts["A sample channel. Sign in to see yours."].waitForExistence(timeout: 15))
        app.buttons["You"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Relay"].waitForExistence(timeout: 5), "the You screen")
        add(shot(app, "demo you"))
        XCTAssertFalse(app.buttons["Link Again"].exists, "the sample can't link, so it doesn't offer to")
    }

    @MainActor
    func testStepCard() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-demo", "YES", "-lockOff", "YES", "-language", "system", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        let general = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'general'")).firstMatch
        XCTAssertTrue(general.waitForExistence(timeout: 15))
        general.tap()
        XCTAssertTrue(app.staticTexts["A step for you"].waitForExistence(timeout: 5), "the sample's step card")
        XCTAssertTrue(app.staticTexts["bun run sign"].exists, "the step's command")
        add(shot(app, "demo step"))

        let done = app.buttons["Done"].firstMatch
        XCTAssertTrue(done.waitForExistence(timeout: 5), "the step's Done")
        done.tap()
        XCTAssertTrue(app.staticTexts["Couldn't send · Try again"].waitForExistence(timeout: 5), "Done went to the engine, which the sample refuses")
        XCTAssertTrue(done.isEnabled, "the step stays open to try again")
        add(shot(app, "demo step refused"))
    }

    @MainActor
    private func shot(_ app: XCUIApplication, _ name: String) -> XCTAttachment {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        return attachment
    }
}
extension XCUIElement {
    func waitForHittable(timeout: TimeInterval) -> Bool {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if exists && isHittable { return true }
            usleep(200_000)
        }
        return exists && isHittable
    }
}
