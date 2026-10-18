import { describe, expect, test } from "bun:test";
import { generateIdentity } from "@kiwi/core/identity.ts";
import { personaOf } from "@kiwi/core/personality.ts";
import { makePin, MAX_PIN, pinned, readPin } from "@kiwi/core/pin.ts";
import { PRESETS } from "@kiwi/core/presets.ts";

const room = "ef".repeat(16);
const builder = PRESETS.find((p) => p.id === "builder")!;

describe("a personality pinned in an invite", () => {
  test("the owner's token reads back for its room and its owner, and nothing else does", async () => {
    const owner = await generateIdentity("human");
    const token = await makePin(owner, room, builder);
    expect(token.length).toBeLessThanOrEqual(MAX_PIN);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    const pin = await readPin(token, room, owner.pk);
    expect(pin).toMatchObject({ id: "builder", name: "Builder" });

    expect(await readPin(token, "ab".repeat(16), owner.pk)).toBeNull();
    const other = await generateIdentity("other");
    expect(await readPin(token, room, other.pk)).toBeNull();
    expect(await readPin(await makePin(other, room, builder), room, owner.pk)).toBeNull();
    expect(await readPin(`${token.slice(0, -4)}AAAA`, room, owner.pk)).toBeNull();
    expect(await readPin("not a token", room, owner.pk)).toBeNull();
    expect(await readPin(undefined, room, owner.pk)).toBeNull();
  });

  test("a pin names its personality as it was: the same one resolves, an edited one doesn't", async () => {
    const owner = await generateIdentity("human");
    const pin = (await readPin(await makePin(owner, room, builder), room, owner.pk))!;
    expect(await pinned(pin, PRESETS)).toEqual(personaOf(builder));
    expect(await pinned(pin, [{ ...builder, instructions: `${builder.instructions} Also deploy.` }])).toBeNull();
    expect(
      await pinned(
        pin,
        PRESETS.filter((p) => p.id !== "builder"),
      ),
    ).toBeNull();
  });
});
