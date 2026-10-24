import LocalAuthentication
import SwiftUI

enum Loaded<Value> {
    case loading
    case failed(String)
    case ready(Value)
}

enum AgentStep: Hashable {
    case harness(ComputerView)
    case folder(ComputerView, HarnessChoice, Bool)
    case options(ComputerView, HarnessChoice, Bool, String)
}

struct NewAgentSheet: View {
    let room: RoomView
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var path: [AgentStep] = []
    @State private var computers: Loaded<[ComputerView]> = .loading

    var body: some View {
        NavigationStack(path: $path) {
            List {
                switch computers {
                case .loading:
                    Waiting(text: "Looking for your computers…")
                case .failed(let why):
                    Failed(why: why) { Task { await load() } }
                case .ready(let list) where list.isEmpty:
                    Section {
                        Text("No paired computers yet").type(.body).foregroundStyle(Tone.ink2)
                    } footer: {
                        Text("Pair one from the Mac app: Settings → Computers.")
                    }
                case .ready(let list):
                    Section {
                        ForEach(list) { c in
                            NavigationLink(value: AgentStep.harness(c)) { ComputerRow(computer: c) }
                                .disabled(!c.online)
                        }
                    } footer: {
                        Text("The agent starts on the computer you pick and joins \(room.title).")
                    }
                }
            }
            .navigationTitle("New Agent")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .navigationDestination(for: AgentStep.self) { step in
                switch step {
                case .harness(let c):
                    HarnessStep(computer: c)
                case .folder(let c, let h, let bypass):
                    FolderStep(room: room, computer: c, harness: h, bypass: bypass)
                case .options(let c, let h, let bypass, let folder):
                    OptionsStep(room: room, computer: c, harness: h, bypass: bypass, folder: folder) { dismiss() }
                }
            }
        }
        .task { await load() }
    }

    private func load() async {
        computers = .loading
        do {
            computers = .ready(try await model.computers())
        } catch {
            computers = .failed(error.localizedDescription)
        }
    }
}

private struct ComputerRow: View {
    let computer: ComputerView

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "desktopcomputer").font(.system(size: 19)).foregroundStyle(Tone.ink2).frame(width: 30)
            VStack(alignment: .leading, spacing: 1) {
                Text(computer.name).type(.body).foregroundStyle(Tone.ink)
                Text(computer.online ? "Online" : "Offline · seen \(When.short(computer.seen))").type(.meta).foregroundStyle(computer.online ? Tone.live : Tone.ink3)
            }
        }
        .padding(.vertical, 2)
    }
}

private struct HarnessStep: View {
    let computer: ComputerView
    @Environment(AppModel.self) private var model
    @State private var harnesses: Loaded<HarnessesOn> = .loading

    var body: some View {
        List {
            switch harnesses {
            case .loading:
                Waiting(text: "Asking \(computer.name)…")
            case .failed(let why):
                Failed(why: why) { Task { await load() } }
            case .ready(let got) where got.harnesses.isEmpty:
                Section {
                    Text("Nothing to start on \(computer.name)").type(.body).foregroundStyle(Tone.ink2)
                } footer: {
                    Text("Install Claude Code or Codex there, then try again.")
                }
            case .ready(let got):
                Section {
                    ForEach(got.harnesses) { h in
                        NavigationLink(value: AgentStep.folder(computer, h, got.bypass)) { HarnessRow(harness: h) }
                            .disabled(!h.start)
                    }
                } footer: {
                    Text("What's installed on \(computer.name).")
                }
            }
        }
        .navigationTitle("Harness")
        .task { await load() }
    }

    private func load() async {
        harnesses = .loading
        do {
            harnesses = .ready(try await model.harnesses(on: computer.key))
        } catch {
            harnesses = .failed(error.localizedDescription)
        }
    }
}

private struct HarnessRow: View {
    let harness: HarnessChoice

    var body: some View {
        HStack(spacing: 12) {
            Group {
                if UIImage(named: "harness-\(harness.face)") != nil {
                    Image("harness-\(harness.face)").resizable().scaledToFit()
                } else {
                    Image(systemName: "terminal").font(.system(size: 17)).foregroundStyle(Tone.ink2)
                }
            }
            .frame(width: 28, height: 28)
            VStack(alignment: .leading, spacing: 1) {
                Text(harness.name).type(.body).foregroundStyle(Tone.ink)
                if let line = harness.start ? harness.version : harness.why ?? "Kiwi can't start it yet" {
                    Text(line).type(.meta).foregroundStyle(Tone.ink3).lineLimit(2)
                }
            }
        }
        .padding(.vertical, 2)
    }
}

private struct FolderStep: View {
    let room: RoomView
    let computer: ComputerView
    let harness: HarnessChoice
    let bypass: Bool
    @Environment(AppModel.self) private var model
    @State private var folders: Loaded<[String]> = .loading

