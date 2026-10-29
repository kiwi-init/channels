import Foundation
import Observation
import SwiftUI
import UIKit

struct Outgoing: Sendable {
    let name: String
    let mime: String
    let data: String
}

enum Phase: Equatable {
    case starting
    case unlinked
    case ready
    case broken(String)
}

enum Linking: Equatable {
    case idle
    case asking
    case digits(String)
    case opening
    case signingIn(url: String?, code: String)
    case approve(String)
    case failed(String)

    var signingIn: Bool {
        switch self {
        case .opening, .signingIn, .approve: true
        default: false
        }
    }
}

struct Draft {
    var text = ""
    var attached: [Attached] = []

    var isEmpty: Bool { text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && attached.isEmpty }
}

@MainActor
@Observable
final class AppModel {
    static let defaultRelay = "https://channels.kiwiinit.com"
    static let signInRelay = UserDefaults.standard.string(forKey: "relay")

    var phase: Phase = .starting
    var person: String = ""
    var relay: String = ""
    var rooms: [String: RoomView] = [:]
    var linking: Linking = .idle
    var relinkAsked = false
    var enrolled = false
    var joining = 0

    var relinking: Bool {
        phase == .ready && (relinkAsked || linking != .idle)
    }
    var seen: [String: Int] = UserDefaults.standard.dictionary(forKey: "seen") as? [String: Int] ?? [:]
    var pinned: [String] = (UserDefaults.standard.stringArray(forKey: "pinned") ?? []).map { $0.contains("|") ? $0 : "\($0)|main" }
    var placeSeen: [String: Int] = UserDefaults.standard.dictionary(forKey: "placeSeen") as? [String: Int] ?? [:]
    var drafts: [String: Draft] = [:]
    var feeds: [String: Feed] = [:]
    var pending: [String: [Pending]] = [:]
    var sentAs: [Int: UUID] = [:]
    var visited: [Spot] = []
    var launches: [String: LaunchSeen] = [:]

    @ObservationIgnored let engine = Engine()
    @ObservationIgnored private var booted = false
    @ObservationIgnored private let pictures = NSCache<NSString, UIImage>()

    var channels: [RoomView] {
        rooms.values.filter { $0.gone == nil }.sorted { (($0.latest ?? $0.last)?.at ?? 0) > (($1.latest ?? $1.last)?.at ?? 0) }
    }

    func fresh(_ room: RoomView, _ key: String) -> Bool {
        guard let place = room.placeView(key), let last = place.last, !last.mine else { return false }
        let mark = key == "main" ? (seen[room.code] ?? 0) : (placeSeen["\(room.code)|\(key)"] ?? 0)
        return place.lastSeq > mark
    }

    func draft(_ code: String, _ place: String) -> Draft {
        drafts["\(code)|\(place)"] ?? Draft()
    }

    func keep(_ draft: Draft, _ code: String, _ place: String) {
        drafts["\(code)|\(place)"] = draft.isEmpty ? nil : draft
    }

    func open(_ code: String, place: String) async {
        try? await engine.ask(["op": "open", "code": code, "place": place])
    }

    func boot() async {
        guard !booted else { return }
        booted = true
        engine.onPush = { [weak self] push in self?.take(push) }
        do {
            try await engine.load()
        } catch {
            phase = .broken(error.localizedDescription)
            return
        }
        #if DEBUG
            if let json = ProcessInfo.processInfo.environment["CHANNELS_FIXTURE"], let room = try? JSONDecoder().decode(RoomView.self, from: Data(json.utf8)) {
                rooms[room.code] = room
                phase = .ready
                return
            }
        #endif
        guard let saved = Vault.load() else {
            phase = .unlinked
            return
        }
        await start(saved)
    }

    private func start(_ saved: Data) async {
        guard let object = try? JSONSerialization.jsonObject(with: saved) as? [String: Any] else {
            phase = .unlinked
            return
        }
        held(object)
        do {
            try await engine.ask(["op": "start", "saved": object])
            phase = .ready
        } catch {
            phase = .broken(error.localizedDescription)
        }
    }

    private func held(_ saved: [String: Any]) {
        let device = saved["device"] as? [String: Any]
        let owner = saved["person"] as? [String: Any] ?? device?["person"] as? [String: Any]
        person = owner?["name"] as? String ?? ""
        relay = saved["relay"] as? String ?? relay
        enrolled = device != nil
        joining = (saved["seats"] as? [[String: Any]] ?? []).count { $0["requestId"] != nil && ($0["access"] == nil || $0["access"] is NSNull) }
    }

