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
    case opening
    case signingIn(url: String?, code: String)
    case asking
    case approve(String)
    case check(name: String, fingerprint: String, digits: String)
    case failed(String)
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
    var path: [Route] = []
    var showing: Route?
    var drawer: Drawer = .closed
    var pane: Pane = .needs
    var enrolled = false
    var joining = 0
    var unsaved: String?
    private let push = PushTags()
    private let github = GitHubSheet()

    var relinking: Bool {
        phase == .ready && (relinkAsked || linking != .idle)
    }
    var seen: [String: Int] = UserDefaults.standard.dictionary(forKey: "seen") as? [String: Int] ?? [:]
    var placeSeen: [String: Int] = UserDefaults.standard.dictionary(forKey: "placeSeen") as? [String: Int] ?? [:]
    var drafts: [String: Draft] = [:]
    var feeds: [String: Feed] = [:]
    var pending: [String: [Pending]] = [:]
    var sentAs: [String: [Int: UUID]] = [:]

    @ObservationIgnored let engine = Engine()
    @ObservationIgnored private var booted = false
    @ObservationIgnored private var shut = false
    @ObservationIgnored private var keeping: Data?
    @ObservationIgnored private let pictures = NSCache<NSString, UIImage>()
    @ObservationIgnored private var wroteMarks: [String: [String: Int]] = [:]
    @ObservationIgnored private var pulledMarks: Set<String> = []
    @ObservationIgnored var keptUnread: Set<String> = []
    @ObservationIgnored private var front = true
    @ObservationIgnored private var leaving: UIBackgroundTaskIdentifier = .invalid

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
        do {
            try await engine.ask(["op": "open", "code": code, "place": place])
        } catch {
            Trouble.note("open \(place)", error)
        }
    }

    func boot() async {
        guard !booted else { return }
        booted = true
        engine.onPush = { [weak self] push in self?.take(push) }
        engine.onLost = { [weak self] in
            Task { await self?.recover() }
        }
        do {
            try await engine.load()
        } catch {
            phase = .broken(error.localizedDescription)
            return
        }
        #if DEBUG
            if let json = ProcessInfo.processInfo.environment["CHANNELS_FIXTURE"] {
                do {
                    let room = try JSONDecoder().decode(RoomView.self, from: Data(json.utf8))
                    rooms[room.code] = room
                    phase = .ready
                    return
                } catch {
                    Trouble.note("CHANNELS_FIXTURE", error)
                }
            }
            switch UserDefaults.standard.string(forKey: "link") {
            case "github": linking = .signingIn(url: "https://github.com/login/device", code: "4F2A-9C1B")
            case "asking": linking = .asking
            case "digits": linking = .approve("482915")
            case "check": linking = .check(name: "Jow", fingerprint: "3fa2 91c0 7be4 d518 0c6a", digits: "482915")
            default: break
            }
        #endif
        await resume()
        #if DEBUG
            if phase == .unlinked, UserDefaults.standard.string(forKey: "link") == "start" { await signIn() }
        #endif
    }

    private func recover() async {
        do {
            try await engine.open()
        } catch {
            phase = .broken(error.localizedDescription)
            return
        }
        await resume()
    }

    private func resume() async {
        switch Vault.load() {
        case .empty:
            shut = false
            phase = .unlinked
        case .shut(let why):
            shut = true
            phase = .broken("Channels can't read its sign-in: \(why.localizedDescription). Unlock this iPhone and it carries on.")
        case .found(let saved):
            shut = false
            store(saved)
            await start(saved)
        }
    }

    func awake() async {
        if phase == .ready, push.stale(Set(rooms.keys)), let token = push.token { await registerPush(token) }
        if shut {
            await resume()
        } else if let keeping {
            store(keeping)
        }
        nudge()
    }

    private func store(_ data: Data) {
        do {
            try Vault.save(data)
            keeping = nil
            unsaved = nil
        } catch {
            keeping = data
            unsaved = "This iPhone couldn't save your sign-in: \(error.localizedDescription). You stay signed in until Channels closes, and it tries again each time you open it."
        }
    }

    private func start(_ saved: Data) async {
        let object: [String: Any]
        do {
            guard let parsed = try JSONSerialization.jsonObject(with: saved) as? [String: Any] else { throw EngineError.garbled }
            object = parsed
        } catch {
            Trouble.note("saved sign-in unreadable", error)
            phase = .unlinked
            return
        }
        held(object)
        do {
            let codes = (object["seats"] as? [[String: Any]] ?? []).compactMap { $0["code"] as? String }
            try await engine.ask(["op": "start", "saved": object, "kept": Kept.load(codes)])
            phase = .ready
            PushDelegate.onToken = { [weak self] token in Task { await self?.registerPush(token) } }
            Task { await PushTags.ask() }
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
            store(data)
            do {
                if let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] { held(object) }
            } catch {
                Trouble.note("saved push unreadable", error)
            }
        case .room(let room):
            if let before = rooms[room.code], before.connection == .live {
                let known = Set(before.asks.map(\.seq))
                let reviewed = Set(before.reviews.map(\.task))
                let seen = Set(before.open.map(\.id))
                if room.asks.contains(where: { !known.contains($0.seq) }) || room.reviews.contains(where: { !reviewed.contains($0.task) })
                    || room.open.contains(where: { !seen.contains($0.id) })
                {
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
            if room.connection == .live { pullOnce(room.code) }
        case .gone(let code):
            rooms[code] = nil
            Kept.drop(code)
        case .kept(let code, let sealed):
            Kept.save(code, sealed)
        case .log:
            return
        case .removed(let by):
            unlink()
            linking = .failed("This iPhone was removed from your devices by \(by), so it deleted its keys and channels. Sign in to add it again.")
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
            _ = try await engine.ask(["op": "enrollAsk"])
            github.close()
            linking = .asking
            let shown = try await engine.ask(["op": "enrollWait"], as: EnrollDigits.self)
            linking = .approve(shown.digits)
            let person = try await engine.ask(["op": "enrollCheck"], as: EnrollPerson.self)
            linking = .check(name: person.name, fingerprint: person.fingerprint, digits: shown.digits)
        } catch {
            github.close()
            if linking != .idle { linking = .failed(error.localizedDescription) }
        }
    }

    func openGitHub() {
        guard case .signingIn(let url, let code) = linking, let page = url.flatMap(URL.init(string:)) else { return }
        github.open(page, code: code)
    }

    func keepLink() async {
        do {
            let data = try await engine.ask(["op": "enrollFinish"])
            store(data)
            linking = .idle
            relinkAsked = false
            rooms = [:]
            await start(data)
        } catch {
            if linking != .idle { linking = .failed(error.localizedDescription) }
        }
    }

    func refuseLink(_ fingerprint: String) async {
        linking = .failed(
            "Kept nothing. If your computer never showed \(fingerprint), someone else answered this iPhone. Your computer may still list it under Devices: remove it there.")
        await cancelEnroll()
    }

    private func registerPush(_ token: String) async {
        #if DEBUG
            let sandbox = true
        #else
            let sandbox = false
        #endif
        do {
            let seats = try await engine.ask(["op": "push", "token": token, "sandbox": sandbox], as: [PushSeat].self)
            push.take(seats, token: token)
            for seat in seats where !seat.ok { Trouble.note("push: \(seat.label) refused: \(seat.error ?? "")") }
        } catch {
            Trouble.note("push: couldn't register", error)
        }
    }

    func cancelLink() async {
        github.close()
        linking = .idle
        relinkAsked = false
        await cancelEnroll()
    }

    private func cancelEnroll() async {
        do {
            try await engine.ask(["op": "enrollCancel"])
        } catch {
            Trouble.note("enrollCancel", error)
        }
    }

    @discardableResult
    func send(_ spot: Spot, _ body: String, re: Int?, pictures: [Outgoing] = []) async throws -> Int? {
        var ask: [String: Any] = [
            "op": "send", "code": spot.code, "place": spot.place, "body": body, "imgs": pictures.map { ["name": $0.name, "mime": $0.mime, "data": $0.data] },
        ]
        ask["re"] = re ?? NSNull()
        let data = try await engine.ask(ask)
        do {
            return try JSONDecoder().decode(Int.self, from: data)
        } catch {
            Trouble.note("send: no seq back", error)
            return nil
        }
    }

    func image(_ code: String, seq: Int, index: Int) async -> UIImage? {
        let key = "\(code)/\(seq)/\(index)" as NSString
        if let hit = pictures.object(forKey: key) { return hit }
        do {
            let data = try await engine.ask(["op": "image", "code": code, "seq": seq, "index": index])
            guard let text = try JSONDecoder().decode(String?.self, from: data) else { return nil }
            guard let raw = Data(base64Encoded: text), let image = UIImage(data: raw) else {
                Trouble.note("image \(key): not a picture")
                return nil
            }
            pictures.setObject(image, forKey: key)
            return image
        } catch {
            Trouble.note("image \(key)", error)
            return nil
        }
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

    func allow(_ code: String, id: String, allow: Bool) async throws {
        try await engine.ask(["op": "allow", "code": code, "id": id, "allow": allow])
    }

    func letIn(_ code: String, id: String) async throws {
        try await engine.ask(["op": "letIn", "code": code, "id": id])
    }

    func approveSpec(_ code: String, ask: Int, v: Int) async throws {
        try await engine.ask(["op": "approveSpec", "code": code, "ask": ask, "v": v])
    }

    func nudge() {
        Task {
            do {
                try await engine.ask(["op": "nudge"])
            } catch {
                Trouble.note("nudge", error)
            }
        }
    }

    func cameToFront() {
        front = true
        pulledMarks = []
        for (code, room) in rooms where room.connection == .live { pullOnce(code) }
    }

    func wentToBack() {
        front = false
        endLeaving()
        leaving = UIApplication.shared.beginBackgroundTask(withName: "read marks") { [weak self] in
            MainActor.assumeIsolated { self?.endLeaving() }
        }
        Task {
            await syncMarks(write: true)
            endLeaving()
        }
    }

    func marksTick() async {
        guard front else { return }
        await syncMarks(write: true)
    }

    private func endLeaving() {
        guard leaving != .invalid else { return }
        UIApplication.shared.endBackgroundTask(leaving)
        leaving = .invalid
    }

    private func pullOnce(_ code: String) {
        guard front, !pulledMarks.contains(code) else { return }
        pulledMarks.insert(code)
        Task { await syncMarks(code, write: false) }
    }

    private func syncMarks(write: Bool) async {
        for code in rooms.keys.sorted() { await syncMarks(code, write: write) }
    }

    private func syncMarks(_ code: String, write: Bool) async {
        guard let room = rooms[code], room.gone == nil else { return }
        let keys = ["main"] + (room.sideKey.map { [$0] } ?? [])
        let local = marks(code, keys)
        if write && (local.isEmpty || wroteMarks[code] == local) { return }
        let merged: [String: Int]
        do {
            merged = try await engine.ask(["op": "marks", "code": code, "marks": local, "write": write], as: [String: Int].self)
        } catch {
            Trouble.note("marks \(code)", error)
            return
        }
        var main = false
        var side = false
        for (key, mark) in merged where keys.contains(key) {
            if keptUnread.contains("\(code)|\(key)") { continue }
            if key == "main" {
                if mark > (seen[code] ?? 0) {
                    seen[code] = mark
                    main = true
                }
            } else if mark > (placeSeen["\(code)|\(key)"] ?? 0) {
                placeSeen["\(code)|\(key)"] = mark
                side = true
            }
        }
        if main { UserDefaults.standard.set(seen, forKey: "seen") }
        if side { UserDefaults.standard.set(placeSeen, forKey: "placeSeen") }
        if write { wroteMarks[code] = marks(code, keys) }
    }

    private func marks(_ code: String, _ keys: [String]) -> [String: Int] {
        var out: [String: Int] = [:]
        for key in keys {
            if let mark = key == "main" ? seen[code] : placeSeen["\(code)|\(key)"] { out[key] = mark }
        }
        return out
    }

    func unlink() {
        Vault.wipe()
        Kept.wipe()
        push.forget()
        keeping = nil
        unsaved = nil
        rooms = [:]
        feeds = [:]
        drafts = [:]
        pending = [:]
        sentAs = [:]
        path = []
        showing = nil
        drawer = .closed
        pane = .needs
        person = ""
        enrolled = false
        joining = 0
        phase = .unlinked
        let relay = relay
        Task {
            do {
                try await engine.ask(["op": "start", "saved": ["relay": relay, "person": NSNull(), "seats": []]])
            } catch {
                Trouble.note("start after unlink", error)
            }
        }
    }
}
