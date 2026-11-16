import { describe, expect, test } from "bun:test";

import { isProduction, keysIn, readersIn, unread, type Source } from "../scripts/ui-word-readers.ts";

const KEYS = ["live.map.event", "tasks.lanes.empty", "tasks.lanes.label", "events.task.claim", "events.task.first", "chat.only.in.a.test"];

const left = (sources: readonly Source[]): string[] => unread(KEYS, readersIn(sources.filter((s) => isProduction(s.file))));

describe("a UI word key is read only when production code looks it up (#2499)", () => {
  test("a direct lookup reads its key", () => {
    expect(left([{ file: "ui/src/a.tsx", code: 'const a = t("live.map.event", { who, what })' }])).not.toContain("live.map.event");
  });

  test("a dynamic prefix keeps its whole family, conservatively", () => {
    const got = left([{ file: "ui/src/a.tsx", code: "const a = t(`tasks.lanes.${part}`)" }]);
    expect(got).not.toContain("tasks.lanes.empty");
    expect(got).not.toContain("tasks.lanes.label");
  });

  test("a template whose head isn't a key path, like `s${n}`, keeps no family", () => {
    expect(left([{ file: "ui/src/a.tsx", code: "const a = `s${n}`; const b = `T${id}`" }])).toContain("tasks.lanes.empty");
  });

  test("an event key is read when core passes it to say(), not by map.ts's events.${key} bridge alone", () => {
    const got = left([
      { file: "ui/src/live/map.ts", code: "const sayEvent = (key, vars) => t(`events.${key}`, vars)" },
      { file: "packages/core/src/format.ts", code: 'function said(ev) { switch (ev.op) { case "task.claim": return say("task.claim", { task: ev.task }) } }' },
    ]);
    expect(got).not.toContain("events.task.claim");
    expect(got).toContain("events.task.first");
  });

  test("a key mentioned only in a test or a catalog has no reader", () => {
    const got = left([
      { file: "ui/src/chat/a.test.ts", code: 'expect(t("chat.only.in.a.test")).toBe("x")' },
      { file: "ui/src/i18n/en/chat.ts", code: 'export default { "chat.only.in.a.test": "x" }' },
      { file: "ui/src/i18n/ja/chat.ts", code: 'export default { "chat.only.in.a.test": "x" }' },
    ]);
    expect(got).toContain("chat.only.in.a.test");
  });

  test("a key in a type position isn't a lookup", () => {
    expect(left([{ file: "ui/src/a.ts", code: 'type K = "live.map.event"; const k: K = x' }])).toContain("live.map.event");
  });

  test("a catalog's keys are its string-keyed properties, plural forms included", () => {
    expect(keysIn("x.ts", 'export default { "a.b": "x", "c.d": { one: "1", other: "n" } }')).toEqual(["a.b", "c.d"]);
  });
});
