export interface Colors {
  canvas: string
  rail: string
  raised: string
  field: string
  ink: string
  ink2: string
  ink3: string
  line: string
  wash: string
  wash2: string
  accent: string
  accentInk: string
  accentText: string
  accentWash: string
  link: string
  ring: string
  alert: string
  alertFill: string
  decide: string
  decideWash: string
  live: string
  doing: string
  warn: string
  overlay: string
  bubbleMe: string
  bubbleMeInk: string
  bubbleThem: string
  bubbleThemInk: string
  edgeStrong: string
  pick: string
}

export const light: Colors = {
  canvas: "#ffffff",
  rail: "#ffffff",
  raised: "#ffffff",
  field: "#f0f0f3",
  ink: "#0f0f11",
  ink2: "#4a4a52",
  ink3: "#6b6b73",
  line: "rgba(15, 15, 17, 0.08)",
  wash: "rgba(15, 15, 17, 0.045)",
  wash2: "rgba(15, 15, 17, 0.075)",
  accent: "#007aff",
  accentInk: "#ffffff",
  accentText: "#007aff",
  accentWash: "rgba(0, 122, 255, 0.1)",
  link: "#007aff",
  ring: "rgba(0, 122, 255, 0.55)",
  alert: "#d1342a",
  alertFill: "#d1342a",
  decide: "#a35a00",
  decideWash: "rgba(214, 125, 0, 0.12)",
  live: "#1f9a55",
  doing: "#2f6fe4",
  warn: "#a35a00",
  overlay: "rgba(20, 20, 22, 0.32)",
  bubbleMe: "#007aff",
  bubbleMeInk: "#ffffff",
  bubbleThem: "#e9e9eb",
  bubbleThemInk: "#0f0f11",
  edgeStrong: "rgba(15, 15, 17, 0.14)",
  pick: "rgba(15, 15, 17, 0.07)",
}

export const dark: Colors = {
  canvas: "#0d0d0e",
  rail: "#0d0d0e",
  raised: "#1c1c1e",
  field: "#1a1a1c",
  ink: "#f3f3f5",
  ink2: "#bcbcc3",
  ink3: "#8f8f97",
  line: "rgba(255, 255, 255, 0.08)",
  wash: "rgba(255, 255, 255, 0.055)",
  wash2: "rgba(255, 255, 255, 0.09)",
  accent: "#0a84ff",
  accentInk: "#ffffff",
  accentText: "#0a84ff",
  accentWash: "rgba(10, 132, 255, 0.18)",
  link: "#0a84ff",
  ring: "rgba(10, 132, 255, 0.6)",
  alert: "#ff6259",
  alertFill: "#d1342a",
  decide: "#f5b041",
  decideWash: "rgba(245, 176, 65, 0.14)",
  live: "#32d074",
  doing: "#5b9bff",
  warn: "#f5b041",
  overlay: "rgba(0, 0, 0, 0.62)",
  bubbleMe: "#0a84ff",
  bubbleMeInk: "#ffffff",
  bubbleThem: "#1f1f21",
  bubbleThemInk: "#f3f3f5",
  edgeStrong: "rgba(255, 255, 255, 0.14)",
  pick: "rgba(255, 255, 255, 0.08)",
}

export const type = {
  stamp: { fontSize: 11, lineHeight: 14 },
  meta: { fontSize: 12, lineHeight: 16 },
  ui: { fontSize: 13, lineHeight: 18 },
  body: { fontSize: 15, lineHeight: 21 },
  title: { fontSize: 16, lineHeight: 21 },
  display: { fontSize: 26, lineHeight: 32 },
} as const

export const radius = {
  row: 8,
  ctl: 10,
  card: 16,
  bubble: 20,
  dock: 26,
} as const

export const shadowPop = {
  light: { edge: "rgba(15, 15, 17, 0.08)", shade: "rgba(15, 15, 17, 0.16)" },
  dark: { edge: "rgba(255, 255, 255, 0.09)", shade: "rgba(0, 0, 0, 0.65)" },
} as const

export const mono = "Menlo"

export type Scheme = "light" | "dark"
