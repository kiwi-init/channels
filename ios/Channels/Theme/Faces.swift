import CoreGraphics

struct FaceEyes {
    let x: CGFloat
    let y: CGFloat
    let spacing: CGFloat
    let scale: CGFloat
}

enum Faces {
    static let eyes: [String: FaceEyes] = [
        "lead": FaceEyes(x: 50, y: 43, spacing: 17, scale: 1.1),
        "builder": FaceEyes(x: 50, y: 42, spacing: 16, scale: 1.15),
        "reviewer": FaceEyes(x: 50, y: 42, spacing: 17, scale: 1.15),
        "bug-hunter": FaceEyes(x: 50, y: 56, spacing: 17, scale: 1.15),
        "explorer": FaceEyes(x: 41, y: 40, spacing: 17, scale: 1.15),
        "releaser": FaceEyes(x: 50, y: 46, spacing: 15, scale: 1.05),
        "default": FaceEyes(x: 50, y: 42, spacing: 18, scale: 1.25),
    ]
    static let fallback = FaceEyes(x: 50, y: 42, spacing: 18, scale: 1.25)
}
