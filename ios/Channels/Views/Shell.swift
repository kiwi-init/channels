import SwiftUI

extension AppModel {
    func go(_ route: Route) {
        path.append(route)
    }

    func jump(_ route: Route) {
        path = [route]
    }
}

struct Shell: View {
    @Environment(AppModel.self) private var model
    @State private var settings = false

    var body: some View {
        NavigationStack(path: Binding(get: { model.path }, set: { model.path = $0 })) {
            ChannelList(settings: $settings)
                .navigationDestination(for: Route.self) { RouteScreen(route: $0) }
        }
        .sheet(isPresented: $settings) {
            NavigationStack {
                SettingsScreen()
                    .toolbar {
                        ToolbarItem(placement: .topBarTrailing) {
                            Button("Done") { settings = false }
                        }
                    }
            }
        }
        .alert("Sign-in not saved", isPresented: Binding(get: { model.unsaved != nil }, set: { if !$0 { model.unsaved = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(model.unsaved ?? "")
        }
        #if DEBUG
            .onAppear(perform: shot)
        #endif
    }

    #if DEBUG
        private func shot() {
            guard let shot = UserDefaults.standard.string(forKey: "shot"), let first = model.channels.first else { return }
            if let text = UserDefaults.standard.string(forKey: "draft") { model.keep(Draft(text: text), first.code, "main") }
            let place = UserDefaults.standard.string(forKey: "place") ?? "main"
            switch shot {
            case "channel", "conversation": model.path = [.place(Spot(code: first.code, place: place))]
            case "needs": model.path = [.needs]
            case "board", "tasks": model.path = [.tasks(first.code)]
            case "settings": settings = true
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
        case .needs: NeedsScreen()
        }
    }
}
