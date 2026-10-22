import SwiftUI
import UIKit
import VisionKit

struct LinkView: View {
    @Environment(AppModel.self) private var model
    @State private var scanning = false
    @State private var pasteError: String?

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
        .sheet(isPresented: $scanning) {
            Scanner { code in
                scanning = false
                Task { await model.link(code) }
            }
            .ignoresSafeArea()
            .presentationDragIndicator(.visible)
        }
    }

    @ViewBuilder private var content: some View {
        switch model.linking {
        case .idle, .failed:
            VStack(alignment: .leading, spacing: 0) {
                Text("Link this iPhone").type(.title, .semibold).foregroundStyle(Tone.ink)
                VStack(alignment: .leading, spacing: 10) {
                    step(1, "Open Channels on your Mac.")
                    step(2, "Settings → Phone → Link a phone.")
                    step(3, "Scan the code it shows.")
                }
                .padding(.top, 12)
                if case .failed(let why) = model.linking {
                    Text(why).type(.ui).foregroundStyle(Tone.alert).padding(.top, 16)
                }
                if let pasteError {
                    Text(pasteError).type(.ui).foregroundStyle(Tone.alert).padding(.top, 16)
                }
                VStack(spacing: 10) {
                    PrimaryButton(title: "Scan the code") {
                        pasteError = nil
                        scanning = true
                    }
                    QuietButton(title: "Paste the code") { paste() }
                }
                .padding(.top, 24)
            }
        case .asking:
            HStack(spacing: 10) {
                ProgressView()
                Text("Asking your Mac…").type(.body).foregroundStyle(Tone.ink2)
            }
        case .digits(let digits):
            VStack(alignment: .leading, spacing: 0) {
                Text("Check the code").type(.title, .semibold).foregroundStyle(Tone.ink)
                Text("Your Mac shows six digits too. When they match, press It matches on the Mac.")
                    .type(.ui)
                    .foregroundStyle(Tone.ink2)
                    .padding(.top, 6)
                Text(spaced(digits))
                    .font(.custom("Inter", size: 44).weight(.semibold))
                    .monospacedDigit()
                    .tracking(2)
                    .foregroundStyle(Tone.ink)
                    .padding(.vertical, 24)
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text("Waiting for your Mac").type(.ui).foregroundStyle(Tone.ink3)
                }
                QuietButton(title: "Cancel") { Task { await model.cancelLink() } }
                    .padding(.top, 24)
            }
        }
    }

    private func step(_ n: Int, _ text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text("\(n)").type(.ui, .semibold).foregroundStyle(Tone.ink3).frame(width: 14, alignment: .leading)
            Text(text).type(.body).foregroundStyle(Tone.ink)
        }
    }

    private func spaced(_ digits: String) -> String {
        digits.count == 6 ? "\(digits.prefix(3)) \(digits.suffix(3))" : digits
    }

    private func paste() {
        let text = UIPasteboard.general.string?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard text.hasPrefix("kl1-") else {
            pasteError = "The clipboard doesn't hold a link code. Copy it from Link a phone on your Mac."
            return
        }
        pasteError = nil
        Task { await model.link(text) }
    }
}

struct Scanner: UIViewControllerRepresentable {
    let found: (String) -> Void

    func makeUIViewController(context: Context) -> UIViewController {
        guard DataScannerViewController.isSupported else {
            let host = UIHostingController(rootView: Centered(title: "No camera", detail: "This iPhone can't scan codes. Paste the code instead."))
            return host
        }
        let scanner = DataScannerViewController(
            recognizedDataTypes: [.barcode(symbologies: [.qr])],
            qualityLevel: .balanced,
            recognizesMultipleItems: false,
            isHighFrameRateTrackingEnabled: false,
            isHighlightingEnabled: true)
        scanner.delegate = context.coordinator
        try? scanner.startScanning()
        return scanner
    }

    func updateUIViewController(_ controller: UIViewController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(found) }

    @MainActor
    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        private let found: (String) -> Void
        private var done = false

        init(_ found: @escaping (String) -> Void) {
            self.found = found
        }

        func dataScanner(_ scanner: DataScannerViewController, didAdd items: [RecognizedItem], allItems: [RecognizedItem]) {
            for item in items {
                guard !done, case .barcode(let code) = item, let text = code.payloadStringValue else { continue }
                let link = text.hasPrefix("kiwi://link/") ? String(text.dropFirst("kiwi://link/".count)) : text
                guard link.hasPrefix("kl1-") else { continue }
                done = true
                scanner.stopScanning()
                found(link)
            }
        }
    }
}
