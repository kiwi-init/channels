const SEEN = "ui.onboarded"

let kept = false

export function rememberOnboarded(keep = true): void {
  if (keep) {
    try {
      localStorage.setItem(SEEN, "1")
      return
    } catch {
      // Without storage it is remembered until the page reloads, and the channels it leads to keep it away.
    }
  }
  kept = true
}

export function onboarded(known: boolean): boolean {
  if (kept) return true
  let seen = false
  try {
    seen = localStorage.getItem(SEEN) === "1"
  } catch {
    // Without storage it shows until the person has a channel, which keeps it away.
  }
  if (seen || !known) return seen
  rememberOnboarded()
  return true
}
