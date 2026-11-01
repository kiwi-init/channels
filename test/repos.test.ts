import { beforeAll, describe, expect, test } from "bun:test";
import { wants } from "../src/agent.ts";
import { describeEvent, formatStatus, statusJson } from "@kiwi/core/format.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { wellFormed, type Event, type Message } from "@kiwi/core/protocol.ts";
import { fold, outsideRepos, reposOf, type FoldBase, type Roster } from "@kiwi/core/state.ts";

const ids: Record<string, Identity> = {};
let seq = 0;
async function ev(from: string, e: Event): Promise<Message> {
  seq++;
  const base = { v: 1 as const, id: crypto.randomUUID(), from, kind: "event" as const, body: "", ev: e, ts: seq };
  const p = await sign(ids[from]!, base);
  return { ...p, seq, rts: seq, sigOk: await verify(p) };
}

let roster: Roster;
beforeAll(async () => {
  for (const n of ["jon", "mac", "win"]) ids[n] = await generateIdentity(n);
  roster = [
    { name: "jon", pk: ids.jon!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "mac", pk: ids.mac!.pk, owner: false, at: 1, active: true, kind: "agent" },
    { name: "win", pk: ids.win!.pk, owner: false, at: 2, active: true, kind: "agent" },
  ];
});

describe("the channel's repos", () => {
  test("only the owner sets them; an empty list clears them; agents hear it", async () => {
    const forged = await ev("win", { op: "repos.set", repos: ["evil/fork"] });
    const set = await ev("jon", { op: "repos.set", repos: ["ojow/channels", "ojow/site", "OJOW/channels"] });
    let s = fold([forged, set], roster);
    expect(s.rejected.get(forged.seq)).toBe("only the owner, or a person they fully trust, sets the channel's repos");
    expect(s.repos).toEqual(["ojow/channels", "ojow/site"]);
    expect(describeEvent(set)).toBe("set the channel's repos: ojow/channels, ojow/site, OJOW/channels");
    expect(wants("mac", set, s)).toBe(true);
    expect(statusJson({ alias: "c", me: "mac", state: s, online: new Map(), unread: 0 }).repos).toEqual(["ojow/channels", "ojow/site"]);
    s = fold([forged, set, await ev("jon", { op: "repos.set", repos: [] })], roster);
    expect(s.repos).toEqual([]);
  });

  test("an agent whose card names another repo is flagged in status; one in a listed repo, or with no repo, isn't", async () => {
    const msgs = [
      await ev("jon", { op: "repos.set", repos: ["ojow/channels"] }),
      await ev("mac", { op: "card", os: "macos", repo: "Ojow/Channels", branch: "T39" }),
      await ev("win", { op: "card", os: "windows", repo: "someone/else", branch: "main" }),
    ];
    const s = fold(msgs, roster);
    expect(outsideRepos(s, s.members.get("mac")!.card)).toBe(false);
    expect(outsideRepos(s, s.members.get("win")!.card)).toBe(true);
    expect(outsideRepos(s, { os: "linux" })).toBe(false);
    expect(outsideRepos({ repos: [] }, { repo: "someone/else" })).toBe(false);
    const status = formatStatus({ alias: "c", me: "jon", state: s, online: new Map(), unread: 0 });
    expect(status).toContain("repos: ojow/channels");
    expect(status).toContain("someone/else@main · not one of this channel's repos");
    expect(status).not.toContain("Ojow/Channels@T39 · not one");
  });

  test("the signed setting stands in for a repos.set the tail doesn't hold; a later one wins", async () => {
    const tail = [await ev("mac", { op: "card", os: "macos" })];
    const floor = { charter: null, hold: null, repos: { list: ["ojow/channels"], since: tail[0]!.seq - 1 } };
    expect(fold(tail, roster, Date.now(), null, floor).repos).toEqual(["ojow/channels"]);
    expect(fold(tail, roster).repos).toEqual([]);
    const later = await ev("jon", { op: "repos.set", repos: ["ojow/site"] });
    expect(fold([...tail, later], roster, Date.now(), null, floor).repos).toEqual(["ojow/site"]);
  });

  test("a snapshot carries them, and one from before repos folds to none", async () => {
    const kept: { base?: FoldBase } = {};
    const msgs = [await ev("jon", { op: "repos.set", repos: ["ojow/channels"] })];
    fold(msgs, roster, Date.now(), null, null, null, (b) => void (kept.base = b));
    expect(kept.base!.repos).toEqual(["ojow/channels"]);
    expect(fold([], roster, Date.now(), null, null, kept.base).repos).toEqual(["ojow/channels"]);
    const older = { ...kept.base! };
    delete older.repos;
    expect(fold([], roster, Date.now(), null, null, older).repos).toEqual([]);
  });

  test("owner/name only, at most 20", () => {
    const p = { v: 1, id: "x", from: "jon", kind: "event", body: "", ts: 1 };
    expect(wellFormed({ ...p, ev: { op: "repos.set", repos: ["ojow/channels", "a.b/c_d-e"] } })).toBe(true);
    expect(wellFormed({ ...p, ev: { op: "repos.set", repos: ["https://github.com/ojow/channels"] } })).toBe(false);
    expect(wellFormed({ ...p, ev: { op: "repos.set", repos: ["channels"] } })).toBe(false);
    expect(wellFormed({ ...p, ev: { op: "repos.set", repos: Array.from({ length: 21 }, (_, i) => `o/r${i}`) } })).toBe(false);
    expect(reposOf([" ojow/channels ", 3, "bad", "ojow/CHANNELS"])).toEqual(["ojow/channels"]);
  });
});
