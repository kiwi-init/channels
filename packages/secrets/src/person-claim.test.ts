import { describe, expect, test } from "bun:test";

import { encodeJoinCode, newRoomId } from "@kiwi/core/crypto.ts";
import { generateIdentity } from "@kiwi/core/identity.ts";
import { checkPerson } from "@kiwi/core/person.ts";

import { personClaimFor } from "./person-claim.ts";

describe("person claim on a join request", () => {
  test("proves the person key over this member key in this channel, and nothing else", async () => {
    const person = await generateIdentity("Ada");
    const member = await generateIdentity("ada");
    const other = await generateIdentity("eve");
    const room = newRoomId();
    const code = encodeJoinCode({ roomId: room, ownerFp: "A".repeat(16) });
    const claim = await personClaimFor(person, code, member.pk);
    expect(claim.person).toBe(person.pk);
    expect(await checkPerson(claim, room, member.pk)).toBe(person.pk);
    expect(await checkPerson(claim, room, other.pk)).toBeNull();
    expect(await checkPerson(claim, "x".repeat(room.length), member.pk)).toBeNull();
  });
});
