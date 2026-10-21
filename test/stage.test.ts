import { describe, expect, test } from "bun:test";
import { formatTask, formatTasks } from "@kiwi/core/format.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { PROTOCOL_VERSION, type Event, type Kind, type Message, type Payload } from "@kiwi/core/protocol.ts";
import { stageOf, stageText } from "@kiwi/core/stage.ts";
import { fold, type ChannelState, type Roster } from "@kiwi/core/state.ts";

const T0 = 1_760_000_000_000;
const R = "o/r";

async function setup() {
  const ids: Record<string, Identity> = { jow: await generateIdentity("jow"), ann: await generateIdentity("ann") };
  const roster: Roster = [
    { name: "jow", pk: ids.jow!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "ann", pk: ids.ann!.pk, owner: false, at: 0, active: true, kind: "agent", scopes: ["post", "tasks", "facts"] },
  ];
  const log: Message[] = [];
  const say = async (from: string, kind: Kind, body: string, ev?: Event, re?: number[]): Promise<number> => {
    const seq = log.length + 1;
    const payload: Payload = { v: PROTOCOL_VERSION, id: `s${seq}`, from, kind, body, ts: T0 + seq * 1_000, ...(ev ? { ev } : {}), ...(re ? { re } : {}) };
    const p = await sign(ids[from]!, payload);
    log.push({ ...p, seq, rts: T0 + seq * 1_000, sigOk: await verify(p) });
    return seq;
  };
  const github = (items: Record<string, unknown>[]) => say("jow", "event", "GitHub", { op: "github", items: items.map((i) => ({ repo: R, at: T0 + log.length * 1_000, ...i })) } as Event);
  const state = (): ChannelState => fold(log, roster, T0 + 3_600_000);
  const stage = (id: number): string => {
    const s = state();
    return stageText(s, stageOf(s, s.tasks.get(id)!));
  };
  return { log, say, github, state, stage };
}

describe("a task's stage is read off the signed log, never typed", () => {
  test("open, building, proving, red, proving again after a push, review owed, declared done, then done once GitHub says merged", async () => {
    const { say, github, stage, state } = await setup();
    await say("jow", "event", "set the branch prefix", { op: "branch.prefix.set", prefix: "T" });
    const ask = await say("jow", "msg", "ship the docs today");
    const loose = await say("ann", "event", "added a task", { op: "task.add", title: "Someday" }, [ask]);
    expect(stage(loose)).toBe("open");
    const t = await say("ann", "event", "added a task", { op: "task.add", title: "Write the docs", owner: "ann", review: "jow" }, [ask]);
    expect(stage(t)).toBe("building");
    await github([{ event: "pull_request", action: "opened", number: 9, state: "open", branch: `T${t}-docs`, sha: "s1" }]);
    expect(stage(t)).toBe("proving: #9 no checks yet");
    await github([{ event: "check_run", action: "created", name: "ci", status: "queued", sha: "s1", run: 1 }]);
    expect(stage(t)).toBe("proving: #9 1 check running");
    await github([{ event: "check_run", action: "completed", name: "ci", status: "completed", conclusion: "failure", sha: "s1", run: 1 }]);
    expect(stage(t)).toBe("red: #9 failed ci");
    await github([{ event: "push", branch: `T${t}-docs`, sha: "s2" }]);
    expect(stage(t)).toBe("proving: #9 no checks yet");
    await github([{ event: "check_run", action: "completed", name: "ci", status: "completed", conclusion: "success", sha: "s2", run: 2 }]);
    expect(stage(t)).toBe("proving: #9 checks green, not merged");
    await say("ann", "event", "sent for review", { op: "task.update", task: t, state: "review", at: "s2" });
    expect(stage(t)).toBe("review owed by jow (#9)");
    await say("jow", "event", "approved", { op: "task.update", task: t, state: "done", verdict: "approved", round: 1 });
    expect(stage(t)).toBe("done, declared (#9 not merged)");
    await github([{ event: "pull_request", action: "closed", number: 9, state: "closed", merged: true }]);
    expect(stage(t)).toBe("done: #9 merged");
    expect(state().tasks.get(t)!.state).toBe("done");
  });

  test("GitHub's merge proves a task done even before anyone marks it, but not over a failed check; a cancelled task is dropped", async () => {
    const { say, github, stage } = await setup();
    await say("jow", "event", "set the branch prefix", { op: "branch.prefix.set", prefix: "T" });
    const a = await say("ann", "event", "added", { op: "task.add", title: "A", owner: "ann" });
    await github([{ event: "pull_request", action: "opened", number: 3, state: "open", branch: `T${a}-a`, sha: "x1" }]);
    await github([{ event: "check_run", action: "completed", name: "ci", status: "completed", conclusion: "success", sha: "x1", run: 7 }]);
    await github([{ event: "pull_request", action: "closed", number: 3, state: "closed", merged: true }]);
    expect(stage(a)).toBe("done: #3 merged");
    const b = await say("ann", "event", "added", { op: "task.add", title: "B", owner: "ann" });
    await github([{ event: "pull_request", action: "opened", number: 4, state: "open", branch: `T${b}-b`, sha: "y1" }]);
    await github([{ event: "check_run", action: "completed", name: "ci", status: "completed", conclusion: "failure", sha: "y1", run: 8 }]);
    await github([{ event: "pull_request", action: "closed", number: 4, state: "closed", merged: true }]);
    expect(stage(b)).toBe("building (#4)");
    await say("ann", "event", "done", { op: "task.update", task: b, state: "done" });
    expect(stage(b)).toBe("done, declared (#4 merged with a failed check)");
    const c = await say("ann", "event", "added", { op: "task.add", title: "C", owner: "ann" });
    await say("ann", "event", "done", { op: "task.update", task: c, state: "done" });
    expect(stage(c)).toBe("done, declared (no merged PR)");
    const d = await say("ann", "event", "added", { op: "task.add", title: "D", owner: "ann" });
    await say("ann", "event", "cancelled", { op: "task.update", task: d, state: "cancelled" });
    expect(stage(d)).toBe("dropped");
  });

  test("without a branch prefix a PR links through the task's proof, and a person reviewing anyone's round reads as such", async () => {
    const { say, github, stage } = await setup();
    const t = await say("ann", "event", "added", { op: "task.add", title: "Linked by proof", owner: "ann", review: "*" });
    await github([{ event: "pull_request", action: "opened", number: 12, state: "open", branch: `T${t}-p`, sha: "z1" }]);
    expect(stage(t)).toBe("building");
    await say("ann", "event", "proof", { op: "task.update", task: t, proof: { url: `https://github.com/${R}/pull/12`, label: "PR" } });
    expect(stage(t)).toBe("proving: #12 no checks yet");
    await say("ann", "event", "review", { op: "task.update", task: t, state: "review" });
    expect(stage(t)).toBe("review owed by anyone who hasn't worked on it (#12)");
  });

  test("task show and the board say each task's stage next to its declared state", async () => {
    const { say, github, state } = await setup();
    await say("jow", "event", "set the branch prefix", { op: "branch.prefix.set", prefix: "T" });
    const t = await say("ann", "event", "added", { op: "task.add", title: "Shown", owner: "ann" });
    await github([{ event: "pull_request", action: "opened", number: 5, state: "open", branch: `T${t}-s`, sha: "q1" }]);
    const s = state();
    expect(formatTask(s, s.tasks.get(t)!, T0 + 3_600_000)).toContain("  stage: proving: #5 no checks yet");
    expect(formatTasks(s)).toContain("Shown · proving: #5 no checks yet");
  });
});
