import { describe, expect, test } from "bun:test";
import { freshKeyPair } from "@kiwi/core/crypto.ts";
import { generateIdentity } from "@kiwi/core/identity.ts";

const real = async (alg: { name: "Ed25519" } | { name: "X25519" }, usages: ("sign" | "verify" | "deriveBits")[]) => (await crypto.subtle.generateKey(alg, true, usages)) as unknown as CryptoKeyPair;

const flaky = (fails: number, error: () => Error = () => new DOMException("The operation failed for an operation-specific reason", "OperationError")) => {
  let calls = 0;
  const make = async (alg: { name: "Ed25519" } | { name: "X25519" }, usages: ("sign" | "verify" | "deriveBits")[]) => {
    calls++;
    if (calls <= fails) throw error();
    return real(alg, usages);
  };
  return { make, calls: () => calls };
};

describe("a new key pair, where Linux WebKit's generateKey fails now and then (T517)", () => {
  test("an OperationError asks again, and the pair that comes back works", async () => {
    const f = flaky(2);
    const pair = await freshKeyPair({ name: "Ed25519" }, ["sign", "verify"], f.make);
    expect(f.calls()).toBe(3);
    const sig = await crypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, new TextEncoder().encode("hi"));
    expect(await crypto.subtle.verify({ name: "Ed25519" }, pair.publicKey, sig, new TextEncoder().encode("hi"))).toBe(true);
  });

  test("five OperationErrors in a row are given up on, and any other error isn't asked again", async () => {
    const down = flaky(5);
    await expect(freshKeyPair({ name: "X25519" }, ["deriveBits"], down.make)).rejects.toThrow("operation-specific");
    expect(down.calls()).toBe(5);
    const unsupported = flaky(1, () => new DOMException("Unsupported", "NotSupportedError"));
    await expect(freshKeyPair({ name: "X25519" }, ["deriveBits"], unsupported.make)).rejects.toThrow("Unsupported");
    expect(unsupported.calls()).toBe(1);
  });

  test("a person's identity still comes out whole: an Ed25519 signing key and an X25519 exchange key", async () => {
    const id = await generateIdentity("Ada");
    expect([id.pk, id.sk, id.xpk, id.xsk].every((k) => typeof k === "string" && k.length > 20)).toBe(true);
  });
});
