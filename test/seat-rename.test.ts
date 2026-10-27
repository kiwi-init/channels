import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import { generateIdentity, type Identity } from "@kiwi/core/identity.ts";
import { aliasesOf, fold, renamedMessage, rosterOf, type FoldBase } from "@kiwi/core/state.ts";
import { startRelay } from "../src/relay/bun.ts";
import { readCursor, writeCursor } from "../src/config/cursors.ts";
import { loadConfig, updateConfig } from "../src/config/file.ts";
import { identitiesIn, saveIdentity } from "../src/config/identities.ts";
import { renameMember } from "../src/config/wipe.ts";
import { checked } from "./check.ts";

setDefaultTimeout(60_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-seat-rename-"));
let server: ReturnType<typeof startRelay>;
let relay: string;
beforeAll(() => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  relay = server.url.origin;
});
afterAll(() => {
  server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

async function team() {
  const owner = await generateIdentity("human");
  const made = await Channel.create(relay, owner, { name: "human", kind: "human" }, []);
  const ownerCh = new Channel(made.access, relay, owner);
  const asks: { id: Identity; requestId: string }[] = [];
  for (const handle of ["patient-otter", "honest-wren"]) {
    const id = await generateIdentity(handle);
    asks.push({ id, requestId: (await Channel.requestJoin(relay, made.code, id, { name: handle })).requestId });
  }
  for (const r of await checked(ownerCh, relay, made.code, asks)) await ownerCh.approve(r);
  const [otter, wren] = asks.map((a) => a.id) as [Identity, Identity];
  const seat = async (id: Identity) => new Channel(await Channel.resume(relay, made.code, id), relay, id);
  return { code: made.code, ownerCh, otter, wren, seat, otterCh: await seat(otter), wrenCh: await seat(wren) };
}

describe("seat rename", () => {
  test("a renamed seat keeps its task, its review and its history, under the new handle", async () => {
    const { ownerCh, otter, wren, seat, otterCh, wrenCh } = await team();
    const id = await otterCh.send("task: the gate", { kind: "event", ev: { op: "task.add", title: "the gate change", owner: "patient-otter", review: "honest-wren" } });
    const asked = await wrenCh.send("@patient-otter how is the gate going?", { kind: "ask", to: ["patient-otter"] });
    await otterCh.send("in review", { kind: "event", ev: { op: "task.update", task: id, state: "review" } });
    const before = await ownerCh.history(0);
    const kept: { base?: FoldBase } = {};
    fold(before.messages, rosterOf(await ownerCh.members()), Date.now(), undefined, undefined, null, (b) => void (kept.base = b));

    const members = await ownerCh.members();
    await ownerCh.updateHandle(
      members.find((m) => m.pk === otter.pk)!,
      "opus-vm-coder",
    );
    await ownerCh.updateHandle(
      (await ownerCh.members()).find((m) => m.pk === wren.pk)!,
      "opus-local-coder",
    );
    const roster = rosterOf(await ownerCh.members());
    expect(roster.find((r) => r.pk === otter.pk)).toMatchObject({ name: "opus-vm-coder", was: ["patient-otter"] });

    await wrenCh.send("approved", { kind: "event", ev: { op: "task.update", task: id, state: "done", verdict: "approved", round: 1 } });
    const adopted = await seat({ ...otter, name: "opus-vm-coder" });
    const said = await adopted.send("answering as my nickname now", { to: ["opus-local-coder"] });

    const { messages } = await ownerCh.history(0);
    const state = fold(messages, roster);
    for (const m of messages) expect(state.trust.get(m.seq)).toBe("verified");
    expect(state.members.has("patient-otter")).toBe(false);
    expect(state.members.has("honest-wren")).toBe(false);
    expect(state.members.get("opus-vm-coder")?.pk).toBe(otter.pk);
    const task = state.tasks.get(id)!;
    expect(task).toMatchObject({ owner: "opus-vm-coder", review: "opus-local-coder", state: "done", approvedBy: "opus-local-coder", createdBy: "opus-vm-coder" });
    expect(task.workedBy).toEqual(["opus-vm-coder"]);

    const aliases = aliasesOf(roster);
    const question = renamedMessage(
      aliases,
      messages.find((m) => m.seq === asked)!,
    );
    expect(question).toMatchObject({ from: "opus-local-coder", to: ["opus-vm-coder"] });
    expect(messages.find((m) => m.seq === said)!.from).toBe("opus-vm-coder");
    expect(state.threadPeople.get(asked)).toEqual(new Set(["opus-local-coder", "opus-vm-coder"]));

    const resumed = fold(messages, roster, Date.now(), undefined, undefined, kept.base);
    expect(resumed.tasks.get(id)).toEqual(task);
    expect([...resumed.members.keys()].sort()).toEqual([...state.members.keys()].sort());
    expect(resumed.members.get("opus-vm-coder")?.messages).toBe(state.members.get("opus-vm-coder")?.messages);
    expect(resumed.threadPeople).toEqual(state.threadPeople);
  });

  test("only the owner renames a seat, and never to a name someone else has or had", async () => {
    const { ownerCh, otter, wren, otterCh } = await team();
    const mine = (await otterCh.members()).find((m) => m.pk === otter.pk)!;
    await expect(otterCh.updateHandle(mine, "opus-vm-coder")).rejects.toThrow(/only the channel owner/);
    expect((await ownerCh.members()).find((m) => m.pk === otter.pk)!.name).toBe("patient-otter");

    const members = await ownerCh.members();
    await expect(
      ownerCh.updateHandle(
        members.find((m) => m.pk === otter.pk)!,
        "honest-wren",
      ),
    ).rejects.toThrow(/someone else's name/);
    await expect(
      ownerCh.updateHandle(
        members.find((m) => m.pk === otter.pk)!,
        "owner",
      ),
    ).rejects.toThrow(/reserved/);
    await expect(
      ownerCh.updateHandle(
        members.find((m) => m.owner)!,
        "boss",
      ),
    ).rejects.toThrow(/only an agent's handle/);
    await ownerCh.updateHandle(
      members.find((m) => m.pk === otter.pk)!,
      "opus-vm-coder",
    );
    await expect(
      ownerCh.updateHandle(
        (await ownerCh.members()).find((m) => m.pk === wren.pk)!,
        "patient-otter",
      ),
    ).rejects.toThrow(/someone else's name/);

    await ownerCh.updateHandle(
      (await ownerCh.members()).find((m) => m.pk === otter.pk)!,
      "patient-otter",
    );
    expect((await ownerCh.members()).find((m) => m.pk === otter.pk)).toMatchObject({ name: "patient-otter", was: ["opus-vm-coder"] });
  });
});

describe("this computer's seat", () => {
  test("once the owner renamed it, the seat's key, cursor, folder and wake setting move to the new handle", async () => {
    const prev = process.env.KIWI_HOME;
    const home = mkdtempSync(join(tmpdir(), "kiwi-seat-rename-home-"));
    process.env.KIWI_HOME = home;
    try {
      const { code, otter } = await team();
      const access = await Channel.resume(relay, code, otter);
      updateConfig((c) => {
        c.channels.team = { ...access, relay, code, as: "patient-otter" };
        c.bindings = { "/work/gate": { alias: "team", as: "patient-otter", harness: "claude" }, "/work/other": [{ alias: "team", as: "someone-else" }] };
        c.wakeOff = ["team/patient-otter"];
      });
      saveIdentity(otter, access.roomId);
      writeCursor("team", "patient-otter", 41);
      renameMember("team", otter, "opus-vm-coder");
      expect(identitiesIn(access.roomId)).toEqual(["opus-vm-coder"]);
      expect(readCursor("team", "opus-vm-coder")).toBe(41);
      expect(readCursor("team", "patient-otter")).toBeNull();
      const cfg = loadConfig();
      expect(cfg.channels.team?.as).toBe("opus-vm-coder");
      expect(cfg.bindings).toEqual({ "/work/gate": { alias: "team", as: "opus-vm-coder", harness: "claude" }, "/work/other": [{ alias: "team", as: "someone-else" }] });
      expect(cfg.wakeOff).toEqual(["team/opus-vm-coder"]);
    } finally {
      if (prev === undefined) delete process.env.KIWI_HOME;
      else process.env.KIWI_HOME = prev;
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("aliases", () => {
  const seat = (name: string, pk: string, was?: string[]) => ({ name, pk, ...(was ? { was } : {}) });

  test("an earlier name reads as the current one", () => {
    expect([...aliasesOf([seat("c", "k1", ["a", "b"]), seat("d", "k2")])]).toEqual([
      ["a", "c"],
      ["b", "c"],
    ]);
  });

  test("an earlier name two seats claim, or one somebody holds now, stays as written", () => {
    expect(aliasesOf([seat("c", "k1", ["a"]), seat("d", "k2", ["a"])]).size).toBe(0);
    expect(aliasesOf([seat("c", "k1", ["d"]), seat("D", "k2")]).size).toBe(0);
  });
});
