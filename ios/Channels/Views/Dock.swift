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
    static func jpeg(_ image: UIImage, longest: CGFloat = 1600) -> Data? {
        let size = image.size
        let scale = min(1, longest / max(size.width, size.height))
        let target = CGSize(width: (size.width * scale).rounded(), height: (size.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let resized = UIGraphicsImageRenderer(size: target, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: target)) }
        return resized.jpegData(compressionQuality: 0.7)
    }
}

struct SwitchControl {
    let current: PlaceView?
    let fresh: Bool
    let open: Bool
    let hold: () -> Void
    let move: (CGPoint) -> Void
    let release: (Bool) -> Void
    let tap: () -> Void
    let step: (Int) -> Bool
    let placed: (CGRect) -> Void
}

struct SwitchButton: View {
    enum Touch {
        case idle, pressing, flicking, holding
    }

    let room: RoomView
    let control: SwitchControl
    @State private var touch = Touch.idle
    @State private var timer: Task<Void, Never>?
    @State private var nudge: CGFloat = 0
    @GestureState private var pressed = false

    var body: some View {
        ZStack {
            if control.open {
                Image(systemName: "xmark")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Tone.ink)
                    .transition(.scale(scale: 0.4).combined(with: .opacity))
            } else {
                PlaceFace(room: room, place: control.current, size: 34)
                    .id(control.current?.key)
                    .transition(.scale(scale: 0.6).combined(with: .opacity))
            }
        }
        .offset(x: nudge)
        .frame(width: 44, height: 44)
        .glassCircle()
        .prism(Circle(), band: 0.66)
        .overlay(alignment: .topTrailing) {
            if control.fresh && !control.open {
                Circle().fill(Tone.accent).frame(width: 11, height: 11).overlay(Circle().stroke(Tone.canvas, lineWidth: 2)).offset(x: 1, y: -1)
            }
        }
        .scaleEffect(touch == .idle ? 1 : 0.9)
        .animation(.spring(duration: 0.2, bounce: 0.4), value: touch == .idle)
        .animation(.spring(duration: 0.3, bounce: 0.3), value: control.open)
        .animation(.spring(duration: 0.3, bounce: 0.3), value: control.current?.key)
        .contentShape(Circle())
        .onGeometryChange(for: CGRect.self) {
            $0.frame(in: .global)
        } action: {
            control.placed($0)
        }
        .gesture(
            DragGesture(minimumDistance: 0, coordinateSpace: .global)
                .updating($pressed) { _, state, _ in state = true }
                .onChanged(changed)
                .onEnded(ended)
        )
        .onChange(of: pressed) { _, now in
            guard !now else { return }
            Task { abandon() }
        }
        .accessibilityElement()
        .accessibilityLabel(control.current.map { "Switch conversation, now in \($0.kind == "main" ? "general" : $0.title)" } ?? "Switch conversation")
        .accessibilityHint("Swipe up for the list, or sideways for the next one.")
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { control.tap() }
        .accessibilityAdjustableAction { direction in
            _ = control.step(direction == .increment ? 1 : -1)
        }
    }

    private func changed(_ drag: DragGesture.Value) {
        let dx = drag.translation.width
        let dy = drag.translation.height
        switch touch {
        case .idle:
            touch = .pressing
            timer = Task {
                try? await Task.sleep(for: .milliseconds(90))
                guard !Task.isCancelled, touch == .pressing else { return }
                lift()
            }
        case .pressing:
            guard hypot(dx, dy) > 10 else { return }
            timer?.cancel()
            if dy < 0 && -dy > abs(dx) {
                lift()
                control.move(drag.location)
            } else {
                touch = .flicking
            }
        case .flicking:
            nudge = max(-16, min(16, dx * 0.35))
        case .holding:
            control.move(drag.location)
        }
    }

    private func ended(_ drag: DragGesture.Value) {
        timer?.cancel()
        let was = touch
        touch = .idle
        withAnimation(.spring(duration: 0.35, bounce: 0.5)) { nudge = 0 }
        switch was {
        case .pressing, .idle:
            Haptic.tap()
            control.tap()
        case .flicking:
            let dx = drag.translation.width
            guard abs(dx) > 26, abs(dx) > abs(drag.translation.height) * 1.2 else { return }
            if !control.step(dx < 0 ? 1 : -1) {
                UIImpactFeedbackGenerator(style: .rigid).impactOccurred(intensity: 0.6)
            }
        case .holding:
            control.release(hypot(drag.translation.width, drag.translation.height) < 24)
        }
    }

    private func abandon() {
        guard touch != .idle else { return }
        timer?.cancel()
        if touch == .holding { control.tap() }
        touch = .idle
        withAnimation(.spring(duration: 0.35, bounce: 0.5)) { nudge = 0 }
    }

    private func lift() {
        touch = .holding
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        control.hold()
    }
}

