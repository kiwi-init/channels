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
        try await drawn()
        snap("list")

        tapFirst("general")
        snap("general")
        app.swipeDown()
        snap("general scrolled up")
        back()

        tapFirst("lead")
        snap("lead chat")
        let field = app.textViews.firstMatch.exists ? app.textViews.firstMatch : app.textFields.firstMatch
        if field.waitForExistence(timeout: 2) {
            field.tap()
            try await Task.sleep(for: .milliseconds(600))
            field.typeText("Hello from the tour")
            snap("typed")
        }
        back()

        tapFirst("Needs You")
        snap("needs")
        tapFirst("Run a command")
        snap("need form")
        back()
        back()

        tapFirst("Tasks")
        snap("tasks")
        tapFirst("Composer empties after Send, every time")
        snap("task thread")
        back()
        back()

        tapFirst("You")
        snap("you")
    }

    @MainActor
    private func back() {
        let button = app.navigationBars.buttons.firstMatch
        if button.exists && button.isHittable {
            button.tap()
        } else {
            print("TOUR no back button")
        }
        Thread.sleep(forTimeInterval: 0.7)
    }

    @MainActor
    func testOpenUntouched() async throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["TOUR"] != nil, "a hand-run walk: TEST_RUNNER_TOUR=1")
        let url = try XCTUnwrap(Bundle(for: TourTests.self).url(forResource: "fixture", withExtension: "json"), "the Make the fixture build phase didn't run")
        app = XCUIApplication()
        app.launchEnvironment["CHANNELS_FIXTURE"] = try String(contentsOf: url, encoding: .utf8)
        app.launchArguments = ["-shot", "tour"]
        app.launch()
        try await drawn()
        print("TOUR TREE\n\(app.debugDescription)")
        snap("untouched")
    }

    @MainActor
    func testScreensJowShot() async throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["TOUR"] != nil, "a hand-run walk: TEST_RUNNER_TOUR=1")
        let url = try XCTUnwrap(Bundle(for: TourTests.self).url(forResource: "fixture", withExtension: "json"), "the Make the fixture build phase didn't run")
        for shot in ["list", "needs", "board", "channel"] {
            app = XCUIApplication()
            app.launchEnvironment["CHANNELS_FIXTURE"] = try String(contentsOf: url, encoding: .utf8)
            app.launchArguments = ["-shot", shot]
            app.launch()
            try await drawn()
            snap("shot \(shot)")
            app.terminate()
        }
    }

    @MainActor
    private func drawn() async throws {
        let shown = app.navigationBars.firstMatch.waitForExistence(timeout: 40) || app.buttons["Needs You"].waitForExistence(timeout: 5)
        if !shown { print("TOUR nothing drew within 45 s") }
        try await Task.sleep(for: .seconds(1))
    }

    @MainActor
    private func tapFirst(_ label: String) {
        let matches = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@ OR label BEGINSWITH %@", label, label + " "))
        _ = matches.firstMatch.waitForExistence(timeout: 2)
        if let hit = matches.allElementsBoundByIndex.first(where: { $0.isHittable }) {
            hit.tap()
        } else {
            print("TOUR couldn't tap \(label)")
        }
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