    var body: some View {
        List {
            switch folders {
            case .loading:
                Waiting(text: "Asking \(computer.name)…")
            case .failed(let why):
                Failed(why: why) { Task { await load() } }
            case .ready(let list) where list.isEmpty:
                Section {
                    Text("No folders yet").type(.body).foregroundStyle(Tone.ink2)
                } footer: {
                    Text("An agent starts where this channel's agents already work on \(computer.name). Start the first one there from the Mac app.")
                }
            case .ready(let list):
                Section {
                    ForEach(list, id: \.self) { folder in
                        NavigationLink(value: AgentStep.options(computer, harness, bypass, folder)) { FolderRow(folder: folder) }
                    }
                } footer: {
                    Text("Where this channel's agents work on \(computer.name).")
                }
            }
        }
        .navigationTitle("Folder")
        .task { await load() }
    }

    private func load() async {
        folders = .loading
        do {
            folders = .ready(try await model.folders(on: computer.key, code: room.code))
        } catch {
            folders = .failed(error.localizedDescription)
        }
    }
}

private struct FolderRow: View {
    let folder: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "folder").font(.system(size: 18)).foregroundStyle(Tone.accent).frame(width: 28)
            VStack(alignment: .leading, spacing: 1) {
                Text((folder as NSString).lastPathComponent).type(.body).foregroundStyle(Tone.ink)
                Text(folder).type(.meta).foregroundStyle(Tone.ink3).lineLimit(1).truncationMode(.head)
            }
        }
        .padding(.vertical, 2)
    }
}

private enum Starting {
    case sending
    case started(String)
    case failed(String)
}

private struct OptionsStep: View {
    let room: RoomView
    let computer: ComputerView
    let harness: HarnessChoice
    let bypass: Bool
    let folder: String
    let close: () -> Void
    @Environment(AppModel.self) private var model
    @State private var nick = ""
    @State private var modelName = ""
    @State private var effort: String?
    @State private var permission: String?
    @State private var context: Int?
    @State private var starting: Starting?

    private var options: HarnessOptions? { harness.options }
    private var efforts: [String] { options?.effort ?? [] }
    private var modes: [String] { (options?.permission ?? []).filter { $0 != "default" } }
    private var sizes: [Int] { options?.context ?? [] }
    private var hasChoices: Bool { !efforts.isEmpty || !modes.isEmpty || !sizes.isEmpty }

    var body: some View {
        Group {
            if let starting {
                StartedView(room: room, computer: computer, harness: harness, starting: starting, retry: { self.starting = nil }, close: close)
            } else {
                form
            }
        }
        .navigationBarBackButtonHidden(starting != nil)
    }

    private var form: some View {
        Form {
            Section {
                LabeledContent("Computer", value: computer.name)
                LabeledContent("Harness", value: harness.name)
                LabeledContent("Folder", value: (folder as NSString).lastPathComponent)
            }
            Section {
                TextField("Name", text: $nick, prompt: Text("Kiwi picks one"))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                if options?.model == true {
                    TextField("Model", text: $modelName, prompt: Text("\(harness.name)'s default"))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
            }
            if hasChoices {
                Section {
                    if !efforts.isEmpty {
                        Picker("Effort", selection: $effort) {
                            Text("Default").tag(String?.none)
                            ForEach(efforts, id: \.self) { Text($0.capitalized).tag(String?.some($0)) }
                        }
                    }
                    if !modes.isEmpty {
                        Picker("Permissions", selection: $permission) {
                            Text("Default").tag(String?.none)
                            ForEach(modes, id: \.self) { Text(Permissions.label($0)).tag(String?.some($0)) }
                        }
                    }
                    if !sizes.isEmpty {
                        Picker("Context", selection: $context) {
                            Text("Default").tag(Int?.none)
                            ForEach(sizes, id: \.self) { Text(Permissions.tokens($0)).tag(Int?.some($0)) }
                        }
                    }
                } footer: {
                    if permission == "bypass" {
                        Text("The agent runs commands and changes files on \(computer.name) without asking first. You'll confirm with Face ID.")
                            .foregroundStyle(Tone.decide)
                    } else if !bypass && !modes.isEmpty {
                        Text("Bypass is off on \(computer.name). Turn on Allow bypass from your other devices in its Settings → New agents to start one from here.")
                    }
                }
            }
        }
        .navigationTitle("Options")
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Start") { Task { await start() } }
                    .disabled(!nameOK)
            }
        }
    }

    private var trimmedNick: String { nick.trimmingCharacters(in: .whitespaces) }
    private var trimmedModel: String { modelName.trimmingCharacters(in: .whitespaces) }

    private var nameOK: Bool {
        trimmedNick.isEmpty || trimmedNick.range(of: #"^[\p{L}\p{N}][\p{L}\p{N} _.-]{0,39}$"#, options: .regularExpression) != nil
    }

    private var choices: [String: Any] {
        var out: [String: Any] = [:]
        if !trimmedNick.isEmpty { out["nick"] = trimmedNick }
        if !trimmedModel.isEmpty { out["model"] = trimmedModel }
        if let effort { out["effort"] = effort }
        if let permission { out["permission"] = permission }
        if let context { out["context"] = context }
        return out
    }

    private func start() async {
        if permission == "bypass" {
            guard Permissions.canConfirm else {
                starting = .failed("Bypass needs Face ID or a passcode on this iPhone. Turn one on in Settings, then try again.")
                return
            }
            guard await Permissions.confirmBypass(on: computer.name) else { return }
        }
        Haptic.tap()
        starting = .sending
        do {
            let launched = try await model.launch(room.code, on: computer.key, harness: harness.harness, folder: folder, choices: choices)
            if launched.ok, let id = launched.launch {
                starting = .started(id)
            } else {
                starting = .failed(launched.detail ?? "\(computer.name) couldn't start it.")
            }
        } catch {
            starting = .failed(error.localizedDescription)
        }
    }
}

