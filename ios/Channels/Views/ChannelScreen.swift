import SwiftUI

struct ChannelScreen: View {
    let code: String
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var details = Self.opensDetails
    @State private var replyTo: MessageView?
    @FocusState private var typing: Bool

    private static var opensDetails: Bool {
        #if DEBUG
            UserDefaults.standard.string(forKey: "shot") == "tasks"
        #else
            false
        #endif
    }

    var body: some View {
        Group {
            if let room = model.rooms[code] {
                Conversation(room: room, replyTo: $replyTo, typing: $typing)
                    .bar(.top) { header(room) }
                    .bar(.bottom) { Composer(room: room, replyTo: $replyTo, typing: $typing) }
                    .onAppear { model.markSeen(room) }
                    .onChange(of: room.messages.last?.seq) { _, _ in model.markSeen(room) }
                    .sheet(isPresented: $details) { Details(room: room) }
            } else {
                Centered(title: "This channel is gone", detail: "Its owner closed it, or this phone was removed from it.")
            }
        }
        .background(Tone.canvas)
        .toolbar(.hidden, for: .navigationBar)
    }

    private func header(_ room: RoomView) -> some View {
        ZStack(alignment: .top) {
            HStack {
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 19, weight: .semibold))
                        .foregroundStyle(Tone.ink)
                        .frame(width: 44, height: 44)
                        .glassCircle()
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Channels")
                Spacer()
            }
            Button {
                details = true
            } label: {
                VStack(spacing: -6) {
                    ChannelAvatar(room: room, size: 54)
                    HStack(spacing: 3) {
                        Text(room.title).type(.ui, .semibold).foregroundStyle(Tone.ink).lineLimit(1)
                        Image(systemName: "chevron.right").font(.system(size: 10, weight: .bold)).foregroundStyle(Tone.ink3)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .glassCapsule()
                    status(room).padding(.top, 9)
                }
            }
            .buttonStyle(.plain)
            .frame(maxWidth: 240)
            .accessibilityLabel("\(room.title), details")
        }
        .padding(.horizontal, 12)
        .padding(.top, 2)
        .padding(.bottom, 6)
    }

    @ViewBuilder private func status(_ room: RoomView) -> some View {
        let parts: [String] = [
            room.connection == .connecting ? "Connecting…" : nil,
            room.connection == .reconnecting ? "Reconnecting…" : nil,
            room.working > 0 ? "\(room.working) working" : nil,
            room.asks.isEmpty ? nil : "\(room.asks.count) \(room.asks.count == 1 ? "needs" : "need") you",
            room.hold != nil ? "paused" : nil,
        ].compactMap { $0 }
        if !parts.isEmpty {
            HStack(spacing: 4) {
                if room.working > 0 { Dot(color: Tone.doing, size: 5) }
                Text(parts.joined(separator: " · ")).type(.stamp, .medium).foregroundStyle(room.asks.isEmpty ? Tone.ink3 : Tone.decide)
            }
        }
    }
}

struct ChannelAvatar: View {
    let room: RoomView
    var size: CGFloat = 50

    var body: some View {
        Group {
            if let lead = room.lead, let member = room.member(lead) {
                Face(name: lead, member: member, size: size)
            } else {
                Text(String(room.title.prefix(1)).uppercased())
                    .font(.system(size: size * 0.42, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white)
                    .frame(width: size, height: size)
                    .background(Circle().fill(LinearGradient(colors: [Tone.avatarTop, Tone.avatarBottom], startPoint: .top, endPoint: .bottom)))
            }
        }
        .frame(width: size, height: size)
    }
}

struct Details: View {
    let room: RoomView
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            TasksTab(room: room)
                .background(Tone.canvas)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { dismiss() }
                    }
                }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }
}

extension View {
    @ViewBuilder func bar<Content: View>(_ edge: VerticalEdge, @ViewBuilder content: () -> Content) -> some View {
        if #available(iOS 26.0, *) {
            self.safeAreaBar(edge: edge, spacing: 0, content: content)
        } else {
            self.safeAreaInset(edge: edge, spacing: 0) {
                content().background {
                    LinearGradient(colors: [Tone.canvas, Tone.canvas.opacity(0)], startPoint: edge == .top ? .top : .bottom, endPoint: edge == .top ? .bottom : .top)
                        .ignoresSafeArea()
                }
            }
        }
    }
}
