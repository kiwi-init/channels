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
    case failed(String)
}

@MainActor
@Observable
final class AppModel {
    var phase: Phase = .starting
    var person: String = ""
    var relay: String = ""
    var rooms: [String: RoomView] = [:]
    var linking: Linking = .idle
    var relinkAsked = false

    var relinking: Bool {
        phase == .ready && (relinkAsked || linking != .idle)
    }
    var seen: [String: Int] = UserDefaults.standard.dictionary(forKey: "seen") as? [String: Int] ?? [:]
    var pinned: [String] = UserDefaults.standard.stringArray(forKey: "pinned") ?? []

    @ObservationIgnored let engine = Engine()
    @ObservationIgnored private var booted = false
    @ObservationIgnored private let pictures = NSCache<NSString, UIImage>()

    var channels: [RoomView] {
        rooms.values.filter { $0.gone == nil }.sorted { ($0.last?.at ?? 0) > ($1.last?.at ?? 0) }
    }

    var pinnedChannels: [RoomView] {
        pinned.compactMap { rooms[$0] }.filter { $0.gone == nil }
    }

    var otherChannels: [RoomView] {
        channels.filter { !pinned.contains($0.code) }
    }

    func togglePin(_ room: RoomView) {
        if pinned.contains(room.code) {
            pinned.removeAll { $0 == room.code }
        } else {
            pinned.append(room.code)
        }
        UserDefaults.standard.set(pinned, forKey: "pinned")
    }

    func markUnread(_ room: RoomView) {
        guard let last = room.messages.last(where: { !$0.mine && !$0.event }) else { return }
        seen[room.code] = last.seq - 1
        UserDefaults.standard.set(seen, forKey: "seen")
    }

    func markRead(_ room: RoomView) {
        guard let top = room.messages.last?.seq else { return }
        seen[room.code] = top
        UserDefaults.standard.set(seen, forKey: "seen")
    }

    func unread(_ room: RoomView) -> Int {
        let mark = seen[room.code] ?? 0
        return room.messages.filter { $0.seq > mark && !$0.mine && !$0.event }.count
    }

    func markSeen(_ room: RoomView) {
        guard let top = room.messages.last?.seq, top > (seen[room.code] ?? 0) else { return }
        seen[room.code] = top
        UserDefaults.standard.set(seen, forKey: "seen")
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
        person = (object["person"] as? [String: Any])?["name"] as? String ?? ""
        relay = object["relay"] as? String ?? ""
        do {
            try await engine.ask(["op": "start", "saved": object])
            phase = .ready
        } catch {
            phase = .broken(error.localizedDescription)
        }
    }

    private func take(_ push: Push) {
        switch push {
        case .saved(let data):
            Vault.save(data)
        case .room(let room):
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

    func cancelLink() async {
        linking = .idle
        relinkAsked = false
        try? await engine.ask(["op": "linkCancel"])
    }

    func send(_ code: String, _ body: String, re: Int?, pictures: [Outgoing] = []) async throws {
        var ask: [String: Any] = ["op": "send", "code": code, "body": body, "imgs": pictures.map { ["name": $0.name, "mime": $0.mime, "data": $0.data] }]
        ask["re"] = re ?? NSNull()
        try await engine.ask(ask)
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

    func nudge() {
        Task { try? await engine.ask(["op": "nudge"]) }
    }

    func unlink() {
        Vault.wipe()
        rooms = [:]
        person = ""
        phase = .unlinked
        Task { try? await engine.ask(["op": "start", "saved": ["relay": relay, "person": NSNull(), "seats": []]]) }
    }
}
