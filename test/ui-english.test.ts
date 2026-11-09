import { describe, expect, test } from "bun:test";

import { englishIn, skipped } from "../scripts/ui-english.ts";

const found = (code: string, file = "x.tsx"): number => englishIn(file, code);

describe("ui-english stays quiet on names and ids", () => {
  test("a template of only a task id and holes is an id", () => {
    expect(found("const a = `T${id}`")).toBe(0);
    expect(found("const a = `T${id} ${title}`")).toBe(0);
    expect(found("const a = `T${id} ${a} · ${b}`")).toBe(0);
    expect(found("const a = `T${id} `")).toBe(0);
  });

  test("theme, font, brand, key and command names stay as they are", () => {
    expect(found('import type { ColorTheme } from "./derive"\nexport const DARK: ColorTheme = { id: "dark", name: "Channels Dark", appearance: "dark" }')).toBe(0);
    expect(found('export const ALL: readonly ColorTheme[] = [{ id: "a", name: "Abyssal Trench" }, { id: "b", name: "Alpine Milk" }]')).toBe(0);
    expect(found('const fonts = [["inter", "Inter"], ["lato", "Lato"], ["atkinson", "Atkinson"]]')).toBe(0);
    expect(found('const a = <h1 className="start-word">channels</h1>')).toBe(0);
    expect(found('const a = <Row label="GitHub" />')).toBe(0);
    expect(found("const a = <kbd>Esc</kbd>")).toBe(0);
    expect(found('const OS = { linux: "Linux", windows: "Windows" }')).toBe(0);
  });

  test("a developer error's message and a markdown node's type are not shown", () => {
    expect(found('throw new TypeError("Words can\'t be shown raw: render it with Shown")')).toBe(0);
    expect(found('node.type = safe ? "Link" : "Text"\nconst n = { type: "Text", content: alt }')).toBe(0);
    expect(found('noteTyping(() => ({ what: "Backspace dropped an empty line" }))')).toBe(0);
  });
});

describe("ui-english flags English a person reads", () => {
  test("a sentence in JSX text, a shown attribute or a literal", () => {
    expect(found("const a = <p>Nothing here yet</p>")).toBe(1);
    expect(found('const a = <input placeholder="Search messages" />')).toBe(1);
    expect(found('const a = { label: "Copy scroll trace" }')).toBe(1);
    expect(found('announce("Scroll trace copied")')).toBe(1);
  });

  test("a template with words, around an id or not", () => {
    expect(found("const a = `Review T${id}`")).toBe(1);
    expect(found("const a = `T${id} shipped with its gate shut`")).toBe(1);
    expect(found("const a = `Spec #${ask} changed`")).toBe(1);
  });

  test("a theme rule covers only a theme's name, and a plain Error stays checked", () => {
    expect(found('export const DARK: ColorTheme = { name: "Dark", note: "Pick this one" }')).toBe(1);
    expect(found('export const A = { name: "Abyssal Trench" }')).toBe(1);
    expect(found('throw new Error("Open the channel first")')).toBe(1);
    expect(found("const a = <p>GitHub is down</p>")).toBe(1);
  });
});

describe("ui-english flags a short lowercase phrase", () => {
  test("a phrase in a literal or a template with holes", () => {
    expect(found('const a = { status: "ready for review" }')).toBe(1);
    expect(found('const a = active ? "thinking" : "waiting for a reply"')).toBe(1);
    expect(found("const a = `${n} checks failed`")).toBe(1);
    expect(found("const a = `merged ${pr}`")).toBe(1);
  });

  test("a single word, an id, a key, a rel and channel text stay quiet", () => {
    expect(found('const a = "idle"')).toBe(0);
    expect(found('const a = "is-gone doc-image"')).toBe(0);
    expect(found("const a = { key: `update ${v} ${state}` }")).toBe(0);
    expect(found("const key = `moved ${to}`")).toBe(0);
    expect(found('const a = <a rel="noopener noreferrer" />')).toBe(0);
    expect(found('const a = { rel: "noopener noreferrer" }')).toBe(0);
    expect(found("await event(run, `cleared ${name}'s role`, ev)")).toBe(0);
    expect(found('void send("set their picture", ev)')).toBe(0);
    expect(found('await run.send("deleted the message", ev)')).toBe(0);
    expect(found("const a = <code>kiwi doctor</code>")).toBe(0);
  });

  test("the thumbnail worker and the typing trace are not shown, the rest of chat and kit is", () => {
    expect(skipped("chat/thumbs.ts")).toBe(true);
    expect(skipped("chat/thumb-shrink.ts")).toBe(true);
    expect(skipped("kit/typing-record.ts")).toBe(true);
    expect(skipped("kit/typing-trace.ts")).toBe(true);
    expect(skipped("chat/thumb-button.tsx")).toBe(false);
    expect(skipped("kit/typing-hook.ts")).toBe(false);
    expect(found('throw new Error("the canvas gave no png")')).toBe(1);
  });
});
