import SwiftUI

struct MorphPanel<Face: View, Content: View>: View {
    let from: CGRect
    var rising = false
    let closed: () -> Void
    @ViewBuilder let face: () -> Face
    @ViewBuilder let content: (@escaping () -> Void) -> Content
    @State private var open = false
    @State private var pull: CGFloat = 0

    var body: some View {
        GeometryReader { geo in
            let box = geo.frame(in: .global)
            let fallback = CGRect(x: geo.size.width / 2 - 22, y: rising ? geo.size.height - 50 : 2, width: 44, height: 44)
            let start = from == .zero ? fallback : from.offsetBy(dx: -box.minX, dy: -box.minY)
            let top = rising ? 8 : start.minY
            let end = CGRect(x: 8, y: top, width: geo.size.width - 16, height: max(240, geo.size.height - 4 - top))
            let rect = open ? end.offsetBy(dx: 0, dy: pull * 0.4) : start
            let radius = open ? 44 : min(start.width, start.height) / 2
            ZStack(alignment: .topLeading) {
                Rectangle()
                    .fill(.black.opacity(open ? 0.4 : 0))
                    .background(.ultraThinMaterial.opacity(open ? 1 : 0))
                    .ignoresSafeArea()
                    .contentShape(Rectangle())
                    .onTapGesture(perform: collapse)
                ZStack(alignment: rising ? .bottom : .top) {
                    VStack(spacing: 0) {
                        if rising { grabber }
                        content(collapse)
                        if !rising { grabber }
                    }
                    .frame(width: end.width, height: end.height)
                    .opacity(open ? 1 : 0)
                    face()
                        .frame(width: start.width, height: start.height)
                        .opacity(open ? 0 : 1)
                }
                .frame(width: rect.width, height: rect.height, alignment: rising ? .bottom : .top)
                .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
                .glass(radius)
                .offset(x: rect.minX, y: rect.minY)
            }
        }
        .onAppear {
            Haptic.tap()
            withAnimation(Motion.morph) { open = true }
        }
        .accessibilityAction(.escape, collapse)
    }

    private var grabber: some View {
        Capsule()
            .fill(Tone.ink3.opacity(0.6))
            .frame(width: 40, height: 5)
            .frame(maxWidth: .infinity, minHeight: 28)
            .contentShape(Rectangle())
            .gesture(
                DragGesture()
                    .onChanged { drag in
                        pull = rising ? max(0, drag.translation.height) : min(0, drag.translation.height)
                    }
                    .onEnded { drag in
                        let far =
                            rising
                            ? drag.translation.height > 50 || drag.predictedEndTranslation.height > 140
                            : drag.translation.height < -50 || drag.predictedEndTranslation.height < -140
                        if far {
                            collapse()
                        } else {
                            withAnimation(.spring(duration: 0.3, bounce: 0.3)) { pull = 0 }
                        }
                    }
            )
            .accessibilityHidden(true)
    }

    private func collapse() {
        withAnimation(Motion.morph) {
            open = false
            pull = 0
        } completion: {
            closed()
        }
    }
}
