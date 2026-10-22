import LocalAuthentication
import SwiftUI

struct ChannelList: View {
    @Environment(AppModel.self) private var model
    @State private var path: [Route] = []
    @State private var settings = false
    @State private var inbox = false
    @State private var search = ""
    @FocusState private var searching: Bool
    @Namespace private var glass

    private var needs: Int { model.channels.reduce(0) { $0 + $1.asks.count } }

    private var nextUnread: RoomView? {
        (model.pinnedChannels + model.otherChannels).first { model.unread($0) > 0 }
    }

    private var query: String { search.trimmingCharacters(in: .whitespaces).lowercased() }

    private var rows: [RoomView] {
        let all = query.isEmpty ? model.otherChannels : model.channels
        return query.isEmpty ? all : all.filter { $0.title.lowercased().contains(query) }
    }

    var body: some View {
        NavigationStack(path: $path) {
            List {
                header
                    .listRowInsets(EdgeInsets())
                    .listRowSeparator(.hidden)
                    .listRowBackground(Tone.canvas)
                if query.isEmpty && !model.pinnedChannels.isEmpty {
                    pins
                        .listRowInsets(EdgeInsets())
                        .listRowSeparator(.hidden)
                        .listRowBackground(Tone.canvas)
                }
                if model.channels.isEmpty {
                    empty
                        .listRowSeparator(.hidden)
                        .listRowBackground(Tone.canvas)
                }
                ForEach(rows) { room in
                    let unread = model.unread(room)
                    Button {
                        path.append(Route(code: room.code))
                    } label: {
                        ChannelRow(room: room, unread: unread, draft: model.draft(in: room))
                    }
                    .buttonStyle(RowPress())
                    .listRowInsets(EdgeInsets())
                    .listRowSeparator(.hidden)
                    .listRowBackground(Tone.canvas)
                    .swipeActions(edge: .leading, allowsFullSwipe: true) {
                        Button {
                            withAnimation(Motion.ease) { model.togglePin(room) }
                        } label: {
                            Label("Pin", systemImage: "pin.fill")
                        }
                        .tint(Tone.decide)
                    }
                    .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                        readButton(room, unread: unread)
                    }
                    .contextMenu { menu(room, unread: unread) }
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(Tone.canvas)
            .refreshable { model.nudge() }
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: Route.self) { route in
                ChannelScreen(route: route)
            }
            .bar(.bottom) { dock }
        }
        .sheet(isPresented: $settings) { SettingsSheet() }
        .sheet(isPresented: $inbox) {
            Inbox { code, place in path = [Route(code: code, place: place)] }
        }
        #if DEBUG
            .onChange(of: model.channels.first?.code) { _, code in
                guard let code, path.isEmpty, let shot = UserDefaults.standard.string(forKey: "shot") else { return }
                if let text = UserDefaults.standard.string(forKey: "draft") { model.keep(Draft(text: text), code, "main") }
                if shot == "settings" {
                    settings = true
                } else if shot != "list" {
                    path = [Route(code: code)]
                }
            }
        #endif
    }

    private func readButton(_ room: RoomView, unread: Int) -> some View {
        Button {
            if unread > 0 { model.markRead(room) } else { model.markUnread(room) }
        } label: {
            Label(unread > 0 ? "Read" : "Unread", systemImage: unread > 0 ? "envelope.open.fill" : "envelope.badge.fill")
        }
        .tint(Tone.accent)
    }

    @ViewBuilder private func menu(_ room: RoomView, unread: Int) -> some View {
        Button {
            withAnimation(Motion.ease) { model.togglePin(room) }
        } label: {
            Label(model.pinned.contains(room.code) ? "Unpin" : "Pin", systemImage: model.pinned.contains(room.code) ? "pin.slash" : "pin")
        }
        Button {
            if unread > 0 { model.markRead(room) } else { model.markUnread(room) }
        } label: {
            Label(unread > 0 ? "Mark as Read" : "Mark as Unread", systemImage: unread > 0 ? "envelope.open" : "envelope.badge")
        }
    }

