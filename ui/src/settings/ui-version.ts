export function uiVersionOf(stamped: unknown): string {
  return typeof stamped === "string" && stamped.trim() ? stamped.trim() : "built in"
}

export const UI_VERSION = uiVersionOf(import.meta.env.VITE_KIWI_UI_VERSION)
