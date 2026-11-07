import SwiftUI

struct NeedsScreen: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        List {
            ForEach(model.homeNeeds) { need in
                HomeNeedCard(need: need) { _ in }
                    .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Tone.canvas)
        .overlay {
            if model.homeNeeds.isEmpty {
                ContentUnavailableView("Nothing Needs You", systemImage: "checkmark.circle")
            }
        }
        .navigationTitle("Needs You")
    }
}
