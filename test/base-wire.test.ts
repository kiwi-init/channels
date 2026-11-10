import { describe, expect, test } from "bun:test";
import { fromWire, readableWire, toWire, BASE_WIRE_VERSION } from "@kiwi/core/base-wire.ts";
import { PROTOCOL_VERSION, type Message } from "@kiwi/core/protocol.ts";
import { fold, type FoldBase, type Roster } from "@kiwi/core/state.ts";
import type { GithubCheck } from "@kiwi/core/state/github.ts";

const T0 = 1_700_000_000_000;
const OWNER = "o".repeat(43);
const roster: Roster = [{ name: "jow", pk: OWNER, owner: true, at: 0, active: true, kind: "human" }];
const msg: Message = { v: PROTOCOL_VERSION, id: "m1", from: "jow", kind: "msg", body: "hi", ts: T0, rts: T0, seq: 1, sigOk: true, pk: OWNER };

function emptyBase(): FoldBase {
  let base: FoldBase | null = null;
  fold([msg], roster, T0, null, null, undefined, (b) => void (base = b));
  if (!base) throw new Error("no base");
  return base;
}

const job = (repo: string, wf: number, run: number) => `https://github.com/${repo}/actions/runs/${wf}/job/${run}`;

const plain: GithubCheck = {
  name: "ci-ok",
  at: T0 + 9,
  status: "completed",
  conclusion: "success",
  url: job("o/r", 42, 4_242),
  run: 4_242,
  completedAt: T0 + 8,
  attempts: [{ run: 4_242, attempt: 1, started: T0 + 1, conclusion: "success", completed: T0 + 8 }],
};

function withChecks(checks: GithubCheck[]): FoldBase {
  const base = emptyBase();
  return { ...base, github: { ...base.github!, checks: [["o/r@abc1234", checks]] } };
}

const wireChecks = (b: FoldBase) => toWire(b).github!.checks[0]![1];

describe("the fold base on the wire", () => {
  test("a check run whose link and only attempt the fold can rebuild is stored without them and comes back whole", () => {
    const base = withChecks(
      [plain, { ...plain, name: "queued", status: "queued", conclusion: undefined, completedAt: undefined, attempts: [{ run: 4_242, attempt: 1 }] }].map(
        (c) => JSON.parse(JSON.stringify(c)) as GithubCheck,
      ),
    );
    const [first, second] = wireChecks(base);
    expect(first).toEqual({ name: "ci-ok", at: T0 + 9, status: "completed", conclusion: "success", run: 4_242, completedAt: T0 + 8, wf: 42, once: { started: T0 + 1 } });
    expect(second).toEqual({ name: "queued", at: T0 + 9, status: "queued", run: 4_242, wf: 42, once: {} });
    expect(fromWire(JSON.parse(JSON.stringify(toWire(base)))).github).toEqual(base.github!);
  });

  test("a link or attempts the fold can't rebuild are kept as they were", () => {
    const odd: GithubCheck[] = [
      { ...plain, name: "other repo", url: job("O/R", 42, 4_242) },
      { ...plain, name: "other job", url: job("o/r", 42, 9_999) },
      { ...plain, name: "not a job", url: "https://example.com/build/7" },
      { ...plain, name: "rerun", attempt: 2, attempts: [plain.attempts![0]!, { run: 4_242, attempt: 2, started: T0 + 20 }] },
      { ...plain, name: "stale attempt", attempts: [{ run: 4_242, attempt: 1, conclusion: "failure", completed: T0 + 5 }] },
      { name: "no run", at: T0, status: "in_progress", url: "https://github.com/o/r/actions/runs/42" },
    ];
    const base = withChecks(odd);
    const wire = wireChecks(base);
    const once = { started: T0 + 1 };
    expect(wire.map((c) => ({ url: c.url, wf: c.wf, attempts: c.attempts, once: c.once }))).toEqual([
      { url: odd[0]!.url, wf: undefined, attempts: undefined, once },
      { url: odd[1]!.url, wf: undefined, attempts: undefined, once },
      { url: odd[2]!.url, wf: undefined, attempts: undefined, once },
      { url: undefined, wf: 42, attempts: odd[3]!.attempts, once: undefined },
      { url: undefined, wf: 42, attempts: odd[4]!.attempts, once: undefined },
      { url: odd[5]!.url, wf: undefined, attempts: undefined, once: undefined },
    ]);
    expect(fromWire(JSON.parse(JSON.stringify(toWire(base)))).github).toEqual(base.github!);
  });

  test("a base kept by the previous wire version still reads", () => {
    const base = withChecks([plain]);
    const v7 = { ...toWire(base), github: base.github };
    expect(readableWire(7)).toBe(true);
    expect(readableWire(BASE_WIRE_VERSION)).toBe(true);
    expect(readableWire(6)).toBe(false);
    expect(fromWire(JSON.parse(JSON.stringify(v7))).github).toEqual(base.github!);
  });
});
