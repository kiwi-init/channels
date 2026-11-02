import LocalAuthentication
import SwiftUI

struct ConversationList: View {
    @Environment(AppModel.self) private var model
    @State private var path: [Spot] = []
    @State private var filter = Filter.all
    @State private var search = ""
    @State private var settings = false
    @FocusState private var searching: Bool
    @Namespace private var glass

    private var query: String { search.trimmingCharacters(in: .whitespaces).lowercased() }
    private var finding: Bool { searching || !query.isEmpty }

    private var rows: [Row] {
        let all = model.rows(finding ? .all : filter)
        guard !query.isEmpty else { return finding ? all : all.filter { !model.isPinned($0.spot) || filter != .all } }
        return all.filter { $0.fullTitle.lowercased().contains(query) || $0.line.lowercased().contains(query) }
    }

    private var hits: [(Row, MessageView)] {
        guard query.count > 1 else { return [] }
        return model.rows(.all).flatMap { row in
            (model.shown(row.spot)?.messages ?? [])
                .filter { !$0.event && ($0.plain.lowercased().contains(query) || $0.body.lowercased().contains(query)) }
                .suffix(3)
                .map { (row, $0) }
        }
        .sorted { $0.1.at > $1.1.at }
        .prefix(20)
        .map { $0 }
    }

