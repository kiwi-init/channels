// Inter, everywhere: the same letters on a Mac, Windows and Linux. The
// variable face (opsz) stands in the system stack only until it loads.
// There is no font switcher: hierarchy comes from weight, size and spacing.

export type FontKind = "inter"

export const DEFAULT_FONT: FontKind = "inter"

/** The stack `index.css` sets as `--font-sans`, for callers that need it. */
export const FONT_STACK = `"Inter Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`

export function resolveFontStack(): string {
  return FONT_STACK
}
