export type FontKind = "system"

export const DEFAULT_FONT: FontKind = "system"

/** The stack `index.css` sets as `--font-sans`, for callers that need it. */
export const FONT_STACK = `-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`

export function resolveFontStack(): string {
  return FONT_STACK
}
