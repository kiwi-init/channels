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
    func testTabBarStaysInAChat() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-demo", "YES", "-lockOff", "YES", "-language", "system", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        let general = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'general'")).firstMatch
        XCTAssertTrue(general.waitForExistence(timeout: 15))
        add(shot(app, "list with the tab bar"))
        general.tap()
        let field = app.descendants(matching: .any).matching(identifier: "composer").firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5), "the chat's composer")
        let needs = app.tabBars.buttons["Needs You"].firstMatch
        XCTAssertTrue(needs.waitForExistence(timeout: 5) && needs.isHittable, "the tab bar stays in a chat")
        sleep(1)
        add(shot(app, "chat at rest with the tab bar"))

        app.swipeDown()
        app.swipeDown()
        sleep(1)
        add(shot(app, "chat scrolled up, the tab bar small"))
        XCTAssertTrue(app.tabBars.firstMatch.exists, "the tab bar is there after scrolling")
        XCTAssertTrue(field.exists, "the composer is there after scrolling")
        app.swipeUp()
        app.swipeUp()
        app.swipeUp()
        sleep(1)
        add(shot(app, "chat scrolled back down"))
        if !needs.isHittable { app.tabBars.buttons["Chats"].firstMatch.tap() }
        XCTAssertTrue(needs.waitForHittable(timeout: 5), "the tab bar opens up again")

        needs.tap()
        XCTAssertTrue(app.navigationBars["Needs You"].waitForExistence(timeout: 5), "a tab opens from inside a chat")
        app.tabBars.buttons["Chats"].firstMatch.tap()
        XCTAssertTrue(field.waitForExistence(timeout: 5), "back on Chats, the chat is still open")
        field.tap()
        sleep(1)
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
