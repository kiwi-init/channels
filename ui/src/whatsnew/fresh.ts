export function emptyStore(store: () => Pick<Storage, "length">): boolean {
  try {
    return store().length === 0
  } catch {
    // No storage to read: treat the app as one that has run before, so the window shows as it always did.
    return false
  }
}

export const freshInstall = emptyStore(() => localStorage)
