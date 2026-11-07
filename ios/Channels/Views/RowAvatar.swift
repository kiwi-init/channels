import SwiftUI

struct RowAvatar: View {
    let row: Row
    var size: CGFloat = 52

    var body: some View {
        Group {
            switch row.kind {
            case .group:
                ChannelAvatar(room: row.room, size: size)
                    .overlay(alignment: .topTrailing) {
                        if row.working {
                            Circle().fill(Tone.doing).frame(width: size * 0.26, height: size * 0.26).overlay(Circle().stroke(Tone.canvas, lineWidth: 2))
                        }
                    }
            case .lead:
                Face(name: row.lead ?? row.title, member: row.lead.flatMap { row.room.member($0) }, size: size)
            }
        }
        .overlay(alignment: .bottomTrailing) {
            if row.kind != .group && row.qualifier != nil && size >= 44 {
                ChannelAvatar(room: row.room, size: size * 0.4).overlay(Circle().stroke(Tone.canvas, lineWidth: 2)).offset(x: 3, y: 3)
            }
        }
        .frame(width: size, height: size)
    }
}
