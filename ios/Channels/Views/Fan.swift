import SwiftUI
import UIKit

struct FanItem: Identifiable, Equatable {
    let key: String
    let title: String
    let line: String
    let fresh: Bool
    let place: PlaceView?
    var member: String?
    var tag: String?
    var drafted = false

    var id: String { key }
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
    let anchor: CGRect
    @Binding var frames: [String: CGRect]
    let choose: (String) -> Void
    let dismiss: () -> Void
    @State private var shown = false

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .bottomTrailing) {
                Rectangle()
                    .fill(.black.opacity(shown ? 0.45 : 0))
                    .background(.thinMaterial.opacity(shown ? 1 : 0))
                    .ignoresSafeArea()
                    .onTapGesture(perform: dismiss)
                stack
                    .padding(.trailing, max(12, geo.size.width - anchor.maxX))
                    .padding(.bottom, max(0, geo.size.height - anchor.minY + 12))
                close.position(x: anchor.midX, y: anchor.midY)
            }
        }
        .onAppear { shown = true }
    }

    private var close: some View {
        Button(action: dismiss) {
            Image(systemName: "xmark")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Tone.ink)
                .frame(width: 44, height: 44)
                .glassCircle()
                .prism(Circle(), band: 0.66)
                .scaleEffect(hover == nil && mode == .held ? 0.9 : 1)
        }
        .buttonStyle(.plain)
        .allowsHitTesting(mode == .tapped)
        .accessibilityLabel("Close")
    }

    private var stack: some View {
        VStack(alignment: .trailing, spacing: 10) {
            ForEach(Array(items.enumerated().reversed()), id: \.element.id) { index, item in
                row(item)
                    .scaleEffect(shown ? (hover == item.key ? 1.07 : 1) : 0.75, anchor: .bottomTrailing)
                    .opacity(shown ? 1 : 0)
                    .offset(y: shown ? 0 : CGFloat(index + 1) * 12)
                    .animation(.spring(duration: 0.24, bounce: 0.28).delay(shown ? Double(index) * 0.012 : 0), value: shown)
                    .animation(.spring(duration: 0.16, bounce: 0.4), value: hover)
                    .onGeometryChange(for: CGRect.self) {
                        $0.frame(in: .global)
                    } action: {
                        frames[item.key] = $0
                    }
            }
        }
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
                        Text(item.title).type(.ui, .semibold).foregroundStyle(Tone.ink).lineLimit(1)
                        if let tag = item.tag, tag.lowercased() != item.title.lowercased() {
                            Text(tag).type(.stamp, .semibold).foregroundStyle(Tone.ink3)
                        }
                    }
                    if item.drafted {
                        (Text("Draft: ").foregroundStyle(Tone.alert) + Text(item.line).foregroundStyle(Tone.ink3)).type(.meta).lineLimit(1)
                    } else if !item.line.isEmpty {
                        Text(item.line).type(.meta).foregroundStyle(Tone.ink3).lineLimit(1)
                    }
                }
                .frame(maxWidth: 220, alignment: .trailing)
                if let member = item.member, item.place == nil {
                    Face(name: member, member: room.member(member), size: 36)
                } else {
                    PlaceFace(room: room, place: item.place, size: 36)
                }
            }
            .padding(.leading, 16)
            .padding(.trailing, 6)
            .padding(.vertical, 6)
            .glassCapsule()
            .modifier(Lit(on: hot || here, band: hot ? 0.38 : 0.7))
        }
        .buttonStyle(.plain)
        .allowsHitTesting(mode == .tapped)
        .accessibilityLabel(here ? "\(item.title), current" : item.title)
    }
}

struct Lit: ViewModifier {
    let on: Bool
    let band: CGFloat

    func body(content: Content) -> some View {
        if on {
            content.prism(Capsule(), band: band).animation(.spring(duration: 0.45, bounce: 0.2), value: band)
        } else {
            content
        }
    }
}

extension ChannelScreen {
    static func fanItems(_ room: RoomView, model: AppModel, current: String) -> [FanItem] {
        func line(_ m: MessageView?) -> String {
            guard let m else { return "" }
            return "\(m.mine ? "You" : room.display(m.from)): \(m.body.replacingOccurrences(of: "\n", with: " "))"
        }
        func item(_ key: String, _ title: String, _ p: PlaceView?, member: String? = nil, tag: String? = nil, fresh: Bool? = nil) -> FanItem {
            let kept = key == current ? Draft() : model.draft(room.code, key)
            let said = kept.text.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "\n", with: " ")
            return FanItem(
                key: key, title: title, line: kept.isEmpty ? line(p?.last) : (said.isEmpty ? "a photo" : said), fresh: fresh ?? model.fresh(room, key), place: p,
                member: member, tag: tag, drafted: !kept.isEmpty)
        }
        var out: [FanItem] = []
        let general = room.placeView("main")
        out.append(item("main", "# general", general))
        var lead: String?
        if let name = room.lead, name != room.me {
            lead = name
            let key = room.dmKey(with: name)
            let p = room.placeView(key)
            out.append(item(key, room.display(name), p, member: name, tag: "lead"))
        }
        let direct = room.places.filter { $0.kind == "dm" && $0.withMe && room.other(in: $0) != lead }.sorted { $0.lastSeq > $1.lastSeq }
        for p in direct.prefix(6) {
            out.append(item(p.key, p.title, p))
        }
        if !out.contains(where: { $0.key == current }), let p = room.placeView(current), p.kind == "task" {
            out.append(item(p.key, p.task.map(taskLabel) ?? p.title, p, fresh: false))
        }
        return out
    }
}
