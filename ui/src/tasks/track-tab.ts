const KEY = "kiwi:track:tab"

export type TrackTab = "now" | "activity"

export function readTab(): TrackTab {
  try {
    return localStorage.getItem(KEY) === "activity" ? "activity" : "now"
  } catch {
    // Storage can be off (private windows, blocked site data): the column opens on Now.
    return "now"
  }
}

export function keepTab(tab: TrackTab): void {
  try {
    localStorage.setItem(KEY, tab)
  } catch {
    // Storage can be off: the choice lasts until the window reloads.
  }
}
