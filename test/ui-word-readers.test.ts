import { describe, expect, test } from "bun:test";

import { isProduction, keysIn, readersIn, unread, type Source } from "../scripts/ui-word-readers.ts";

const KEYS = ["live.map.event", "tasks.lanes.empty", "tasks.lanes.label", "tasks.label", "tasks.unused", "events.task.claim", "events.task.first", "chat.only.in.a.test"];

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

  test("a production diagnostic, comparison or bare mention of an otherwise unused key reads nothing", () => {
    const got = left([
      {
        file: "ui/src/a.ts",
        code: [
          '"tasks.unused";',
          'console.error("tasks.unused");',
          'throw new Error("tasks.unused");',
          'function f(k) { if (k === "tasks.unused") return 1; switch (k) { case "tasks.unused": return 2 } }',
          'const o = { "tasks.unused": 1 };',
        ].join("\n"),
      },
    ]);
    expect(got).toContain("tasks.unused");
  });

  test("a leading interpolation resolves through a const, or keeps its family when it can't", () => {
    expect(left([{ file: "ui/src/a.tsx", code: 'const area = "tasks"; const label = t(`${area}.label`)' }])).not.toContain("tasks.label");
    const open = left([{ file: "ui/src/a.tsx", code: "function label(area) { return t(`${area}.label`) }" }]);
    expect(open).not.toContain("tasks.label");
    expect(open).not.toContain("tasks.lanes.label");
    expect(open).toContain("tasks.unused");
  });

  test("a concatenated prefix keeps its family, through a const too", () => {
    expect(left([{ file: "ui/src/a.tsx", code: 'const a = t("tasks.lanes." + part)' }])).not.toContain("tasks.lanes.empty");
    expect(left([{ file: "ui/src/a.tsx", code: 'const P = "tasks.lanes."; const a = t(P + part)' }])).not.toContain("tasks.lanes.empty");
  });

  test("a key reaches t() through a Key-typed helper or a typed map of keys", () => {
    expect(left([{ file: "ui/src/a.tsx", code: 'function heading(key: Key) { return t(key) }\nheading("live.map.event")' }])).not.toContain("live.map.event");
    expect(left([{ file: "ui/src/a.ts", code: 'const WORDS: Readonly<Record<string, Key>> = { failure: "tasks.label" }; const w = t(WORDS[x])' }])).not.toContain("tasks.label");
  });

  test("a const resolves only where it's the one binding of its name: a sibling's or a parameter's keeps the family", () => {
    const siblings = 'function a() { const area = "tasks"; return t(`${area}.label`) }\nfunction b() { const area = "other"; return area }';
    expect(left([{ file: "ui/src/a.tsx", code: siblings }])).not.toContain("tasks.label");
    const shadowed = 'const area = "other"; function label(area) { return t(`${area}.label`) }';
    expect(left([{ file: "ui/src/a.tsx", code: shadowed }])).not.toContain("tasks.label");
  });

  test("a key stored in a variable that only a diagnostic uses has no reader", () => {
    expect(left([{ file: "ui/src/a.ts", code: 'const diagnostic = "tasks.unused"; console.log(diagnostic)' }])).toContain("tasks.unused");
    expect(left([{ file: "ui/src/a.ts", code: 'const words = { gone: "tasks.unused" }; console.error(words.gone)' }])).toContain("tasks.unused");
  });

  test("a key reaches a lookup through an untyped map: indexed, mapped over, or imported", () => {
    expect(left([{ file: "packages/core/src/f.ts", code: 'const KEYS = ["tasks.label"] as const; const s = say(KEYS[step])' }])).not.toContain("tasks.label");
    expect(left([{ file: "ui/src/a.tsx", code: 'const CAN = [{ id: "read", label: "tasks.label" }] as const; const r = CAN.map((c) => t(c.label))' }])).not.toContain("tasks.label");
    const imported = left([
      { file: "ui/src/words.ts", code: 'export const WORDS = { a: "tasks.label" }' },
      { file: "ui/src/a.tsx", code: 'import { WORDS as W } from "~/words"; const x = t(W[k])' },
    ]);
    expect(imported).not.toContain("tasks.label");
  });

  test("a field typed through an interface that holds a Key reads its key", () => {
    const code = 'interface Character { name: Key }\nconst CHARACTERS: Record<string, Character> = { lead: { name: "tasks.label" } }';
    expect(left([{ file: "ui/src/a.ts", code }])).not.toContain("tasks.label");
  });

  test("a file name built like `${a}.${b}` keeps no family", () => {
    expect(left([{ file: "ui/src/a.ts", code: "const f = `${name}.${ext}`" }])).toContain("tasks.unused");
  });

  test("a key in a type position isn't a lookup", () => {
    expect(left([{ file: "ui/src/a.ts", code: 'type K = "live.map.event"; const k: K = x' }])).toContain("live.map.event");
  });

  test("a catalog's keys are its string-keyed properties, plural forms included", () => {
    expect(keysIn("x.ts", 'export default { "a.b": "x", "c.d": { one: "1", other: "n" } }')).toEqual(["a.b", "c.d"]);
  });
});
