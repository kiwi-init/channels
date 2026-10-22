import PhotosUI
import SwiftUI
import UIKit

struct Line: Identifiable {
    enum Kind {
        case time(Date)
        case event(MessageView)
        case bubble(MessageView, first: Bool, last: Bool)
    }

    let id: String
    let kind: Kind

    static func build(_ messages: [MessageView]) -> [Line] {
        var out: [Line] = []
        var prev: MessageView?
        var lastAt: MessageView?
        for m in messages {
            let gap = lastAt.map { m.at - $0.at } ?? .infinity
            let newDay = lastAt.map { !Calendar.current.isDate($0.date, inSameDayAs: m.date) } ?? true
            lastAt = m
            if newDay || gap > 15 * 60_000 {
                out.append(Line(id: "t\(m.seq)", kind: .time(m.date)))
                prev = nil
            }
            if m.event {
                out.append(Line(id: "e\(m.seq)", kind: .event(m)))
                prev = nil
                continue
            }
            let first = prev == nil || prev?.from != m.from || m.quote != nil
            if !first, let lastLine = out.last, case .bubble(let p, let pFirst, _) = lastLine.kind {
                out[out.count - 1] = Line(id: lastLine.id, kind: .bubble(p, first: pFirst, last: false))
            }
            out.append(Line(id: "b\(m.seq)", kind: .bubble(m, first: first, last: true)))
            prev = m
        }
        return out
    }
}

struct Conversation: View {
    let room: RoomView
    @Binding var replyTo: MessageView?
    var typing: FocusState<Bool>.Binding

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 0) {
                    if !room.whole && !room.messages.isEmpty {
                        Text("Earlier messages are on your Mac")
                            .type(.meta)
                            .foregroundStyle(Tone.ink3)
                            .padding(.vertical, 14)
                    }
                    if room.messages.isEmpty && room.connection == .live {
                        Text("No messages yet").type(.ui).foregroundStyle(Tone.ink3).padding(.top, 80)
                    }
                    ForEach(Line.build(room.messages)) { line in
                        LineView(line: line, room: room) { m in
                            replyTo = m
                            typing.wrappedValue = true
                        } jump: { seq in
                            withAnimation(Motion.ease) { proxy.scrollTo("b\(seq)", anchor: .center) }
                        }
                        .id(line.id)
                    }
                    Color.clear.frame(height: 6).id("bottom")
                }
                .padding(.horizontal, 12)
            }
            .defaultScrollAnchor(.bottom)
            .scrollDismissesKeyboard(.interactively)
            .softEdges()
            .onChange(of: room.messages.last?.seq) { _, _ in
                withAnimation(Motion.ease) { proxy.scrollTo("bottom", anchor: .bottom) }
            }
            .onChange(of: typing.wrappedValue) { _, now in
                guard now else { return }
                Task {
                    try? await Task.sleep(for: .milliseconds(250))
                    withAnimation(Motion.ease) { proxy.scrollTo("bottom", anchor: .bottom) }
                }
            }
            .task {
                try? await Task.sleep(for: .milliseconds(80))
                proxy.scrollTo("bottom", anchor: .bottom)
            }
        }
    }
}

struct LineView: View {
    let line: Line
    let room: RoomView
    let reply: (MessageView) -> Void
    let jump: (Int) -> Void

    var body: some View {
        switch line.kind {
        case .time(let date):
            (Text(When.dayWord(date)).fontWeight(.semibold) + Text(" \(When.clock(date))"))
                .type(.meta)
                .foregroundStyle(Tone.ink3)
                .frame(maxWidth: .infinity)
                .padding(.top, 14)
                .padding(.bottom, 6)
        case .event(let m):
            Text("\(room.display(m.from)) \(m.body)")
                .type(.meta)
                .foregroundStyle(Tone.ink3)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 32)
                .padding(.vertical, 4)
        case .bubble(let m, let first, let last):
            BubbleRow(message: m, first: first, last: last, room: room, reply: reply, jump: jump)
        }
    }
}

