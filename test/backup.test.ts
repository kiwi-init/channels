import { describe, expect, test } from "bun:test";

import { BACKUP_WORDS, WrongPassphrase, generatePassphrase, normalizePassphrase, openBackup, passphraseProblem, readEnvelope, sealBackup } from "../src/backup.ts";
import { WORDS } from "../src/backup-words.ts";

const fast = { N: 2 ** 14, r: 8, p: 1 };
const isKeys = (v: unknown): v is { person: string; channels: string[] } => !!v && typeof v === "object" && "person" in v && "channels" in v;
const payload = { person: "pk-1", channels: ["a", "b"] };

describe("backup passphrase", () => {
  test("the list has 7776 distinct lowercase words and a passphrase is six of them", () => {
    expect(WORDS.length).toBe(7776);
    expect(new Set(WORDS).size).toBe(7776);
    expect(WORDS.every((w) => /^[a-z]{4,6}$/.test(w))).toBe(true)
    const words = generatePassphrase().split(" ");
    expect(words).toHaveLength(BACKUP_WORDS);
    expect(words.every((w) => WORDS.includes(w))).toBe(true);
    expect(generatePassphrase()).not.toBe(generatePassphrase());
  });

  test("typing it with other case, dashes or spaces is the same passphrase", () => {
    expect(normalizePassphrase("  Alpha-BRAVO   charlie\n")).toBe("alpha bravo charlie");
  });

  test("short passphrases and PINs are refused", () => {
    expect(passphraseProblem("123456")).not.toBeNull();
    expect(passphraseProblem("one two three four")).not.toBeNull();
    expect(passphraseProblem("one two three four five")).toBeNull();
    expect(passphraseProblem("abcdefghij klmnopqrst")).toBeNull();
  });
});

describe("backup envelope", () => {
  test("opens with the same passphrase, however it is typed", async () => {
    const env = await sealBackup("alpha bravo charlie delta echo foxtrot", payload, fast);
    expect(await openBackup("ALPHA-bravo charlie delta echo  foxtrot", env, isKeys)).toEqual(payload);
  });

  test("a wrong passphrase, a changed parameter or a changed byte opens nothing", async () => {
    const env = await sealBackup("alpha bravo charlie delta echo foxtrot", payload, fast);
    await expect(openBackup("alpha bravo charlie delta echo golf", env, isKeys)).rejects.toBeInstanceOf(WrongPassphrase);
    await expect(openBackup("alpha bravo charlie delta echo foxtrot", { ...env, salt: env.salt.replace(/^./, (c) => (c === "A" ? "B" : "A")) }, isKeys)).rejects.toBeInstanceOf(WrongPassphrase);
    await expect(openBackup("alpha bravo charlie delta echo foxtrot", { ...env, ct: env.ct.replace(/^./, (c) => (c === "A" ? "B" : "A")) }, isKeys)).rejects.toBeInstanceOf(WrongPassphrase);
  });

  test("the envelope holds no key material in the clear", async () => {
    const env = await sealBackup("alpha bravo charlie delta echo foxtrot", { person: "SECRET-KEY", channels: [] }, fast);
    expect(JSON.stringify(env)).not.toContain("SECRET-KEY");
  });

  test("a relay-supplied envelope with a silly cost is not read", async () => {
    const env = await sealBackup("alpha bravo charlie delta echo foxtrot", payload, fast);
    expect(readEnvelope(env)).not.toBeNull();
    expect(readEnvelope({ ...env, N: 2 ** 30 })).toBeNull();
    expect(readEnvelope({ ...env, N: 2 })).toBeNull();
    expect(readEnvelope({ ...env, v: 2 })).toBeNull();
    expect(readEnvelope("x")).toBeNull();
  });
});