    var body: some View {
        NavigationStack(path: $path) {
            List {
                if let unsaved = model.unsaved {
                    Text(unsaved)
                        .type(.ui)
                        .foregroundStyle(Tone.alert)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .listRowInsets(EdgeInsets())
                        .listRowSeparator(.hidden)
                        .listRowBackground(Tone.canvas)
                }
                if filter == .all && !finding && !model.pinned.isEmpty {
                    pins
                        .listRowInsets(EdgeInsets())
                        .listRowSeparator(.hidden)
                        .listRowBackground(Tone.canvas)
                }
                if model.channels.isEmpty {
                    empty
                        .listRowSeparator(.hidden)
                        .listRowBackground(Tone.canvas)
                } else if rows.isEmpty && hits.isEmpty {
                    Text(finding ? "No Results" : emptyFilter)
                        .type(.body, .semibold)
                        .foregroundStyle(Tone.ink3)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 80)
                        .listRowSeparator(.hidden)
                        .listRowBackground(Tone.canvas)
                }
                ForEach(rows) { row in
                    Button {
                        path.append(row.spot)
                    } label: {
                        ConversationRowView(row: row)
                    }
                    .buttonStyle(RowPress())
                    .listRowInsets(EdgeInsets())
                    .listRowSeparator(.hidden)
                    .listRowBackground(Tone.canvas)
                    .swipeActions(edge: .leading, allowsFullSwipe: true) { leading(row) }
                    .contextMenu {
                        RowMenu(row: row) { path.append($0) }
                    } preview: {
                        RowPeek(row: row)
                    }
                }
                if !hits.isEmpty {
                    Text("Messages")
                        .type(.title, .bold)
                        .foregroundStyle(Tone.ink)
                        .padding(.horizontal, 16)
                        .padding(.top, 18)
                        .listRowInsets(EdgeInsets())
                        .listRowSeparator(.hidden)
                        .listRowBackground(Tone.canvas)
                    ForEach(hits, id: \.1.seq) { row, message in
                        Button {
                            path.append(row.spot)
                        } label: {
                            Hit(row: row, message: message, query: query)
                        }
                        .buttonStyle(RowPress())
                        .listRowInsets(EdgeInsets())
                        .listRowSeparator(.hidden)
                        .listRowBackground(Tone.canvas)
                    }
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(Tone.canvas)
            .softEdges()
            .refreshable { model.nudge() }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { toolbar }
            .navigationDestination(for: Spot.self) { spot in
                ConversationScreen(start: spot)
            }
            .navigationDestination(isPresented: $settings) {
                SettingsScreen()
            }
            .bar(.bottom) { dock }
        }
        #if DEBUG
            .onChange(of: model.channels.first?.code, initial: true) { _, code in
                guard let code, path.isEmpty, let shot = UserDefaults.standard.string(forKey: "shot") else { return }
                if let text = UserDefaults.standard.string(forKey: "draft") { model.keep(Draft(text: text), code, "main") }
                switch shot {
                case "settings": settings = true
                case "list": break
                default: path = [Spot(code: code, place: UserDefaults.standard.string(forKey: "place") ?? "main")]
                }
            }
        #endif
    }

    private var emptyFilter: String {
        switch filter {
        case .all: "No Conversations"
        case .needs: "Nothing Needs You"
        case .unread: "No Unread Messages"
        }
    }

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            Menu {
                Button {
                    settings = true
                } label: {
                    Label(model.person.isEmpty ? "Settings" : "Settings · \(model.person)", systemImage: "gear")
                }
                if !model.rows(.unread).isEmpty {
                    Button {
                        withAnimation(Motion.ease) { model.markAllRead() }
                    } label: {
                        Label("Mark All as Read", systemImage: "envelope.open")
                    }
                }
            } label: {
                Text("Edit")
            }
        }
        ToolbarItem(placement: .principal) {
            VStack(spacing: 0) {
                Text(filter == .all ? "Channels" : filter.title).type(.title).foregroundStyle(Tone.ink)
                if model.channels.contains(where: { $0.connection == .connecting }) {
                    Text("Connecting…").type(.stamp).foregroundStyle(Tone.ink3)
                }
            }
        }
        ToolbarItem(placement: .topBarTrailing) {
            Menu {
                Picker("Filter", selection: $filter.animation(Motion.ease)) {
                    ForEach(Filter.allCases, id: \.self) { f in
                        if f == .all || f == .needs || !model.rows(f).isEmpty {
                            Label(subtitle(f).map { "\(f.title) · \($0)" } ?? f.title, systemImage: f.symbol).tag(f)
                        }
                    }
                }
            } label: {
                Image(systemName: filter == .all ? "line.3.horizontal.decrease" : "line.3.horizontal.decrease.circle.fill")
                    .foregroundStyle(filter == .all ? Tone.ink : Tone.accent)
                    .overlay(alignment: .topTrailing) {
                        if model.waiting > 0 && filter != .needs {
                            Circle().fill(Tone.decide).frame(width: 9, height: 9).offset(x: 5, y: -4)
                        }
                    }
                    .accessibilityLabel(model.waiting > 0 ? "Filter, \(model.waiting) need you" : "Filter")
            }
        }
    }

    private func subtitle(_ f: Filter) -> String? {
        switch f {
        case .needs: model.waiting > 0 ? "\(model.waiting)" : nil
        case .unread: "\(model.rows(.unread).count)"
        default: nil
        }
    }

    @ViewBuilder private func leading(_ row: Row) -> some View {
        Button {
            withAnimation(Motion.ease) {
                if row.unread { model.markRead(row.spot) } else { model.markUnread(row.spot) }
            }
        } label: {
            Label(row.unread ? "Read" : "Unread", systemImage: row.unread ? "envelope.open.fill" : "envelope.badge.fill")
        }
        .tint(Tone.accent)
        Button {
            withAnimation(Motion.ease) { model.togglePin(row.spot) }
        } label: {
            Label(model.isPinned(row.spot) ? "Unpin" : "Pin", systemImage: model.isPinned(row.spot) ? "pin.slash.fill" : "pin.fill")
        }
        .tint(Tone.decide)
    }

    private var pins: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 18) {
            ForEach(model.pins()) { row in
                Button {
                    path.append(row.spot)
                } label: {
                    PinCell(row: row)
                }
                .buttonStyle(.plain)
                .contextMenu {
                    RowMenu(row: row) { path.append($0) }
                } preview: {
                    RowPeek(row: row)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 14)
        .padding(.bottom, 16)
    }

    private var dock: some View {
        GlassGroup(spacing: 10) {
            HStack(spacing: 10) {
                HStack(spacing: 8) {
                    Button {
                        if finding {
                            search = ""
                            searching = false
                        } else {
                            searching = true
                        }
                    } label: {
                        Image(systemName: finding ? "chevron.left" : "magnifyingglass")
                            .font(.system(size: 17, weight: finding ? .semibold : .regular))
                            .foregroundStyle(finding ? Tone.ink : Tone.ink3)
                            .contentTransition(.symbolEffect(.replace))
                            .frame(width: 28, height: 44)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(finding ? "End search" : "Search")
                    TextField("Search", text: $search)
                        .type(.body)
                        .foregroundStyle(Tone.ink)
                        .submitLabel(.search)
                        .focused($searching)
                }
                .padding(.leading, 12)
                .padding(.trailing, 16)
                .frame(height: 48)
                .glassCapsule()
                .glassID("search", in: glass)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 6)
            .animation(.snappy(duration: 0.28), value: finding)
        }
    }

    private var emptyDetail: String {
        if model.joining > 0 {
            let channels = model.joining == 1 ? "1 channel" : "\(model.joining) channels"
            return "Asked to join \(channels) as you. Channels you own let this iPhone in while Channels is open on your computer."
        }
        return model.enrolled ? "This iPhone joins the channels your computer had when it approved it." : "Link your Mac again to bring your channels."
    }

    private var empty: some View {
        VStack(spacing: 6) {
            Text(model.joining > 0 ? "Waiting to Be Let In" : "No Conversations").type(.title, .semibold).foregroundStyle(Tone.ink)
            Text(emptyDetail)
                .type(.ui)
                .foregroundStyle(Tone.ink3)
                .multilineTextAlignment(.center)
            if !model.enrolled {
                Button("Link Again") { model.relinkAsked = true }
                    .type(.ui, .semibold)
                    .padding(.top, 6)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(40)
    }
}

struct RowPress: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(configuration.isPressed ? Tone.wash2 : .clear)
            .contentShape(Rectangle())
    }
}

struct RowAvatar: View {
    let row: Row
    var size: CGFloat = 52

    var body: some View {
        Group {
            switch row.kind {
            case .group:
                ChannelAvatar(room: row.room, size: size)
                    .overlay(alignment: .topTrailing) {
                        if row.working {
                            Circle().fill(Tone.doing).frame(width: size * 0.26, height: size * 0.26).overlay(Circle().stroke(Tone.canvas, lineWidth: 2))
                        }
                    }
            case .lead:
                Face(name: row.lead ?? row.title, member: row.lead.flatMap { row.room.member($0) }, size: size)
            }
        }
        .overlay(alignment: .bottomTrailing) {
            if row.kind != .group && row.qualifier != nil && size >= 44 {
                ChannelAvatar(room: row.room, size: size * 0.4).overlay(Circle().stroke(Tone.canvas, lineWidth: 2)).offset(x: 3, y: 3)
            }
        }
        .frame(width: size, height: size)
    }
}

struct ConversationRowView: View {
    let row: Row

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            Circle()
                .fill(row.unread ? Tone.accent : .clear)
                .frame(width: 10, height: 10)
                .frame(width: 22)
                .padding(.top, 24)
            RowAvatar(row: row)
                .padding(.trailing, 12)
                .padding(.top, 2)
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    (Text(row.title).foregroundStyle(Tone.ink) + Text(row.qualifier.map { " · \($0)" } ?? "").foregroundStyle(Tone.ink3).fontWeight(.regular))
                        .type(.body, .semibold)
                        .lineLimit(1)
                    Spacer(minLength: 8)
                    if let last = row.last {
                        Text(When.list(last.date)).type(.ui).foregroundStyle(Tone.ink3)
                    }
                    Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(Tone.ink3.opacity(0.6))
                }
                preview
                    .type(.ui)
                    .lineLimit(2)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.trailing, 16)
            .padding(.vertical, 11)
            .overlay(alignment: .bottom) {
                Rectangle().fill(Tone.line).frame(height: 0.5)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var preview: Text {
        let line = row.line
        if let need = row.need {
            let more = row.needs > 1 ? " · \(row.needs)" : ""
            return Text("Needs you: ").foregroundStyle(Tone.decide).fontWeight(.semibold) + Text(need + more).foregroundStyle(Tone.ink3)
        }
        if row.draft != nil, line.hasPrefix("Draft: ") {
            return Text("Draft: ").foregroundStyle(Tone.alert) + Text(String(line.dropFirst(7))).foregroundStyle(Tone.ink3)
        }
        return Text(line).foregroundStyle(Tone.ink3)
    }
}

