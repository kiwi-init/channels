import { beforeAll, describe, expect, test } from "bun:test";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import type { Event, Kind, Message } from "@kiwi/core/protocol.ts";
import { fold, type Roster } from "@kiwi/core/state.ts";
import { prsIn, taskFeed, taskPrs } from "@kiwi/core/work.ts";

const ids: Record<string, Identity> = {};
let seq = 0;
async function msg(from: string, kind: Kind, body: string, ev?: Event): Promise<Message> {
  seq++;
  const p = await sign(ids[from]!, { v: 1 as const, id: crypto.randomUUID(), from, kind, body, ts: seq, ...(ev ? { ev } : {}) });
  return { ...p, seq, rts: seq, sigOk: await verify(p) };
}

let roster: Roster;
beforeAll(async () => {
  for (const n of ["jon", "mac"]) ids[n] = await generateIdentity(n);
  roster = [
    { name: "jon", pk: ids.jon!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "mac", pk: ids.mac!.pk, owner: false, at: 1, active: true, kind: "agent" },
  ];
});

const url = "https://github.com/ojow/channels/pull/9";
const sha = "f".repeat(40);

describe("a PR's card says what GitHub said, not what the chat guessed", () => {
  test("GitHub's state, title and checks win over 'closed' in a message; without GitHub's word the guess stays", async () => {
    const add = await msg("jon", "event", "", { op: "task.add", title: "Cards", owner: "mac" });
    const t = add.seq;
    const linked = await msg("mac", "event", "", { op: "task.update", task: t, state: "doing", note: `PR ${url}` });
    const guess = await msg("mac", "msg", `T${t}: closed ${url} by mistake, reopening`);
    expect(prsIn(fold([add, linked, guess], roster), [add, linked, guess], () => true)[0]).toMatchObject({ number: 9, state: "closed" });
    const news = await msg("jon", "event", "", {
      op: "github",
      items: [
        { event: "pull_request", repo: "ojow/channels", action: "reopened", number: 9, title: "PR cards", state: "open", merged: false, branch: "T43", sha, at: 1 },
        { event: "check_run", repo: "ojow/channels", action: "completed", name: "ci-ok", conclusion: "failure", sha, at: 2 },
        { event: "check_run", repo: "ojow/channels", action: "completed", name: "unit", conclusion: "success", sha, at: 3 },
      ],
    });
    const log = [add, linked, guess, news];
    const s = fold(log, roster);
    expect(taskPrs(taskFeed(s, log, t))).toMatchObject([{ number: 9, state: "open", title: "PR cards", checks: { passed: 1, failed: ["ci-ok"], running: 0 } }]);
  });
});
