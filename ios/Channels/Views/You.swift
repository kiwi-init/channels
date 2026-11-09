import LocalAuthentication
import SwiftUI

struct SettingsScreen: View {
    @Environment(AppModel.self) private var model
    @State private var confirm = false
    @State private var guarded = SettingsScreen.lockWords()
    @AppStorage(Lock.offKey) private var lockOff = false

    private var relayHost: String {
        URL(string: model.relay)?.host() ?? model.relay
    }

    private var version: String {
        let info = Bundle.main.infoDictionary
        return "\(info?["CFBundleShortVersionString"] as? String ?? "") (\(info?["CFBundleVersion"] as? String ?? ""))"
    }

    private static func lockWords() -> String? {
        let context = LAContext()
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: nil) else { return nil }
        switch context.biometryType {
        case .faceID: return String(localized: "Face ID")
        case .touchID: return String(localized: "Touch ID")
        case .opticID: return String(localized: "Optic ID")
        default: return String(localized: "Passcode")
        }
    }

    var body: some View {
        List {
            Section {
                VStack(spacing: 4) {
                    Face(name: model.person, member: nil, size: 80).padding(.bottom, 8)
                    Text(model.person).font(.title2.weight(.bold)).foregroundStyle(Tone.ink)
                    Text(model.enrolled ? "One of your devices" : "Linked to your Mac").type(.ui).foregroundStyle(Tone.ink3)
                }
                .frame(maxWidth: .infinity)
                .accessibilityElement(children: .combine)
            }
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: 8, leading: 0, bottom: 6, trailing: 0))
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
                if let guarded {
                    Toggle(isOn: Binding(get: { !lockOff }, set: { lockOff = !$0 })) {
                        Setting(symbol: "lock.fill", tint: Tone.ink3, title: "Lock with \(guarded)")
                    }
                } else {
                    LabeledContent {
                        Text("Off, no passcode")
                    } label: {
                        Setting(symbol: "lock.fill", tint: Tone.ink3, title: "Lock")
                    }
                }
            }
            .listRowBackground(Tone.raised)
            AppearanceSection()
            if !model.enrolled {
                Section {
                    Button {
                        model.relinkAsked = true
                    } label: {
                        Setting(symbol: "link", tint: Tone.accent, title: "Link Again")
                    }
                    .tint(Tone.ink)
                } footer: {
                    Text("Brings the channels you joined on your Mac since you linked.")
                }
                .listRowBackground(Tone.raised)
            }
            if model.demo {
                Section {
                    Button {
                        model.endDemo()
                    } label: {
                        Text("Sign In").frame(maxWidth: .infinity)
                    }
                } footer: {
                    Text("You're looking at a sample channel. Sign in to see yours.")
                }
                .listRowBackground(Tone.raised)
            } else {
                Section {
                    Button(role: .destructive) {
                        confirm = true
                    } label: {
                        Text(model.enrolled ? "Sign Out of This iPhone" : "Unlink This iPhone").frame(maxWidth: .infinity)
                    }
                } footer: {
                    Text(
                        model.enrolled
                            ? "This iPhone holds its own device key and its channels' keys in its keychain. Signing out deletes them from this phone; forget it in Settings → Devices on your computer too."
                            : "This iPhone holds your person key and your channels' keys in its keychain. Unlinking deletes them from this phone.")
                }
                .listRowBackground(Tone.raised)
            }
            Section {
            } footer: {
                Text("Channels \(version)").frame(maxWidth: .infinity)
            }
        }
        .grouped()
        .navigationTitle("You")
        .confirmationDialog(model.enrolled ? "Sign out of this iPhone?" : "Unlink this iPhone?", isPresented: $confirm, titleVisibility: .visible) {
            Button(model.enrolled ? "Sign Out" : "Unlink", role: .destructive) {
                model.unlink()
            }
        } message: {
            Text(model.enrolled ? "Its keys are deleted. Sign in again to come back." : "Its keys are deleted. Link again from your Mac to come back.")
        }
    }
}

struct Setting: View {
    let symbol: String
    let tint: Color
    let title: LocalizedStringKey

    var body: some View {
        Label {
            Text(title).type(.body).foregroundStyle(Tone.ink)
        } icon: {
            Image(systemName: symbol)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 30, height: 30)
                .background(tint, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
        }
    }
}
