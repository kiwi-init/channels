const SEEN = "ui.onboarded"

let seen: boolean | null = null

export function rememberOnboarded(keep = true): void {
  seen = true
  if (!keep) return
  try {
    localStorage.setItem(SEEN, "1")
  } catch {
    // Without storage it is remembered until the page reloads, and the channels it leads to keep it away.
  }
}

export function onboarded(known: boolean): boolean {
  if (seen === null) {
    try {
      seen = localStorage.getItem(SEEN) === "1"
    } catch {
      // Without storage it shows until the person has a channel, which keeps it away.
      seen = false
    }
    if (!seen && known) rememberOnboarded()
  }
  return seen
}
