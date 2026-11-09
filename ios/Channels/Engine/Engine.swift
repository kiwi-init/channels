import Foundation
import OSLog
import SwiftUI
import WebKit

enum EngineError: LocalizedError {
    case missing
    case refused(String)
    case garbled

    var errorDescription: String? {
        switch self {
        case .missing: String(localized: "The app is missing its engine. Reinstall Channels.")
        case .refused(let why): why
        case .garbled: String(localized: "The engine answered something this app can't read.")
        }
    }
}

enum Push {
    case saved(Data)
    case room(RoomView)
    case gone(String)
    case log(String)
    case removed(String)
    case kept(String, Data)
}

@MainActor
final class Engine: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    let web: WKWebView
    var demo = false
    private var loaded: CheckedContinuation<Void, Error>?
    private let decoder = JSONDecoder()
    private let logger = Logger(subsystem: "com.kiwiinit.channels", category: "engine")
    private static let signIn: Set<String> = [
        "https://github.com/login/device/code", "https://github.com/login/oauth/access_token",
    ]
    var onPush: (Push) -> Void = { _ in }
    var onLost: () -> Void = {}

    override init() {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.suppressesIncrementalRendering = true
        config.preferences.inactiveSchedulingPolicy = .none
        web = WKWebView(frame: CGRect(x: 0, y: 0, width: 1, height: 1), configuration: config)
        super.init()
        config.userContentController.add(Relay(self), name: "kiwi")
        web.navigationDelegate = self
        web.isInspectable = true
    }

    func load() async throws {
        guard let url = Bundle.main.url(forResource: "engine", withExtension: "js") else { throw EngineError.missing }
        let source = try String(contentsOf: url, encoding: .utf8)
        web.configuration.userContentController.addUserScript(
            WKUserScript(source: source, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        try await open()
    }

    func open() async throws {
        try await withCheckedThrowingContinuation { (done: CheckedContinuation<Void, Error>) in
            loaded = done
            web.loadHTMLString("<!doctype html><meta charset=utf-8><title>Channels engine</title>", baseURL: URL(string: "http://localhost/"))
        }
    }

    @discardableResult
    func ask(_ request: [String: Any]) async throws -> Data {
        if demo { throw EngineError.refused(Demo.refusal) }
        let json = String(data: try JSONSerialization.data(withJSONObject: request), encoding: .utf8) ?? "{}"
        let raw = try await web.callAsyncJavaScript("return await kiwi.ask(json)", arguments: ["json": json], in: nil, contentWorld: .page)
        guard let text = raw as? String, let data = text.data(using: .utf8),
            let reply = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { throw EngineError.garbled }
        guard reply["ok"] as? Bool == true else { throw EngineError.refused(reply["error"] as? String ?? String(localized: "Something went wrong.")) }
        return try JSONSerialization.data(withJSONObject: reply["value"] ?? NSNull(), options: .fragmentsAllowed)
    }

    func ask<T: Decodable>(_ request: [String: Any], as: T.Type) async throws -> T {
        try decoder.decode(T.self, from: try await ask(request))
    }

    private func fetchForEngine(_ id: Int, _ url: String, _ body: String) async {
        var answer: [String: Any] = ["id": id]
        if Self.signIn.contains(url), let target = URL(string: url) {
            var request = URLRequest(url: target, timeoutInterval: 20)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "content-type")
            request.setValue("application/json", forHTTPHeaderField: "accept")
            request.httpBody = Data(body.utf8)
            do {
                let (data, response) = try await URLSession.shared.data(for: request)
                answer["status"] = (response as? HTTPURLResponse)?.statusCode ?? 500
                answer["body"] = String(decoding: data, as: UTF8.self)
            } catch {
                logger.info("sign-in: \(target.lastPathComponent, privacy: .public) failed: \(error.localizedDescription, privacy: .public)")
                answer["error"] = error.localizedDescription
            }
        } else {
            answer["error"] = "this app only makes its sign-in calls"
        }
        guard let blob = try? JSONSerialization.data(withJSONObject: answer), let json = String(data: blob, encoding: .utf8) else {
            return dropped("the sign-in answer for fetch \(id): it isn't JSON")
        }
        do {
            _ = try await web.callAsyncJavaScript("kiwi.fetched(json)", arguments: ["json": json], in: nil, contentWorld: .page)
        } catch {
            logger.info("sign-in: couldn't hand the engine its answer: \(error.localizedDescription, privacy: .public)")
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loaded?.resume()
        loaded = nil
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        loaded?.resume(throwing: error)
        loaded = nil
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        onPush(.log("engine restarted"))
        loaded?.resume(throwing: EngineError.garbled)
        loaded = nil
        onLost()
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let text = message.body as? String, let data = text.data(using: .utf8),
            let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], let type = object["type"] as? String
        else { return dropped("a push that isn't JSON with a type") }
        switch type {
        case "saved":
            guard let saved = object["saved"], let blob = try? JSONSerialization.data(withJSONObject: saved) else { return dropped("a saved push without keys") }
            onPush(.saved(blob))
        case "room":
            guard let room = object["room"], let blob = try? JSONSerialization.data(withJSONObject: room) else { return dropped("a room push without a room") }
            do {
                onPush(.room(try decoder.decode(RoomView.self, from: blob)))
            } catch {
                dropped("a room view that didn't decode: \(error)")
            }
        case "gone":
            guard let code = object["code"] as? String else { return dropped("a gone push without a code") }
            onPush(.gone(code))
        case "log":
            guard let line = object["line"] as? String else { return dropped("a log push without a line") }
            logger.info("\(line, privacy: .public)")
            onPush(.log(line))
        case "fetch":
            guard let id = object["id"] as? Int, let url = object["url"] as? String, let body = object["body"] as? String else {
                return dropped("a fetch push without an id, url or body")
            }
            Task { await fetchForEngine(id, url, body) }
        case "removed":
            onPush(.removed(object["by"] as? String ?? String(localized: "another device")))
        case "kept":
            guard let code = object["code"] as? String, let sealed = object["sealed"], let blob = try? JSONSerialization.data(withJSONObject: sealed) else {
                return dropped("a kept push without a code or sealed view")
            }
            onPush(.kept(code, blob))
        default:
            dropped("a push of unknown type \(type)")
        }
    }

    private func dropped(_ what: String) {
        logger.error("engine: dropped \(what, privacy: .public)")
        onPush(.log("dropped \(what)"))
    }
}

struct EngineHost: UIViewRepresentable {
    let engine: Engine

    func makeUIView(context: Context) -> WKWebView {
        engine.web
    }

    func updateUIView(_ view: WKWebView, context: Context) {}
}

private final class Relay: NSObject, WKScriptMessageHandler {
    weak var engine: Engine?

    init(_ engine: Engine) {
        self.engine = engine
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        MainActor.assumeIsolated {
            engine?.userContentController(controller, didReceive: message)
        }
    }
}
