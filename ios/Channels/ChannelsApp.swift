import SwiftUI

@main
struct ChannelsApp: App {
    @UIApplicationDelegateAdaptor(PushDelegate.self) private var push
    @State private var model = AppModel()
    @State private var lock = Lock()
    @State private var cover = LockCover()
    @Environment(\.scenePhase) private var scene

    init() {
        _ = ThemeStore.shared
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .onChange(of: lock.locked && model.phase == .ready, initial: true) { _, shut in
                    if shut {
                        cover.show { Task { await lock.unlock() } }
                    } else {
                        cover.hide()
                    }
                }
                .task { await model.boot() }
                .task {
                    while !Task.isCancelled {
                        try? await Task.sleep(for: .seconds(45))
                        await model.marksTick()
                    }
                }
                .onChange(of: scene) { _, now in
                    switch now {
                    case .active:
                        Task { await model.awake() }
                        Task { await lock.back() }
                        model.cameToFront()
                    case .background:
                        lock.left()
                        model.wentToBack()
                    default:
                        break
                    }
                }
        }
    }
}

struct RootView: View {
    @Environment(AppModel.self) private var model
    private var theme: ThemeStore { ThemeStore.shared }

    private var relinking: Binding<Bool> {
        Binding(
            get: { model.relinking },
            set: { shown in if !shown { Task { await model.cancelLink() } } })
    }

    var body: some View {
        Group {
            switch model.phase {
            case .starting:
                Starting()
            case .unlinked:
                LinkView()
            case .ready:
                Shell()
                    .sheet(isPresented: relinking) {
                        LinkView().presentationDragIndicator(.visible)
                    }
            case .broken(let why):
                Centered(title: "Channels can't start", detail: why)
            }
        }
        .id(theme.key)
        .preferredColorScheme(theme.appearance.scheme)
        .background(alignment: .topLeading) {
            EngineHost(engine: model.engine)
                .frame(width: 1, height: 1)
                .opacity(0.01)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
        .background(Tone.canvas)
        .tint(Tone.accent)
    }
}

struct Starting: View {
    @State private var slow = false

    var body: some View {
        ZStack {
            Tone.canvas.ignoresSafeArea()
            if slow {
                VStack(spacing: 14) {
                    Image("Mark").resizable().scaledToFit().frame(width: 56, height: 56)
                    ProgressView()
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Starting Channels")
            }
        }
        .task {
            try? await Task.sleep(for: .milliseconds(600))
            slow = true
        }
    }
}

struct Locked: View {
    let unlock: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "lock.fill").font(.system(size: 30)).foregroundStyle(Tone.ink3)
            Text("Channels is locked").type(.title).foregroundStyle(Tone.ink)
            Button("Unlock", action: unlock).type(.body, .semibold)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Tone.canvas)
    }
}

struct Centered: View {
    let title: String
    let detail: String

    var body: some View {
        VStack(spacing: 6) {
            Text(title).type(.title, .semibold).foregroundStyle(Tone.ink)
            Text(detail).type(.ui).foregroundStyle(Tone.ink2).multilineTextAlignment(.center)
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Tone.canvas)
    }
}