private struct StartedView: View {
    let room: RoomView
    let computer: ComputerView
    let harness: HarnessChoice
    let starting: Starting
    let retry: () -> Void
    let close: () -> Void
    @Environment(AppModel.self) private var model

    var body: some View {
        List {
            switch starting {
            case .sending:
                Section {
                    StageRow(text: "Asking \(computer.name) to start \(harness.name)", state: .busy)
                }
            case .failed(let why):
                Section {
                    StageRow(text: "\(computer.name) didn't start it", state: .failed)
                    Text(why).type(.ui).foregroundStyle(Tone.ink2)
                }
                Section {
                    Button("Try Again", action: retry)
                }
            case .started(let id):
                let seen = model.launches[id]
                let joined = seen?.stage == "joined"
                Section {
                    StageRow(text: "\(harness.name) started on \(computer.name)", state: .done)
                    StageRow(text: seen.map { "\($0.name) asked to join" } ?? "Waiting for it to ask to join", state: seen == nil ? .busy : .done)
                    StageRow(text: joined ? "\(seen?.name ?? "It") is in \(room.title)" : "Letting it in", state: joined ? .done : seen == nil ? .waiting : .busy)
                } footer: {
                    Text(joined ? "It's working in a terminal on \(computer.name)." : "This takes a few seconds while it starts on \(computer.name).")
                }
            }
        }
        .navigationTitle("New Agent")
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Done", action: close)
            }
        }
    }
}

private enum StageState {
    case waiting, busy, done, failed
}

private struct StageRow: View {
    let text: String
    let state: StageState

    var body: some View {
        HStack(spacing: 12) {
            Group {
                switch state {
                case .waiting: Image(systemName: "circle").foregroundStyle(Tone.ink3)
                case .busy: ProgressView().controlSize(.small)
                case .done: Image(systemName: "checkmark.circle.fill").foregroundStyle(Tone.live)
                case .failed: Image(systemName: "exclamationmark.circle.fill").foregroundStyle(Tone.alert)
                }
            }
            .font(.system(size: 18))
            .frame(width: 24)
            Text(text).type(.body).foregroundStyle(state == .waiting ? Tone.ink3 : Tone.ink)
        }
        .padding(.vertical, 2)
    }
}

private struct Waiting: View {
    let text: String

    var body: some View {
        Section {
            HStack(spacing: 10) {
                ProgressView().controlSize(.small)
                Text(text).type(.body).foregroundStyle(Tone.ink2)
            }
        }
    }
}

private struct Failed: View {
    let why: String
    let retry: () -> Void

    var body: some View {
        Section {
            Text(why).type(.body).foregroundStyle(Tone.ink2)
            Button("Try Again", action: retry)
        }
    }
}

enum Permissions {
    static func label(_ mode: String) -> String {
        switch mode {
        case "accept-edits": "Accept Edits"
        case "plan": "Plan Only"
        case "bypass": "Bypass"
        default: mode
        }
    }

    static func tokens(_ n: Int) -> String {
        n % 1_000_000 == 0 ? "\(n / 1_000_000)M tokens" : n % 1_000 == 0 ? "\(n / 1_000)K tokens" : "\(n) tokens"
    }

    static var canConfirm: Bool {
        LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: nil)
    }

    @MainActor static func confirmBypass(on computer: String) async -> Bool {
        let context = LAContext()
        return (try? await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Start an agent on \(computer) that doesn't ask before it acts")) ?? false
    }
}