struct PlaceFace: View {
    let room: RoomView
    let place: PlaceView?
    var size: CGFloat = 34

    var body: some View {
        if let place, place.kind == "dm", let other = room.other(in: place) {
            Face(name: other, member: room.member(other), size: size)
        } else if let place, place.kind == "dm" {
            HStack(spacing: -size * 0.5) {
                ForEach(place.with, id: \.self) { name in
                    Face(name: name, member: room.member(name), size: size * 0.8).overlay(Circle().stroke(Tone.canvas, lineWidth: 1.5))
                }
            }
            .frame(width: size, height: size)
        } else if let place, place.kind == "task", let id = place.task {
            Text(taskLabel(id))
                .font(.system(size: size * 0.32, weight: .bold, design: .rounded))
                .foregroundStyle(Tone.doing)
                .frame(width: size, height: size)
                .background(Tone.doing.opacity(0.15), in: Circle())
        } else {
            ChannelAvatar(room: room, size: size)
        }
    }
}

struct Dock: View {
    let room: RoomView
    let place: String
    @Binding var replyTo: MessageView?
    var typing: FocusState<Bool>.Binding
    let follow: Follow
    let switcher: SwitchControl
    let jump: () -> Void
    @Environment(AppModel.self) private var model
    @Namespace private var glass
    @State private var draft = ""
    @State private var sending = false
    @State private var error: String?
    @State private var picked: [PhotosPickerItem] = []
    @State private var choosing = false
    @State private var attached: [Attached] = []
    @State private var drafting = ""

    private var here: PlaceView? { room.placeView(place) }
    private var readOnly: Bool { here.map { $0.kind == "dm" && !$0.withMe } ?? false }
    private var hasText: Bool { !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    private var canSend: Bool { !sending && room.connection == .live && (hasText || !attached.isEmpty) }

    private var asking: AskView? {
        guard here?.kind != "dm" else { return nil }
        let task = here?.task
        return room.asks.first { $0.task == task }
    }

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
            if let replyTo { replyBar(replyTo) }
            GlassGroup(spacing: 12) {
                HStack(alignment: .bottom, spacing: 8) {
                    if readOnly {
                        Text("Between \(here?.with.map { room.display($0) }.joined(separator: " and ") ?? "two others"). You can read along.")
                            .type(.meta)
                            .foregroundStyle(Tone.ink3)
                            .multilineTextAlignment(.center)
                            .frame(maxWidth: .infinity, minHeight: 44)
                    } else {
                        plus.glassID("plus", in: glass)
                        field.glassID("field", in: glass)
                    }
                    SwitchButton(room: room, control: switcher).glassID("switch", in: glass)
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
        .onAppear { restore(place) }
        .onDisappear { model.keep(Draft(text: draft, attached: attached), room.code, place) }
        .onChange(of: place) { old, new in
            model.keep(Draft(text: draft, attached: attached), room.code, old)
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

    private func replyBar(_ m: MessageView) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "arrowshape.turn.up.left.fill").font(.system(size: 11)).foregroundStyle(Tone.accent)
            (Text("\(room.display(m.from)): ").fontWeight(.semibold) + Text(m.body.replacingOccurrences(of: "\n", with: " ")))
                .type(.meta)
                .foregroundStyle(Tone.ink2)
                .lineLimit(1)
            Spacer()
            Button {
                replyTo = nil
            } label: {
                Image(systemName: "xmark.circle.fill").font(.system(size: 17)).foregroundStyle(Tone.ink3)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Cancel reply")
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
        if let replyTo { return "Reply to \(room.display(replyTo.from))" }
        if let asking { return "Answer \(room.display(asking.from))" }
        if let here, here.kind == "dm", let other = room.other(in: here) { return "Message \(room.display(other))" }
        if let here, here.kind == "task", let id = here.task { return "Message \(taskLabel(id))" }
        return "Message"
    }

    private func restore(_ key: String) {
        drafting = key
        let kept = model.draft(room.code, key)
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
        sending = true
        error = nil
        Haptic.tap()
        let from = drafting
        let pictures = attached.enumerated().map { i, a in Outgoing(name: "photo-\(i + 1).jpg", mime: "image/jpeg", data: a.data.base64EncodedString()) }
        Task {
            do {
                if replyTo == nil, pictures.isEmpty, let asking {
                    try await model.answer(room.code, seq: asking.seq, text: text)
                } else {
                    try await model.send(room.code, text, re: replyTo?.seq, pictures: pictures)
                }
                if drafting == from {
                    if draft.trimmingCharacters(in: .whitespacesAndNewlines) == text { draft = "" }
                    attached = []
                    replyTo = nil
                } else {
                    model.keep(Draft(), room.code, from)
                }
            } catch {
                self.error = error.localizedDescription
            }
            sending = false
        }
    }
}
