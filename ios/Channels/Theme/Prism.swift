import SwiftUI

enum Spectrum {
    static let colors: [Color] = [0xff3b5c, 0xffb02e, 0xf5ff5a, 0x5dff8f, 0x39d4ff, 0x3d5bff, 0xb04dff].map { Color(hex: $0) }
    static let fill = Color(Shade(0x0f0f11, 0.045), Shade(0xffffff, 0.09))
    static let edge = Color(Shade(0x0f0f11, 0.1), Shade(0xffffff, 0.08))
    static let glint = Color(Shade(0x0f0f11, 0.72), Shade(0xffffff))

    static func line(_ degrees: Double) -> (UnitPoint, UnitPoint) {
        let r = degrees * .pi / 180
        let dx = sin(r) / 2
        let dy = -cos(r) / 2
        return (UnitPoint(x: 0.5 - dx, y: 0.5 - dy), UnitPoint(x: 0.5 + dx, y: 0.5 + dy))
    }

    static func band(at center: CGFloat) -> [Gradient.Stop] {
        let c = min(0.9, max(0.1, center))
        var stops: [Gradient.Stop] = [
            .init(color: .clear, location: c - 0.08),
            .init(color: glint.opacity(0.4), location: c - 0.065),
            .init(color: .clear, location: c - 0.05),
        ]
        for (i, color) in colors.enumerated() {
            stops.append(.init(color: color, location: c - 0.035 + CGFloat(i) * 0.015))
        }
        stops.append(.init(color: .clear, location: c + 0.08))
        return stops
    }

    static var glintStops: [Gradient.Stop] {
        [
            .init(color: glint, location: 0),
            .init(color: glint.opacity(0.3), location: 0.26),
            .init(color: glint.opacity(0.12), location: 0.62),
            .init(color: glint.opacity(0.6), location: 1),
        ]
    }
}

struct Prism<S: InsettableShape>: ViewModifier {
    let shape: S
    var band: CGFloat = 0.7
    @Environment(\.colorSchemeContrast) private var contrast

    func body(content: Content) -> some View {
        if contrast == .increased {
            content.overlay(shape.strokeBorder(Tone.ink, lineWidth: 2))
        } else {
            let glint = Spectrum.line(140)
            let sweep = Spectrum.line(112)
            content
                .background {
                    ZStack {
                        shape.fill(Spectrum.fill)
                        shape.fill(LinearGradient(stops: Spectrum.band(at: band), startPoint: sweep.0, endPoint: sweep.1)).opacity(0.3)
                    }
                    .allowsHitTesting(false)
                }
                .overlay {
                    ZStack {
                        shape.strokeBorder(Spectrum.edge, lineWidth: 1)
                        shape.strokeBorder(LinearGradient(stops: Spectrum.glintStops, startPoint: glint.0, endPoint: glint.1), lineWidth: 1)
                    }
                    .allowsHitTesting(false)
                }
        }
    }
}

extension View {
    func prism<S: InsettableShape>(_ shape: S, band: CGFloat = 0.7) -> some View {
        modifier(Prism(shape: shape, band: band))
    }
}
