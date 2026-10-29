import SwiftUI
import UIKit

struct LinkView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer(minLength: 40)
            Image("Mark")
                .resizable()
                .scaledToFill()
                .frame(width: 64, height: 64)
                .clipShape(RoundedRectangle(cornerRadius: 15, style: .continuous))
                .padding(.bottom, 28)
            Text("Channels").type(.display, .semibold).foregroundStyle(Tone.ink)
            Text("Your agents, on your phone.")
                .type(.body)
                .foregroundStyle(Tone.ink2)
                .padding(.top, 4)
            Spacer(minLength: 32)
            content
            Spacer(minLength: 24)
        }
        .padding(.horizontal, 24)
        .padding(.bottom, 16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .background(Tone.canvas)
    }

    @ViewBuilder private var content: some View {
        switch model.linking {
        case .idle, .failed:
            VStack(alignment: .leading, spacing: 0) {
                Text("Sign in").type(.title, .semibold).foregroundStyle(Tone.ink)
                Text("With the account Channels on your computer uses, then approve this iPhone there.")
                    .type(.ui)
                    .foregroundStyle(Tone.ink2)
                    .padding(.top, 6)
                problems
                PrimaryButton(title: "Sign In") { Task { await model.signIn() } }
                    .padding(.top, 20)
            }
        case .opening:
            VStack(alignment: .leading, spacing: 0) {
                waiting("Opening the sign-in…")
                QuietButton(title: "Cancel") { Task { await model.cancelLink() } }
                    .padding(.top, 24)
            }
        case .signingIn(let url, let code):
            VStack(alignment: .leading, spacing: 0) {
                if let url {
                    Text("Sign in in Safari").type(.title, .semibold).foregroundStyle(Tone.ink)
                    Text(code.isEmpty ? "Use the account Channels on your computer uses." : "Use the account Channels on your computer uses, and check Safari shows \(code).")
                        .type(.ui)
                        .foregroundStyle(Tone.ink2)
                        .padding(.top, 6)
                    QuietButton(title: "Open the sign-in") {
                        if let page = URL(string: url) { UIApplication.shared.open(page) }
                    }
                    .padding(.top, 20)
                    waiting("Finish signing in in Safari").padding(.top, 24)
                } else {
                    waiting("Signing in…")
                }
                QuietButton(title: "Cancel") { Task { await model.cancelLink() } }
                    .padding(.top, 24)
            }
        case .asking:
            VStack(alignment: .leading, spacing: 0) {
                Text("Approve this iPhone").type(.title, .semibold).foregroundStyle(Tone.ink)
                Text("Open Channels on your computer and let this iPhone in. It then shows digits to type there.")
                    .type(.ui)
                    .foregroundStyle(Tone.ink2)
                    .padding(.top, 6)
                waiting("Waiting for your computer").padding(.top, 24)
                QuietButton(title: "Cancel") { Task { await model.cancelLink() } }
                    .padding(.top, 24)
            }
        case .approve(let digits):
            VStack(alignment: .leading, spacing: 0) {
                Text("Approve this iPhone").type(.title, .semibold).foregroundStyle(Tone.ink)
                Text("Channels on your computer asks for these digits. Type them there.")
                    .type(.ui)
                    .foregroundStyle(Tone.ink2)
                    .padding(.top, 6)
                Text(spaced(digits))
                    .font(.custom("Inter", size: 44).weight(.semibold))
                    .monospacedDigit()
                    .tracking(2)
                    .foregroundStyle(Tone.ink)
                    .padding(.vertical, 24)
                waiting("Waiting for your computer")
                QuietButton(title: "Cancel") { Task { await model.cancelLink() } }
                    .padding(.top, 24)
            }
        }
    }

    @ViewBuilder private var problems: some View {
        if case .failed(let why) = model.linking {
            Text(why).type(.ui).foregroundStyle(Tone.alert).padding(.top, 16)
        }
    }

    private func waiting(_ text: String) -> some View {
        HStack(spacing: 8) {
            ProgressView().controlSize(.small)
            Text(text).type(.ui).foregroundStyle(Tone.ink3)
        }
    }

    private func spaced(_ digits: String) -> String {
        digits.count == 6 ? "\(digits.prefix(3)) \(digits.suffix(3))" : digits
    }
}
