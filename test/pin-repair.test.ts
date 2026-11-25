import { describe, expect, test } from "bun:test";
import { b64url, decodeJoinCode, encodeJoinCode, fromB64url, ownerFingerprint } from "@kiwi/core/crypto.ts";
import { generateIdentity } from "@kiwi/core/identity.ts";
import { inviteCheck } from "@kiwi/core/invite-check.ts";
import { makePin, MAX_PIN, pinFits, type PinCheck } from "@kiwi/core/pin.ts";
import { PRESETS } from "@kiwi/core/presets.ts";
import { repairPin, REPAIR_BUDGET_MS } from "../src/pin-repair.ts";

const room = "ef".repeat(16);
const builder = PRESETS.find((p) => p.id === "builder")!;

async function invite() {
  const owner = await generateIdentity("human");
  const token = await makePin(owner, room, builder);
  const code = decodeJoinCode(encodeJoinCode({ roomId: room, ownerFp: await ownerFingerprint(owner.pk) }));
  return { token, fits: (t: string) => pinFits(t, code) };
}

const swapped = (token: string, at: number) => `${token.slice(0, at)}${token[at] === "A" ? "B" : "A"}${token.slice(at + 1)}`;
const never = Number.MAX_SAFE_INTEGER;

describe("an invite token with one character changed in the copy", () => {
  test("a change inside the signature is put back, naming the character", async () => {
    const { token, fits } = await invite();
    const at = token.length - 20;
    const bent = swapped(token, at);
    expect((await fits(bent)).kind).toBe("invalid");
    expect(await repairPin(bent, fits, Date.now() + 60_000)).toEqual({ kind: "repaired", token, at: at + 1, was: bent[at]!, is: token[at]! });
  });

  test("a change that breaks the JSON is put back too", async () => {
    const { token, fits } = await invite();
    const bent = `${token[0] === "e" ? "f" : "e"}${token.slice(1)}`;
    expect((await fits(bent)).kind).toBe("invalid");
    expect(await repairPin(bent, fits, Date.now() + 60_000)).toMatchObject({ kind: "repaired", token, at: 1 });
  });

  test("two changes, a dropped character or another owner's token are not repaired", async () => {
    const { token, fits } = await invite();
    expect(await repairPin(swapped(swapped(token, 40), token.length - 10), fits, Date.now() + 60_000)).toEqual({ kind: "none" });
    expect(await repairPin(`${token.slice(0, 100)}${token.slice(101)}`, fits, Date.now() + 60_000)).toEqual({ kind: "none" });
    const other = await makePin(await generateIdentity("other"), room, builder);
    expect(await repairPin(swapped(other, other.length - 20), fits, Date.now() + 60_000)).toEqual({ kind: "none" });
  });
});

describe("the search's limits", () => {
  const token = "abcdef";
  const fitsAt =
    (...good: string[]) =>
    async (t: string): Promise<PinCheck> =>
      good.includes(t) ? { kind: "fits" } : { kind: "invalid" };

  test("two variants with different payloads that both verify are ambiguous", async () => {
    expect(await repairPin(token, fitsAt("Abcdef", "abcdeA"), never)).toEqual({ kind: "ambiguous" });
  });

  test("variants that decode to the same bytes count once", async () => {
    expect(await repairPin("abc", fitsAt("abd", "abe"), never)).toMatchObject({ kind: "repaired", token: "abd" });
  });

  test("a search past its deadline is refused", async () => {
    let clock = 0;
    const tick = () => (clock += 1_000);
    expect(await repairPin(token, fitsAt("abcdeA"), 3_000, tick)).toEqual({ kind: "outOfTime" });
  });

  test("a variant whose check can't run, like one with a malformed key, is not a match and the search goes on", async () => {
    const check = async (t: string): Promise<PinCheck> => (t === "abcdeA" ? { kind: "fits" } : { kind: "couldNotRun", why: "DataError: bad key" });
    expect(await repairPin(token, check, never)).toMatchObject({ kind: "repaired", token: "abcdeA" });
  });

  test("the worst case, a token as long as MAX_PIN, finishes inside the budget", async () => {
    const { token, fits } = await invite();
    const signed = JSON.parse(new TextDecoder().decode(fromB64url(token))) as Record<string, unknown>;
    const padded = (n: number) => b64url(new TextEncoder().encode(JSON.stringify({ ...signed, sig: `${String(signed.sig).slice(0, -2)}AA`, pad: "x".repeat(n) })));
    let n = 0;
    while (padded(n + 3).length <= MAX_PIN) n += 3;
    const longest = padded(n);
    expect(longest.length).toBeGreaterThan(MAX_PIN - 4);
    const started = performance.now();
    expect(await repairPin(longest, fits, never)).toEqual({ kind: "none" });
    const ms = Math.round(performance.now() - started);
    console.log(`repair search over ${longest.length} characters: ${ms} ms`);
    expect(ms).toBeLessThan(REPAIR_BUDGET_MS);
  });
});

test("the invite check is short, stable and tells two tokens apart", async () => {
  const { token } = await invite();
  expect(inviteCheck(token)).toMatch(/^[0-9a-f]{4}-[0-9a-f]{4}$/);
  expect(inviteCheck(token)).toBe(inviteCheck(`${token}`));
  expect(inviteCheck(swapped(token, 50))).not.toBe(inviteCheck(token));
});
