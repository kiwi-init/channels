import { decodeJoinCode } from "@mc/crypto.ts"
import type { Identity } from "@mc/identity.ts"
import { provePerson, type PersonClaim } from "@mc/person.ts"

/** The person's claim over a member key in the channel `code` names. */
export function personClaimFor(person: Identity, code: string, memberPk: string): Promise<PersonClaim> {
  return provePerson(person, decodeJoinCode(code).roomId, memberPk)
}
