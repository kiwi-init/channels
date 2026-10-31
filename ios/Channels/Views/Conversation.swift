import SwiftUI
import UIKit

struct Line: Identifiable {
    enum Kind {
        case time(Date)
        case event(MessageView)
        case bubble(MessageView, first: Bool, last: Bool)
        case ask(AskView)
        case review(ReviewView)
        case pending(Pending)
    }

    let id: String
    let kind: Kind

    static func build(_ messages: [MessageView], asks: [AskView] = [], reviews: [ReviewView] = [], pending: [Pending] = [], sentAs: [Int: UUID] = [:]) -> [Line] {
        var out: [Line] = []
        var prev: MessageView?
        var lastAt: MessageView?
        let held = asks.map { (at: $0.at, line: Line(id: "a\($0.seq)", kind: .ask($0))) } + reviews.map { (at: $0.at, line: Line(id: "r\($0.task)", kind: .review($0))) }
        var waiting = held.sorted { $0.at < $1.at }[...]
        let answers = Set(messages.compactMap { m in m.chosen.map { "\($0.by)|\($0.choice)" } })
        for m in messages where !m.choices.isEmpty || !answers.contains("\(m.from)|\(m.body)") {
            while let next = waiting.first, next.at < m.at {
                out.append(next.line)
                waiting.removeFirst()
                prev = nil
            }
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
            out.append(Line(id: sentAs[m.seq].map { "p\($0)" } ?? "b\(m.seq)", kind: .bubble(m, first: first, last: true)))
            prev = m
        }
        out += waiting.map(\.line)
        let shown = Set(messages.map(\.seq))
        out += pending.filter { item in item.seq.map { !shown.contains($0) } ?? true }.map { Line(id: "p\($0.id)", kind: .pending($0)) }
        return out
    }
}

struct Follow {
    var atBottom = true
    var unseen = 0
}

struct Conversation: View {
    let room: RoomView
    @Binding var replyTo: MessageView?
    @Binding var position: ScrollPosition
    @Binding var follow: Follow
    var typing: FocusState<Bool>.Binding
    var elsewhere: [AskView] = []
    var reviews: [ReviewView] = []
    var answer: (AskView) -> Void = { _ in }
    var sendBack: (ReviewView) -> Void = { _ in }
    @Environment(AppModel.self) private var model
    @State private var reveal: CGFloat = 0

    private static let revealMax: CGFloat = 62

