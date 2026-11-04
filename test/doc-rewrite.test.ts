import { describe, expect, test } from "bun:test";
import * as Y from "yjs";
import { agentBlock } from "@kiwi/core/doc/agent.ts";
import { attachToBlock, blocksOf, newBlock, rewriteBlock, threadOf } from "@kiwi/core/doc/blocks.ts";

const NET = Symbol("net");

function twoClients(): { desk: Y.Doc; phone: Y.Doc; sync: () => void } {
  const desk = new Y.Doc();
  const phone = new Y.Doc();
  const held: [Y.Doc, Uint8Array][] = [];
  desk.on("update", (u: Uint8Array, o: unknown) => o !== NET && held.push([phone, u]));
  phone.on("update", (u: Uint8Array, o: unknown) => o !== NET && held.push([desk, u]));
  return { desk, phone, sync: () => held.splice(0).forEach(([to, u]) => Y.applyUpdate(to, u, NET)) };
}

function posted(doc: Y.Doc, text: string): string {
  const b = agentBlock(doc, "jow", "text");
  b.write(text);
  b.post();
  return b.id;
}

const texts = (doc: Y.Doc): string[] => blocksOf(doc).map((b) => b.text);

function raw(doc: Y.Doc, line = 0): string {
  const block = threadOf(doc).get(line);
  if (!(block instanceof Y.XmlElement)) throw new Error("no block");
  return block
    .toArray()
    .map((p) =>
      p instanceof Y.XmlElement
        ? p
            .toArray()
            .map((t) => t.toString())
            .join("")
        : "",
    )
    .join("\n");
}

function words(doc: Y.Doc, line = 0, paragraph = 0): Y.XmlText {
  const block = threadOf(doc).get(line);
  if (!(block instanceof Y.XmlElement)) throw new Error("no block");
  const p = block.get(paragraph);
  if (!(p instanceof Y.XmlElement)) throw new Error("no paragraph");
  const t = p.get(0);
  if (!(t instanceof Y.XmlText)) throw new Error("no text");
  return t;
}

describe("an edit from another client changes only what it changed in the line (T1776)", () => {
  test("a peer's edit made from stale text doesn't bring back the letters the author deleted meanwhile", () => {
    const { desk, phone, sync } = twoClients();
    const id = posted(desk, "Salve mister :)");
    sync();
    words(desk).delete(8, 4);
    expect(rewriteBlock(phone, id, "Salve mister :D")).toBe(true);
    sync();
    expect(texts(desk)).toEqual(["Salve mi :D"]);
    expect(texts(phone)).toEqual(["Salve mi :D"]);
  });

  test("letters the author types while a peer edits another part of the line all stay", () => {
    const { desk, phone, sync } = twoClients();
    const id = posted(desk, "merged in #12\nthanks");
    sync();
    words(desk, 0, 1).insert(6, " all");
    expect(rewriteBlock(phone, id, "merged in #13\nthanks")).toBe(true);
    sync();
    expect(texts(desk)).toEqual(["merged in #13\nthanks all"]);
    expect(texts(phone)).toEqual(texts(desk));
  });

  test("lines added, dropped and changed come out as the new text, with the line's images kept", () => {
    const doc = new Y.Doc();
    const id = posted(doc, "one\ntwo\nthree\nfour");
    attachToBlock(doc, id, [{ file: { name: "a.txt", mime: "text/plain", size: 1, pieces: [] } }]);
    expect(rewriteBlock(doc, id, "one\n2\n2.5\nfour")).toBe(true);
    expect(texts(doc)).toEqual(["one\n2\n2.5\nfour\n[file: a.txt]"]);
    expect(rewriteBlock(doc, id, "four")).toBe(true);
    expect(texts(doc)).toEqual(["four\n[file: a.txt]"]);
    expect(rewriteBlock(doc, id, "")).toBe(true);
    expect(texts(doc)).toEqual(["\n[file: a.txt]"]);
    expect(rewriteBlock(doc, id, "back\nagain")).toBe(true);
    expect(texts(doc)).toEqual(["back\nagain\n[file: a.txt]"]);
  });

  test("whatever the line held, it ends up exactly as the new text", () => {
    let seed = 7;
    const next = (n: number): number => Math.floor((seed = (seed * 1103515245 + 12345) % 2147483648) / 65536) % n;
    const pick = (): string => ["", "a", "ab", "abc", "b", "xyz", "a b", "@ana", "😀", "a😁b", "<tag>", "1 < 2 > 0"][next(12)]!;
    const doc = new Y.Doc();
    const id = posted(doc, "start");
    const drawn = new Set<string>();
    for (let round = 0; round < 500; round++) {
      const text = Array.from({ length: 1 + next(5) }, pick).join("\n");
      for (const line of text.split("\n")) drawn.add(line);
      expect(rewriteBlock(doc, id, text)).toBe(true);
      expect(raw(doc)).toBe(text);
    }
    expect(drawn.size).toBe(12);
  });

  test("an emoji or literal angle brackets in the line come out whole", () => {
    const doc = new Y.Doc();
    const id = posted(doc, "hello 😀");
    expect(rewriteBlock(doc, id, "hello 😁")).toBe(true);
    expect(texts(doc)).toEqual(["hello 😁"]);
    const tagged = posted(doc, "use <tag> now");
    expect(rewriteBlock(doc, tagged, "use <tag> later")).toBe(true);
    expect(raw(doc, 1)).toBe("use <tag> later");
  });

  test("a line that is still someone's unsent draft is never rewritten", () => {
    const doc = new Y.Doc();
    const { id } = newBlock(doc, "text", "jow", "half typed");
    expect(rewriteBlock(doc, id, "something else")).toBe(false);
    expect(texts(doc)).toEqual(["half typed"]);
  });
});
