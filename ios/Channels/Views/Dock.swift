import AudioToolbox
import PhotosUI
import SwiftUI
import UIKit

struct GlassGroup<Content: View>: View {
    var spacing: CGFloat = 10
    @ViewBuilder let content: Content

    var body: some View {
        if #available(iOS 26.0, *) {
            GlassEffectContainer(spacing: spacing) { content }
        } else {
            content
        }
    }
}

extension View {
    @ViewBuilder func glassID(_ id: String, in space: Namespace.ID) -> some View {
        if #available(iOS 26.0, *) {
            self.glassEffectID(id, in: space)
        } else {
            self
        }
    }
}

struct Attached: Identifiable {
    let id = UUID()
    let image: UIImage
    let data: Data
}

enum Shrink {
    static let limit = 256 * 1024
    static let maxSide: CGFloat = 4096
    static let floor: CGFloat = 0.25
    static let top: CGFloat = 0.92
    static let steps = 5

    static func jpeg(_ image: UIImage) -> Data? {
        let size = image.size
        var scale = min(1, maxSide / max(size.width, size.height))
        while true {
            let target = CGSize(width: max(1, (size.width * scale).rounded()), height: max(1, (size.height * scale).rounded()))
            let format = UIGraphicsImageRendererFormat()
            format.scale = 1
            format.opaque = true
            let resized = UIGraphicsImageRenderer(size: target, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: target)) }
            if let fit = best(resized) { return fit }
            guard let low = resized.jpegData(compressionQuality: floor) else { return nil }
            if target.width <= 1 && target.height <= 1 { return nil }
            scale *= min(0.9, max(0.5, (CGFloat(limit) / CGFloat(low.count)).squareRoot() * 0.95))
        }
    }

    private static func best(_ image: UIImage) -> Data? {
        if let full = image.jpegData(compressionQuality: top), full.count <= limit { return full }
        var lo = floor
        var hi = top
        var found: Data?
        for _ in 0..<steps {
            let mid = (lo + hi) / 2
            if let got = image.jpegData(compressionQuality: mid), got.count <= limit {
                found = got
                lo = mid
            } else {
                hi = mid
            }
        }
        if let found { return found }
        if let low = image.jpegData(compressionQuality: floor), low.count <= limit { return low }
        return nil
    }
}

struct Dock: View {
    let room: RoomView
    let spot: Spot
    @Binding var replyTo: MessageView?
    @Binding var answering: AskView?
    @Binding var sendingBack: ReviewView?
    var typing: FocusState<Bool>.Binding
    let follow: Follow
    let jump: () -> Void
    @Environment(AppModel.self) private var model
    @Namespace private var glass
    @State private var draft = ""
    @State private var sending = false
    @State private var error: String?
    @State private var picked: [PhotosPickerItem] = []
    @State private var choosing = false
    @State private var attached: [Attached] = []
    @State private var drafting: Spot?

