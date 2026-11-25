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
        XCTAssertTrue(app.buttons["tab-needs"].waitForHittable(timeout: 5), "the tabs outside a chat")
        XCTAssertTrue(app.descendants(matching: .any).matching(identifier: "lead-row").firstMatch.exists, "the lead, at the top of the channel in Chats")
        add(shot(app, "list with the tab bar"))
        general.tap()
        let field = app.descendants(matching: .any).matching(identifier: "composer").firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5), "the chat's composer in the bar")
        let needs = app.buttons["tab-needs"]
        XCTAssertTrue(needs.waitForHittable(timeout: 5), "in a chat all three tabs stay, as icons beside the composer")
        XCTAssertTrue(app.buttons["tab-chats"].isHittable && app.buttons["tab-you"].isHittable)
        XCTAssertEqual(needs.frame.midY, field.frame.midY, accuracy: 2, "one row: the tab icons and the composer")
        XCTAssertGreaterThan(field.frame.width, needs.frame.width * 3, "the composer takes the wide pill")
        sleep(1)
        add(shot(app, "chat at rest with the tab bar"))
        let newest = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Something else'")).firstMatch
        XCTAssertTrue(newest.waitForExistence(timeout: 5), "the newest item, the step's Something else")
        XCTAssertLessThanOrEqual(newest.frame.maxY, field.frame.minY + 1, "the newest item ends above the bar")
        XCTAssertGreaterThan(newest.frame.maxY, field.frame.minY - 40, "and no wide empty gap sits between them")

        app.swipeDown()
        app.swipeDown()
        sleep(1)
        add(shot(app, "chat scrolled up"))
        XCTAssertTrue(field.exists && needs.exists, "the bar is there after scrolling")
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
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5), "the composer opens over the keyboard")
        XCTAssertFalse(needs.exists, "and the bar steps aside")
        app.typeText("hi")
        add(shot(app, "chat typing"))
    }

    @MainActor
    func testMessageTheLeadFromTheBar() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-demo", "YES", "-lockOff", "YES", "-language", "system", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        let pill = app.buttons["lead-composer"]
        XCTAssertTrue(pill.waitForHittable(timeout: 15), "outside a chat, the pill beside the tabs writes to the lead")
        XCTAssertTrue(app.buttons["tab-needs"].isHittable, "beside the tabs")
        XCTAssertEqual(pill.frame.midY, app.buttons["tab-needs"].frame.midY, accuracy: 2, "one row")
        add(shot(app, "chats at rest"))
        pill.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5), "the composer opens over the keyboard")
        XCTAssertFalse(pill.exists, "in place of the bar")
        app.typeText("status?")
        add(shot(app, "lead composer open"))
        app.buttons["Send"].firstMatch.tap()
        XCTAssertTrue(pill.waitForHittable(timeout: 5), "sent, the bar comes back")
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'general'")).firstMatch.exists, "and you stay on Chats")
        add(shot(app, "lead message sent"))
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
