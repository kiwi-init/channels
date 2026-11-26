import SwiftUI
import UIKit

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

    var body: some View {
        ZStack {
            page(.chats) {
                NavigationStack(path: Binding(get: { model.path }, set: { model.path = $0 })) {
                    ChannelList()
                        .navigationDestination(for: Route.self) { RouteScreen(route: $0) }
                }
                .underBar(.chats)
            }
            page(.needs) {
                NavigationStack {
                    NeedsScreen()
                }
                .underBar(.needs)
            }
        }
        .onChange(of: model.path) { _, _ in model.cardOpen = false }
        .onChange(of: model.tab) { _, _ in model.cardOpen = false }
        .sheet(isPresented: Binding(get: { model.showYou }, set: { model.showYou = $0 })) {
            NavigationStack {
                SettingsScreen()
            }
            .presentationDragIndicator(.visible)
        }
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
            if let text = UserDefaults.standard.string(forKey: "draft") {
                let photo = UIGraphicsImageRenderer(size: CGSize(width: 600, height: 400)).image { context in
                    UIColor.systemTeal.setFill()
                    context.fill(CGRect(x: 0, y: 0, width: 600, height: 400))
                }
                let attached = UserDefaults.standard.bool(forKey: "attach") ? [Attached(image: photo, data: photo.jpegData(compressionQuality: 0.7) ?? Data())] : []
                model.keep(Draft(text: text, attached: attached), first.code, "main")
            }
            let place = UserDefaults.standard.string(forKey: "place") ?? "main"
            switch shot {
            case "channel", "conversation": model.path = [.place(Spot(code: first.code, place: place))]
            case "needs": model.tab = .needs
            case "board", "tasks": model.path = [.tasks(first.code)]
            case "settings": model.showYou = true
            default: break
            }
        }
    #endif
}

private struct UnderBar: ViewModifier {
    let tab: AppTab
    @Environment(AppModel.self) private var model

    func body(content: Content) -> some View {
        content
            .overlay {
                if model.cardOpen {
                    Color.black.opacity(0.001)
                        .ignoresSafeArea()
                        .onTapGesture { withAnimation(Bar.spring(false)) { model.cardOpen = false } }
                        .accessibilityHidden(true)
                }
            }
            .bar(.bottom) { RootBar(on: tab) }
    }
}

extension View {
    fileprivate func underBar(_ tab: AppTab) -> some View {
        modifier(UnderBar(tab: tab))
    }
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
