import XCTest

final class LanguageTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    @MainActor
    func testPickingALanguageChangesTheAppAtOnce() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-demo", "YES", "-language", "system", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        let you = app.tabBars.buttons["You"]
        XCTAssertTrue(you.waitForExistence(timeout: 15))
        you.tap()
        let row = app.buttons["language"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 5), "the Language row in You")
        add(shot(app, "language en"))

        row.tap()
        let japanese = app.buttons["日本語"].firstMatch
        XCTAssertTrue(japanese.waitForExistence(timeout: 5), "日本語 among the choices")
        add(shot(app, "language choices"))
        japanese.tap()
        XCTAssertTrue(app.tabBars.buttons["あなた"].waitForExistence(timeout: 5), "the tab bar is in Japanese without a restart")
        add(shot(app, "language ja"))

        app.buttons["language"].firstMatch.tap()
        let system = app.buttons.matching(NSPredicate(format: "label IN %@", ["System", "システム"])).firstMatch
        XCTAssertTrue(system.waitForExistence(timeout: 5))
        system.tap()
        XCTAssertTrue(app.tabBars.buttons["You"].waitForExistence(timeout: 5), "System goes back to the phone's language")
    }

    @MainActor
    func testSystemLanguageIsFollowed() throws {
        for (language, locale, tab, name) in [("pt-BR", "pt_BR", "Você", "pt-BR"), ("ja", "ja_JP", "あなた", "ja")] {
            let app = XCUIApplication()
            app.launchArguments = ["-demo", "YES", "-language", "system", "-AppleLanguages", "(\(language))", "-AppleLocale", locale]
            app.launch()
            XCTAssertTrue(app.tabBars.buttons[tab].waitForExistence(timeout: 15), "the app follows a phone set to \(language)")
            add(shot(app, "system \(name) chats"))
            app.tabBars.buttons[tab].tap()
            XCTAssertTrue(app.buttons["language"].firstMatch.waitForExistence(timeout: 5))
            add(shot(app, "system \(name) you"))
            app.terminate()
        }
    }

    @MainActor
    private func shot(_ app: XCUIApplication, _ name: String) -> XCTAttachment {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        return attachment
    }
}
