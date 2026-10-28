import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChannelIdentityView, PersonView, PhoneView } from "../desktop/src/bridge.ts";
import { createLinkHost } from "../desktop/src/link-host.ts";
import { generateIdentity } from "@kiwi/core/identity.ts";
import { askToLink, linkDigits, newLinkKeys, openLink, readLinkCode, waitForLinkChunks } from "@kiwi/core/link.ts";
import { startRelay } from "../src/relay/bun.ts";

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-desktop-link-"));
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

async function app() {
  const id = await generateIdentity("Ada Lovelace");
  const person: PersonView = { name: id.name, pk: id.pk, sk: id.sk, xpk: id.xpk!, xsk: id.xsk! };
  const channels: ChannelIdentityView[] = await Promise.all(
    [0, 1, 2].map(async (i) => {
      const c = await generateIdentity(`member-${i}`);
      return { label: `channel ${i}`, pk: c.pk, sk: c.sk, xpk: c.xpk, xsk: c.xsk, code: `mc2-code-${i}`, access: { epoch: 1 } };
    }),
  );
  const linked: PhoneView[] = [];
  const host = createLinkHost({ relayUrl: () => relay, person: () => person, channels: () => channels, linked: (p) => linked.push(p) });
  return { person, channels, linked, host };
}

describe("the desktop's side of linking a phone", () => {
  test("shows a code, tells what asked, sends the person and every channel once the person says yes", async () => {
    const a = await app();
    const { code: text } = await a.host.begin();
    const code = readLinkCode(text)!;
    expect(code).toBeTruthy();

    const phone = await newLinkKeys();
    await askToLink(relay, code, phone.xpk, "Ada's iPhone");
    const ask = await a.host.poll();
    expect(ask?.label).toBe("Ada's iPhone");
    expect(ask?.digits).toBe(await linkDigits(code.secret, code.dxpk, phone.xpk));

    const done = await a.host.answer(true);
    expect(done?.label).toBe("Ada's iPhone");
    expect(a.linked).toHaveLength(1);
    expect(a.linked[0]?.channels).toEqual(["channel 0", "channel 1", "channel 2"]);

    const chunks = await waitForLinkChunks(relay, code.secret, { timeoutMs: 5_000 });
    const payload = await openLink(code, phone.xsk, phone.xpk, chunks!);
    expect(payload?.person).toEqual(a.person);
    expect(payload?.channels.map((c) => c.label)).toEqual(["channel 0", "channel 1", "channel 2"]);
    expect(payload?.channels[1]).toMatchObject({ pk: a.channels[1]!.pk, sk: a.channels[1]!.sk, code: "mc2-code-1" });
    expect(payload?.relayUrl).toBe(relay);
  });

  test("sends nothing when the person says no, and the phone's wait ends empty", async () => {
    const a = await app();
    const code = readLinkCode((await a.host.begin()).code)!;
    await askToLink(relay, code, (await newLinkKeys()).xpk, "not mine");
    await a.host.poll();
    expect(await a.host.answer(false)).toBeNull();
    expect(a.linked).toEqual([]);
    expect(await waitForLinkChunks(relay, code.secret, { timeoutMs: 300, everyMs: 100 })).toBeNull();
  });

  test("a new begin replaces the last code, and a cancel ends a wait", async () => {
    const a = await app();
    const first = readLinkCode((await a.host.begin()).code)!;
    const second = readLinkCode((await a.host.begin()).code)!;
    expect(second.secret).not.toBe(first.secret);
    const waiting = a.host.poll();
    await a.host.cancel();
    expect(await waiting).toBeNull();
    await expect(a.host.poll()).rejects.toThrow("linking hasn't started");
    await expect(a.host.answer(true)).rejects.toThrow("linking hasn't started");
  });

  test("cannot begin without a person", async () => {
    const host = createLinkHost({
      relayUrl: () => relay,
      person: () => {
        throw new Error("make your person key first");
      },
      channels: () => [],
      linked: () => {},
    });
    await expect(host.begin()).rejects.toThrow("make your person key first");
  });
});