    private var solo: Bool {
        room.placeView(room.place).map { $0.kind == "dm" && $0.withMe } ?? false
    }

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                if !room.whole && !room.messages.isEmpty {
                    Text("Earlier messages aren't on this phone")
                        .type(.meta)
                        .foregroundStyle(Tone.ink3)
                        .padding(.vertical, 14)
                }
                if room.whole || (room.messages.isEmpty && room.connection == .live) {
                    Intro(room: room)
                }
                ForEach(
                    Line.build(room.messages, asks: elsewhere, reviews: reviews, pending: model.pending["\(room.code)|\(room.place)"] ?? [], sentAs: model.sentAs)
                ) { line in
                    LineView(line: line, room: room, reveal: reveal, solo: solo) { m in
                        replyTo = m
                        typing.wrappedValue = true
                    } jump: { seq in
                        withAnimation(Motion.ease) { position.scrollTo(id: "b\(seq)", anchor: .center) }
                    } answer: { seq in
                        if let ask = room.asks.first(where: { $0.seq == seq }) { answer(ask) }
                    } sendBack: { review in
                        sendBack(review)
                    }
                    .id(line.id)
                    .transition(.asymmetric(insertion: .move(edge: .bottom).combined(with: .opacity), removal: .opacity))
                }
                Color.clear.frame(height: 6).id("bottom")
            }
            .scrollTargetLayout()
            .padding(.horizontal, 12)
        }
        .scrollPosition($position)
        .defaultScrollAnchor(.bottom)
        .scrollDismissesKeyboard(.interactively)
        .softEdges()
        .simultaneousGesture(
            DragGesture(minimumDistance: 14)
                .onChanged { drag in
                    let dx = drag.translation.width
                    guard dx < 0, abs(dx) > abs(drag.translation.height) * 1.3 else { return }
                    reveal = min(Self.revealMax, -dx * 0.7)
                }
                .onEnded { _ in
                    withAnimation(.spring(duration: 0.32, bounce: 0.18)) { reveal = 0 }
                }
        )
        .onScrollGeometryChange(for: Bool.self) { geo in
            geo.visibleRect.maxY >= geo.contentSize.height - 60
        } action: { _, near in
            follow.atBottom = near
            if near { follow.unseen = 0 }
        }
        .onChange(of: model.pending["\(room.code)|\(room.place)"]?.count ?? 0) { old, now in
            guard now > old else { return }
            withAnimation(Motion.sent) { position.scrollTo(edge: .bottom) }
        }
        .onChange(of: room.messages.last?.seq) { old, _ in
            guard old != nil, let last = room.messages.last else { return }
            if follow.atBottom || last.mine {
                withAnimation(Motion.ease) { position.scrollTo(edge: .bottom) }
            } else if !last.event {
                follow.unseen += 1
            }
        }
        .task(id: room.messages.isEmpty) {
            guard !room.messages.isEmpty else { return }
            try? await Task.sleep(for: .milliseconds(120))
            position.scrollTo(edge: .bottom)
        }
        .onChange(of: typing.wrappedValue) { _, now in
            guard now else { return }
            Task {
                try? await Task.sleep(for: .milliseconds(250))
                withAnimation(Motion.ease) { position.scrollTo(edge: .bottom) }
            }
        }
    }
}

struct Intro: View {
    let room: RoomView

    private var lead: String? { room.place == "main" ? nil : room.lead }

    var body: some View {
        VStack(spacing: 4) {
            face.padding(.bottom, 8)
            Text(title).type(.title).foregroundStyle(Tone.ink).multilineTextAlignment(.center)
            ForEach(lines, id: \.self) { line in
                Text(line).type(.meta).foregroundStyle(Tone.ink3).multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 32)
        .padding(.top, room.messages.isEmpty ? 72 : 28)
        .padding(.bottom, 20)
    }

    @ViewBuilder private var face: some View {
        if let lead {
            Face(name: lead, member: room.member(lead), size: 72)
        } else {
            ChannelAvatar(room: room, size: 72)
        }
    }

    private var title: String {
        lead.map { room.display($0) } ?? room.title
    }

    private var lines: [String] {
        guard let lead else {
            let names = room.members.filter { $0.name != room.me }.map(\.display)
            return ["You, \(names.joined(separator: ", "))", room.messages.isEmpty ? "No messages yet" : "The start of #general"]
        }
        let member = room.member(lead)
        let now: String? = member?.working == true ? (member?.doing.first.map { "Working on \(taskLabel($0))" } ?? "Working") : nil
        return ["Lead of \(room.title)", now ?? (room.messages.isEmpty ? "Everyone in the channel can read this" : nil)].compactMap { $0 }
    }
}

struct LineView: View {
    let line: Line
    let room: RoomView
    let reveal: CGFloat
    let solo: Bool
    let reply: (MessageView) -> Void
    let jump: (Int) -> Void
    let answer: (Int) -> Void
    let sendBack: (ReviewView) -> Void

    var body: some View {
        switch line.kind {
        case .ask(let ask):
            AskLine(ask: ask, room: room) { answer(ask.seq) }
        case .review(let review):
            ReviewLine(review: review, room: room) { sendBack(review) }
        case .pending(let item):
            PendingBubble(item: item, spot: Spot(code: room.code, place: room.place))
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
            BubbleRow(message: m, first: first, last: last, room: room, reveal: reveal, solo: solo, reply: reply, jump: jump, answer: answer)
        }
    }
}

struct PendingBubble: View {
    let item: Pending
    let spot: Spot
    @Environment(AppModel.self) private var model

