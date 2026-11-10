import SwiftUI

@MainActor
enum FeedLog {
    #if DEBUG
        static let on = UserDefaults.standard.bool(forKey: "feedlog")
        static var rows = 0
    #endif

    static func note(_ what: @autoclosure () -> String) {
        #if DEBUG
            if on { NSLog("FEEDLOG rows %d %@", rows, what()) }
        #endif
    }

    static func row(_ by: Int) {
        #if DEBUG
            rows += by
        #endif
    }
}

extension View {
    func feedLogged() -> some View {
        onAppear { FeedLog.row(1) }.onDisappear { FeedLog.row(-1) }
    }
}