struct BubbleRow: View {
    let message: MessageView
    let first: Bool
    let last: Bool
    let room: RoomView
    let reply: (MessageView) -> Void
    let jump: (Int) -> Void

    private let avatar: CGFloat = 30

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            if message.mine {
                Spacer(minLength: 56)
            } else {
                Group {
                    if last {
                        Face(name: message.from, member: room.member(message.from), size: avatar)
                    } else {
                        Color.clear
                    }
                }
                .frame(width: avatar, height: avatar)
            }
            VStack(alignment: message.mine ? .trailing : .leading, spacing: 3) {
                if first && !message.mine {
                    Text(name)
                        .type(.meta)
                        .foregroundStyle(Tone.ink3)
                        .padding(.leading, 12)
                }
                if let quote = message.quote {
                    QuoteBubble(quote: quote, room: room) { jump(quote.seq) }
                }
                Bubble(message: message, code: room.code, tail: last)
                    .contextMenu {
                        Button {
                            reply(message)
                        } label: {
                            Label("Reply", systemImage: "arrowshape.turn.up.left")
                        }
                        Button {
                            UIPasteboard.general.string = message.body
                        } label: {
                            Label("Copy", systemImage: "doc.on.doc")
                        }
                    }
                if !message.choices.isEmpty {
                    Choices(message: message, room: room)
                }
            }
            if !message.mine { Spacer(minLength: 40) }
        }
        .padding(.top, first ? 8 : 2)
    }

    private var name: String {
        room.display(message.from)
    }
}

struct Bubble: View {
    let message: MessageView
    let code: String
    let tail: Bool

    private var fill: Color { message.mine ? Tone.bubbleMine : Tone.bubbleThem }
    private var ink: Color { message.mine ? .white : Tone.ink }
    private var onlyPictures: Bool { message.images > 0 && message.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    var body: some View {
        VStack(alignment: message.mine ? .trailing : .leading, spacing: 4) {
            ForEach(0..<message.images, id: \.self) { i in
                Picture(code: code, seq: message.seq, index: i)
            }
            if !onlyPictures {
                Prose(text: message.body, ink: ink, link: message.mine ? .white : Tone.accent, code: message.mine ? .white.opacity(0.18) : Tone.wash2)
                    .padding(.horizontal, 13)
                    .padding(.vertical, 8)
                    .background {
                        ZStack {
                            RoundedRectangle(cornerRadius: 19, style: .continuous).fill(fill)
                            if tail {
                                Tail().fill(fill).scaleEffect(x: message.mine ? 1 : -1, anchor: .center)
                            }
                        }
                    }
            }
        }
    }
}

struct Tail: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        let x = rect.maxX
        let y = rect.maxY
        p.move(to: CGPoint(x: x - 16, y: y - 18))
        p.addLine(to: CGPoint(x: x, y: y - 18))
        p.addCurve(to: CGPoint(x: x + 5.5, y: y), control1: CGPoint(x: x, y: y - 6), control2: CGPoint(x: x + 2, y: y - 1.5))
        p.addCurve(to: CGPoint(x: x - 11, y: y - 3.5), control1: CGPoint(x: x - 1, y: y + 0.6), control2: CGPoint(x: x - 7, y: y - 0.8))
        p.closeSubpath()
        return p
    }
}

struct QuoteBubble: View {
    let quote: QuoteView
    let room: RoomView
    let tap: () -> Void

