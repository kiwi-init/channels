# EnrichedMarkdown (vendored)

Software Mansion's [enriched-markdown-ios](https://github.com/software-mansion-labs/enriched-markdown-ios)
at tag `0.4.0` (commit `52ae77e`), MIT (`LICENSE`). md4c is MIT too; its notice is at the top of
`core/md4c/md4c.c`. The iPhone app draws message markdown with it (`ios/Channels/Views/Markdown.swift`).

## What's here

Only the core product: `core/` (md4c, the parser), `cpp/` (the C++ shim) and
`Sources/EnrichedMarkdown/`. `Package.swift` declares just those three targets.

Left out: LaTeX and syntax highlighting. Upstream's manifest declares RaTeX as a binary target,
so resolving it downloads a 47 MB xcframework from a third-party URL even when only the core is
used. Without those targets, nothing is fetched at build time.

## Changes from upstream

- **The first render is synchronous** (`MarkdownRenderStore.shown`, used by
  `EnrichedMarkdownText.body`). Upstream renders on a background queue, so a view first lays out
  empty and then jumps to its height. In the conversation's lazy stack, every bubble that scrolled
  in would jump. Later changes (theme, Dynamic Type, a new string) still render in the background.
- **The view hugs its text** (`MarkdownTextView.usedWidth`, used by the representable's
  `sizeThatFits`). Upstream always takes the whole proposed width, which would stretch every
  bubble to the edge. Text with attachments (tables, code panels, rules, images) still takes the
  full width.

## Updating

Copy the same three folders from the new tag, keep this `Package.swift`, and apply the two
changes again: `git log -p -- ios/Vendor/EnrichedMarkdown` shows them.
