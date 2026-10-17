import { decodeJoinCode } from "@kiwi/core/crypto.ts"
import type { Identity } from "@kiwi/core/identity.ts"
import { provePerson, type PersonClaim } from "@kiwi/core/person.ts"

/** The person's claim over a member key in the channel `code` names. */
export function personClaimFor(person: Identity, code: string, memberPk: string): Promise<PersonClaim> {
  return provePerson(person, decodeJoinCode(code).roomId, memberPk)
}
