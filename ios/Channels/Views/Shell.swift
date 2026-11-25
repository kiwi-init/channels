import SwiftUI

extension AppModel {
    func go(_ route: Route) {
        path.append(route)
    }

    func jump(_ route: Route) {
        tab = .chats
        path = [route]
    }
}

struct Shell: View {
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var still
    @State private var keyboard = false
    @State private var home: CGFloat = 0

    private var barShown: Bool { !keyboard && model.docked == nil && !model.leadOpen }

    var body: some View {
        ZStack(alignment: .bottom) {
            page(.chats) {
                NavigationStack(path: Binding(get: { model.path }, set: { model.path = $0 })) {
                    ChannelList()
                        .navigationDestination(for: Route.self) { RouteScreen(route: $0) }
                }
            }
            page(.needs) {
                NavigationStack {
                    NeedsScreen()
                }
            }
            page(.you) {
                NavigationStack {
                    SettingsScreen()
                }
            }
            if model.leadOpen {
                Color.black.opacity(0.001)
                    .ignoresSafeArea()
                    .onTapGesture { model.leadOpen = false }
                    .accessibilityHidden(true)
            }
        }
        .bar(.bottom) {
            if model.leadOpen, let room = model.leadRoom, let spot = room.leadSpot {
                LeadDock(room: room, spot: spot)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            } else if barShown {
                TabBar()
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
                    .padding(.bottom, home > 20 ? -12 : 12)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .onGeometryChange(for: CGFloat.self) {
            $0.safeAreaInsets.bottom
        } action: {
            if !keyboard { home = $0 }
        }
        .animation(Bar.spring(still), value: model.leadOpen)
        .onChange(of: model.path) { _, _ in model.leadOpen = false }
        .onChange(of: model.tab) { _, _ in model.leadOpen = false }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in keyboard = true }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in keyboard = false }
        .alert("Sign-in not saved", isPresented: Binding(get: { model.unsaved != nil }, set: { if !$0 { model.unsaved = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(model.unsaved ?? "")
        }
        #if DEBUG
            .onAppear(perform: shot)
            .overlay {
                if UserDefaults.standard.string(forKey: "shot") == "live" { LivePreview() }
            }
        #endif
    }

    private func page<Content: View>(_ tab: AppTab, @ViewBuilder _ content: () -> Content) -> some View {
        let shown = model.tab == tab
        return content()
            .opacity(shown ? 1 : 0)
            .allowsHitTesting(shown)
            .accessibilityHidden(!shown)
    }

    #if DEBUG
        private func shot() {
            guard let shot = UserDefaults.standard.string(forKey: "shot"), let first = model.channels.first else { return }
            if let text = UserDefaults.standard.string(forKey: "draft") { model.keep(Draft(text: text), first.code, "main") }
            let place = UserDefaults.standard.string(forKey: "place") ?? "main"
            switch shot {
            case "channel", "conversation": model.path = [.place(Spot(code: first.code, place: place))]
            case "needs": model.tab = .needs
            case "board", "tasks": model.path = [.tasks(first.code)]
            case "settings": model.tab = .you
            default: break
            }
        }
    #endif
}

struct RouteScreen: View {
    let route: Route

    var body: some View {
        switch route {
        case .place(let spot): ConversationScreen(start: spot)
        case .tasks(let code): TasksScreen(code: code)
        }
    }
}
