import Foundation
import SwiftUI
import WebKit

enum EngineError: LocalizedError {
    case missing
    case refused(String)
    case garbled

    var errorDescription: String? {
        switch self {
        case .missing: "The app is missing its engine. Reinstall Channels."
        case .refused(let why): why
        case .garbled: "The engine answered something this app can't read."
        }
    }
}

enum Push {
    case saved(Data)
    case room(RoomView)
    case gone(String)
    case log(String)
}

@MainActor
final class Engine: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    let web: WKWebView
    private var loaded: CheckedContinuation<Void, Error>?
    private let decoder = JSONDecoder()
    var onPush: (Push) -> Void = { _ in }

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
        try await withCheckedThrowingContinuation { (done: CheckedContinuation<Void, Error>) in
            loaded = done
            web.loadHTMLString("<!doctype html><meta charset=utf-8><title>Channels engine</title>", baseURL: URL(string: "http://localhost/"))
        }
    }

    @discardableResult
    func ask(_ request: [String: Any]) async throws -> Data {
        let json = String(data: try JSONSerialization.data(withJSONObject: request), encoding: .utf8) ?? "{}"
        let raw = try await web.callAsyncJavaScript("return await kiwi.ask(json)", arguments: ["json": json], in: nil, contentWorld: .page)
        guard let text = raw as? String, let data = text.data(using: .utf8),
            let reply = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { throw EngineError.garbled }
        guard reply["ok"] as? Bool == true else { throw EngineError.refused(reply["error"] as? String ?? "Something went wrong.") }
        return try JSONSerialization.data(withJSONObject: reply["value"] ?? NSNull(), options: .fragmentsAllowed)
    }

    func ask<T: Decodable>(_ request: [String: Any], as: T.Type) async throws -> T {
        try decoder.decode(T.self, from: try await ask(request))
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
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let text = message.body as? String, let data = text.data(using: .utf8) else { return }
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let type = object["type"] as? String else { return }
        switch type {
        case "saved":
            if let saved = object["saved"], let blob = try? JSONSerialization.data(withJSONObject: saved) { onPush(.saved(blob)) }
        case "room":
            if let room = object["room"], let blob = try? JSONSerialization.data(withJSONObject: room),
                let view = try? decoder.decode(RoomView.self, from: blob)
            {
                onPush(.room(view))
            }
        case "gone":
            if let code = object["code"] as? String { onPush(.gone(code)) }
        case "log":
            if let line = object["line"] as? String { onPush(.log(line)) }
        default:
            return
        }
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