    var body: some View {
        HStack(alignment: .center, spacing: 8) {
            Spacer(minLength: 56)
            if item.failed {
                Menu {
                    Button {
                        model.retry(item, spot)
                    } label: {
                        Label("Try Again", systemImage: "arrow.clockwise")
                    }
                    Button(role: .destructive) {
                        withAnimation(Motion.ease) { model.drop(item, spot) }
                    } label: {
                        Label("Delete", systemImage: "trash")
                    }
                } label: {
                    Image(systemName: "exclamationmark.circle.fill").font(.system(size: 22)).foregroundStyle(Tone.alert)
                }
                .accessibilityLabel("Not delivered")
            }
            VStack(alignment: .trailing, spacing: 3) {
                Markdown(text: item.body, ink: .white, link: .white, code: .white.opacity(0.18), underline: true)
                    .padding(.horizontal, 13)
                    .padding(.vertical, 8)
                    .background {
                        ZStack {
                            RoundedRectangle(cornerRadius: 19, style: .continuous).fill(Tone.bubbleMine)
                            Tail().fill(Tone.bubbleMine)
                        }
                    }
                if item.failed {
                    Text("Not Delivered").type(.stamp, .semibold).foregroundStyle(Tone.alert)
                }
            }
        }
        .padding(.top, 2)
    }
}

struct BubbleRow: View {
    let message: MessageView
    let first: Bool
    let last: Bool
    let room: RoomView
    let reveal: CGFloat
    let solo: Bool
    let reply: (MessageView) -> Void
    let jump: (Int) -> Void
    let answer: (Int) -> Void
    @State private var pull: CGFloat = 0
    @State private var armed = false

    private let avatar: CGFloat = 30
    private static let replyAt: CGFloat = 56

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            if message.mine {
                Spacer(minLength: 56)
            } else if !solo {
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
                if first && !message.mine && !solo {
                    Text(room.display(message.from))
                        .type(.meta)
                        .foregroundStyle(Tone.ink3)
                        .padding(.leading, 12)
                }
                if let quote = message.quote {
                    QuoteBubble(quote: quote, room: room) { jump(quote.seq) }
                }
                if message.choices.isEmpty {
                    Bubble(message: message, room: room, tail: last, reply: { reply(message) })
                        .padding(.top, message.reactions.isEmpty ? 0 : 20)
                } else {
                    PollCard(poll: Poll(message), room: room, tail: last) {
                        if message.waiting { answer(message.seq) } else { reply(message) }
                    }
                }
            }
            if !message.mine { Spacer(minLength: 40) }
        }
        .padding(.top, first ? 8 : 2)
        .offset(x: pull - reveal)
        .background(alignment: .leading) {
            Image(systemName: "arrowshape.turn.up.left.fill")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(armed ? Tone.accent : Tone.ink3)
                .frame(width: 30, height: 30)
                .background(Tone.wash2, in: Circle())
                .opacity(Double(min(1, pull / Self.replyAt)))
                .scaleEffect(armed ? 1.1 : 0.85)
                .offset(x: -36 + pull * 0.6)
        }
        .overlay(alignment: .trailing) {
            Text(When.clock(message.date))
                .type(.stamp)
                .foregroundStyle(Tone.ink3)
                .fixedSize()
                .opacity(Double(reveal / 62))
                .offset(x: 62 - reveal + 4)
        }
        .gesture(
            Rightward { dx in
                pull = min(84, max(0, dx) * 0.6)
                let now = pull >= Self.replyAt
                if now != armed {
                    armed = now
                    if now { Haptic.tap() }
                }
            } ended: {
                if armed { reply(message) }
                armed = false
                withAnimation(.spring(duration: 0.3, bounce: 0.2)) { pull = 0 }
            }
        )
    }
}

struct Rightward: UIGestureRecognizerRepresentable {
    let moved: (CGFloat) -> Void
    let ended: () -> Void

    func makeCoordinator(converter: CoordinateSpaceConverter) -> Only {
        Only()
    }

    func makeUIGestureRecognizer(context: Context) -> UIPanGestureRecognizer {
        let pan = UIPanGestureRecognizer()
        pan.delegate = context.coordinator
        return pan
    }

