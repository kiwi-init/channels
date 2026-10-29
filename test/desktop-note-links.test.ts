import { expect, test } from "bun:test";

import { noteLinks } from "../desktop/src/note-links.ts";

test("each notification with a link gets its own tag, and a click on it finds the link again", () => {
  const notes = noteLinks();
  const a = notes.tag("kiwi://join/a");
  const b = notes.tag("kiwi://join/b");
  expect(a).not.toBe(b);
  expect(notes.link(a)).toBe("kiwi://join/a");
  expect(notes.link(b)).toBe("kiwi://join/b");
});

test("no link is tag 0, which opens nothing", () => {
  const notes = noteLinks();
  expect(notes.tag(null)).toBe(0);
  expect(notes.link(0)).toBeNull();
  expect(notes.link(12345)).toBeNull();
});

test("only the last hundred are kept", () => {
  const notes = noteLinks();
  const first = notes.tag("kiwi://join/first");
  let last = first;
  for (let i = 0; i < 100; i++) last = notes.tag(`kiwi://join/${i}`);
  expect(notes.link(first)).toBeNull();
  expect(notes.link(last)).toBe("kiwi://join/99");
  expect(notes.link(last - 99)).toBe("kiwi://join/0");
});
