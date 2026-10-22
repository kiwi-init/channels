import SwiftUI

struct ChannelList: View {
    @Environment(AppModel.self) private var model
    @State private var path: [String] = []
    @State private var settings = false
    @State private var search = ""

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
                        path.append(room.code)
                    } label: {
                        ChannelRow(room: room, unread: unread)
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
            .navigationDestination(for: String.self) { code in
                ChannelScreen(code: code)
            }
        }
        .sheet(isPresented: $settings) { SettingsSheet() }
        #if DEBUG
            .onChange(of: model.channels.first?.code) { _, code in
                guard let code, path.isEmpty, UserDefaults.standard.string(forKey: "shot") != nil else { return }
                path = [code]
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
                    path.append(room.code)
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
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Spacer()
                Button {
                    settings = true
                } label: {
                    Face(name: model.person, member: nil, size: 36)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Settings")
            }
            Text("Channels").type(.display, .bold).foregroundStyle(Tone.ink)
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass").foregroundStyle(Tone.ink3)
                TextField("Search", text: $search)
                    .type(.body)
                    .foregroundStyle(Tone.ink)
                    .submitLabel(.search)
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
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(Tone.wash2, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
        }
        .padding(.horizontal, 16)
        .padding(.top, 6)
        .padding(.bottom, 8)
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

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Settings").type(.title, .semibold).foregroundStyle(Tone.ink)
                Spacer()
                Button("Done") { dismiss() }.type(.body, .semibold)
            }
            .padding(.bottom, 24)
            HStack(spacing: 12) {
                Face(name: model.person, member: nil, size: 44)
                VStack(alignment: .leading, spacing: 2) {
                    Text(model.person).type(.body, .semibold).foregroundStyle(Tone.ink)
                    Text("Linked to your Mac").type(.ui).foregroundStyle(Tone.ink3)
                }
            }
            .padding(.bottom, 20)
            row("Relay", model.relay)
            row("Channels", "\(model.channels.count)")
            Button {
                dismiss()
                model.relinkAsked = true
            } label: {
                HStack {
                    Text("Link again").type(.ui, .medium).foregroundStyle(Tone.accent)
                    Spacer()
                    Text("Brings channels you joined since").type(.meta).foregroundStyle(Tone.ink3)
                }
                .padding(.vertical, 12)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            Text("This iPhone holds your person key and the keys of your channels, in its keychain. Unlinking deletes them from this phone.")
                .type(.ui)
                .foregroundStyle(Tone.ink3)
                .padding(.top, 20)
            Spacer()
            Button(role: .destructive) {
                confirm = true
            } label: {
                Text("Unlink this iPhone")
                    .type(.body, .semibold)
                    .foregroundStyle(Tone.alert)
                    .frame(maxWidth: .infinity, minHeight: 50)
                    .outlined(Radius.ctl, Tone.edgeStrong)
            }
            .buttonStyle(.plain)
        }
        .padding(24)
        .background(Tone.canvas)
        .presentationDetents([.medium, .large])
        .confirmationDialog("Unlink this iPhone?", isPresented: $confirm, titleVisibility: .visible) {
            Button("Unlink", role: .destructive) {
                dismiss()
                model.unlink()
            }
        } message: {
            Text("Its keys are deleted. Link again from your Mac to come back.")
        }
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).type(.ui).foregroundStyle(Tone.ink2)
            Spacer()
            Text(value).type(.ui).foregroundStyle(Tone.ink).lineLimit(1).truncationMode(.middle)
        }
        .padding(.vertical, 12)
        .overlay(alignment: .bottom) { Rectangle().fill(Tone.line).frame(height: 1) }
    }
}
