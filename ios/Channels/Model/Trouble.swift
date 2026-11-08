import Foundation
import os

enum Trouble {
    private static let log = Logger(subsystem: "com.kiwiinit.channels", category: "app")

    static func note(_ what: String, _ error: Error) {
        log.error("\(what, privacy: .public): \(error.localizedDescription, privacy: .public)")
    }

    static func note(_ what: String) {
        log.error("\(what, privacy: .public)")
    }
}
