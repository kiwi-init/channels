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
        let field = app.descendants(matching: .any).matching(identifier: "composer").firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 15), "the chat's message field")
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
    func testTabBarStaysInAChat() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-demo", "YES", "-lockOff", "YES", "-language", "system", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        let general = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'general'")).firstMatch
        XCTAssertTrue(general.waitForExistence(timeout: 15))
        let needs = app.buttons["tab-needs"]
        let channel = app.buttons["channel"]
        XCTAssertTrue(needs.waitForHittable(timeout: 5) && channel.isHittable, "one row on the list: the tabs and the channel")
        XCTAssertEqual(needs.frame.midY, channel.frame.midY, accuracy: 2)
        let listRow = needs.frame.midY
        let listHeight = needs.frame.height
        XCTAssertTrue(app.descendants(matching: .any).matching(identifier: "lead-row").firstMatch.exists, "the lead, the first row of the channel")
        XCTAssertFalse(app.buttons["tab-you"].exists, "You isn't a tab")
        XCTAssertTrue(app.buttons["you"].isHittable, "You is the face at the top right")
        add(shot(app, "list with the bar"))

        channel.tap()
        let card = app.buttons["channel-card"]
        XCTAssertTrue(card.waitForExistence(timeout: 5), "the channel grows into its card")
        let leadField = app.descendants(matching: .any).matching(identifier: "composer").firstMatch
        XCTAssertTrue(leadField.waitForExistence(timeout: 5), "with a field to message the lead")
        XCTAssertFalse(needs.isHittable, "the card takes the row")
        sleep(1)
        add(shot(app, "channel card open"))
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)).tap()
        XCTAssertTrue(channel.waitForHittable(timeout: 5), "tapping outside folds it back")

        general.tap()
        let field = app.descendants(matching: .any).matching(identifier: "composer").firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 15), "the chat's composer")
        XCTAssertTrue(needs.waitForHittable(timeout: 5), "in a chat the tabs stay, as icons")
        XCTAssertEqual(needs.frame.midY, field.frame.midY, accuracy: 4, "one row: the tab icons and the composer")
        XCTAssertEqual(needs.frame.midY, listRow, accuracy: 1, "the row sits where it sat on the list")
        XCTAssertEqual(needs.frame.height, listHeight, accuracy: 1, "and keeps its height")
        let newest = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Something else'")).firstMatch
        XCTAssertTrue(newest.waitForExistence(timeout: 5), "the newest item, the step's Something else")
        sleep(1)
        add(shot(app, "chat at rest"))
        XCTAssertLessThanOrEqual(newest.frame.maxY, field.frame.minY + 1, "the newest item ends above the bar")
        XCTAssertGreaterThan(newest.frame.maxY, field.frame.minY - 40, "and no wide empty gap sits between them")

        app.swipeDown()
        app.swipeDown()
        sleep(1)
        XCTAssertTrue(needs.isHittable && field.exists, "the bar is there after scrolling")
        app.swipeUp()
        app.swipeUp()
        app.swipeUp()
        sleep(1)
        XCTAssertLessThanOrEqual(newest.frame.maxY, field.frame.minY + 1, "back at the bottom, the newest item ends above the bar")

        needs.tap()
        XCTAssertTrue(app.navigationBars["Needs You"].waitForExistence(timeout: 5), "a tab opens from inside a chat")
        app.buttons["tab-chats"].tap()
        XCTAssertTrue(field.waitForHittable(timeout: 5), "back on Chats, the chat is still open")
        field.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5), "the composer grows over the keyboard")
        sleep(1)
        XCTAssertFalse(needs.isHittable, "and the tabs melt into it")
        field.typeText("hi")
        add(shot(app, "chat typing"))
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
