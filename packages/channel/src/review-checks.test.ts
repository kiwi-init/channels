import { describe, expect, test } from "bun:test";

import { generateIdentity, sign, verify } from "@kiwi/core/identity.ts";
import type { Event, Message } from "@kiwi/core/protocol.ts";
import { fold } from "@kiwi/core/state.ts";
import { checkedUpTo, issuesToPost, linksToPost, tasksToClose } from "./review-checks.ts";
import { closeFromGithub } from "./task-actions.ts";

describe("posting review checks from the owner's app", () => {
  test("with Write to GitHub on, a PR on branch T<n>-… is linked back once, and not on the first look", async () => {
    const jon = await generateIdentity("jon");
    const roster = [{ name: "jon", pk: jon.pk, owner: true, at: 0, active: true, kind: "human" as const }];
    let seq = 0;
    const ev = async (e: Event): Promise<Message> => {
      seq++;
      const p = await sign(jon, { v: 1 as const, id: crypto.randomUUID(), from: "jon", kind: "event" as const, body: "", ts: seq, ev: e });
      return { ...p, seq, rts: seq, sigOk: await verify(p) };
    };
    const room = `room-${crypto.randomUUID()}`;
    const log = [await ev({ op: "task.add", title: "Link back" }), await ev({ op: "github.write.set", on: true }), await ev({ op: "branch.prefix.set", prefix: "T" })];
    expect(linksToPost(room, fold(log, roster))).toEqual([]);
    log.push(await ev({ op: "github", items: [{ event: "pull_request", repo: "o/r", action: "opened", number: 5, state: "open", branch: "T1-link", at: 1 }] }));
    expect(linksToPost(room, fold(log, roster))).toEqual([{ repo: "o/r", number: 5, task: 1, seq: 4, body: "Linked to Kiwi task T1" }]);
    expect(checkedUpTo(room, "prLinks")).toBe(3);
  });

  test("an issue's task and the issue close each other, once, and nothing from before the first look", async () => {
    const jon = await generateIdentity("jon");
    const roster = [{ name: "jon", pk: jon.pk, owner: true, at: 0, active: true, kind: "human" as const }];
    let seq = 0;
    const ev = async (e: Event, body = ""): Promise<Message> => {
      seq++;
      const p = await sign(jon, { v: 1 as const, id: crypto.randomUUID(), from: "jon", kind: "event" as const, body, ts: seq, ev: e });
      return { ...p, seq, rts: seq, sigOk: await verify(p) };
    };
    const room = `room-${crypto.randomUUID()}`;
    const log = [
      await ev({ op: "github.write.set", on: true }),
      await ev({ op: "task.add", title: "Old", issue: { repo: "o/r", number: 1 } }),
      await ev({ op: "task.add", title: "New", issue: { repo: "o/r", number: 2 } }),
    ];
    log.push(await ev({ op: "task.update", task: 2, state: "done" }));
    expect(issuesToPost(room, fold(log, roster))).toEqual([]);
    expect(tasksToClose(room, fold(log, roster))).toEqual([]);
    log.push(await ev({ op: "github", items: [{ event: "issues", repo: "o/r", action: "closed", number: 2, state: "closed", reason: "not_planned", by: "jow", at: 1 }] }));
    let s = fold(log, roster);
    expect(issuesToPost(room, s)).toEqual([]);
    const due = tasksToClose(room, s);
    expect(due).toEqual([{ task: 3, seq: 5, cancelled: true, note: "o/r#2 closed as not planned on GitHub by @jow" }]);
    const { body, opts } = closeFromGithub(s.tasks.get(3)!, due[0]!);
    expect(body).toBe("T3 cancelled: o/r#2 closed as not planned on GitHub by @jow");
    log.push(await ev(opts.ev!, body));
    s = fold(log, roster);
    expect(s.tasks.get(3)).toMatchObject({ state: "done", cancelled: true });
    expect(issuesToPost(room, s)).toEqual([]);
    expect(checkedUpTo(room, "issueCloses")).toBe(4);
    expect(checkedUpTo(room, "issueTasks")).toBe(4);
  });

  test("an issue closing moves a task with a landing step to landing, never to done (#623)", async () => {
    const jon = await generateIdentity("jon");
    const roster = [{ name: "jon", pk: jon.pk, owner: true, at: 0, active: true, kind: "human" as const }];
    let seq = 0;
    const ev = async (e: Event, body = ""): Promise<Message> => {
      seq++;
      const p = await sign(jon, { v: 1 as const, id: crypto.randomUUID(), from: "jon", kind: "event" as const, body, ts: seq, ev: e });
      return { ...p, seq, rts: seq, sigOk: await verify(p) };
    };
    const room = `room-${crypto.randomUUID()}`;
    const log = [await ev({ op: "landing.set", then: "merge" }), await ev({ op: "task.add", title: "Export", issue: { repo: "o/r", number: 7 } })];
    expect(tasksToClose(room, fold(log, roster))).toEqual([]);
    log.push(await ev({ op: "github", items: [{ event: "issues", repo: "o/r", action: "closed", number: 7, state: "closed", reason: "completed", by: "jow", at: 1 }] }));
    let s = fold(log, roster);
    const due = tasksToClose(room, s);
    expect(due).toHaveLength(1);
    const { body, opts } = closeFromGithub(s.tasks.get(2)!, due[0]!);
    expect(body).toBe("T2 landing: o/r#7 closed on GitHub by @jow");
    log.push(await ev(opts.ev!, body));
    s = fold(log, roster);
    expect(s.tasks.get(2)!.state).toBe("landing");
    expect(tasksToClose(room, s)).toEqual([]);
  });

  test("with Write to GitHub on, a task filed from an issue gets one link comment on it, and not on the first look", async () => {
    const jon = await generateIdentity("jon");
    const roster = [{ name: "jon", pk: jon.pk, owner: true, at: 0, active: true, kind: "human" as const }];
    let seq = 0;
    const ev = async (e: Event): Promise<Message> => {
      seq++;
      const p = await sign(jon, { v: 1 as const, id: crypto.randomUUID(), from: "jon", kind: "event" as const, body: "", ts: seq, ev: e });
      return { ...p, seq, rts: seq, sigOk: await verify(p) };
    };
    const room = `room-${crypto.randomUUID()}`;
    const log = [await ev({ op: "github.write.set", on: true }), await ev({ op: "task.add", title: "Seen", issue: { repo: "o/r", number: 4 } })];
    expect(linksToPost(room, fold(log, roster))).toEqual([]);
    log.push(await ev({ op: "task.add", title: "Secret plan", issue: { repo: "o/r", number: 5 } }));
    expect(linksToPost(room, fold(log, roster))).toEqual([{ repo: "o/r", number: 5, task: 3, seq: 3, body: "Linked to Kiwi task T3" }]);
  });
});