    var body: some View {
        Button(action: tap) {
            HStack(spacing: 6) {
                Image(systemName: "arrowshape.turn.up.left.fill").font(.system(size: 10)).foregroundStyle(Tone.ink3)
                (Text("\(room.display(quote.from)): ").fontWeight(.semibold) + Text(quote.words))
                    .type(.meta)
                    .foregroundStyle(Tone.ink2)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
            }
            .padding(.horizontal, 11)
            .padding(.vertical, 6)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Tone.edgeStrong, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

struct Choices: View {
    let message: MessageView
    let room: RoomView
    @Environment(AppModel.self) private var model
    @State private var sending: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(message.choices, id: \.self) { choice in
                let picked = message.chosen?.choice == choice
                Button {
                    guard message.waiting, message.chosen == nil, sending == nil else { return }
                    sending = choice
                    Haptic.tap()
                    Task {
                        try? await model.answer(room.code, seq: message.seq, text: choice)
                        sending = nil
                    }
                } label: {
                    HStack(spacing: 8) {
                        Text(choice)
                            .type(.ui, .medium)
                            .foregroundStyle(picked ? .white : (message.chosen == nil ? Tone.accent : Tone.ink3))
                            .multilineTextAlignment(.leading)
                        if sending == choice { ProgressView().controlSize(.mini) }
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 9)
                    .background {
                        if picked {
                            Capsule().fill(Tone.accent)
                        } else {
                            Capsule().strokeBorder(Tone.edgeStrong, lineWidth: 1)
                        }
                    }
                    .contentShape(Capsule())
                }
                .buttonStyle(.plain)
            }
            if let chosen = message.chosen {
                Text("\(chosen.by == room.me ? "You" : room.display(chosen.by)) chose this")
                    .type(.meta)
                    .foregroundStyle(Tone.ink3)
                    .padding(.leading, 12)
            } else if message.waiting {
                Text("Waiting on you").type(.meta, .semibold).foregroundStyle(Tone.decide).padding(.leading, 12)
            }
        }
        .padding(.top, 3)
    }
}

struct Picture: View {
    let code: String
    let seq: Int
    let index: Int
    @Environment(AppModel.self) private var model
    @State private var image: UIImage?
    @State private var failed = false

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .frame(maxWidth: 240, maxHeight: 320)
            } else {
                ZStack {
                    Tone.wash
                    if failed {
                        Image(systemName: "photo").foregroundStyle(Tone.ink3)
                    } else {
                        ProgressView()
                    }
                }
                .frame(width: 200, height: 150)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .task(id: "\(code)/\(seq)/\(index)") {
            if let got = await model.image(code, seq: seq, index: index) {
                image = got
            } else {
                failed = true
            }
        }
    }
}

struct Prose: View {
    let text: String
    var ink: Color = Tone.ink
    var link: Color = Tone.accent
    var code: Color = Tone.wash2

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(Block.parse(text).enumerated()), id: \.offset) { _, block in
                switch block {
                case .text(let s):
                    Text(inline(s))
                        .type(.body)
                        .foregroundStyle(ink)
                        .tint(link)
                case .code(let s):
                    ScrollView(.horizontal, showsIndicators: false) {
                        Text(s)
                            .font(.mono(.meta))
                            .foregroundStyle(ink)
                            .padding(8)
                    }
                    .background(code, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
            }
        }
    }

    private func inline(_ s: String) -> AttributedString {
        let options = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace, failurePolicy: .returnPartiallyParsedIfPossible)
        return (try? AttributedString(markdown: s, options: options)) ?? AttributedString(s)
    }
}

enum Block {
    case text(String)
    case code(String)

    static func parse(_ text: String) -> [Block] {
        var out: [Block] = []
        var buffer: [String] = []
        var inCode = false
        for line in text.split(separator: "\n", omittingEmptySubsequences: false) {
            if line.trimmingCharacters(in: .whitespaces).hasPrefix("```") {
                let joined = buffer.joined(separator: "\n")
                if inCode {
                    out.append(.code(joined))
                } else if !joined.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    out.append(.text(joined))
                }
                buffer = []
                inCode.toggle()
                continue
            }
            buffer.append(String(line))
        }
        let rest = buffer.joined(separator: "\n")
        if !rest.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { out.append(inCode ? .code(rest) : .text(rest)) }
        return out
    }
}

struct Attached: Identifiable {
    let id = UUID()
    let image: UIImage
    let data: Data
}

