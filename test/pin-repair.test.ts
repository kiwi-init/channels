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
const SIGNED = {
  code: "mc2-7-_v7-_v7-_v7-_v7-_v7w-VTcFxOB8jOiLzSWR",
  token:
    "eyJyb29tIjoiZWZlZmVmZWZlZmVmZWZlZmVmZWZlZmVmZWZlZmVmZWYiLCJwaW4iOnsiaWQiOiJidWlsZGVyIiwibmFtZSI6IkJ1aWxkZXIiLCJoYXNoIjoiZDdkNTUyNjFjNWZhNjhhMGZiYTdmNmNhOTExNDAwZDAifSwicGsiOiI5eWRqSHVxeWFQNTRSaDBSODh2Z0VFSUg1Q3JiY0VwY2k1Z0ZySFZiX0FRIiwic2lnIjoiajZMTng3N29mOVBtYVJmbG1WTEhxcVJVMWpVTjRudXZvRUY4c0plQk5oRlpfWG5TdHpFemdwalEySDl5eVM2UTlrTHJGNC0yUEpzLW5tTEJTdF95Q2cifQ",
};

describe("an invite token with one character changed in the copy", () => {
  test("a change inside the signature is put back, naming the character", async () => {
    const { token, code } = SIGNED;
    const fits = (t: string) => pinFits(t, decodeJoinCode(code));
    const at = token.length - 20;
    const bent = swapped(token, at);
    expect((await fits(bent)).kind).toBe("invalid");
    expect(await repairPin(bent, fits, 60_000)).toEqual({ kind: "repaired", token, at: at + 1, was: bent[at]!, is: token[at]! });
  });

  test("a change that breaks the JSON is put back too", async () => {
    const { token, fits } = await invite();
    const bent = `${token[0] === "e" ? "f" : "e"}${token.slice(1)}`;
    expect((await fits(bent)).kind).toBe("invalid");
    expect(await repairPin(bent, fits, 60_000)).toMatchObject({ kind: "repaired", token, at: 1 });
  });

  test("two changes, a dropped character or another owner's token are not repaired", async () => {
    const { token, fits } = await invite();
    expect(await repairPin(swapped(swapped(token, 40), token.length - 10), fits, 60_000)).toEqual({ kind: "none" });
    expect(await repairPin(`${token.slice(0, 100)}${token.slice(101)}`, fits, 60_000)).toEqual({ kind: "none" });
    const other = await makePin(await generateIdentity("other"), room, builder);
    expect(await repairPin(swapped(other, other.length - 20), fits, 60_000)).toEqual({ kind: "none" });
  });
});

describe("the search's limits", () => {
  const token = b64url(new TextEncoder().encode(JSON.stringify({ v: "abcdefghijkl" })));
  const readable = (i: number) =>
    [..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"]
      .map((c) => `${token.slice(0, i)}${c}${token.slice(i + 1)}`)
      .find((t) => {
        if (t === token) return false;
        try {
          return typeof JSON.parse(new TextDecoder().decode(fromB64url(t))) === "object";
        } catch {
          // A variant that isn't JSON is no use as a stand-in for a signed token.
          return false;
        }
      })!;
  const first = readable(8);
  const last = readable(token.length - 4);
  const fitsAt =
    (...good: string[]) =>
    async (t: string): Promise<PinCheck> =>
      good.includes(t) ? { kind: "fits" } : { kind: "invalid" };

  test("two variants with different payloads that both verify are ambiguous", async () => {
    expect(await repairPin(token, fitsAt(first, last), never)).toEqual({ kind: "ambiguous" });
  });

  test("two spellings of one signature that decode to different bytes are ambiguous", async () => {
    const { token, fits } = await invite();
    const o = JSON.parse(new TextDecoder().decode(fromB64url(token))) as { sig: string };
    const spelled = (sig: string) => b64url(new TextEncoder().encode(JSON.stringify({ ...o, sig })));
    const pair = (at: number) => [spelled(`${o.sig.slice(0, at)}-${o.sig.slice(at + 1)}`), spelled(`${o.sig.slice(0, at)}+${o.sig.slice(at + 1)}`)] as const;
    const differing = (a: string, b: string) => [...a].flatMap((c, i) => (c === b[i] ? [] : [i]));
    const at = [...Array(o.sig.length).keys()].find((i) => differing(...pair(i)).length === 1)!;
    const [plain, alias] = pair(at);
    const diff = differing(plain, alias)[0]!;
    const both = async (t: string): Promise<PinCheck> => (t === plain || t === alias ? { kind: "fits" } : fits(t));
    const bent = `${plain.slice(0, diff)}${plain[diff] === "A" || alias[diff] === "A" ? "Q" : "A"}${plain.slice(diff + 1)}`;
    expect(await repairPin(bent, both, never)).toEqual({ kind: "ambiguous" });
  });

  test("outer spellings that decode to the same bytes count once", async () => {
    expect(await repairPin("abc", fitsAt("abd", "abe"), never)).toMatchObject({ kind: "repaired", token: "abd" });
  });

  test("a search past its deadline is refused", async () => {
    let clock = 0;
    const slow = async (t: string): Promise<PinCheck> => {
      clock += 1;
      return fitsAt(last)(t);
    };
    expect(await repairPin(token, slow, 100, () => clock)).toEqual({ kind: "outOfTime" });
  });

  test("a match found in the batch that crosses the deadline is still refused", async () => {
    let clock = 0;
    const lastBatchIsLate = async (t: string): Promise<PinCheck> => {
      if (t.slice(0, -1) === token.slice(0, -1)) clock = 1_000;
      return fitsAt(last)(t);
    };
    expect(await repairPin(token, lastBatchIsLate, 500, () => clock)).toEqual({ kind: "outOfTime" });
    expect(await repairPin(token, fitsAt(last), 500, () => 0)).toMatchObject({ kind: "repaired", token: last });
  });

  test("a check that can't run stops the search and says so, even after a match", async () => {
    const check = async (t: string): Promise<PinCheck> => (t === first ? { kind: "fits" } : t === last ? { kind: "couldNotRun", why: "OperationError: injected" } : { kind: "invalid" });
    expect(await repairPin(token, check, never)).toEqual({ kind: "couldNotRun", why: "OperationError: injected" });
  });

  test("every one-character variant of a real token is told fits or invalid, never could-not-run", async () => {
    const { token: real, fits } = await invite();
    const bent = swapped(real, real.length - 20);
    const kinds = new Set<string>();
    const counted = async (t: string) => {
      const r = await fits(t);
      kinds.add(r.kind);
      return r;
    };
    await repairPin(bent, counted, never);
    expect([...kinds].sort()).toEqual(["fits", "invalid"]);
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
