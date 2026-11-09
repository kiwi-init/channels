import { beforeAll, describe, expect, test } from "bun:test";

import type { ChannelOps } from "../../../desktop/src/bridge.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { PROTOCOL_VERSION, reviewCheckOf, type Event, type Kind, type Message, type Payload } from "@kiwi/core/protocol.ts";
import { postDowngrades, shipGate } from "@kiwi/core/ship-gate.ts";
import { fold, type ChannelState, type Roster } from "@kiwi/core/state.ts";
import { RelayError } from "@kiwi/core/client/relay-errors.ts";
import { ChannelLink } from "./channel-ops.ts";
import { checksToPost } from "./review-checks.ts";
import { postReviewChores } from "./review-chores.ts";

const S = "5".repeat(40);
const T0 = 1_760_000_000_000;
const PAT = { user: "u-pat", name: "Pat" };

describe("a person withdrawing a pass from the app, with the owner's app offline (#623 rule 1)", () => {
  const ids: Record<string, Identity> = {};
  let state: ChannelState;
  let ask = 0;
  let task = 0;

  beforeAll(async () => {
    for (const n of ["jow", "pat", "ann", "mac"]) ids[n] = await generateIdentity(n);
    const roster: Roster = [
      { name: "jow", pk: ids.jow!.pk, owner: true, at: 0, active: true, kind: "human" },
      { name: "pat", pk: ids.pat!.pk, owner: false, at: 1, active: true, kind: "human", sponsor: PAT },
      { name: "ann", pk: ids.ann!.pk, owner: false, at: 2, active: true, kind: "agent", sponsor: PAT },
      { name: "mac", pk: ids.mac!.pk, owner: false, at: 3, active: true, kind: "agent" },
    ];
    const log: Message[] = [];
    const say = async (from: string, kind: Kind, body: string, extra: Partial<Pick<Message, "to" | "ev" | "re" | "esc" | "choices" | "holds" | "check">> = {}): Promise<number> => {
      const seq = log.length + 1;
      const payload: Payload = { v: PROTOCOL_VERSION, id: `s${seq}`, from, kind, body, ts: T0 + seq * 1_000, ...extra };
      const p = await sign(ids[from]!, payload);
      log.push({ ...p, seq, rts: T0 + seq * 1_000, sigOk: await verify(p) });
      return seq;
    };
    const ev = (from: string, e: Event) => say(from, "event", "", { ev: e });
    await ev("jow", { op: "repos.set", repos: ["o/r"] });
    await ev("jow", { op: "branch.prefix.set", prefix: "T" });
    await ev("jow", { op: "landing.set", then: "merge" });
    task = await ev("ann", { op: "task.add", title: "tray", owner: "ann", review: "mac" });
    await ev("jow", { op: "github", items: [{ repo: "o/r", at: T0, event: "pull_request", action: "opened", number: 9, state: "open", branch: `T${task}-x`, sha: S }] } as Event);
    ask = await say("ann", "blocking", "Does it work on KDE?", {
      to: ["pat"],
      esc: true,
      choices: ["A: it works on KDE", "B: it's broken there"],
      holds: [task],
      check: { phase: "pre-ship", decider: "pat", artifact: { kind: "pr", repo: "o/r", pr: 9, sha: S } },
    });
    await say("pat", "msg", "A", { re: [ask] });
    await ev("ann", { op: "task.update", task, state: "review", at: S });
    await ev("mac", { op: "task.update", task, state: "done", verdict: "approved", round: 1, at: S });
    state = fold(log, roster, T0 + 3_600_000);
  });

  const linkFor = (from: string, reach: "up" | "down", fencedSends = 0) => {
    const calls: { op: string; args: unknown[] }[] = [];
    let tickets = 0;
    let fenced = fencedSends;
    const ops = {
      call: async (_code: string, op: string, ...args: unknown[]) => {
        calls.push({ op, args });
        if (op === "postReviewCheck" && reach === "down") throw new TypeError("fetch failed");
        if (op === "postReviewCheck") return { url: null, ticket: `t${++tickets}` };
        if (fenced-- > 0) throw new RelayError(412, "kiwi/review's ticket for this change ran out", "Fenced");
        return 99;
      },
    } as unknown as ChannelOps;
    const link = new ChannelLink("code", "room", ids[from]!.pk, ids.jow!.pk, ops);
    link.beforeSend = (body, opts) => postDowngrades(state, reviewCheckOf(link.roomId), { ...opts, from, body }, (c) => link.postReviewCheck(c));
    return { link, calls };
  };

  test("the gate is open: the approval is at the head and Pat's check passed", () => {
    expect(shipGate(state, state.tasks.get(task)!)).toEqual({ open: true });
  });

  test("with the relay unreachable, Pat's 'B' isn't sent and Pat is told why", async () => {
    const { link, calls } = linkFor("pat", "down");
    await expect(link.send("B", { re: [ask] })).rejects.toThrow(/^kiwi\/review on o\/r@5555555 has to turn waiting before this goes out, .*nothing was sent, try again$/);
    expect(calls.map((c) => c.op)).toEqual(["postReviewCheck"]);
  });

  test("Pat's app alone turns kiwi/review waiting, then sends the answer", async () => {
    const { link, calls } = linkFor("pat", "up");
    expect(await link.send("B", { re: [ask] })).toBe(99);
    expect(calls).toEqual([
      { op: "postReviewCheck", args: [{ repo: "o/r", sha: S, verdict: "waiting", tasks: [task], note: `T${task}: a pre-ship check isn't passed` }] },
      { op: "send", args: ["B", { re: [ask], tickets: ["t1"] }] },
    ]);
  });

  test("a pass, or a 'B' from someone who isn't the check's decider, goes straight out", async () => {
    const pass = linkFor("pat", "down");
    await pass.link.send("A", { re: [ask] });
    expect(pass.calls.map((c) => c.op)).toEqual(["send"]);
    const other = linkFor("ann", "down");
    await other.link.send("B", { re: [ask] });
    expect(other.calls.map((c) => c.op)).toEqual(["send"]);
  });

  test("reopening the approved task for review from the app is held while the relay is down, and posts waiting first when it's up", async () => {
    const reopen = { kind: "event" as const, ev: { op: "task.update" as const, task, state: "review" as const, at: S } };
    const down = linkFor("ann", "down");
    await expect(down.link.send("", reopen)).rejects.toThrow(/has to turn waiting before this goes out, .*nothing was sent/);
    expect(down.calls.map((c) => c.op)).toEqual(["postReviewCheck"]);
    const up = linkFor("ann", "up");
    await up.link.send("", reopen);
    expect(up.calls.map((c) => c.op)).toEqual(["postReviewCheck", "send"]);
    expect(up.calls[0]!.args[0]).toMatchObject({ verdict: "waiting", tasks: [task] });
  });

  test("when the relay says the ticket ran out, the app posts a fresh downgrade and sends again, once", async () => {
    const { link, calls } = linkFor("pat", "up", 1);
    expect(await link.send("B", { re: [ask] })).toBe(99);
    expect(calls.map((c) => [c.op, c.op === "send" ? c.args[1] : undefined])).toEqual([
      ["postReviewCheck", undefined],
      ["send", { re: [ask], tickets: ["t1"] }],
      ["postReviewCheck", undefined],
      ["send", { re: [ask], tickets: ["t2"] }],
    ]);
    const twice = linkFor("pat", "up", 2);
    await expect(twice.link.send("B", { re: [ask] })).rejects.toThrow(/ran out/);
  });

  test("the owner's app keeps a success the fence refused as due, and posts it with the seq it folded", async () => {
    const posts: unknown[] = [];
    let refuse = true;
    const ops = {
      call: async (_code: string, op: string, ...args: unknown[]) => {
        if (op !== "postReviewCheck") return null;
        posts.push(args[0]);
        if (refuse) throw new RelayError(412, "a change at this commit is still on its way", "Fenced");
        return { url: null };
      },
    } as unknown as ChannelOps;
    const room = `room-${crypto.randomUUID()}`;
    const owner = new ChannelLink("code", room, ids.jow!.pk, ids.jow!.pk, ops);
    await postReviewChores(owner, state);
    expect(posts).toEqual([{ repo: "o/r", sha: S, verdict: "approved", tasks: [task], upTo: state.head }]);
    expect(checksToPost(room, state)).toHaveLength(1);
    refuse = false;
    await postReviewChores(owner, state);
    expect(checksToPost(room, state)).toEqual([]);
  });
});
