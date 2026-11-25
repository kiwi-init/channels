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
    @State private var picking = false
    @State private var keyboard = false
    @State private var home: CGFloat = 0

    private var barShown: Bool { !keyboard && model.docked == nil }

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
            if picking {
                Color.black.opacity(0.001)
                    .ignoresSafeArea()
                    .onTapGesture { picking = false }
                    .accessibilityHidden(true)
            }
            if barShown, picking {
                ChannelMenu(picking: $picking)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 10)
                    .transition(.scale(scale: 0.92, anchor: .bottom).combined(with: .opacity))
            }
        }
        .animation(Bar.spring(still), value: picking)
        .bar(.bottom) {
            if barShown {
                TabBar(picking: $picking)
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
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in keyboard = true }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in keyboard = false }
        .onChange(of: model.tab) { _, _ in picking = false }
        .onChange(of: model.path) { _, _ in picking = false }
        .onChange(of: model.composing) { _, _ in picking = false }
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