struct PinCell: View {
    let row: Row

    var body: some View {
        VStack(spacing: 6) {
            RowAvatar(row: row, size: 80)
                .overlay(alignment: .topLeading) {
                    if row.unread {
                        Circle().fill(Tone.accent).frame(width: 14, height: 14).overlay(Circle().stroke(Tone.canvas, lineWidth: 2.5))
                    }
                }
                .overlay(alignment: .top) {
                    if let peek {
                        Text(peek)
                            .type(.meta)
                            .foregroundStyle(row.needs == 0 ? Tone.ink2 : Tone.decide)
                            .lineLimit(1)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(row.needs == 0 ? Tone.bubbleThem : Tone.decideWash, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                            .frame(maxWidth: 112)
                            .offset(y: -22)
                            .transition(.scale(scale: 0.6).combined(with: .opacity))
                    }
                }
            Text(row.title)
                .type(.meta, row.unread ? .semibold : .regular)
                .foregroundStyle(row.unread ? Tone.ink : Tone.ink2)
                .lineLimit(1)
        }
        .padding(.top, peek == nil ? 0 : 12)
        .contentShape(Rectangle())
        .animation(.spring(duration: 0.3, bounce: 0.3), value: peek)
    }

    private var peek: String? {
        if let need = row.need { return need }
        guard row.unread, let last = row.last else { return nil }
        return last.plain.replacingOccurrences(of: "\n", with: " ")
    }
}

struct RowMenu: View {
    let row: Row
    let open: (Spot) -> Void
    @Environment(AppModel.self) private var model

