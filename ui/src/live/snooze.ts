export type SnoozeFor = "1h" | "8h" | "tomorrow"

export const muteKey = (code: string, room?: string | null): string => (room ? `${code}/${room}` : code)

export function snoozeEnd(choice: SnoozeFor, now: number): number {
  if (choice === "1h") return now + 3_600_000
  if (choice === "8h") return now + 8 * 3_600_000
  const at = new Date(now)
  at.setDate(at.getDate() + 1)
  at.setHours(9, 0, 0, 0)
  return at.getTime()
}
