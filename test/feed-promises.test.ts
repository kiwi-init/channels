import { describe, expect, test } from "bun:test";
import { broken, checksOf, promisesIn } from "../scripts/feed-promises.ts";

const LIST = [
  "# What the feed promises",
  "",
  "## A new message",
  "",
  "| The feed promises | The check that fails | Words in that check |",
  "| --- | --- | --- |",
  "| At the bottom the view follows | `scripts/ui-doc-follow.ts` | `the view follows` |",
  "| Scrolled up it stays | `scripts/ui-send-scroll.ts` | `keeps the view where it was` |",
  "",
  "## A reload",
  "",
  "| The feed promises | The check that fails | Words in that check |",
  "| --- | --- | --- |",
  "| The same message is on screen | `test/place.test.ts` | `a \\| in the words` |",
].join("\n");

const files: Record<string, string> = {
  "scripts/ui-doc-follow.ts": 'console.log("the view follows an agent")',
  "scripts/ui-send-scroll.ts": 'console.log("sending keeps the view where it was")',
  "test/place.test.ts": 'test("a | in the words", () => {})',
};
const repo = { read: (path: string) => files[path] ?? null, ci: "run: bun scripts/ui-doc-follow.ts --dist ui/dist\nrun: bun scripts/ui-send-scroll.ts\n" };

describe("the list of what the feed promises", () => {
  test("every row is a promise with its section, check, words and line", () => {
    const { promises, problems } = promisesIn(LIST);
    expect(problems).toEqual([]);
    expect(promises.map((p) => [p.section, p.promise, p.check, p.words, p.line])).toEqual([
      ["A new message", "At the bottom the view follows", "scripts/ui-doc-follow.ts", "the view follows", 7],
      ["A new message", "Scrolled up it stays", "scripts/ui-send-scroll.ts", "keeps the view where it was", 8],
      ["A reload", "The same message is on screen", "test/place.test.ts", "a | in the words", 14],
    ]);
    expect(broken(promises, repo)).toEqual([]);
    expect(checksOf(promises)).toEqual(["scripts/ui-doc-follow.ts", "scripts/ui-send-scroll.ts", "test/place.test.ts"]);
  });

  test("a promise with no check, or no words from it, is refused", () => {
    const rows = (row: string) => promisesIn(`## A\n\n| a | b | c |\n| --- | --- | --- |\n${row}`).problems;
    expect(rows("| It never jumps | | |")).toEqual(['line 5: "It never jumps" names no check (a script under scripts/ or a unit test, in backticks)']);
    expect(rows("| It never jumps | `docs/feed.md` | `x` |")).toEqual(['line 5: "It never jumps" names no check (a script under scripts/ or a unit test, in backticks)']);
    expect(rows("| It never jumps | `scripts/ui-scroll-fps.ts` | never jumped |")).toEqual(['line 5: "It never jumps" doesn\'t quote the words its check says']);
    expect(rows("| | `scripts/ui-scroll-fps.ts` | `x` |")).toEqual(["line 5: a row with no promise"]);
  });

  test("a check that is gone, that lost its words, or that CI doesn't run is refused", () => {
    const { promises } = promisesIn(LIST);
    expect(broken(promises, { ...repo, read: (path) => (path === "scripts/ui-doc-follow.ts" ? null : repo.read(path)) })).toEqual([
      'line 7: "At the bottom the view follows" names scripts/ui-doc-follow.ts, which is not in the repo',
    ]);
    expect(broken(promises, { ...repo, read: (path) => (path === "scripts/ui-send-scroll.ts" ? "console.log('sending is fine')" : repo.read(path)) })).toEqual([
      'line 8: scripts/ui-send-scroll.ts no longer says "keeps the view where it was", so nothing proves "Scrolled up it stays"',
    ]);
    expect(broken(promises, { ...repo, ci: "run: bun scripts/ui-doc-follow.ts\nrun: bun scripts/ui-send-scroll.tsx\n" })).toEqual([
      'line 8: CI doesn\'t run scripts/ui-send-scroll.ts, so "Scrolled up it stays" can break unseen',
    ]);
  });

  test("the same promise twice, and an empty list, are refused", () => {
    const twice = promisesIn(`${LIST}\n| The same message is on screen | \`test/place.test.ts\` | \`a \\| in the words\` |`);
    expect(broken(twice.promises, repo)).toEqual(['line 15: "The same message is on screen" is already on line 14']);
    expect(broken([], repo)).toEqual(["the list has no promises"]);
  });
});
