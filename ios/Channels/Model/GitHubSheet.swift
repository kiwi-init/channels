import AuthenticationServices
import UIKit

@MainActor
final class GitHubSheet: NSObject, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?

    func open(_ page: URL, code: String) {
        close()
        if !code.isEmpty { UIPasteboard.general.string = code }
        var parts = URLComponents(url: page, resolvingAgainstBaseURL: false)
        if !code.isEmpty { parts?.queryItems = [URLQueryItem(name: "user_code", value: code)] }
        let session = ASWebAuthenticationSession(url: parts?.url ?? page, callback: .customScheme("kiwichannels")) { _, _ in }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = false
        self.session = session
        if !session.start() { UIApplication.shared.open(page) }
    }

    func close() {
        session?.cancel()
        session = nil
    }

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            return scenes.flatMap(\.windows).first(where: \.isKeyWindow) ?? ASPresentationAnchor()
        }
    }
}