    private var here: PlaceView? { room.placeView(spot.place) }
    private var hasText: Bool { !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    private var canSend: Bool { !sending && room.connection == .live && (hasText || !attached.isEmpty) }

    private var mention: String? {
        guard let token = draft.split(separator: " ", omittingEmptySubsequences: false).last, token.hasPrefix("@") else { return nil }
        return String(token.dropFirst()).lowercased()
    }

    private var mentionable: [MemberView] {
        guard let mention else { return [] }
        return room.members.filter { $0.name != room.me && ($0.name.lowercased().hasPrefix(mention) || $0.display.lowercased().hasPrefix(mention)) }
    }

    var body: some View {
        VStack(alignment: .trailing, spacing: 8) {
            if let error {
                Text("Not sent: \(error)").type(.meta).foregroundStyle(Tone.alert).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 4)
            }
            if !mentionable.isEmpty { mentions }
            if let sendingBack {
                bar("arrowshape.turn.up.left.fill", Tone.decide, "Send back \(taskLabel(sendingBack.task))", sendingBack.title) { self.sendingBack = nil }
            } else if let answering {
                bar("hand.raised.fill", Tone.decide, room.display(answering.from), answering.plain) { self.answering = nil }
            } else if let replyTo {
                bar("arrowshape.turn.up.left.fill", Tone.accent, room.display(replyTo.from), replyTo.plain) { self.replyTo = nil }
            }
            GlassGroup(spacing: 12) {
                HStack(alignment: .bottom, spacing: 8) {
                    plus.glassID("plus", in: glass)
                    field.glassID("field", in: glass)
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 6)
        .padding(.bottom, 6)
        .animation(.snappy(duration: 0.25), value: mentionable.map(\.name))
        .overlay(alignment: .topTrailing) {
            if !follow.atBottom {
                jumpButton.padding(.trailing, 14).offset(y: -40).transition(.scale(scale: 0.5).combined(with: .opacity))
            }
        }
        .animation(.snappy(duration: 0.25), value: follow.atBottom)
        .photosPicker(isPresented: $choosing, selection: $picked, maxSelectionCount: 4, matching: .images)
        .onAppear { restore(spot) }
        .onDisappear { model.keep(Draft(text: draft, attached: attached), spot.code, spot.place) }
        .onChange(of: spot) { old, new in
            model.keep(Draft(text: draft, attached: attached), old.code, old.place)
            error = nil
            restore(new)
        }
        .onChange(of: picked) { _, items in
            guard !items.isEmpty else { return }
            picked = []
            Task { await load(items) }
        }
    }

    private var plus: some View {
        Button {
            choosing = true
        } label: {
            Image(systemName: "plus")
                .font(.system(size: 19, weight: .medium))
                .foregroundStyle(Tone.ink)
                .frame(width: 44, height: 44)
                .glassCircle()
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Add photos")
    }

    private var field: some View {
        VStack(alignment: .leading, spacing: 0) {
            if !attached.isEmpty { tray }
            HStack(alignment: .bottom, spacing: 6) {
                TextField(placeholder, text: $draft, axis: .vertical)
                    .type(.body)
                    .foregroundStyle(Tone.ink)
                    .lineLimit(1...6)
                    .focused(typing)
                    .padding(.leading, 15)
                    .padding(.vertical, 11)
                if canSend || sending { sendButton }
            }
        }
        .frame(minHeight: 44)
        .glass(22)
    }

    private var mentions: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(mentionable) { m in
                    Button {
                        complete(m.name)
                    } label: {
                        HStack(spacing: 6) {
                            Face(name: m.name, member: m, size: 24)
                            Text(m.display).type(.ui, .medium).foregroundStyle(Tone.ink)
                        }
                        .padding(.leading, 6)
                        .padding(.trailing, 12)
                        .padding(.vertical, 6)
                        .glassCapsule()
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 2)
        }
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }

    private func bar(_ symbol: String, _ tint: Color, _ who: String, _ body: String, cancel: @escaping () -> Void) -> some View {
        HStack(spacing: 8) {
            Image(systemName: symbol).font(.system(size: 11)).foregroundStyle(tint)
            (Text("\(who): ").fontWeight(.semibold) + Text(body.replacingOccurrences(of: "\n", with: " ")))
                .type(.meta)
                .foregroundStyle(Tone.ink2)
                .lineLimit(1)
            Spacer()
            Button(action: cancel) {
                Image(systemName: "xmark.circle.fill").font(.system(size: 17)).foregroundStyle(Tone.ink3)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Cancel")
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .glass(18)
    }

    private var jumpButton: some View {
        Button(action: jump) {
            ZStack(alignment: .topTrailing) {
                Image(systemName: "arrow.down")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Tone.ink)
                    .frame(width: 34, height: 34)
                    .glassCircle()
                if follow.unseen > 0 {
                    Text("\(follow.unseen)")
                        .type(.stamp, .bold)
                        .foregroundStyle(.white)
                        .padding(.horizontal, 5)
                        .frame(minWidth: 18, minHeight: 18)
                        .background(Tone.accent, in: Capsule())
                        .offset(x: 4, y: -4)
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(follow.unseen > 0 ? "\(follow.unseen) new, jump to the latest" : "Jump to the latest")
    }

    private var tray: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(attached) { a in
                    Image(uiImage: a.image)
                        .resizable()
                        .scaledToFill()
                        .frame(width: 64, height: 64)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(alignment: .topTrailing) {
                            Button {
                                attached.removeAll { $0.id == a.id }
                            } label: {
                                Image(systemName: "xmark.circle.fill")
                                    .font(.system(size: 18))
                                    .symbolRenderingMode(.palette)
                                    .foregroundStyle(.white, .black.opacity(0.55))
                            }
                            .buttonStyle(.plain)
                            .padding(3)
                        }
                }
            }
            .padding(.horizontal, 6)
            .padding(.top, 6)
        }
    }

    private var sendButton: some View {
        Button(action: send) {
            ZStack {
                if sending {
                    ProgressView().tint(.white).controlSize(.mini)
                } else {
                    Image(systemName: "arrow.up").font(.system(size: 15, weight: .bold))
                }
            }
            .foregroundStyle(.white)
            .frame(width: 32, height: 32)
            .background(Tone.accent, in: Circle())
        }
        .buttonStyle(.plain)
        .disabled(!canSend)
        .padding(.trailing, 6)
        .padding(.bottom, 6)
        .transition(.scale.combined(with: .opacity))
        .accessibilityLabel("Send")
    }

    private var placeholder: String {
        if room.connection != .live { return "Connecting…" }
        if sendingBack != nil { return "What to change" }
        if let replyTo { return "Reply to \(room.display(replyTo.from))" }
        if let answering { return "Answer \(room.display(answering.from))" }
        if let here, here.kind == "dm", let other = room.other(in: here) { return "Message \(room.display(other))" }
        return "Message"
    }

    private func restore(_ key: Spot) {
        drafting = key
        let kept = model.draft(key.code, key.place)
        draft = kept.text
        attached = kept.attached
    }

    private func complete(_ name: String) {
        var words = draft.split(separator: " ", omittingEmptySubsequences: false).map(String.init)
        if !words.isEmpty { words.removeLast() }
        words.append("@\(name) ")
        draft = words.joined(separator: " ")
        Haptic.tap()
    }

    private func load(_ items: [PhotosPickerItem]) async {
        for item in items {
            guard let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data), let jpeg = Shrink.jpeg(image) else { continue }
            attached.append(Attached(image: image, data: jpeg))
        }
    }

    private func send() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard canSend else { return }
        if attached.isEmpty && answering == nil && sendingBack == nil {
            model.post(spot, text, re: replyTo?.seq)
            draft = ""
            replyTo = nil
            error = nil
            Haptic.tap()
            AudioServicesPlaySystemSound(1004)
            return
        }
        sending = true
        error = nil
        Haptic.tap()
        let from = spot
        let pictures = attached.enumerated().map { i, a in Outgoing(name: "photo-\(i + 1).jpg", mime: "image/jpeg", data: a.data.base64EncodedString()) }
        Task {
            do {
                if pictures.isEmpty, let review = sendingBack {
                    try await model.sendBack(from.code, task: review.task, why: text)
                    sendingBack = nil
                } else if pictures.isEmpty, let ask = answering {
                    try await model.answer(from.code, seq: ask.seq, text: text)
                    answering = nil
                } else {
                    try await model.send(from, text, re: replyTo?.seq, pictures: pictures)
                }
                if drafting == from {
                    if draft.trimmingCharacters(in: .whitespacesAndNewlines) == text { draft = "" }
                    attached = []
                    replyTo = nil
                } else {
                    model.keep(Draft(), from.code, from.place)
                }
            } catch {
                self.error = error.localizedDescription
            }
            sending = false
        }
    }
}
