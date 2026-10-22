import SwiftUI
import UIKit

struct FanItem: Identifiable, Equatable {
    let key: String
    let title: String
    let line: String
    let fresh: Bool
    let place: PlaceView?

    var id: String { key }

    static let everything = "everything"
}

enum FanMode {
    case held
    case tapped
}

struct Fan: View {
    let room: RoomView
    let items: [FanItem]
    let current: String
    let mode: FanMode
    let hover: String?
    let bottom: CGFloat
    @Binding var frames: [String: CGRect]
    let choose: (String) -> Void
    let dismiss: () -> Void
    @State private var shown = false

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            Rectangle()
                .fill(.black.opacity(shown ? 0.45 : 0))
                .background(.thinMaterial.opacity(shown ? 1 : 0))
                .ignoresSafeArea()
                .onTapGesture(perform: dismiss)
            VStack(alignment: .trailing, spacing: 10) {
                ForEach(Array(items.enumerated().reversed()), id: \.element.id) { index, item in
                    row(item)
                        .scaleEffect(shown ? (hover == item.key ? 1.07 : 1) : 0.4, anchor: .trailing)
                        .opacity(shown ? 1 : 0)
                        .offset(y: shown ? 0 : CGFloat(index + 1) * 22)
                        .animation(.spring(duration: 0.38, bounce: 0.32).delay(shown ? Double(index) * 0.025 : 0), value: shown)
                        .animation(.spring(duration: 0.2, bounce: 0.4), value: hover)
                        .onGeometryChange(for: CGRect.self) {
                            $0.frame(in: .global)
                        } action: {
                            frames[item.key] = $0
                        }
                }
            }
            .padding(.trailing, 14)
            .padding(.bottom, bottom)
        }
        .onAppear { shown = true }
    }

    private func row(_ item: FanItem) -> some View {
        let hot = hover == item.key
        let here = current == item.key
        return Button {
            choose(item.key)
        } label: {
            HStack(spacing: 10) {
                VStack(alignment: .trailing, spacing: 1) {
                    HStack(spacing: 5) {
                        if item.fresh { Dot(color: Tone.accent, size: 7) }
                        Text(item.title).type(.ui, .semibold).foregroundStyle(here ? Tone.accent : Tone.ink).lineLimit(1)
                    }
                    if !item.line.isEmpty {
                        Text(item.line).type(.meta).foregroundStyle(Tone.ink3).lineLimit(1)
                    }
                }
                .frame(maxWidth: 220, alignment: .trailing)
                if item.key == FanItem.everything {
                    Image(systemName: "square.grid.2x2")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Tone.ink2)
                        .frame(width: 36, height: 36)
                        .background(Tone.wash2, in: Circle())
                } else {
                    PlaceFace(room: room, place: item.place, size: 36)
                }
            }
            .padding(.leading, 16)
            .padding(.trailing, 6)
            .padding(.vertical, 6)
            .glassCapsule()
            .overlay(Capsule().strokeBorder(hot ? Tone.accent : (here ? Tone.accent.opacity(0.5) : .clear), lineWidth: hot ? 2 : 1))
        }
        .buttonStyle(.plain)
        .allowsHitTesting(mode == .tapped)
        .accessibilityLabel(here ? "\(item.title), current" : item.title)
    }
}

extension ChannelScreen {
    static func fanItems(_ room: RoomView, model: AppModel, current: String) -> [FanItem] {
        func line(_ m: MessageView?) -> String {
            guard let m else { return "" }
            return "\(m.mine ? "You" : room.display(m.from)): \(m.body.replacingOccurrences(of: "\n", with: " "))"
        }
        var out: [FanItem] = []
        let general = room.placeView("main")
        out.append(FanItem(key: "main", title: "# general", line: line(general?.last), fresh: model.fresh(room, "main"), place: general))
        let direct = room.places.filter { $0.kind == "dm" && $0.withMe }.sorted { $0.lastSeq > $1.lastSeq }
        for p in direct.prefix(6) {
            out.append(FanItem(key: p.key, title: p.title, line: line(p.last), fresh: model.fresh(room, p.key), place: p))
        }
        if !out.contains(where: { $0.key == current }), let p = room.placeView(current) {
            out.insert(FanItem(key: p.key, title: p.kind == "task" ? (p.task.map(taskLabel) ?? p.title) : p.title, line: line(p.last), fresh: false, place: p), at: 1)
        }
        out.append(FanItem(key: FanItem.everything, title: "Everything", line: "conversations, tasks, people", fresh: false, place: nil))
        return out
    }
}
