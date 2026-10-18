import { beforeAll, describe, expect, test } from "bun:test";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { formatTask } from "@kiwi/core/format.ts";
import { wellFormedEvent, type Event, type GithubNote, type Message } from "@kiwi/core/protocol.ts";
import { fold, type FoldBase, type Roster } from "@kiwi/core/state.ts";
import { issuesToClose, parseIssueRef, taskOfIssue, tasksClosedOnGithub } from "@kiwi/core/work.ts";
import { githubItem } from "../src/relay/github.ts";

const ids: Record<string, Identity> = {};
let seq = 0;
async function ev(from: string, e: Event): Promise<Message> {
  seq++;
  const p = await sign(ids[from]!, { v: 1 as const, id: crypto.randomUUID(), from, kind: "event" as const, body: "", ts: seq, ev: e });
  return { ...p, seq, rts: seq, sigOk: await verify(p) };
}

const issueNews = (number: number, state: "open" | "closed", more: Partial<GithubNote> = {}): Event => ({
  op: "github",
  items: [{ event: "issues", repo: "ojow/channels", action: state === "closed" ? "closed" : "reopened", number, state, at: seq + 1, ...more }],
});

let roster: Roster;
beforeAll(async () => {
  for (const n of ["jon", "mac"]) ids[n] = await generateIdentity(n);
  roster = [
    { name: "jon", pk: ids.jon!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "mac", pk: ids.mac!.pk, owner: false, at: 1, active: true, kind: "agent" },
  ];
});

describe("naming an issue to import", () => {
  const repos = ["ojow/channels"];
  test("a number, owner/repo#n or its GitHub link, in one of the channel's repos", () => {
    expect(parseIssueRef("12", repos)).toEqual({ repo: "ojow/channels", number: 12 });
    expect(parseIssueRef("#12", repos)).toEqual({ repo: "ojow/channels", number: 12 });
    expect(parseIssueRef("OJOW/Channels#12", repos)).toEqual({ repo: "ojow/channels", number: 12 });
    expect(parseIssueRef("https://github.com/ojow/channels/issues/12#issuecomment-3", repos)).toEqual({ repo: "ojow/channels", number: 12 });
  });

  test("anything else says what to write instead", () => {
    expect(parseIssueRef("someone/else#3", repos)).toBe("someone/else isn't one of the channel's repos (ojow/channels)");
    expect(parseIssueRef("12", ["a/b", "c/d"])).toBe("say which repo: a/b#12 or c/d#12");
    expect(parseIssueRef("12", [])).toBe("the channel has no repo connected: the owner connects one in the app's GitHub settings");
    expect(parseIssueRef("https://github.com/ojow/channels/pull/12", repos)).toBe(`"https://github.com/ojow/channels/pull/12" isn't an issue: say 12, owner/repo#12 or its GitHub link`);
    expect(parseIssueRef("0", repos)).toBe(`"0" has no issue number`);
  });

  test("a task.add's issue is a repo and a positive number, or the event is dropped", () => {
    expect(wellFormedEvent({ op: "task.add", title: "x", issue: { repo: "o/r", number: 3 } })).toBe(true);
    expect(wellFormedEvent({ op: "task.add", title: "x", issue: { repo: "o", number: 3 } })).toBe(false);
    expect(wellFormedEvent({ op: "task.add", title: "x", issue: { repo: "o/r", number: 0 } })).toBe(false);
    expect(wellFormedEvent({ op: "task.add", title: "x", issue: "o/r#3" })).toBe(false);
  });
});

describe("GitHub's issue events", () => {
  test("the webhook keeps an issue's number, title, link, state and why it closed", () => {
    const payload = {
      action: "closed",
      repository: { full_name: "ojow/channels" },
      sender: { login: "jow" },
      issue: { number: 12, title: "Copy icons", html_url: "https://github.com/ojow/channels/issues/12", state: "closed", state_reason: "not_planned", body: "x".repeat(9000) },
    };
    expect(githubItem("issues", payload, 5)).toEqual({
      event: "issues",
      repo: "ojow/channels",
      at: 5,
      by: "jow",
      action: "closed",
      number: 12,
      title: "Copy icons",
      url: "https://github.com/ojow/channels/issues/12",
      state: "closed",
      reason: "not_planned",
    });
  });
});

