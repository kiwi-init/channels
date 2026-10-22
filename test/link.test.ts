import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateIdentity } from "@kiwi/core/identity.ts";
import {
  LINK_CHUNK_BYTES,
  LINK_PREFIX,
  askToLink,
  dropLink,
  linkCode,
  linkDigits,
  newLinkKeys,
  newLinkSecret,
  openLink,
  personFingerprint,
  readLinkAsk,
  readLinkCode,
  sealLink,
  waitForLinkAsk,
  waitForLinkChunks,
  writeLinkChunks,
  type LinkChannel,
  type LinkCode,
  type LinkPayload,
} from "@kiwi/core/link.ts";
import { MAILBOX_MAX_BYTES } from "@kiwi/core/mailbox.ts";
import { startRelay } from "../src/relay/bun.ts";

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-link-relay-"));
let server: ReturnType<typeof startRelay> | undefined;
let relay = "";

beforeAll(() => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  relay = server.url.origin;
});
afterAll(() => {
  server?.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

async function desktop(channels = 3, fat = 0) {
  const person = await generateIdentity("Ada Lovelace");
  const secret = newLinkSecret();
  const keys = await newLinkKeys();
  const code: LinkCode = { secret, dxpk: keys.xpk, personFp: await personFingerprint(person.pk), relay };
  const chans: LinkChannel[] = await Promise.all(
    Array.from({ length: channels }, async (_, i) => {
      const id = await generateIdentity(`member-${i}`);
      return { label: `channel ${i}`, pk: id.pk, sk: id.sk, xpk: id.xpk, xsk: id.xsk, code: `mc2-${"x".repeat(60)}-${i}`, access: { keys: { "1": "k".repeat(43 + fat) } } };
    }),
  );
  const payload: LinkPayload = {
    kind: "kiwi-link-payload",
    v: 1,
    person: { name: person.name, pk: person.pk, sk: person.sk, xpk: person.xpk!, xsk: person.xsk! },
    channels: chans,
    relayUrl: relay,
    at: Date.now(),
  };
  return { person, secret, keys, code, payload };
}

describe("the link code", () => {
  test("round-trips, and nothing else is a code", async () => {
    const d = await desktop();
    expect(linkCode(d.code).startsWith(LINK_PREFIX)).toBe(true);
    expect(readLinkCode(linkCode(d.code))).toEqual(d.code);
    expect(readLinkCode(`  ${linkCode(d.code)}\n`)).toEqual(d.code);
    const where = linkCode(d.code).split(".")[3]!;
    const ok = `${LINK_PREFIX}${d.secret}.${d.keys.xpk}.${d.code.personFp}`;
    for (const bad of [
      "",
      "kp1-" + d.secret,
      `${LINK_PREFIX}${d.secret}`,
      `${LINK_PREFIX}${d.secret}.${d.keys.xpk}`,
      `${LINK_PREFIX}${d.secret}.${d.keys.xpk}.short.${where}`,
      ok,
      `${ok}.`,
      `${ok}.${where}.extra`,
      `${LINK_PREFIX}bad.${d.keys.xpk}.${d.code.personFp}.${where}`,
      `${ok}.${Buffer.from("ftp://relay.example").toString("base64url")}`,
      `${ok}.${Buffer.from("not a url").toString("base64url")}`,
    ])
      expect(readLinkCode(bad)).toBeNull();
    expect(readLinkCode(linkCode({ ...d.code, relay: "https://relay.example.com:8443/some/path" }))?.relay).toBe("https://relay.example.com:8443");
  });
});

describe("the six digits", () => {
  test("are the same on both sides and change with any input", async () => {
    const a = await newLinkKeys();
    const b = await newLinkKeys();
    const secret = newLinkSecret();
    const digits = await linkDigits(secret, a.xpk, b.xpk);
    expect(digits).toMatch(/^\d{6}$/);
    expect(await linkDigits(secret, a.xpk, b.xpk)).toBe(digits);
    expect(await linkDigits(newLinkSecret(), a.xpk, b.xpk)).not.toBe(digits);
    expect(await linkDigits(secret, (await newLinkKeys()).xpk, b.xpk)).not.toBe(digits);
    expect(await linkDigits(secret, a.xpk, (await newLinkKeys()).xpk)).not.toBe(digits);
  });
});

describe("sealing the person", () => {
  test("opens only with the phone's key, the right code, and every chunk", async () => {
    const d = await desktop(40, 600);
    const phone = await newLinkKeys();
    const chunks = await sealLink(d.secret, d.keys.xsk, d.keys.xpk, phone.xpk, d.payload);
    expect(chunks.length).toBeGreaterThan(1);
    expect(await openLink(d.code, phone.xsk, phone.xpk, chunks)).toEqual(d.payload);
    expect(await openLink(d.code, (await newLinkKeys()).xsk, phone.xpk, chunks)).toBeNull();
    expect(await openLink({ ...d.code, secret: newLinkSecret() }, phone.xsk, phone.xpk, chunks)).toBeNull();
    expect(await openLink({ ...d.code, dxpk: (await newLinkKeys()).xpk }, phone.xsk, phone.xpk, chunks)).toBeNull();
    expect(await openLink(d.code, phone.xsk, phone.xpk, chunks.slice(1))).toBeNull();
    expect(await openLink(d.code, phone.xsk, phone.xpk, [])).toBeNull();
    expect(await openLink(d.code, phone.xsk, phone.xpk, [...chunks].reverse())).toEqual(d.payload);
    expect(
      await openLink(
        d.code,
        phone.xsk,
        phone.xpk,
        [chunks[1]!, chunks[0]!, ...chunks.slice(2)].map((c, i) => (i < 2 ? { ...c, i: 1 - c.i } : c)),
      ),
    ).toBeNull();
    const flipped = chunks.map((c, i) => (i === 0 ? { ...c, ct: `${c.ct.slice(0, -2)}${c.ct.endsWith("AA") ? "BB" : "AA"}` } : c));
    expect(await openLink(d.code, phone.xsk, phone.xpk, flipped)).toBeNull();
  });

  test("refuses a payload whose person is not the one the code names", async () => {
    const d = await desktop();
    const phone = await newLinkKeys();
    const other = await generateIdentity("Someone Else");
    const swapped: LinkPayload = { ...d.payload, person: { name: other.name, pk: other.pk, sk: other.sk, xpk: other.xpk!, xsk: other.xsk! } };
    const chunks = await sealLink(d.secret, d.keys.xsk, d.keys.xpk, phone.xpk, swapped);
    expect(await openLink(d.code, phone.xsk, phone.xpk, chunks)).toBeNull();
  });

  test("keeps every secret out of what is sent", async () => {
    const d = await desktop();
    const phone = await newLinkKeys();
    const wire = JSON.stringify(await sealLink(d.secret, d.keys.xsk, d.keys.xpk, phone.xpk, d.payload));
    for (const secretValue of [d.person.sk, d.person.xsk!, d.payload.channels[0]!.sk, d.person.name]) expect(wire.includes(secretValue)).toBe(false);
  });

  test("a code leaked to someone else gives digits that do not match the real phone's", async () => {
    const d = await desktop();
    const real = await newLinkKeys();
    const attacker = await newLinkKeys();
    const onPhone = await linkDigits(d.secret, d.keys.xpk, real.xpk);
    const onDesktop = await linkDigits(d.secret, d.keys.xpk, attacker.xpk);
    expect(onDesktop).not.toBe(onPhone);
  });
});

describe("through the relay", () => {
  test("a phone links: ask, same digits, sealed chunks across mailboxes, all within the slot limit, then dropped", async () => {
    const d = await desktop(60, 900);
    const phone = await newLinkKeys();

    const phoneBox = await askToLink(relay, d.code, phone.xpk, "Ada's iPhone");
    const seen = await waitForLinkAsk(relay, d.secret, { timeoutMs: 5_000 });
    expect(seen?.ask.pxpk).toBe(phone.xpk);
    expect(seen?.ask.label).toBe("Ada's iPhone");
    expect(await linkDigits(d.secret, d.keys.xpk, seen!.ask.pxpk)).toBe(await linkDigits(d.secret, d.code.dxpk, phone.xpk));

    const chunks = await sealLink(d.secret, d.keys.xsk, d.keys.xpk, seen!.ask.pxpk, d.payload);
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) expect(JSON.stringify(c).length).toBeLessThan(MAILBOX_MAX_BYTES);
    await writeLinkChunks(relay, d.secret, chunks);

    const got = await waitForLinkChunks(relay, d.secret, { timeoutMs: 5_000 });
    expect(got).toHaveLength(chunks.length);
    expect(await openLink(d.code, phone.xsk, phone.xpk, got!)).toEqual(d.payload);

    await dropLink(relay, d.secret, chunks.length);
    expect(await phoneBox.get("a")).toBeNull();
    expect(await phoneBox.get("b")).toBeNull();
  });

  test("a second phone cannot take the slot, and a stranger's mailbox is not an ask", async () => {
    const d = await desktop();
    const first = await newLinkKeys();
    const second = await newLinkKeys();
    await askToLink(relay, d.code, first.xpk, "first");
    await expect(askToLink(relay, d.code, second.xpk, "second")).rejects.toThrow();
    expect((await waitForLinkAsk(relay, d.secret, { timeoutMs: 2_000 }))?.ask.pxpk).toBe(first.xpk);
    expect(readLinkAsk({ kind: "kiwi-link-ask", v: 1, mailbox: "someone-elses", pxpk: first.xpk, label: "x", at: 1 }, "mine")).toBeNull();
    expect(readLinkAsk({ kind: "kiwi-link-ask", v: 1, mailbox: "mine", pxpk: "short", label: "x", at: 1 }, "mine")).toBeNull();
    expect(readLinkAsk(null, "mine")).toBeNull();
  });

  test("nobody answers: the wait ends empty", async () => {
    const d = await desktop();
    expect(await waitForLinkAsk(relay, d.secret, { timeoutMs: 300, everyMs: 100 })).toBeNull();
    expect(await waitForLinkChunks(relay, d.secret, { timeoutMs: 300, everyMs: 100 })).toBeNull();
  });
});

describe("limits", () => {
  test("a chunk is small enough that the mailbox's own sealing still fits the slot", () => {
    expect(Math.ceil((LINK_CHUNK_BYTES * 4) / 3) * (4 / 3) * 1.1).toBeLessThan(MAILBOX_MAX_BYTES);
  });

  test("more channels than a link can carry is refused, not truncated", async () => {
    const d = await desktop(1);
    const phone = await newLinkKeys();
    const huge: LinkPayload = { ...d.payload, channels: Array.from({ length: 1 }, () => ({ ...d.payload.channels[0]!, filler: "z".repeat(2 * 1024 * 1024) })) };
    await expect(sealLink(d.secret, d.keys.xsk, d.keys.xpk, phone.xpk, huge)).rejects.toThrow("more channels than a link can carry");
  });
});
