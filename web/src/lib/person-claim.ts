// A person's join request says which person key is theirs: a PersonClaim, the person key's
// signature over this member key in this channel (src/person.ts). Relative imports so bun test
// resolves it without the @mc alias.
import { decodeJoinCode } from "../../../src/crypto.ts"
import type { Identity } from "../../../src/identity.ts"
import { provePerson, type PersonClaim } from "../../../src/person.ts"

/** The person's claim over a member key in the channel `code` names. */
export function personClaimFor(person: Identity, code: string, memberPk: string): Promise<PersonClaim> {
  return provePerson(person, decodeJoinCode(code).roomId, memberPk)
}