describe("a task imported from an issue", () => {
  test("closing the task closes the issue once, completed or not planned", async () => {
    const log = [await ev("jon", { op: "repos.set", repos: ["ojow/channels"] })];
    const add = await ev("mac", { op: "task.add", title: "Copy icons", issue: { repo: "ojow/channels", number: 12 } });
    const other = await ev("mac", { op: "task.add", title: "Dropped", issue: { repo: "ojow/channels", number: 13 } });
    log.push(add, other);
    let s = fold(log, roster);
    expect(s.tasks.get(add.seq)?.issue).toEqual({ repo: "ojow/channels", number: 12 });
    expect(taskOfIssue(s, { repo: "OJOW/channels", number: 12 })?.id).toBe(add.seq);
    expect(formatTask(s, s.tasks.get(add.seq)!)).toContain("issue: ojow/channels#12; closing either one closes the other");
    const done = await ev("jon", { op: "task.update", task: add.seq, state: "done", note: "fixed in #371" });
    const cancel = await ev("jon", { op: "task.update", task: other.seq, state: "cancelled", note: "duplicate" });
    log.push(done, cancel);
    s = fold(log, roster);
    expect(issuesToClose(s, other.seq)).toEqual([
      { repo: "ojow/channels", number: 12, task: add.seq, seq: done.seq, reason: "completed", body: `Kiwi task T${add.seq} done: fixed in #371` },
      { repo: "ojow/channels", number: 13, task: other.seq, seq: cancel.seq, reason: "not_planned", body: `Kiwi task T${other.seq} cancelled: duplicate` },
    ]);
    expect(issuesToClose(s, done.seq).map((i) => i.number)).toEqual([13]);
    expect(taskOfIssue(s, { repo: "ojow/channels", number: 12 })).toBeUndefined();
    log.push(await ev("jon", issueNews(12, "closed", { by: "kiwi-channels[bot]", reason: "completed" })));
    s = fold(log, roster);
    expect(issuesToClose(s, 0).map((i) => i.number)).toEqual([13]);
    expect(tasksClosedOnGithub(s, 0)).toEqual([]);
  });

  test("closing the issue on GitHub closes its task, as cancelled when not planned, and only GitHub's owner-posted news counts", async () => {
    const log = [await ev("jon", { op: "repos.set", repos: ["ojow/channels"] })];
    const a = await ev("mac", { op: "task.add", title: "Fix it", issue: { repo: "ojow/channels", number: 20 } });
    const b = await ev("mac", { op: "task.add", title: "Won't do", issue: { repo: "ojow/channels", number: 21 } });
    log.push(a, b);
    const forged = await ev("mac", issueNews(20, "closed"));
    log.push(forged);
    expect(tasksClosedOnGithub(fold(log, roster), 0)).toEqual([]);
    const closed = await ev("jon", issueNews(20, "closed", { by: "jow", reason: "completed" }));
    const skipped = await ev("jon", issueNews(21, "closed", { by: "jow", reason: "not_planned" }));
    log.push(closed, skipped);
    let s = fold(log, roster);
    expect(tasksClosedOnGithub(s, b.seq)).toEqual([
      { task: a.seq, seq: closed.seq, cancelled: false, note: "ojow/channels#20 closed on GitHub by @jow" },
      { task: b.seq, seq: skipped.seq, cancelled: true, note: "ojow/channels#21 closed as not planned on GitHub by @jow" },
    ]);
    expect(tasksClosedOnGithub(s, closed.seq).map((c) => c.task)).toEqual([b.seq]);
    log.push(await ev("jon", issueNews(20, "closed", { action: "edited", by: "someone" })));
    s = fold(log, roster);
    expect(s.github.issues.get("ojow/channels#20")).toMatchObject({ state: "closed", seq: closed.seq, by: "jow", reason: "completed" });
    const finish = await ev("jon", { op: "task.update", task: a.seq, state: "done", note: "ojow/channels#20 closed on GitHub by @jow" });
    log.push(finish);
    s = fold(log, roster);
    expect(tasksClosedOnGithub(s, 0).map((c) => c.task)).toEqual([b.seq]);
    expect(issuesToClose(s, 0)).toEqual([]);
  });

  test("a reopened issue isn't closed again by an old close, and a task reopened clears its close", async () => {
    const log = [await ev("jon", { op: "repos.set", repos: ["ojow/channels"] })];
    const a = await ev("mac", { op: "task.add", title: "Flaky", issue: { repo: "ojow/channels", number: 30 } });
    log.push(a, await ev("jon", issueNews(30, "closed", { by: "jow" })), await ev("jon", issueNews(30, "open", { by: "jow" })));
    let s = fold(log, roster);
    expect(s.github.issues.get("ojow/channels#30")?.state).toBe("open");
    expect(tasksClosedOnGithub(s, 0)).toEqual([]);
    log.push(await ev("jon", { op: "task.update", task: a.seq, state: "done" }), await ev("jon", { op: "task.update", task: a.seq, state: "doing" }));
    s = fold(log, roster);
    expect(s.tasks.get(a.seq)?.closedSeq).toBeUndefined();
    expect(issuesToClose(s, 0)).toEqual([]);
  });

  test("a snapshot keeps the issues GitHub reported", async () => {
    const log = [await ev("jon", { op: "repos.set", repos: ["ojow/channels"] }), await ev("jon", issueNews(40, "closed", { by: "jow", title: "Old" }))];
    let base: FoldBase | undefined;
    fold(log, roster, Date.now(), undefined, undefined, undefined, (b) => (base = b));
    expect(base?.github?.issues).toMatchObject([{ repo: "ojow/channels", number: 40, state: "closed", title: "Old" }]);
    expect(fold([], roster, Date.now(), undefined, undefined, base).github.issues.get("ojow/channels#40")?.title).toBe("Old");
  });
});
