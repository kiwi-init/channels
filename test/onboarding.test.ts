// Getting agents in without busywork: an owner lets in agents from their own trusted computers with no
// code to compare, because the computer's signature on the agent's key, sealed to the owner, is that
// proof and the relay can't forge it. `kiwi demo` shows a whole session on a throwaway local relay.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "../src/client.ts";
import { generateIdentity, signText } from "../src/identity.ts";
import { autoAdmissible, type JoinRequest } from "../src/membership.ts";
import { startRelay } from "../src/relay/bun.ts";
import { vouchStatement } from "../src/vouch.ts";
import { runDemo } from "../src/demo.ts";

describe("a computer's vouch, checked by the owner", () => {
  test("a good signature names the computer; a forged or misdirected one names nobody", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "kiwi-vouch-relay-"));
    const server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
    const relay = server.url.origin;
    try {
      const owner = await generateIdentity("human");
      const made = await Channel.create(relay, owner, { name: "human" });
      const ownerCh = new Channel(made.access, relay, owner);
      const roomId = made.access.roomId;
      const machine = await generateIdentity("machine");
      const stranger = await generateIdentity("machine");

      const good = await generateIdentity("mac");
      await Channel.requestJoin(relay, made.code, good, { name: "mac" }, null, { pk: machine.pk, sig: await signText(machine, vouchStatement(roomId, good.pk)) });
      // Signed by the computer, but for another key: can't be moved onto this request.
      const moved = await generateIdentity("win");
      await Channel.requestJoin(relay, made.code, moved, { name: "win" }, null, { pk: machine.pk, sig: await signText(machine, vouchStatement(roomId, good.pk)) });
      // Claims the trusted computer but was signed by another key.
      const forged = await generateIdentity("ci");
      await Channel.requestJoin(relay, made.code, forged, { name: "ci" }, null, { pk: machine.pk, sig: await signText(stranger, vouchStatement(roomId, forged.pk)) });
      const plain = await generateIdentity("bot");
      await Channel.requestJoin(relay, made.code, plain, { name: "bot" });

      const reqs = await ownerCh.requests();
      const by = (name: string) => reqs.find((r) => r.name === name)!;
      expect(by("mac").vouchedBy).toBe(machine.pk);
      expect(by("win").vouchedBy).toBeUndefined();
      expect(by("ci").vouchedBy).toBeUndefined();
      expect(by("bot").vouchedBy).toBeUndefined();

      const trusted = new Set([machine.pk]);
      expect(autoAdmissible(by("mac"), trusted)).toBe(true);
      expect(autoAdmissible(by("mac"), new Set())).toBe(false);
      for (const n of ["win", "ci", "bot"]) expect(autoAdmissible(by(n), trusted)).toBe(false);

      // Let in the way the dashboard does it: sign this side's half, the agent reveals, approve.
      const r = by("mac");
      await ownerCh.checkRequest(r);
      const ask = (await ownerCh.requests()).find((x) => x.pk === good.pk)!;
      await Channel.joinStatus(relay, made.code, good, ask.id);
      const ready = (await ownerCh.requests()).find((x) => x.pk === good.pk)!;
      expect(ready.check).toBe("ready");
      await ownerCh.approve(ready);
      expect((await Channel.joinStatus(relay, made.code, good, ask.id)).status).toBe("approved");
    } finally {
      server.stop(true);
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("never a person, and never a RECLAIM of someone's seat", () => {
    const base = { id: "r", pk: "k", xpk: "x", code: "123-456", check: "ready", commit: "c", ts: 0, sponsoredBy: null, name: "mac", kind: "agent", vouchedBy: "m" } as JoinRequest;
    const t = new Set(["m"]);
    expect(autoAdmissible(base, t)).toBe(true);
    expect(autoAdmissible({ ...base, kind: "human" }, t)).toBe(false);
    expect(autoAdmissible({ ...base, reclaims: { name: "mac", pk: "old" } as JoinRequest["reclaims"] }, t)).toBe(false);
    expect(autoAdmissible({ ...base, reclaim: true }, t)).toBe(false);
  });
});

describe("kiwi demo", () => {
  test("plays a whole session on its own relay, and leaves nothing behind", async () => {
    const lines: string[] = [];
    const home = process.env.KIWI_HOME;
    await runDemo({ pace: 0, print: (l) => lines.push(l) });
    const all = lines.join("\n");
    expect(all).toContain("set the charter");
    expect(all).toContain("described itself: windows x64");
    expect(all).toContain("fits: win (free)");
    expect(all).toContain("needs review by someone who hasn't worked on it");
    expect(all).toContain("approved T");
    expect(all).toContain("handed T");
    expect(all).toContain("[escalation]");
    expect(all).toContain("ON HOLD");
    expect(all).toContain("lifted the hold");
    expect(process.env.KIWI_HOME).toBe(home);
  }, 60_000);
});
