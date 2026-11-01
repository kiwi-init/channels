import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newChannelKey } from "@kiwi/core/crypto.ts";
import { mergeMarks, NOTE_MAX_BYTES, NOTES_PER_KEY, noteId, openNote, sealNote, type Marks } from "@kiwi/core/note.ts";
import { startRelay } from "../src/relay/bun.ts";
import { runAgent } from "../src/agent.ts";
import { joinAgent, pairComputer, setupChannel, type OwnerSetup } from "./owner.ts";
import type { Channel } from "@kiwi/core/client.ts";
import type { Identity } from "@kiwi/core/identity.ts";

setDefaultTimeout(60_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-notes-"));
let server: ReturnType<typeof startRelay>;
let s: OwnerSetup;
let ana: { id: Identity; ch: Channel };

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  s = await setupChannel(server.url.origin);
  ana = await joinAgent(s, "ana", await pairComputer(s.person));
});

afterAll(() => {
  server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

const refusal = (p: Promise<unknown>) =>
  p.then(
    () => "written",
    (e: unknown) => (e instanceof Error ? e.message : String(e)),
  );

async function writeMerged(ch: Channel, who: Identity, key: string, id: string, mine: Marks): Promise<number> {
  for (;;) {
    const had = await runAgent(ch.fx.getNote(id));
    const theirs = had ? ((await openNote(key, s.roomId, id, had.box))?.marks ?? {}) : {};
    const box = await sealNote(key, s.roomId, id, who, mergeMarks(theirs, mine));
    const put = await runAgent(ch.fx.putNote(id, box, had?.version ?? null));
    if (!put.conflict) return put.version;
  }
}

describe("a person's note at the relay: one sealed slot, written with the version it read (T976)", () => {
  test("a write takes the version it read; a stale one gets the current note back instead of overwriting it", async () => {
    const key = newChannelKey();
    const id = await noteId(s.roomId, key);
    expect(await runAgent(s.ownerCh.fx.getNote(id))).toBeNull();
    const first = await runAgent(s.ownerCh.fx.putNote(id, await sealNote(key, s.roomId, id, s.owner, { main: 4 }), null));
    expect(first).toEqual({ conflict: false, version: 1 });
    const stale = await runAgent(ana.ch.fx.putNote(id, await sealNote(key, s.roomId, id, ana.id, { main: 2 }), null));
    expect(stale.conflict).toBe(true);
    const got = await runAgent(ana.ch.fx.getNote(id));
    expect((await openNote(key, s.roomId, id, got!.box))?.marks).toEqual({ main: 4 });
    expect(JSON.stringify(got)).not.toContain("main");
  });

  test("two writers at once both keep their marks: the loser merges and writes again", async () => {
    const key = newChannelKey();
    const id = await noteId(s.roomId, key);
    await Promise.all([writeMerged(s.ownerCh, s.owner, key, id, { main: 10, "task:3": 2 }), writeMerged(ana.ch, ana.id, key, id, { main: 7, "dm:ana~owner": 5 })]);
    const got = await runAgent(ana.ch.fx.getNote(id));
    expect((await openNote(key, s.roomId, id, got!.box))?.marks).toEqual({ main: 10, "task:3": 2, "dm:ana~owner": 5 });
  });

  test("a member's key keeps a few notes at most, and a note has a size cap", async () => {
    const bo = await joinAgent(s, "bo", await pairComputer(s.person));
    const key = newChannelKey();
    for (let i = 0; i < NOTES_PER_KEY; i++) {
      const id = await noteId(s.roomId, newChannelKey());
      expect(await runAgent(bo.ch.fx.putNote(id, await sealNote(key, s.roomId, id, bo.id, {}), null))).toEqual({ conflict: false, version: 1 });
    }
    const extra = await noteId(s.roomId, newChannelKey());
    expect(await refusal(runAgent(bo.ch.fx.putNote(extra, await sealNote(key, s.roomId, extra, bo.id, {}), null)))).toContain(`at most ${NOTES_PER_KEY} notes`);
    expect(await refusal(runAgent(s.ownerCh.fx.putNote(extra, "x".repeat(NOTE_MAX_BYTES + 1), null)))).toContain("a note is at most");
  });
});
