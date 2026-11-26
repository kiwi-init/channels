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
        let titles = app.staticTexts.matching(NSPredicate(format: "label == 'Chats'")).allElementsBoundByIndex
        XCTAssertFalse(titles.contains { $0.frame.maxY < needs.frame.minY - 20 }, "and Chats has no title above the bar")
        add(shot(app, "list with the bar"))

        channel.tap()
        let card = app.buttons["channel-card"]
        XCTAssertTrue(card.waitForExistence(timeout: 5), "the channel grows into its card")
        let leadField = app.descendants(matching: .any).matching(identifier: "composer").firstMatch
        XCTAssertTrue(leadField.waitForExistence(timeout: 5), "with a field to message the lead")
        XCTAssertFalse(needs.isHittable, "the card takes the row")
        XCTAssertTrue(app.buttons["tab-current"].isHittable, "the tabs shrink to one round button beside it")
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
        XCTAssertGreaterThan(newest.frame.maxY, field.frame.minY - 60, "and no wide empty gap sits between them")

        app.swipeDown()
        app.swipeDown()
        sleep(1)
        XCTAssertTrue(needs.isHittable && field.exists, "the bar is there after scrolling")
        app.swipeUp()
        app.swipeUp()
        app.swipeUp()
        sleep(1)
        XCTAssertLessThanOrEqual(newest.frame.maxY, field.frame.minY + 1, "back at the bottom, the newest item ends above the bar")
        let jump = app.buttons["jump"]
        XCTAssertFalse(jump.exists, "at the bottom there is no ↓ button")
        app.swipeDown(velocity: .fast)
        app.swipeDown(velocity: .fast)
        app.swipeDown(velocity: .fast)
        XCTAssertTrue(jump.waitForHittable(timeout: 5), "a screen up, the ↓ button shows")
        add(shot(app, "chat jump"))
        XCTAssertLessThanOrEqual(jump.frame.maxY, field.frame.minY - 8, "above the bar, not inside it")
        XCTAssertGreaterThan(jump.frame.maxY, field.frame.minY - 20, "right above it")
        jump.tap()
        sleep(1)
        XCTAssertLessThanOrEqual(newest.frame.maxY, field.frame.minY + 1, "after ↓, the newest item ends above the bar")
        XCTAssertGreaterThan(newest.frame.maxY, field.frame.minY - 60, "right above it")
        XCTAssertFalse(jump.exists, "and the ↓ button goes away")

        needs.tap()
        XCTAssertTrue(app.buttons["tab-needs"].waitForSelected(timeout: 5), "a tab opens from inside a chat")
        XCTAssertFalse(app.navigationBars["Needs You"].exists, "with no title: the bar says where you are")
        app.buttons["tab-chats"].tap()
        XCTAssertTrue(field.waitForHittable(timeout: 5), "back on Chats, the chat is still open")
        field.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5), "the composer grows over the keyboard")
        sleep(1)
        XCTAssertFalse(needs.isHittable, "and the tabs melt into it")
        field.typeText("hi")
        sleep(1)
        add(shot(app, "chat typing"))
        XCTAssertLessThanOrEqual(newest.frame.maxY, field.frame.minY + 1, "typing, the newest item ends above the composer")
        XCTAssertGreaterThan(newest.frame.maxY, field.frame.minY - 60, "and stays right above it, not scrolled away")
    }

    @MainActor
    func testKeyboardLeavesTheBarAtRest() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-demo", "YES", "-lockOff", "YES", "-language", "system", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        let general = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'general'")).firstMatch
        XCTAssertTrue(general.waitForExistence(timeout: 15))
        general.tap()
        let field = app.descendants(matching: .any).matching(identifier: "composer").firstMatch
        let needs = app.buttons["tab-needs"]
        let keyboard = app.keyboards.firstMatch
        let newest = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Something else'")).firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 15) && needs.waitForHittable(timeout: 5), "the chat's row")
        sleep(1)
        let row = needs.frame
        let rest = field.frame

        func type(_ how: String) {
            field.tap()
            XCTAssertTrue(keyboard.waitForExistence(timeout: 5), "\(how): the keyboard is up")
            XCTAssertFalse(needs.isHittable, "\(how): the tabs melt into the composer while typing")
        }
        func atRest(_ how: String, newestAbove: Bool = true) {
            XCTAssertTrue(keyboard.waitForNonExistence(timeout: 5), "\(how): the keyboard goes")
            XCTAssertTrue(needs.waitForHittable(timeout: 5), "\(how): the tabs come back")
            sleep(1)
            XCTAssertEqual(needs.frame.midY, row.midY, accuracy: 1, "\(how): the row is back where it rests")
            XCTAssertEqual(needs.frame.height, row.height, accuracy: 1, "\(how): at its height")
            XCTAssertEqual(field.frame.height, rest.height, accuracy: 1, "\(how): the composer is one line again")
            XCTAssertEqual(field.frame.midY, rest.midY, accuracy: 1, "\(how): and sits in the row")
            if newestAbove {
                XCTAssertLessThanOrEqual(newest.frame.maxY, field.frame.minY + 1, "\(how): the newest item ends above the bar")
            }
            add(shot(app, "at rest after \(how)"))
        }

        type("drag")
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.35)).press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.98)))
        atRest("drag", newestAbove: false)
        app.swipeUp()
        app.swipeUp()
        app.swipeUp()
        sleep(1)

        type("feed tap")
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.96, dy: 0.45)).tap()
        atRest("feed tap")

        type("send")
        field.typeText("hi")
        app.buttons["Send"].firstMatch.tap()
        XCTAssertTrue(keyboard.exists, "sending keeps the keyboard up")
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.96, dy: 0.45)).tap()
        atRest("send then feed tap")

        type("back")
        app.navigationBars.buttons.firstMatch.tap()
        XCTAssertTrue(keyboard.waitForNonExistence(timeout: 5), "back: the keyboard goes with the chat")
        XCTAssertTrue(app.buttons["channel"].waitForHittable(timeout: 5), "back: the list's row")
        XCTAssertEqual(needs.frame.midY, row.midY, accuracy: 1, "back: the list's row rests where the chat's did")
        general.tap()
        XCTAssertTrue(field.waitForExistence(timeout: 5), "reopened")
        sleep(1)
        XCTAssertFalse(keyboard.exists, "reopening the chat doesn't bring the keyboard back")
        atRest("reopen")
    }

    @MainActor
    func testTypingWithAPhotoKeepsTheChat() throws {
        let app = XCUIApplication()
        app.launchArguments = [
            "-demo", "YES", "-lockOff", "YES", "-shot", "channel", "-draft", "First line\nSecond line", "-attach", "YES", "-language", "system", "-AppleLanguages", "(en)",
            "-AppleLocale", "en_US",
        ]
        app.launch()
        let field = app.descendants(matching: .any).matching(identifier: "composer").firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 15), "the chat with a draft")
        field.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5), "the keyboard is up")
        sleep(1)
        add(shot(app, "typing with a photo"))
        let newest = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Something else'")).firstMatch
        XCTAssertTrue(newest.exists, "the feed is still there")
        let tray = app.descendants(matching: .any).matching(identifier: "tray").firstMatch
        XCTAssertTrue(tray.exists, "the photo sits in the composer")
        let composerTop = min(tray.frame.minY, field.frame.minY)
        XCTAssertLessThanOrEqual(newest.frame.maxY, composerTop + 1, "the newest item ends above the composer and its photo")
        XCTAssertGreaterThan(newest.frame.maxY, composerTop - 160, "and stays near it, not scrolled away")
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
    func waitForSelected(timeout: TimeInterval) -> Bool {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if exists && isSelected { return true }
            usleep(200_000)
        }
        return exists && isSelected
    }

    func waitForHittable(timeout: TimeInterval) -> Bool {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if exists && isHittable { return true }
            usleep(200_000)
        }
        return exists && isHittable
    }
}
