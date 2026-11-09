import { describe, expect, test } from "bun:test";

import { englishIn } from "../scripts/ui-english.ts";

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
