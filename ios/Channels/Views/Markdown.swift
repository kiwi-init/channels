import EnrichedMarkdown
import SwiftUI

struct Markdown: View {
    let text: String
    var ink: Color = Tone.ink
    var link: Color = Tone.accent
    var code: Color = Tone.wash2
    var underline = false
    var selectable = true

    static let options = MarkdownParsingOptions(hardSoftBreaks: true, permissiveAutolinks: true)

    var body: some View {
        if Self.native(text) {
            EnrichedMarkdownText(text, options: Self.options)
                .markdownTheme(theme)
                .markdownCodeBlockLayout(.scrollable)
                .onCodeBlockCopy { _ in Haptic.tap() }
                .environment(\.markdownSelectable, selectable)
        } else {
            Prose(text: text, ink: ink, link: link, code: code, underline: underline)
        }
    }

    static func native(_ text: String) -> Bool {
        !Parser.shared.parseMarkdown(text, options: options).children.isEmpty
    }

    private var theme: MarkdownTheme {
        MarkdownTheme {
            Paragraph().font(.body).foregroundStyle(ink).lineHeight(0).marginBottom(6)
            Heading(1).font(.title3).bold().foregroundStyle(ink).lineHeight(0).marginBottom(6)
            Heading(2).font(.headline).foregroundStyle(ink).lineHeight(0).marginBottom(6)
            Heading(3).font(.body).bold().foregroundStyle(ink).lineHeight(0).marginBottom(6)
            Heading(4).font(.body).bold().foregroundStyle(ink).lineHeight(0).marginBottom(6)
            Heading(5).font(.subheadline).bold().foregroundStyle(ink).lineHeight(0).marginBottom(6)
            Heading(6).font(.subheadline).foregroundStyle(ink).lineHeight(0).marginBottom(6)
            EnrichedMarkdown.Link().foregroundStyle(link).underline(underline)
            Code().fontDesign(.monospaced).foregroundStyle(ink).background(code)
            CodeBlock().font(.system(.caption, design: .monospaced)).foregroundStyle(ink).background(code).cornerRadius(10).padding(8).marginBottom(6)
            Blockquote().font(.body).foregroundStyle(ink).background(.clear).border(ink.opacity(0.35), width: 3).gapWidth(10).lineHeight(0).marginBottom(6)
            EnrichedMarkdown.List().font(.body).foregroundStyle(ink).bulletColor(ink).markerColor(ink).gapWidth(8).marginLeading(18).lineHeight(0).marginBottom(6)
            TaskList().checkedColor(link).borderColor(ink).checkmarkColor(underline ? Tone.bubbleMine : .white)
            EnrichedMarkdown.Table().font(.callout).headerFont(.callout.weight(.semibold))
                .foregroundStyle(ink).headerForegroundStyle(ink).headerBackground(code).rowOddBackground(.clear).border(ink.opacity(0.2), width: 0.5)
                .cornerRadius(8).cellPadding(horizontal: 8, vertical: 5).lineHeight(0).marginBottom(6)
            ThematicBreak().foregroundStyle(ink.opacity(0.25)).height(0.5).marginTop(6).marginBottom(6)
        }
    }
}
