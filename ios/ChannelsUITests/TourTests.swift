import XCTest

final class TourTests: XCTestCase {
    private var app: XCUIApplication!
    private var step = 0

    @MainActor
    func testTour() async throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["TOUR"] != nil, "a hand-run walk: TEST_RUNNER_TOUR=1 xcodebuild test -only-testing:ChannelsUITests/TourTests")
        let url = try XCTUnwrap(Bundle(for: TourTests.self).url(forResource: "fixture", withExtension: "json"), "the Make the fixture build phase didn't run")
        app = XCUIApplication()
        app.launchEnvironment["CHANNELS_FIXTURE"] = try String(contentsOf: url, encoding: .utf8)
        app.launchArguments = ["-shot", "tour"]
        app.launch()
        try await Task.sleep(for: .seconds(3))
        snap("open")

        app.swipeUp()
        snap("scrolled down")
        app.swipeDown()
        app.swipeDown()
        snap("scrolled up")

        drag(fromX: 0.25, toX: 0.9)
        snap("drawer")
        tapFirst("lead")
        snap("lead chat")

        let field = app.textViews.firstMatch.exists ? app.textViews.firstMatch : app.textFields.firstMatch
        if field.waitForExistence(timeout: 2) {
            field.tap()
            try await Task.sleep(for: .milliseconds(600))
            snap("keyboard")
            field.typeText("Hello from the tour")
            snap("typed")
            drag(fromX: 0.25, toX: 0.9)
            snap("drawer with keyboard")
            drag(fromX: 0.9, toX: 0.1)
        }

        tapFirst("Channels")
        snap("menu button")
        tapFirst("Needs You")
        snap("needs")
        if app.cells.firstMatch.waitForExistence(timeout: 2) {
            app.cells.firstMatch.tap()
            try await Task.sleep(for: .milliseconds(600))
            snap("need form")
        }

        tapFirst("Channels")
        tapFirst("channels-dev")
        snap("channel sidebar")
        tapFirst("Tasks")
        snap("tasks")
        if app.cells.firstMatch.waitForExistence(timeout: 2) {
            app.cells.firstMatch.tap()
            try await Task.sleep(for: .milliseconds(600))
            snap("task thread")
        }

        drag(fromX: 0.85, toX: 0.15)
        snap("members")
        drag(fromX: 0.15, toX: 0.85)
        snap("members closed")

        let bubble = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Round '")).firstMatch
        if bubble.waitForExistence(timeout: 2) {
            bubble.press(forDuration: 0.8)
            snap("long press")
            app.tap()
        }

        tapFirst("Channels")
        tapFirst("Search")
        snap("search")
        app.swipeDown()
        tapFirst("Channels")
        tapFirst("You")
        snap("you")
    }

    @MainActor
    func testOpenUntouched() async throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["TOUR"] != nil, "a hand-run walk: TEST_RUNNER_TOUR=1")
        let url = try XCTUnwrap(Bundle(for: TourTests.self).url(forResource: "fixture", withExtension: "json"), "the Make the fixture build phase didn't run")
        app = XCUIApplication()
        app.launchEnvironment["CHANNELS_FIXTURE"] = try String(contentsOf: url, encoding: .utf8)
        app.launchArguments = ["-shot", "tour"]
        app.launch()
        try await Task.sleep(for: .seconds(6))
        print("TOUR TREE\n\(app.debugDescription)")
        snap("untouched")
    }

    @MainActor
    func testScreensJowShot() async throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["TOUR"] != nil, "a hand-run walk: TEST_RUNNER_TOUR=1")
        let url = try XCTUnwrap(Bundle(for: TourTests.self).url(forResource: "fixture", withExtension: "json"), "the Make the fixture build phase didn't run")
        for shot in ["list", "members", "needs", "board"] {
            app = XCUIApplication()
            app.launchEnvironment["CHANNELS_FIXTURE"] = try String(contentsOf: url, encoding: .utf8)
            app.launchArguments = ["-shot", shot]
            app.launch()
            try await Task.sleep(for: .seconds(3))
            snap("shot \(shot)")
            app.terminate()
        }
    }

    @MainActor
    private func tapFirst(_ label: String) {
        let match = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@ OR label BEGINSWITH %@", label, label + " ")).firstMatch
        if match.waitForExistence(timeout: 2) && match.isHittable {
            match.tap()
        } else {
            print("TOUR couldn't tap \(label)")
        }
        Thread.sleep(forTimeInterval: 0.7)
    }

    @MainActor
    private func drag(fromX: CGFloat, toX: CGFloat) {
        let a = app.coordinate(withNormalizedOffset: CGVector(dx: fromX, dy: 0.5))
        let b = app.coordinate(withNormalizedOffset: CGVector(dx: toX, dy: 0.5))
        a.press(forDuration: 0.05, thenDragTo: b, withVelocity: .fast, thenHoldForDuration: 0.05)
        Thread.sleep(forTimeInterval: 0.7)
    }

    @MainActor
    private func snap(_ name: String) {
        step += 1
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = String(format: "%02d %@", step, name)
        shot.lifetime = .keepAlways
        add(shot)
    }
}
