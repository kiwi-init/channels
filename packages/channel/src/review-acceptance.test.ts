import { beforeAll, describe, expect, test } from "bun:test";

import type { ChannelOps } from "../../../desktop/src/bridge.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { PROTOCOL_VERSION, type Event, type Kind, type Message, type Payload } from "@kiwi/core/protocol.ts";
import { fold, type Roster } from "@kiwi/core/state.ts";
import { ChannelLink } from "./channel-ops.ts";
import { checksToPost, landsToPost } from "./review-checks.ts";
import { postReviewChores } from "./review-chores.ts";

const S = "6".repeat(40);
const M = "9".repeat(40);
const T0 = 1_760_000_000_000;

const ids: Record<string, Identity> = {};
let roster: Roster;
beforeAll(async () => {
  for (const n of ["jow", "ann", "mac"]) ids[n] = await generateIdentity(n);
  roster = [
    { name: "jow", pk: ids.jow!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "ann", pk: ids.ann!.pk, owner: false, at: 1, active: true, kind: "agent" },
    { name: "mac", pk: ids.mac!.pk, owner: false, at: 2, active: true, kind: "agent" },
  ];
});

async function channel() {
  const log: Message[] = [];
  const say = async (from: string, kind: Kind, body: string, extra: Partial<Pick<Message, "to" | "ev" | "re" | "esc" | "choices" | "holds" | "check">> = {}): Promise<Message> => {
    const seq = log.length + 1;
    const payload: Payload = { v: PROTOCOL_VERSION, id: `s${seq}`, from, kind, body, ts: T0 + seq * 1_000, ...extra };
    const p = await sign(ids[from]!, payload);
    const m = { ...p, seq, rts: T0 + seq * 1_000, sigOk: await verify(p) };
    log.push(m);
    return m;
  };
  const ev = (from: string, e: Event) => say(from, "event", "", { ev: e });
  const github = (items: Record<string, unknown>[]) => ev("jow", { op: "github", items: items.map((i) => ({ repo: "o/r", at: T0 + log.length * 1_000, ...i })) } as Event);
  await ev("jow", { op: "repos.set", repos: ["o/r"] });
  await ev("jow", { op: "branch.prefix.set", prefix: "T" });
  await ev("jow", { op: "landing.set", then: "merge" });
  const t = (await ev("ann", { op: "task.add", title: "tray", owner: "ann", review: "mac" })).seq;
  await github([{ event: "pull_request", action: "opened", number: 9, state: "open", branch: `T${t}-x`, sha: S }]);
  const approve = async (runs?: number[]) => {
    await ev("ann", { op: "task.update", task: t, state: "review", at: S });
    await ev("mac", { op: "task.update", task: t, state: "done", verdict: "approved", round: 1, at: S, ...(runs ? { runs } : {}) });
  };
  const state = () => fold(log, roster, T0 + 3_600_000);
  return { log, say, ev, github, t, approve, state };
}

function ownerApp(room: string) {
  const posts: Record<string, unknown>[] = [];
  const sent: { body: string; opts: { ev?: Event } }[] = [];
  let up = true;
  const ops = {
    call: async (_code: string, op: string, ...args: unknown[]) => {
      if (!up) throw new TypeError("fetch failed");
      if (op === "postReviewCheck") posts.push(args[0] as Record<string, unknown>);
      if (op === "send") sent.push({ body: args[0] as string, opts: args[1] as { ev?: Event } });
      return op === "postReviewCheck" ? { url: null } : 99;
    },
  } as unknown as ChannelOps;
  const link = new ChannelLink("code", room, ids.jow!.pk, ids.jow!.pk, ops);
  return {
    link,
    posts,
    sent,
    reach: (to: boolean) => {
      up = to;
    },
  };
}

describe("#623 acceptance cases on the owner's app (T3348)", () => {
  test("case 4: a check answered while the owner's app was down is reconciled when it's back", async () => {
    const c = await channel();
    const kde = await c.say("ann", "blocking", "Does it work on KDE?", {
      to: ["jow"],
      esc: true,
      choices: ["A: it works on KDE", "B: it's broken there"],
      holds: [c.t],
      check: { phase: "pre-ship", decider: "jow", artifact: { kind: "pr", repo: "o/r", pr: 9, sha: S } },
    });
    await c.approve();
    const room = `room-${crypto.randomUUID()}`;
    const app = ownerApp(room);
    await postReviewChores(app.link, c.state());
    expect(app.posts).toMatchObject([{ verdict: "waiting", tasks: [c.t] }]);
    app.reach(false);
    await c.say("jow", "msg", "A", { re: [kde.seq] });
    await postReviewChores(app.link, c.state());
    expect(app.posts).toHaveLength(1);
    expect(checksToPost(room, c.state())).toMatchObject([{ verdict: "approved", tasks: [c.t] }]);
    app.reach(true);
    await postReviewChores(app.link, c.state());
    expect(app.posts.at(-1)).toEqual({ repo: "o/r", sha: S, verdict: "approved", tasks: [c.t], upTo: c.state().head });
    expect(checksToPost(room, c.state())).toEqual([]);
  });

  test("case 13: a PASS posted while CI is pending turns kiwi/review green on the CI completion alone", async () => {
    const c = await channel();
    await c.github([{ event: "check_run", sha: S, name: "build", run: 11, status: "in_progress" }]);
    await c.approve([11]);
    const app = ownerApp(`room-${crypto.randomUUID()}`);
    await postReviewChores(app.link, c.state());
    expect(app.posts).toMatchObject([{ verdict: "waiting", note: `T${c.t}: CI run 11 (pending)` }]);
    await c.github([{ event: "check_run", sha: S, name: "build", run: 11, status: "completed", conclusion: "success" }]);
    await postReviewChores(app.link, c.state());
    expect(app.posts.at(-1)).toMatchObject({ verdict: "approved", tasks: [c.t] });
  });

  test("case 10: two owner apps detecting the merge each send task.landed once, and the channel records one landing", async () => {
    const c = await channel();
    await c.approve();
    await c.github([{ event: "pull_request", action: "closed", number: 9, state: "closed", merged: true, merge: M, branch: `T${c.t}-x`, sha: S, happened: T0 + c.log.length * 1_000 }]);
    const merged = c.state();
    const laptop = ownerApp(`room-${crypto.randomUUID()}`);
    const phone = ownerApp(`room-${crypto.randomUUID()}`);
    for (const app of [laptop, phone]) {
      await postReviewChores(app.link, merged);
      await postReviewChores(app.link, merged);
      expect(app.sent.map((s) => s.opts.ev?.op)).toEqual(["task.landed"]);
      expect(landsToPost(app.link.roomId, merged)).toEqual([]);
    }
    for (const app of [laptop, phone]) await c.ev("jow", app.sent[0]!.opts.ev!);
    const after = c.state();
    const task = after.tasks.get(c.t)!;
    expect(task.state).toBe("done");
    expect(task.landed).toMatchObject({ key: `T${c.t}:pr:o/r#9@${S}`, by: "jow" });
    expect(task.notes.filter((n) => n.text.startsWith("landed:"))).toHaveLength(1);
    expect([...after.rejected.keys()].filter((seq) => seq > merged.head)).toEqual([]);
  });
});