    var body: some View {
        if let ask = row.asks.first(where: { !$0.choices.isEmpty }) {
            Section("Answer \(row.room.display(ask.from))") {
                ForEach(ask.choices, id: \.self) { choice in
                    Button {
                        Haptic.tap()
                        Task { try? await model.answer(row.spot.code, seq: ask.seq, text: choice) }
                    } label: {
                        Label(choice, systemImage: "checkmark.circle")
                    }
                }
            }
        }
        if let other = row.room.other(than: row.spot) {
            Button {
                open(other)
            } label: {
                Label(other.general ? "Open # general" : "Message \(row.room.spotTitle(other.place))", systemImage: other.general ? "number" : "bubble.left")
            }
        }
        Button {
            withAnimation(Motion.ease) { model.togglePin(row.spot) }
        } label: {
            Label(model.isPinned(row.spot) ? "Unpin" : "Pin", systemImage: model.isPinned(row.spot) ? "pin.slash" : "pin")
        }
        Button {
            withAnimation(Motion.ease) {
                if row.unread { model.markRead(row.spot) } else { model.markUnread(row.spot) }
            }
        } label: {
            Label(row.unread ? "Mark as Read" : "Mark as Unread", systemImage: row.unread ? "envelope.open" : "envelope.badge")
        }
    }
}

struct RowPeek: View {
    let row: Row
    @Environment(AppModel.self) private var model

    private var messages: [MessageView] {
        let cached = model.shown(row.spot)?.messages.filter { !$0.event } ?? []
        if !cached.isEmpty { return Array(cached.suffix(8)) }
        return row.last.map { [$0] } ?? []
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                RowAvatar(row: row, size: 36)
                Text(row.fullTitle).type(.body, .semibold).foregroundStyle(Tone.ink).lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            Rectangle().fill(Tone.line).frame(height: 0.5)
            VStack(spacing: 6) {
                Spacer(minLength: 0)
                ForEach(messages) { m in
                    PeekBubble(message: m, name: row.kind == .group && !m.mine ? row.room.display(m.from) : nil)
                }
                if let ask = row.asks.first {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(ask.label).type(.meta, .semibold).foregroundStyle(Tone.decide)
                        Text(ask.plain).type(.ui).foregroundStyle(Tone.ink).lineLimit(4)
                        ForEach(ask.choices, id: \.self) { choice in
                            Text(choice).type(.ui, .medium).foregroundStyle(Tone.ink)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 7)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(Tone.wash2, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                        }
                    }
                    .padding(12)
                    .background(Tone.bubbleThem, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .frame(maxWidth: .infinity, alignment: .leading)
                } else if let review = row.reviews.first {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Ready for your review").type(.meta, .semibold).foregroundStyle(Tone.decide)
                        Text("\(taskLabel(review.task)) \(review.title)").type(.ui).foregroundStyle(Tone.ink).lineLimit(4)
                    }
                    .padding(12)
                    .background(Tone.bubbleThem, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(12)
        }
        .frame(width: 340, height: 440)
        .background(Tone.canvas)
    }
}

struct PeekBubble: View {
    let message: MessageView
    let name: String?