    private func take(_ push: Push) {
        switch push {
        case .saved(let data):
            Vault.save(data)
            if let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] { held(object) }
        case .room(let room):
            if let before = rooms[room.code], before.connection == .live {
                let known = Set(before.asks.map(\.seq))
                let reviewed = Set(before.reviews.map(\.task))
                if room.asks.contains(where: { !known.contains($0.seq) }) || room.reviews.contains(where: { !reviewed.contains($0.task) }) {
                    UINotificationFeedbackGenerator().notificationOccurred(.warning)
                }
            }
            feeds["\(room.code)|\(room.place)"] = Feed(messages: room.messages, whole: room.whole)
            defer { settle(room.code) }
            let grew = (room.messages.last?.seq ?? 0) > (rooms[room.code]?.messages.last?.seq ?? Int.max)
            if grew {
                withAnimation(Motion.sent) { rooms[room.code] = room }
            } else {
                rooms[room.code] = room
            }
        case .gone(let code):
            rooms[code] = nil
        case .log:
            return
        case .launch(let launch, let seen):
            launches[launch] = seen
        case .removed(let by):
            unlink()
            linking = .failed("This iPhone was removed from your devices by \(by), so it deleted its keys and channels. Sign in to add it again.")
        }
    }

    func link(_ code: String) async {
        linking = .asking
        do {
            let started = try await engine.ask(["op": "linkAsk", "code": code.trimmingCharacters(in: .whitespacesAndNewlines), "label": UIDevice.current.name], as: LinkStart.self)
            linking = .digits(started.digits)
            let data = try await engine.ask(["op": "linkWait"])
            Vault.save(data)
            linking = .idle
            relinkAsked = false
            rooms = [:]
            await start(data)
        } catch {
            linking = .failed(error.localizedDescription)
        }
    }

    func signIn() async {
        linking = .opening
        do {
            var ask: [String: Any] = [
                "op": "enrollBegin", "relay": Self.signInRelay ?? (relay.isEmpty ? Self.defaultRelay : relay), "label": UIDevice.current.name,
                "os": "iOS \(UIDevice.current.systemVersion)",
            ]
            if let user = UserDefaults.standard.string(forKey: "devUser") { ask["user"] = user }
            let started = try await engine.ask(ask, as: EnrollStart.self)
            linking = .signingIn(url: started.url, code: started.code)
            if let url = started.url.flatMap(URL.init(string:)) { await UIApplication.shared.open(url) }
            let shown = try await engine.ask(["op": "enrollWait"], as: EnrollDigits.self)
            linking = .approve(shown.digits)
            let data = try await engine.ask(["op": "enrollFinish"])
            Vault.save(data)
            linking = .idle
            rooms = [:]
            await start(data)
        } catch {
            if linking != .idle { linking = .failed(error.localizedDescription) }
        }
    }

    func cancelLink() async {
        let enrolling = linking.signingIn
        linking = .idle
        relinkAsked = false
        try? await engine.ask(["op": enrolling ? "enrollCancel" : "linkCancel"])
    }

    @discardableResult
    func send(_ spot: Spot, _ body: String, re: Int?, pictures: [Outgoing] = []) async throws -> Int {
        var ask: [String: Any] = [
            "op": "send", "code": spot.code, "place": spot.place, "body": body, "imgs": pictures.map { ["name": $0.name, "mime": $0.mime, "data": $0.data] },
        ]
        ask["re"] = re ?? NSNull()
        let data = try await engine.ask(ask)
        return (try? JSONDecoder().decode(Int.self, from: data)) ?? 0
    }

    func image(_ code: String, seq: Int, index: Int) async -> UIImage? {
        let key = "\(code)/\(seq)/\(index)" as NSString
        if let hit = pictures.object(forKey: key) { return hit }
        guard let data = try? await engine.ask(["op": "image", "code": code, "seq": seq, "index": index]),
            let text = try? JSONDecoder().decode(String?.self, from: data),
            let raw = Data(base64Encoded: text),
            let image = UIImage(data: raw)
        else { return nil }
        pictures.setObject(image, forKey: key)
        return image
    }

    func react(_ code: String, seq: Int, emoji: String?) async throws {
        try await engine.ask(["op": "react", "code": code, "seq": seq, "emoji": emoji ?? NSNull()])
    }

    func answer(_ code: String, seq: Int, text: String) async throws {
        try await engine.ask(["op": "answer", "code": code, "seq": seq, "text": text])
    }

    func approve(_ code: String, task: Int) async throws {
        try await engine.ask(["op": "approve", "code": code, "task": task])
    }

    func sendBack(_ code: String, task: Int, why: String) async throws {
        try await engine.ask(["op": "sendBack", "code": code, "task": task, "why": why])
    }

    func computers() async throws -> [ComputerView] {
        try await engine.ask(["op": "computers"], as: [ComputerView].self)
    }

    func harnesses(on computer: String) async throws -> HarnessesOn {
        try await engine.ask(["op": "harnessesOn", "computer": computer], as: HarnessesOn.self)
    }

    func folders(on computer: String, code: String) async throws -> [String] {
        try await engine.ask(["op": "foldersOn", "computer": computer, "code": code], as: [String].self)
    }

    func launch(_ code: String, on computer: String, harness: String, folder: String, choices: [String: Any]) async throws -> Launched {
        let ask: [String: Any] = ["op": "launch", "code": code, "computer": computer, "harness": harness, "folder": folder].merging(choices) { first, _ in first }
        return try await engine.ask(ask, as: Launched.self)
    }

    func nudge() {
        Task { try? await engine.ask(["op": "nudge"]) }
    }

    func unlink() {
        Vault.wipe()
        rooms = [:]
        person = ""
        enrolled = false
        joining = 0
        phase = .unlinked
        Task { try? await engine.ask(["op": "start", "saved": ["relay": relay, "person": NSNull(), "seats": []]]) }
    }
}
