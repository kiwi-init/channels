const KEY = "mc.last"

export function lastChannel(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    // A private window or blocked storage: nothing to reopen.
    return null
  }
}

export function rememberChannel(code: string | null): void {
  try {
    if (code) localStorage.setItem(KEY, code)
    else localStorage.removeItem(KEY)
  } catch {
    // A private window or a full disk: the next launch opens nothing, as before.
  }
}

export function reopenable(last: string | null, rows: readonly { code: string; state: string }[]): string | null {
  return last && rows.some((r) => r.code === last && r.state === "member") ? last : null
}