    func handleUIGestureRecognizerAction(_ pan: UIPanGestureRecognizer, context: Context) {
        switch pan.state {
        case .began, .changed: moved(pan.translation(in: pan.view).x)
        case .ended, .cancelled, .failed: ended()
        default: break
        }
    }

    final class Only: NSObject, UIGestureRecognizerDelegate {
        func gestureRecognizerShouldBegin(_ recognizer: UIGestureRecognizer) -> Bool {
            guard let pan = recognizer as? UIPanGestureRecognizer else { return false }
            let v = pan.velocity(in: pan.view)
            return v.x > 0 && v.x > abs(v.y) * 1.3
        }
    }
}

struct Bubble: View {
    let message: MessageView
    let room: RoomView
    let tail: Bool
    let reply: () -> Void
    @Environment(AppModel.self) private var model
    @State private var tapback = false

    private var fill: Color { message.mine ? Tone.bubbleMine : Tone.bubbleThem }
    private var ink: Color { message.mine ? .white : Tone.ink }
    private var link: Color { message.mine ? .white : Tone.accent }
    private var wash: Color { message.mine ? .white.opacity(0.18) : Tone.wash2 }
    private var onlyPictures: Bool { message.images > 0 && message.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    var body: some View {
        VStack(alignment: message.mine ? .trailing : .leading, spacing: 4) {
            ForEach(0..<message.images, id: \.self) { i in
                Picture(code: room.code, seq: message.seq, index: i)
            }
            if !onlyPictures {
                Markdown(text: message.shown, ink: ink, link: link, code: wash, underline: message.mine, selectable: false)
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
                    .contentShape(.contextMenuPreview, RoundedRectangle(cornerRadius: 19, style: .continuous))
                    .onTapGesture(count: 2) {
                        Haptic.tap()
                        tapback = true
                    }
                    .contextMenu {
                        Button(action: reply) { Label("Reply", systemImage: "arrowshape.turn.up.left") }
                        Button {
                            tapback = true
                        } label: {
                            Label("Tapback", systemImage: "heart")
                        }
                        Button {
                            UIPasteboard.general.string = message.body
                        } label: {
                            Label("Copy", systemImage: "doc.on.doc")
                        }
                    }
                    .popover(isPresented: $tapback, arrowEdge: .bottom) {
                        Tapbacks(current: message.myReaction) { emoji in
                            tapback = false
                            Haptic.tap()
                            Task { try? await model.react(room.code, seq: message.seq, emoji: emoji == message.myReaction ? nil : emoji) }
                        }
                        .presentationCompactAdaptation(.popover)
                    }
            }
        }
        .overlay(alignment: message.mine ? .topLeading : .topTrailing) {
            if !message.reactions.isEmpty {
                Badges(reactions: message.reactions, mine: message.mine)
                    .offset(x: message.mine ? -16 : 16, y: -22)
            }
        }
    }
}

struct Tapbacks: View {
    static let emojis = ["❤️", "👍", "👎", "😂", "‼️", "❓"]
    let current: String?
    let pick: (String) -> Void