    var body: some View {
        VStack(alignment: message.mine ? .trailing : .leading, spacing: 2) {
            if let name {
                Text(name).type(.stamp).foregroundStyle(Tone.ink3).padding(.horizontal, 10)
            }
            Text(message.body.isEmpty && message.images > 0 ? "Photo" : message.plain)
                .type(.ui)
                .foregroundStyle(message.mine ? .white : Tone.ink)
                .lineLimit(5)
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(message.mine ? Tone.bubbleMine : Tone.bubbleThem, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .frame(maxWidth: 260, alignment: message.mine ? .trailing : .leading)
        .frame(maxWidth: .infinity, alignment: message.mine ? .trailing : .leading)
    }
}

struct Hit: View {
    let row: Row
    let message: MessageView
    let query: String

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            RowAvatar(row: row, size: 28).padding(.top, 2)
            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text(row.fullTitle).type(.meta, .semibold).foregroundStyle(Tone.ink).lineLimit(1)
                    Spacer()
                    Text(When.list(message.date)).type(.meta).foregroundStyle(Tone.ink3)
                }
                Text(highlighted)
                    .type(.ui)
                    .lineLimit(3)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                    .background(Tone.bubbleThem, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }

    private var highlighted: AttributedString {
        var out = AttributedString((message.mine ? "You: " : "\(row.room.display(message.from)): ") + message.plain.replacingOccurrences(of: "\n", with: " "))
        out.foregroundColor = Tone.ink2
        if let range = out.range(of: query, options: .caseInsensitive) {
            out[range].foregroundColor = Tone.ink
            out[range].font = .body.bold()
        }
        return out
    }
}

struct SettingsScreen: View {
    @Environment(AppModel.self) private var model
    @State private var confirm = false
    @State private var guarded = SettingsScreen.lockWords()

    private var relayHost: String {
        URL(string: model.relay)?.host() ?? model.relay
    }

    private var version: String {
        let info = Bundle.main.infoDictionary
        return "\(info?["CFBundleShortVersionString"] as? String ?? "") (\(info?["CFBundleVersion"] as? String ?? ""))"
    }

    private static func lockWords() -> String {
        let context = LAContext()
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: nil) else { return "Off, no passcode" }
        let how =
            switch context.biometryType {
            case .faceID: "Face ID"
            case .touchID: "Touch ID"
            case .opticID: "Optic ID"
            default: "Passcode"
            }
        return "\(how), after 30 s"
    }

    var body: some View {
        List {
            Section {
                VStack(spacing: 4) {
                    Face(name: model.person, member: nil, size: 80).padding(.bottom, 8)
                    Text(model.person).font(.title2.weight(.bold)).foregroundStyle(Tone.ink)
                    Text(model.enrolled ? "One of your devices" : "Linked to your Mac").type(.ui).foregroundStyle(Tone.ink3)
                }
                .frame(maxWidth: .infinity)
                .accessibilityElement(children: .combine)
            }
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: 8, leading: 0, bottom: 6, trailing: 0))
            Section("This iPhone") {
                LabeledContent {
                    Text("\(model.channels.count)")
                } label: {
                    Setting(symbol: "bubble.left.and.bubble.right.fill", tint: Tone.live, title: "Channels")
                }
                LabeledContent {
                    Text(relayHost).lineLimit(1).truncationMode(.middle)
                } label: {
                    Setting(symbol: "antenna.radiowaves.left.and.right", tint: Tone.doing, title: "Relay")
                }
                LabeledContent {
                    Text(guarded)
                } label: {
                    Setting(symbol: "lock.fill", tint: Tone.ink3, title: "Lock")
                }
            }
            if !model.enrolled {
                Section {
                    Button {
                        model.relinkAsked = true
                    } label: {
                        Setting(symbol: "link", tint: Tone.accent, title: "Link Again")
                    }
                    .tint(Tone.ink)
                } footer: {
                    Text("Brings the channels you joined on your Mac since you linked.")
                }
            }
            Section {
                Button(role: .destructive) {
                    confirm = true
                } label: {
                    Text(model.enrolled ? "Sign Out of This iPhone" : "Unlink This iPhone").frame(maxWidth: .infinity)
                }
            } footer: {
                Text(
                    model.enrolled
                        ? "This iPhone holds its own device key and its channels' keys in its keychain. Signing out deletes them from this phone; forget it in Settings → Devices on your computer too."
                        : "This iPhone holds your person key and your channels' keys in its keychain. Unlinking deletes them from this phone.")
            }
            Section {
            } footer: {
                Text("Channels \(version)").frame(maxWidth: .infinity)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog(model.enrolled ? "Sign out of this iPhone?" : "Unlink this iPhone?", isPresented: $confirm, titleVisibility: .visible) {
            Button(model.enrolled ? "Sign Out" : "Unlink", role: .destructive) {
                model.unlink()
            }
        } message: {
            Text(model.enrolled ? "Its keys are deleted. Sign in again to come back." : "Its keys are deleted. Link again from your Mac to come back.")
        }
    }
}

struct Setting: View {
    let symbol: String
    let tint: Color
    let title: String

    var body: some View {
        Label {
            Text(title).type(.body).foregroundStyle(Tone.ink)
        } icon: {
            Image(systemName: symbol)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 30, height: 30)
                .background(tint.gradient, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
        }
    }
}
