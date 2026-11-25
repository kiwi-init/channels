#if DEBUG
    import Foundation

    @MainActor
    enum Busy {
        static func run(_ json: String, into model: AppModel, history: Bool = false) {
            guard var room = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any],
                let first = (room["messages"] as? [[String: Any]])?.first
            else { return }
            var messages: [[String: Any]] = []
            var seq = 0
            func add(_ words: String, from: String) {
                seq += 1
                var m = first
                m["seq"] = seq
                m["from"] = from
                m["at"] = Date.now.timeIntervalSince1970 * 1000
                m["body"] = words
                m["shown"] = words
                m["plain"] = words
                m["event"] = false
                m["mine"] = false
                m["kind"] = "msg"
                m["quote"] = NSNull()
                m["task"] = NSNull()
                m["reactions"] = [Any]()
                messages.append(m)
            }
            func show() {
                room["messages"] = messages
                guard let data = try? JSONSerialization.data(withJSONObject: room),
                    let view = try? JSONDecoder().decode(RoomView.self, from: data)
                else { return }
                model.rooms[view.code] = view
            }
            let long =
                "a long one. It runs on for a while, the way an agent explains what it found, so the bubble is many lines tall.\n\nA second paragraph, with more to say about where things stand and what comes next, before it ends."
            if history {
                show()
                Task {
                    for batch in [40, 30, 10] {
                        try? await Task.sleep(for: .milliseconds(1200))
                        for _ in 0..<batch {
                            add("History \(seq + 1): \(seq.isMultiple(of: 3) ? long : "short")", from: seq.isMultiple(of: 2) ? "lead" : "builder")
                        }
                        show()
                    }
                }
                return
            }
            for n in 1...80 {
                add(
                    n.isMultiple(of: 3) ? "Busy \(n): a longer line that wraps onto a second line in the bubble, the way agents write" : "Busy \(n): short",
                    from: n.isMultiple(of: 2) ? "lead" : "builder")
            }
            show()
            Task {
                while true {
                    try? await Task.sleep(for: .milliseconds(1500))
                    add("Busy \(seq + 1): \((seq + 1).isMultiple(of: 4) ? long : "arrived while you type")", from: "builder")
                    show()
                }
            }
        }
    }
#endif
