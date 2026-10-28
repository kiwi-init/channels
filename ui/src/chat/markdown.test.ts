import { describe, expect, mock, test } from "bun:test"
import type { CSSProperties } from "react"

import * as shim from "~/chat/react-native"

void mock.module("react-native", () => shim)
Object.assign(globalThis, { __DEV__: false })

const { normalizeMarkdownStyle } = await import("react-native-enriched-markdown/lib/module/normalizeMarkdownStyle.web.js")
const { buildStyles } = await import("react-native-enriched-markdown/lib/module/web/styles.js")
const { withTextSize } = await import("~/chat/markdown")

const fixed = (name: string, s: CSSProperties): string[] => [
  ...(typeof s.fontSize === "number" ? [`${name} fontSize ${s.fontSize}`] : []),
  ...(typeof s.lineHeight === "string" && s.lineHeight.endsWith("px") ? [`${name} lineHeight ${s.lineHeight}`] : []),
]

describe("message text follows Settings > Appearance > Text size", () => {
  test("every markdown style that sets a size scales with --text-scale", () => {
    const styles = withTextSize(buildStyles(normalizeMarkdownStyle({ paragraph: { fontSize: 15, lineHeight: 22 } })))
    const left = Object.entries(styles).flatMap(([name, s]) => ("left" in s ? Object.entries(s).flatMap(([align, cell]) => fixed(`${name}.${align}`, cell)) : fixed(name, s)))
    expect(left).toEqual([])
    expect(styles.paragraph).toMatchObject({ fontSize: "calc(15px * var(--text-scale, 1))", lineHeight: "calc(22px * var(--text-scale, 1))" })
  })
})
