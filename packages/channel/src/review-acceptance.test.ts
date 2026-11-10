import { beforeAll, describe, expect, test } from "bun:test";

import type { ChannelOps } from "../../../desktop/src/bridge.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { PROTOCOL_VERSION, type Event, type Kind, type Message, type Payload } from "@kiwi/core/protocol.ts";
import { fold, type Roster } from "@kiwi/core/state.ts";
import { ChannelLink } from "./channel-ops.ts";
import { reviewCheckOf } from "@kiwi/core/protocol.ts";
import { headsToRetire, stepsToPost } from "./review-checks.ts";
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
      if (op === "retireReview") posts.push(args[0] as Record<string, unknown>);
      if (op === "send") sent.push({ body: args[0] as string, opts: args[1] as { ev?: Event } });
      return op === "retireReview" ? { url: null } : 99;
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

describe("the owner's app after the gate (#3930 §5)", () => {
  test("case 18: two owner apps seeing the merge each send the observation once, and one step ends", async () => {
    const c = await channel();
    await c.approve();
    await c.github([{ event: "pull_request", action: "closed", number: 9, state: "closed", merged: true, merge: M, branch: `T${c.t}-x`, sha: S, happened: T0 + c.log.length * 1_000 }]);
    const merged = c.state();
    const laptop = ownerApp(`room-${crypto.randomUUID()}`);
    const phone = ownerApp(`room-${crypto.randomUUID()}`);
    for (const app of [laptop, phone]) {
      await postReviewChores(app.link, merged);
      await postReviewChores(app.link, merged);
      expect(app.sent.map((s) => s.opts.ev)).toEqual([{ op: "task.landed", task: c.t, step: "s1", artifact: { kind: "pr", repo: "o/r", pr: 9, sha: S } }]);
      expect(stepsToPost(app.link.roomId, merged)).toEqual([]);
    }
    for (const app of [laptop, phone]) await c.ev("jow", app.sent[0]!.opts.ev!);
    const after = c.state();
    const task = after.tasks.get(c.t)!;
    expect(task.state).toBe("done");
    expect(task.notes.filter((n) => n.text.startsWith("step s1"))).toHaveLength(1);
    expect([...after.rejected.keys()].filter((seq) => seq > merged.head)).toEqual([]);
  });

  test("case 15: every open head is answered green once, a later head again, and only a ruleset read without the requirement stops it", async () => {
    const c = await channel();
    const app = ownerApp(`room-${crypto.randomUUID()}`);
    const check = reviewCheckOf(app.link.roomId);
    const rules = (required: string[]) => c.ev("jow", { op: "github.rules", repo: "o/r", branch: "main", required, merge: ["squash"] });
    const pushed = (sha: string) => c.github([{ event: "pull_request", action: "synchronize", number: 9, state: "open", branch: `T${c.t}-x`, sha }]);
    const echoed = (sha: string) => c.github([{ event: "check_run", sha, name: check, run: 1, status: "completed", conclusion: "success" }]);

    await postReviewChores(app.link, c.state());
    await postReviewChores(app.link, c.state());
    expect(app.posts).toEqual([{ repo: "o/r", sha: S }]);

    await rules(["build", check]);
    await echoed(S);
    await postReviewChores(app.link, c.state());
    expect(app.posts).toHaveLength(1);

    const later = "7".repeat(40);
    await pushed(later);
    await postReviewChores(app.link, c.state());
    expect(app.posts.at(-1)).toEqual({ repo: "o/r", sha: later });
    expect(app.posts).toHaveLength(2);

    await rules(["build"]);
    const gone = "8".repeat(40);
    await pushed(gone);
    expect(headsToRetire(app.link.roomId, c.state())).toEqual([]);
    await postReviewChores(app.link, c.state());
    expect(app.posts).toHaveLength(2);

    await rules(["build", check]);
    await postReviewChores(app.link, c.state());
    expect(app.posts.at(-1)).toEqual({ repo: "o/r", sha: gone });
    expect(app.posts).toHaveLength(3);
  });

  test("a head the relay couldn't be reached for is answered on the next look", async () => {
    const c = await channel();
    const app = ownerApp(`room-${crypto.randomUUID()}`);
    app.reach(false);
    await postReviewChores(app.link, c.state());
    expect(app.posts).toEqual([]);
    app.reach(true);
    await postReviewChores(app.link, c.state());
    expect(app.posts).toEqual([{ repo: "o/r", sha: S }]);
  });

  test("a failure that shows at a head after its green is answered again, once, and a ruleset still requiring the check keeps it so", async () => {
    const c = await channel();
    const app = ownerApp(`room-${crypto.randomUUID()}`);
    const check = reviewCheckOf(app.link.roomId);
    const shown = (run: number, conclusion: string) => c.github([{ event: "check_run", sha: S, name: check, run, status: "completed", conclusion }]);
    await c.ev("jow", { op: "github.rules", repo: "o/r", branch: "main", required: [check], merge: ["squash"] });
    await postReviewChores(app.link, c.state());
    await postReviewChores(app.link, c.state());
    expect(app.posts).toHaveLength(1);
    await shown(1, "success");
    await shown(2, "failure");
    await postReviewChores(app.link, c.state());
    await postReviewChores(app.link, c.state());
    expect(app.posts).toEqual([
      { repo: "o/r", sha: S },
      { repo: "o/r", sha: S },
    ]);
    await shown(3, "success");
    await postReviewChores(app.link, c.state());
    expect(app.posts).toHaveLength(2);
  });

  test("a pull request in a repo the channel doesn't hold is left alone", async () => {
    const c = await channel();
    await c.ev("jow", { op: "repos.set", repos: [] });
    expect(headsToRetire(`room-${crypto.randomUUID()}`, c.state())).toEqual([]);
  });
});