struct Composer: View {
    let room: RoomView
    @Binding var replyTo: MessageView?
    var typing: FocusState<Bool>.Binding
    @Environment(AppModel.self) private var model
    @State private var draft = ""
    @State private var sending = false
    @State private var error: String?
    @State private var picked: [PhotosPickerItem] = []
    @State private var choosing = false
    @State private var attached: [Attached] = []

    private var asking: AskView? { room.asks.first { $0.task == nil } }
    private var hasText: Bool { !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    private var canSend: Bool { !sending && room.connection == .live && (hasText || !attached.isEmpty) }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let error {
                Text("Not sent: \(error)").type(.meta).foregroundStyle(Tone.alert).padding(.horizontal, 16)
            }
            if let replyTo {
                HStack(spacing: 8) {
                    Image(systemName: "arrowshape.turn.up.left.fill").font(.system(size: 11)).foregroundStyle(Tone.accent)
                    (Text("Replying to \(room.display(replyTo.from)): ").fontWeight(.semibold) + Text(replyTo.body.replacingOccurrences(of: "\n", with: " ")))
                        .type(.meta)
                        .foregroundStyle(Tone.ink2)
                        .lineLimit(1)
                    Spacer()
                    Button {
                        self.replyTo = nil
                    } label: {
                        Image(systemName: "xmark.circle.fill").font(.system(size: 17)).foregroundStyle(Tone.ink3)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Cancel reply")
                }
                .padding(.horizontal, 16)
            }
            HStack(alignment: .bottom, spacing: 8) {
                Button {
                    choosing = true
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 19, weight: .medium))
                        .foregroundStyle(Tone.ink)
                        .frame(width: 40, height: 40)
                        .glassCircle()
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Add photos")
                VStack(alignment: .leading, spacing: 0) {
                    if !attached.isEmpty { tray }
                    HStack(alignment: .bottom, spacing: 6) {
                        TextField(placeholder, text: $draft, axis: .vertical)
                            .type(.body)
                            .foregroundStyle(Tone.ink)
                            .lineLimit(1...6)
                            .focused(typing)
                            .padding(.leading, 14)
                            .padding(.vertical, 9)
                        if canSend || sending { sendButton }
                    }
                }
                .frame(minHeight: 40)
                .glass(20)
            }
            .padding(.horizontal, 12)
            .animation(Motion.ease, value: canSend)
        }
        .padding(.top, 6)
        .padding(.bottom, 6)
        .photosPicker(isPresented: $choosing, selection: $picked, maxSelectionCount: 4, matching: .images)
        .onChange(of: picked) { _, items in
            guard !items.isEmpty else { return }
            picked = []
            Task { await load(items) }
        }
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
            .frame(width: 30, height: 30)
            .background(Tone.accent, in: Circle())
        }
        .buttonStyle(.plain)
        .disabled(!canSend)
        .padding(.trailing, 5)
        .padding(.bottom, 5)
        .transition(.scale.combined(with: .opacity))
        .accessibilityLabel("Send")
    }

    private var placeholder: String {
        if room.connection != .live { return "Connecting…" }
        if let replyTo { return "Reply to \(room.display(replyTo.from))" }
        if let asking { return "Answer \(room.display(asking.from))" }
        return "Message"
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
        let pictures = attached.enumerated().map { i, a in Outgoing(name: "photo-\(i + 1).jpg", mime: "image/jpeg", data: a.data.base64EncodedString()) }
        Task {
            do {
                if replyTo == nil, pictures.isEmpty, let asking {
                    try await model.answer(room.code, seq: asking.seq, text: text)
                } else {
                    try await model.send(room.code, text, re: replyTo?.seq, pictures: pictures)
                }
                if draft.trimmingCharacters(in: .whitespacesAndNewlines) == text { draft = "" }
                attached = []
                replyTo = nil
            } catch {
                self.error = error.localizedDescription
            }
            sending = false
        }
    }
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
