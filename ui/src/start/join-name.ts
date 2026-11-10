import { handleFor, NAME_RE, RESERVED_NAMES } from "@kiwi/core/membership.ts"

export type NameProblem = "allowed" | "reserved" | null

export const nameProblemOf = (name: string): NameProblem => (!NAME_RE.test(name.trim()) ? "allowed" : RESERVED_NAMES.has(name.trim().toLowerCase()) ? "reserved" : null)

export function joinName(account: string | undefined): { name: string; asks: boolean } {
  const name = account === undefined ? "" : handleFor(account)
  return { name, asks: nameProblemOf(name) !== null }
}