    private var pins: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 16) {
            ForEach(model.pinnedChannels) { room in
                let unread = model.unread(room)
                Button {
                    path.append(Route(code: room.code))
                } label: {
                    VStack(spacing: 6) {
                        ChannelAvatar(room: room, size: 76)
                            .overlay(alignment: .topLeading) {
                                if unread > 0 {
                                    Circle().fill(Tone.accent).frame(width: 14, height: 14).overlay(Circle().stroke(Tone.canvas, lineWidth: 2.5))
                                }
                            }
                            .overlay(alignment: .topTrailing) {
                                if !room.asks.isEmpty {
                                    Text("\(room.asks.count)")
                                        .type(.stamp, .bold)
                                        .foregroundStyle(.white)
                                        .frame(minWidth: 20, minHeight: 20)
                                        .background(Tone.decide, in: Capsule())
                                        .overlay(Capsule().stroke(Tone.canvas, lineWidth: 2))
                                }
                            }
                        Text(room.title).type(.meta, unread > 0 ? .semibold : .regular).foregroundStyle(unread > 0 ? Tone.ink : Tone.ink2).lineLimit(1)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .contextMenu { menu(room, unread: unread) }
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 6)
        .padding(.bottom, 14)
    }

    private var header: some View {
        Text("Channels")
            .type(.display, .bold)
            .foregroundStyle(Tone.ink)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 16)
            .padding(.top, 14)
            .padding(.bottom, 8)
    }

    private var dock: some View {
        GlassGroup(spacing: 12) {
            HStack(spacing: 8) {
                HStack(spacing: 6) {
                    Image(systemName: "magnifyingglass").foregroundStyle(Tone.ink3)
                    TextField("Search", text: $search)
                        .type(.body)
                        .foregroundStyle(Tone.ink)
                        .submitLabel(.search)
                        .focused($searching)
                    if !search.isEmpty {
                        Button {
                            search = ""
                        } label: {
                            Image(systemName: "xmark.circle.fill").foregroundStyle(Tone.ink3)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Clear search")
                    }
                }
                .padding(.horizontal, 14)
                .frame(height: 48)
                .glassCapsule()
                .glassID("search", in: glass)
                if !searching {
                    if needs > 0 {
                        Button {
                            Haptic.tap()
                            inbox = true
                        } label: {
                            HStack(spacing: 5) {
                                Image(systemName: "hand.raised.fill").font(.system(size: 14, weight: .semibold))
                                Text("\(needs)").type(.ui, .bold)
                            }
                            .foregroundStyle(Tone.decide)
                            .padding(.horizontal, 14)
                            .frame(height: 48)
                            .glassCapsule()
                        }
                        .buttonStyle(.plain)
                        .glassID("needs", in: glass)
                        .accessibilityLabel("\(needs) need you")
                    }
                    if let next = nextUnread {
                        Button {
                            Haptic.tap()
                            path.append(Route(code: next.code))
                        } label: {
                            Image(systemName: "arrow.turn.down.right")
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(Tone.accent)
                                .frame(width: 48, height: 48)
                                .glassCircle()
                        }
                        .buttonStyle(.plain)
                        .glassID("next", in: glass)
                        .accessibilityLabel("Next unread: \(next.title)")
                    }
                    Button {
                        settings = true
                    } label: {
                        Face(name: model.person, member: nil, size: 40)
                            .frame(width: 48, height: 48)
                            .glassCircle()
                    }
                    .buttonStyle(.plain)
                    .glassID("me", in: glass)
                    .accessibilityLabel("Settings")
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .animation(.snappy(duration: 0.28), value: searching)
        }
    }

    private var empty: some View {
        VStack(spacing: 6) {
            Text("No channels yet").type(.title).foregroundStyle(Tone.ink)
            Text("Channels you join on your Mac show up here after you link again.")
                .type(.ui)
                .foregroundStyle(Tone.ink3)
                .multilineTextAlignment(.center)
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

struct ChannelRow: View {
    let room: RoomView
    let unread: Int
    var draft: Draft?

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            Circle()
                .fill(unread > 0 ? Tone.accent : .clear)
                .frame(width: 10, height: 10)
                .frame(width: 22)
                .padding(.top, 24)
            ChannelAvatar(room: room, size: 52)
                .padding(.trailing, 12)
                .padding(.top, 2)
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(room.title)
                        .type(.body, .semibold)
                        .foregroundStyle(Tone.ink)
                        .lineLimit(1)
                    Spacer(minLength: 8)
                    if let last = room.last {
                        Text(When.short(last.date)).type(.ui).foregroundStyle(Tone.ink3)
                    }
                    Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(Tone.ink3.opacity(0.6))
                }
                preview
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.trailing, 16)
            .padding(.vertical, 10)
            .overlay(alignment: .bottom) {
                Rectangle().fill(Tone.line).frame(height: 0.5)
            }
        }
    }

    @ViewBuilder private var preview: some View {
        if room.connection == .connecting && room.last == nil {
            Text("Opening…").type(.ui).foregroundStyle(Tone.ink3)
        } else if !room.asks.isEmpty {
            (Text("Needs you: ").foregroundStyle(Tone.decide).fontWeight(.semibold) + Text(oneLine(room.asks[0].body)).foregroundStyle(Tone.ink3))
                .type(.ui)
                .lineLimit(2)
        } else if let draft {
            (Text("Draft: ").foregroundStyle(Tone.alert) + Text(draft.text.isEmpty ? "a photo" : oneLine(draft.text)).foregroundStyle(Tone.ink3))
                .type(.ui)
                .lineLimit(2)
        } else if let last = room.last {
            (Text(last.mine ? "You: " : "\(room.display(last.from)): ") + Text(oneLine(last.body)))
                .type(.ui)
                .foregroundStyle(Tone.ink3)
                .lineLimit(2)
        } else {
            Text("No messages yet").type(.ui).foregroundStyle(Tone.ink3)
        }
    }

    private func oneLine(_ s: String) -> String {
        s.replacingOccurrences(of: "\n", with: " ")
    }
}

struct SettingsSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var confirm = false
    @State private var guarded = SettingsSheet.lockWords()

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
        NavigationStack {
            List {
                Section {
                    VStack(spacing: 4) {
                        Face(name: model.person, member: nil, size: 88).padding(.bottom, 8)
                        Text(model.person).font(.title2.weight(.bold)).foregroundStyle(Tone.ink)
                        Text("Linked to your Mac").type(.ui).foregroundStyle(Tone.ink3)
                    }
                    .frame(maxWidth: .infinity)
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 6, trailing: 0))
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
                Section {
                    Button {
                        dismiss()
                        model.relinkAsked = true
                    } label: {
                        Setting(symbol: "link", tint: Tone.accent, title: "Link again")
                    }
                    .tint(Tone.ink)
                } footer: {
                    Text("Brings the channels you joined on your Mac since you linked.")
                }
                Section {
                    Button(role: .destructive) {
                        confirm = true
                    } label: {
                        Text("Unlink this iPhone").frame(maxWidth: .infinity)
                    }
                } footer: {
                    Text("This iPhone holds your person key and your channels' keys in its keychain. Unlinking deletes them from this phone.")
                }
                Section {
                } footer: {
                    Text("Channels \(version)").frame(maxWidth: .infinity)
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.large])
        .confirmationDialog("Unlink this iPhone?", isPresented: $confirm, titleVisibility: .visible) {
            Button("Unlink", role: .destructive) {
                dismiss()
                model.unlink()
            }
        } message: {
            Text("Its keys are deleted. Link again from your Mac to come back.")
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
