import type { Color } from "@mc/protocol.ts"

// The colours a member can wear on their avatar (a person's pick; their agents wear it too).

/**
 * Bright and friendly, as Grok's characters are: a face you can find in a list at a glance. `ink` is the
 * initials on the avatar's gradient (white, dark on yellow); `text` is dark on every fill, for anything
 * set on the flat colour.
 */
export const PALETTE: Record<Color, { fill: string; ink: string; text: string }> = {
  red: { fill: "#f0605d", ink: "#ffffff", text: "#1a1a1a" },
  orange: { fill: "#ff9a3c", ink: "#ffffff", text: "#1a1a1a" },
  yellow: { fill: "#f5c542", ink: "#1a1a1a", text: "#1a1a1a" },
  green: { fill: "#3fbf74", ink: "#ffffff", text: "#1a1a1a" },
  teal: { fill: "#2fb8b0", ink: "#ffffff", text: "#1a1a1a" },
  blue: { fill: "#4a8df0", ink: "#ffffff", text: "#1a1a1a" },
  indigo: { fill: "#6f74f2", ink: "#ffffff", text: "#1a1a1a" },
  violet: { fill: "#9a63f0", ink: "#ffffff", text: "#1a1a1a" },
  pink: { fill: "#f2559a", ink: "#ffffff", text: "#1a1a1a" },
  brown: { fill: "#b08463", ink: "#ffffff", text: "#1a1a1a" },
}
