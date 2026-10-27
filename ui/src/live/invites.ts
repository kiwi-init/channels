const OWNER_KEY = (code: string) => `channels.invite.owner.${code}`

export function inviteOwner(code: string): string | null {
  try {
    return localStorage.getItem(OWNER_KEY(code))
  } catch {
    // Storage can be off: the waiting screen falls back to the code's own name.
    return null
  }
}

export function rememberOwner(code: string, owner: string): void {
  try {
    localStorage.setItem(OWNER_KEY(code), owner)
  } catch {
    // Storage can be off: the owner's name just isn't remembered for the waiting screen.
  }
}
