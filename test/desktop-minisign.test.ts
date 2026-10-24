import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { minisignVerifies, readPublicKey } from "../desktop/src/minisign.ts";
import { RELEASE_KEY } from "../desktop/src/release-key.ts";
import { throwawayKey } from "./minisign-sign.ts";

const FIXTURES = join(import.meta.dir, "fixtures", "minisign");
const fixture = (name: string): string => readFileSync(join(FIXTURES, name), "utf8");
const sums = readFileSync(join(FIXTURES, "SHA256SUMS"));
const pub = fixture("test.pub");
const keyLine = pub.trim().split("\n").at(-1)!;
const signed = fixture("SHA256SUMS.minisig");
const legacy = fixture("SHA256SUMS.legacy.minisig");

describe("a minisign signature, as minisign 0.12 makes it with a throwaway key", () => {
  test("verifies the SHA256SUMS it signed, prehashed or legacy, with the key's line or its .pub file", () => {
    expect(minisignVerifies(sums, signed, keyLine)).toBe(true);
    expect(minisignVerifies(sums, signed, pub)).toBe(true);
    expect(minisignVerifies(sums, legacy, keyLine)).toBe(true);
    expect(minisignVerifies(sums, signed.replace(/\n/g, "\r\n"), keyLine)).toBe(true);
  });

  test("fails for a changed file, another key, an edited trusted comment, or a broken signature", () => {
    const changed = Buffer.from(sums);
    changed[0] = changed[0]! ^ 1;
    expect(minisignVerifies(changed, signed, keyLine)).toBe(false);
    expect(minisignVerifies(sums, signed, throwawayKey().publicKey)).toBe(false);
    expect(minisignVerifies(sums, signed.replace("kiwi v9.9.9", "kiwi v9.9.8"), keyLine)).toBe(false);
    const [untrusted, sig, trusted, global] = signed.split("\n");
    expect(minisignVerifies(sums, [untrusted, sig, trusted, sig].join("\n"), keyLine)).toBe(false);
    expect(minisignVerifies(sums, [untrusted, `${sig}!`, trusted, global].join("\n"), keyLine)).toBe(false);
    expect(minisignVerifies(sums, [sig, trusted, global].join("\n"), keyLine)).toBe(false);
    expect(minisignVerifies(sums, "", keyLine)).toBe(false);
    expect(minisignVerifies(sums, signed, "")).toBe(false);
  });

  test("a key is minisign's Ed25519 key line and nothing else", () => {
    expect(readPublicKey(pub)?.id.toString("hex")).toBe("d3b370c31d7c8e8b");
    expect(readPublicKey("")).toBeNull();
    expect(readPublicKey("RWT not base64!")).toBeNull();
    expect(readPublicKey(Buffer.alloc(42).toString("base64"))).toBeNull();
  });

  test("the signer the tests use makes what minisign makes", () => {
    const key = throwawayKey();
    expect(minisignVerifies(sums, key.sign(sums, "kiwi v9.9.9 SHA256SUMS"), key.publicKey)).toBe(true);
  });
});

test("the release key pinned in the app is a minisign key", () => {
  expect(readPublicKey(RELEASE_KEY)).not.toBeNull();
});
