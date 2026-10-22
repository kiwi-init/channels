import SwiftUI

struct ChannelList: View {
    @Environment(AppModel.self) private var model
    @State private var path: [String] = []
    @State private var settings = false
    @State private var search = ""

    private var shown: [RoomView] {
        let q = search.trimmingCharacters(in: .whitespaces).lowercased()
        return q.isEmpty ? model.channels : model.channels.filter { $0.title.lowercased().contains(q) }
    }

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                LazyVStack(spacing: 0) {
                    header
                    if model.channels.isEmpty {
                        empty
                    }
                    ForEach(shown) { room in
                        Button {
                            path.append(room.code)
                        } label: {
                            ChannelRow(room: room, unread: model.unread(room))
                        }
                        .buttonStyle(RowPress())
                    }
                }
            }
            .refreshable { model.nudge() }
            .background(Tone.canvas)
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

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Spacer()
                Button {
                    settings = true
                } label: {
                    Face(name: model.person, member: nil, size: 36)
                }
                .accessibilityLabel("Settings")
            }
            Text("Channels").type(.display, .bold).foregroundStyle(Tone.ink)
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass").foregroundStyle(Tone.ink3)
                TextField("Search", text: $search)
                    .type(.body)
                    .foregroundStyle(Tone.ink)
                    .submitLabel(.search)
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