    var body: some View {
        HStack(spacing: 4) {
            ForEach(Self.emojis, id: \.self) { emoji in
                Button {
                    pick(emoji)
                } label: {
                    Text(emoji)
                        .font(.system(size: 26))
                        .frame(width: 42, height: 42)
                        .background(Circle().fill(emoji == current ? Tone.accent.opacity(0.9) : .clear))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
    }
}

struct Badges: View {
    let reactions: [ReactionView]
    let mine: Bool

    var body: some View {
        HStack(spacing: -8) {
            ForEach(reactions.prefix(3), id: \.emoji) { r in
                Text(r.emoji)
                    .font(.system(size: 14))
                    .frame(width: 28, height: 28)
                    .background(Circle().fill(r.mine ? Tone.bubbleMine : Tone.bubbleThem))
                    .overlay(Circle().stroke(Tone.canvas, lineWidth: 2))
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(reactions.map { "\($0.emoji) \($0.who.joined(separator: ", "))" }.joined(separator: "; "))
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
            VStack(alignment: .leading, spacing: 1) {
                Text(room.display(quote.from)).type(.stamp, .semibold).foregroundStyle(Tone.ink3)
                Text(quote.words).type(.meta).foregroundStyle(Tone.ink3).lineLimit(2).multilineTextAlignment(.leading)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(Tone.wash, in: RoundedRectangle(cornerRadius: 15, style: .continuous))
            .frame(maxWidth: 260, alignment: .leading)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("In reply to \(room.display(quote.from)): \(quote.words)")
    }
}

struct Poll {
    let seq: Int
    let body: String
    let choices: [String]
    let chosen: Chosen?
    let waiting: Bool

    init(_ message: MessageView) {
        seq = message.seq
        body = message.shown
        choices = message.choices
        chosen = message.chosen
        waiting = message.waiting
    }

    init(_ ask: AskView) {
        seq = ask.seq
        body = ask.shown
        choices = ask.choices
        chosen = nil
        waiting = true
    }
}

struct AskLine: View {
    let ask: AskView
    let room: RoomView
    let other: () -> Void

    private var origin: String {
        if let task = ask.task { return "in \(taskLabel(task))" }
        if let place = ask.place, place.hasPrefix("dm:") { return "in a direct thread" }
        return ""
    }

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            Face(name: ask.from, member: room.member(ask.from), size: 30)
            VStack(alignment: .leading, spacing: 3) {
                Text([room.display(ask.from), origin].filter { !$0.isEmpty }.joined(separator: " · "))
                    .type(.meta)
                    .foregroundStyle(Tone.ink3)
                    .padding(.leading, 12)
                PollCard(poll: Poll(ask), room: room, tail: true, other: other)
            }
            Spacer(minLength: 40)
        }
        .padding(.top, 10)
    }
}

struct ReviewLine: View {
    let review: ReviewView
    let room: RoomView
    let back: () -> Void

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            if let by = review.by {
                Face(name: by, member: room.member(by), size: 30)
            } else {
                Color.clear.frame(width: 30, height: 30)
            }
            VStack(alignment: .leading, spacing: 3) {
                Text([review.by.map { room.display($0) }, "in \(taskLabel(review.task))"].compactMap { $0 }.joined(separator: " · "))
                    .type(.meta)
                    .foregroundStyle(Tone.ink3)
                    .padding(.leading, 12)
                ReviewCard(review: review, room: room, back: back)
            }
            Spacer(minLength: 40)
        }
        .padding(.top, 10)
    }
}

struct ReviewCard: View {
    let review: ReviewView
    let room: RoomView
    let back: () -> Void
    @Environment(AppModel.self) private var model
    @State private var approving = false
    @State private var failed = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Ready for your review")
                .type(.meta, .semibold)
                .foregroundStyle(Tone.decide)
                .padding(.bottom, 4)
            (Text(taskLabel(review.task)).foregroundStyle(Tone.ink3) + Text(" \(review.title)").foregroundStyle(Tone.ink))
                .type(.body)
                .padding(.bottom, 10)
            Rectangle().fill(Tone.line).frame(height: 0.5)
            Button(action: approve) {
                HStack(spacing: 10) {
                    Image(systemName: "checkmark.circle").font(.system(size: 17, weight: .medium)).frame(width: 22)
                    Text("Approve").type(.ui, .medium)
                    Spacer(minLength: 0)
                    if approving { ProgressView().controlSize(.mini) }
                }
                .foregroundStyle(Tone.ink)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(approving)
            Rectangle().fill(Tone.line).frame(height: 0.5).padding(.leading, 32)
            Button(action: back) {
                HStack(spacing: 10) {
                    Image(systemName: "arrowshape.turn.up.left").font(.system(size: 13, weight: .semibold)).frame(width: 22)
                    Text("Send back…").type(.ui, .medium)
                    Spacer(minLength: 0)
                }
                .foregroundStyle(Tone.accent)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(approving)
            if failed {
                Text("Couldn't send · Try again").type(.meta).foregroundStyle(Tone.alert).padding(.top, 2)
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .frame(maxWidth: 300, alignment: .leading)
        .background {
            ZStack {
                RoundedRectangle(cornerRadius: 19, style: .continuous).fill(Tone.bubbleThem)
                Tail().fill(Tone.bubbleThem).scaleEffect(x: -1, anchor: .center)
            }
        }
    }

    private func approve() {
        guard !approving else { return }
        approving = true
        failed = false
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        Task {
            do {
                try await model.approve(room.code, task: review.task)
                UINotificationFeedbackGenerator().notificationOccurred(.success)
            } catch {
                failed = true
                UINotificationFeedbackGenerator().notificationOccurred(.error)
            }
            approving = false
        }
    }
}

struct PollCard: View {
    let poll: Poll
    let room: RoomView
    let tail: Bool
    let other: () -> Void
    @Environment(AppModel.self) private var model
    @State private var sending: String?
    @State private var failed = false

    private var open: Bool { poll.waiting && poll.chosen == nil }
    private var picked: String? { poll.chosen?.choice ?? sending }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(open ? "Question for you" : poll.chosen == nil ? "Question" : "Decided")
                .type(.meta, .semibold)
                .foregroundStyle(open ? Tone.decide : Tone.ink3)
                .padding(.bottom, 4)
            Markdown(text: poll.body)
                .padding(.bottom, 10)
            Rectangle().fill(Tone.line).frame(height: 0.5)
            ForEach(poll.choices, id: \.self) { choice in
                option(choice)
            }
            if open {
                Button(action: other) {
                    HStack(spacing: 10) {
                        Image(systemName: "arrowshape.turn.up.left").font(.system(size: 13, weight: .semibold)).frame(width: 22)
                        Text("Something else…").type(.ui, .medium)
                        Spacer(minLength: 0)
                    }
                    .foregroundStyle(Tone.accent)
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            if let chosen = poll.chosen {
                Text("\(chosen.by == room.me ? "You" : room.display(chosen.by)) chose")
                    .type(.meta)
                    .foregroundStyle(Tone.ink3)
                    .padding(.top, 2)
            } else if failed {
                Text("Couldn't send · Try again").type(.meta).foregroundStyle(Tone.alert).padding(.top, 2)
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .frame(maxWidth: 300, alignment: .leading)
        .background {
            ZStack {
                RoundedRectangle(cornerRadius: 19, style: .continuous).fill(Tone.bubbleThem)
                if tail {
                    Tail().fill(Tone.bubbleThem).scaleEffect(x: -1, anchor: .center)
                }
            }
        }
        .animation(.spring(duration: 0.35, bounce: 0.3), value: picked)
    }

    private func option(_ choice: String) -> some View {
        let chosen = picked == choice
        return Button {
            guard open, sending == nil else { return }
            sending = choice
            failed = false
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            Task {
                do {
                    try await model.answer(room.code, seq: poll.seq, text: choice)
                    UINotificationFeedbackGenerator().notificationOccurred(.success)
                } catch {
                    sending = nil
                    failed = true
                    UINotificationFeedbackGenerator().notificationOccurred(.error)
                }
            }
        } label: {
            VStack(spacing: 0) {
                HStack(spacing: 10) {
                    ZStack {
                        Circle().strokeBorder(chosen ? Tone.accent : Tone.ink3, lineWidth: 1.5)
                        if chosen {
                            Circle().fill(Tone.accent)
                            Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(.white)
                        }
                    }
                    .frame(width: 22, height: 22)
                    Text(choice)
                        .type(.ui, .medium)
                        .foregroundStyle(picked == nil || chosen ? Tone.ink : Tone.ink3)
                        .multilineTextAlignment(.leading)
                    Spacer(minLength: 0)
                    if sending == choice && poll.chosen == nil {
                        ProgressView().controlSize(.mini)
                    }
                }
                .padding(.vertical, 11)
                .padding(.horizontal, chosen ? 8 : 0)
                .background {
                    if chosen {
                        RoundedRectangle(cornerRadius: 12, style: .continuous).fill(.clear).prism(RoundedRectangle(cornerRadius: 12, style: .continuous), band: 0.5)
                    }
                }
                .padding(.horizontal, chosen ? -8 : 0)
                Rectangle().fill(Tone.line).frame(height: 0.5).padding(.leading, 32)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!open)
        .accessibilityLabel(chosen ? "\(choice), chosen" : choice)
    }
}

struct Shown: Identifiable {
    let id = UUID()
    let image: UIImage
}

struct Picture: View {
    let code: String
    let seq: Int
    let index: Int
    @Environment(AppModel.self) private var model
    @State private var image: UIImage?
    @State private var failed = false
    @State private var shown: Shown?

    var body: some View {
        Group {
            if let image {
                Button {
                    shown = Shown(image: image)
                } label: {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFit()
                        .frame(maxWidth: 240, maxHeight: 320)
                }
                .buttonStyle(.plain)
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
        .fullScreenCover(item: $shown) { s in Viewer(image: s.image) }
    }
}

struct Viewer: View {
    let image: UIImage
    @Environment(\.dismiss) private var dismiss
    @State private var zoom: CGFloat = 1
    @State private var settled: CGFloat = 1
    @State private var drag: CGSize = .zero

    var body: some View {
        ZStack {
            Color.black.opacity(zoom > 1 ? 1 : max(0.3, 1 - abs(drag.height) / 400)).ignoresSafeArea()
            Image(uiImage: image)
                .resizable()
                .scaledToFit()
                .scaleEffect(zoom)
                .offset(drag)
                .gesture(
                    MagnifyGesture()
                        .onChanged { zoom = max(1, settled * $0.magnification) }
                        .onEnded { _ in
                            settled = zoom
                            if zoom < 1.05 {
                                withAnimation(Motion.ease) {
                                    zoom = 1
                                    settled = 1
                                }
                            }
                        }
                        .simultaneously(
                            with: DragGesture()
                                .onChanged { drag = $0.translation }
                                .onEnded { end in
                                    if zoom <= 1 && abs(end.translation.height) > 120 {
                                        dismiss()
                                    } else if zoom <= 1 {
                                        withAnimation(.spring(duration: 0.3)) { drag = .zero }
                                    }
                                }
                        )
                )
                .onTapGesture(count: 2) {
                    withAnimation(.spring(duration: 0.3)) {
                        zoom = zoom > 1 ? 1 : 2.5
                        settled = zoom
                        drag = .zero
                    }
                }
        }
        .overlay(alignment: .top) {
            HStack {
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark").font(.system(size: 17, weight: .semibold)).foregroundStyle(.white).frame(width: 44, height: 44).glassCircle()
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Close")
                Spacer()
                ShareLink(item: Image(uiImage: image), preview: SharePreview("Picture", image: Image(uiImage: image))) {
                    Image(systemName: "square.and.arrow.up").font(.system(size: 17, weight: .semibold)).foregroundStyle(.white).frame(width: 44, height: 44).glassCircle()
                }
                .accessibilityLabel("Share")
            }
            .padding(.horizontal, 16)
            .opacity(drag == .zero ? 1 : 0)
        }
        .environment(\.colorScheme, .dark)
    }
}

struct Prose: View {
    let text: String
    var ink: Color = Tone.ink
    var link: Color = Tone.accent
    var code: Color = Tone.wash2
    var underline = false

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
        var out = (try? AttributedString(markdown: s, options: options)) ?? AttributedString(s)
        let plain = String(out.characters)
        if let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) {
            for match in detector.matches(in: plain, range: NSRange(plain.startIndex..., in: plain)) {
                guard let url = match.url, let range = Range(match.range, in: plain), let found = out.range(of: String(plain[range])) else { continue }
                if out[found].link == nil { out[found].link = url }
            }
        }
        if underline {
            for run in out.runs where run.link != nil { out[run.range].underlineStyle = .single }
        }
        return out
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
