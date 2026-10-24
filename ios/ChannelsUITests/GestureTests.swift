import XCTest

@MainActor
struct Screen {
    let app: XCUIApplication

    static func list() throws -> Screen {
        let url = try XCTUnwrap(Bundle(for: GestureTests.self).url(forResource: "fixture", withExtension: "json"), "the Make the fixture build phase didn't run")
        let app = XCUIApplication()
        app.launchEnvironment["CHANNELS_FIXTURE"] = try String(contentsOf: url, encoding: .utf8)
        app.launchArguments = ["-shot", "list"]
        app.launch()
        return Screen(app: app)
    }

    func enter(after wait: Duration) async throws {
        let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'channels-dev'")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 30), "the channel list never showed")
        try await Task.sleep(for: .seconds(1))
        row.tap()
        try await Task.sleep(for: wait)
    }

    var window: CGRect { app.windows.firstMatch.frame }

    func texts() throws -> [(label: String, frame: CGRect)] {
        var out: [(label: String, frame: CGRect)] = []
        func walk(_ s: XCUIElementSnapshot) {
            if s.elementType == .staticText { out.append((s.label, s.frame)) }
            s.children.forEach(walk)
        }
        walk(try app.snapshot())
        return out
    }

    func drag(from start: CGPoint, by offset: CGVector, hold: TimeInterval = 0.4) {
        let origin = app.windows.firstMatch.coordinate(withNormalizedOffset: .zero)
        let a = origin.withOffset(CGVector(dx: start.x, dy: start.y))
        let b = origin.withOffset(CGVector(dx: start.x + offset.dx, dy: start.y + offset.dy))
        a.press(forDuration: 0.02, thenDragTo: b, withVelocity: XCUIGestureVelocity(500), thenHoldForDuration: hold)
    }

    func scrolled(from start: CGPoint, onBubble: Bool) async throws -> CGFloat {
        let shown = try texts()
        let bodies = shown.filter { $0.label.hasPrefix("Round ") || $0.label.hasPrefix("progress update") }
        let under = bodies.first { $0.frame.contains(start) }
        XCTAssertEqual(under != nil, onBubble, onBubble ? "the drag doesn't start on a bubble" : "the drag starts on a bubble")
        let window = window
        let visible = bodies.filter { $0.frame.minY > window.minY + 100 && $0.frame.maxY < window.maxY - 100 }
        if under == nil && visible.isEmpty {
            print("GESTURE no bubble to measure in \(window): \(shown.count) texts, bodies \(bodies.map { "\($0.label.prefix(24)) at \($0.frame)" })")
            let shot = XCTAttachment(screenshot: app.screenshot())
            shot.name = "no bubble to measure"
            shot.lifetime = .keepAlways
            XCTContext.runActivity(named: "no bubble to measure") { $0.add(shot) }
        }
        let probe = try XCTUnwrap(under ?? visible.first, "no bubble on the screen to measure")
        drag(from: start, by: CGVector(dx: 0, dy: 200))
        try await Task.sleep(for: .milliseconds(800))
        let after = try XCTUnwrap(try texts().first { $0.label == probe.label }, "the bubble left the screen")
        return after.frame.minY - probe.frame.minY
    }
}

final class GestureTests: XCTestCase {
    private static let entries = 8

    @MainActor
    private func drags(onBubble: Bool) async throws -> [Int] {
        var moved: [Int] = []
        for i in 0..<Self.entries {
            let screen = try Screen.list()
            try await screen.enter(after: .milliseconds(i.isMultiple(of: 2) ? 300 : 800))
            let window = screen.window
            let start = CGPoint(x: onBubble ? window.width * 0.72 : window.maxX - 8, y: window.height * 0.42)
            moved.append(Int(try await screen.scrolled(from: start, onBubble: onBubble)))
        }
        print("GESTURE a 200 pt drag from \(onBubble ? "a bubble" : "beside the bubbles"), \(Self.entries) fresh entries: \(moved.map(String.init).joined(separator: " ")) pt")
        return moved
    }

    @MainActor
    func testDragStartingOnABubbleScrolls() async throws {
        let moved = try await drags(onBubble: true)
        XCTAssertTrue(moved.allSatisfy { $0 > 100 }, "a 200 pt drag that starts on a bubble, right after opening the chat, moved it \(moved) pt")
    }

    @MainActor
    func testDragStartingBesideTheBubblesScrolls() async throws {
        let moved = try await drags(onBubble: false)
        XCTAssertTrue(moved.allSatisfy { $0 > 100 }, "a 200 pt drag beside the bubbles moved the chat \(moved) pt")
    }

    @MainActor
    func testSwipingABubbleRightReplies() async throws {
        let screen = try Screen.list()
        try await screen.enter(after: .milliseconds(800))
        let window = screen.window
        screen.drag(from: CGPoint(x: window.width * 0.3, y: window.height * 0.42), by: CGVector(dx: 160, dy: 4), hold: 0.2)
        let any = screen.app.descendants(matching: .any)
        let reply = any.matching(NSPredicate(format: "placeholderValue BEGINSWITH 'Reply to'")).firstMatch
        XCTAssertTrue(reply.waitForExistence(timeout: 3), "swiping a bubble right didn't start a reply")
        XCTAssertTrue(any.matching(NSPredicate(format: "label == 'Back'")).firstMatch.exists, "swiping a bubble right left the conversation")
    }
}
