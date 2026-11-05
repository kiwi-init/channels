export const PLEDGE = "Channels is not a harness"

const SEEN = "ui.onboarded"

export const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

export const pledged = (typed: string): boolean => same(typed, PLEDGE)

let seen: boolean | null = null

export function onboarded(): boolean {
  if (seen !== null) return seen
  try {
    seen = localStorage.getItem(SEEN) === "1"
  } catch {
    // Without storage the onboarding shows until the person has an account, which ends it for good.
    seen = false
  }
  return seen
}

export function rememberOnboarded(keep = true): void {
  seen = true
  if (!keep) return
  try {
    localStorage.setItem(SEEN, "1")
  } catch {
    // Without storage it is remembered until the page reloads, and the account it leads to ends it for good.
  }
}
