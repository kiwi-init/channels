import { describe, expect, test } from "bun:test";
import { b64url, fromB64url, ownerFingerprint } from "@kiwi/core/crypto.ts";
import { generateIdentity, sign, signedBy, verify, VerifyCouldNotRun } from "@kiwi/core/identity.ts";
import { personaOf } from "@kiwi/core/personality.ts";
import { makePin, MAX_PIN, pinFits, pinned, readPin } from "@kiwi/core/pin.ts";
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

    expect(await readPin(token, "ab".repeat(16), owner.pk)).toEqual({ invalid: true });
    const other = await generateIdentity("other");
    expect(await readPin(token, room, other.pk)).toEqual({ invalid: true });
    expect(await readPin(await makePin(other, room, builder), room, owner.pk)).toEqual({ invalid: true });
    expect(await readPin(`${token.slice(0, -4)}AAAA`, room, owner.pk)).toEqual({ invalid: true });
    expect(await readPin("not a token", room, owner.pk)).toEqual({ invalid: true });
    expect(await readPin(undefined, room, owner.pk)).toBeNull();
  });

  test("a pin names its personality as it was: the same one resolves, an edited one doesn't", async () => {
    const owner = await generateIdentity("human");
    const read = await readPin(await makePin(owner, room, builder), room, owner.pk);
    if (!read || "invalid" in read) throw new Error("the owner's own token should read back");
    const pin = read;
    expect(await pinned(pin, PRESETS)).toEqual(personaOf(builder));
    expect(await pinned(pin, [{ ...builder, instructions: `${builder.instructions} Also deploy.` }])).toBeNull();
    expect(
      await pinned(
        pin,
        PRESETS.filter((p) => p.id !== "builder"),
      ),
    ).toBeNull();
  });

  test("a token that fails verification is told apart from no token at all", async () => {
    const owner = await generateIdentity("human");
    const token = await makePin(owner, room, builder);
    const o = JSON.parse(new TextDecoder().decode(fromB64url(token))) as { pk: string };
    o.pk = `${o.pk.slice(0, 15)}${o.pk[15] === "Z" ? "J" : "Z"}${o.pk.slice(16)}`;
    const bent = b64url(new TextEncoder().encode(JSON.stringify(o)));
    expect(await readPin(bent, room, owner.pk)).toEqual({ invalid: true });
    expect(await readPin(token, "ab".repeat(16), owner.pk)).toEqual({ invalid: true });
    expect(await readPin(await makePin(await generateIdentity("other"), room, builder), room, owner.pk)).toEqual({ invalid: true });
    expect(await readPin(undefined, room, owner.pk)).toBeNull();
  });
});

describe("a verifier that throws on a valid key and signature", () => {
  const throwing = async <T>(name: string, run: () => Promise<T>): Promise<T> => {
    const real = crypto.subtle.verify;
    Object.defineProperty(crypto.subtle, "verify", { configurable: true, value: () => Promise.reject(new DOMException("injected", name)) });
    try {
      return await run();
    } finally {
      Object.defineProperty(crypto.subtle, "verify", { configurable: true, value: real });
    }
  };

  for (const name of ["DataError", "OperationError"]) {
    test(`a ${name} isn't read as a bad signature`, async () => {
      const owner = await generateIdentity("human");
      const signed = await sign(owner, { room });
      expect(await signedBy(signed)).toBe(true);
      const thrown = await throwing(name, () =>
        signedBy(signed).then(
          () => null,
          (e: unknown) => e,
        ),
      );
      expect(thrown).toBeInstanceOf(VerifyCouldNotRun);
      expect((thrown as Error).message).toBe(`${name}: injected`);
      expect(await throwing(name, () => verify(signed))).toBe(false);
      const token = await makePin(owner, room, builder);
      const code = { roomId: room, ownerFp: await ownerFingerprint(owner.pk) };
      expect(await throwing(name, () => pinFits(token, code))).toEqual({ kind: "couldNotRun", why: `${name}: injected` });
      expect(await pinFits(token, code)).toEqual({ kind: "fits" });
    });
  }

  test("a key or signature of the wrong length is a bad signature, before WebCrypto runs", async () => {
    const owner = await generateIdentity("human");
    const signed = await sign(owner, { room });
    const short = { ...signed, pk: b64url(fromB64url(signed.pk).slice(0, 31)) };
    const long = { ...signed, sig: b64url(new Uint8Array([...fromB64url(signed.sig), 0])) };
    expect(await throwing("OperationError", () => Promise.all([signedBy(short), signedBy(long)]))).toEqual([false, false]);
  });
});
