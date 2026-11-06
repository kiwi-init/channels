import { describe, expect, test } from "bun:test";
import { HELP, helpFor, SHORT_HELP } from "../src/cli/help.ts";
import { COMMANDS } from "../src/cli/commands.ts";

const known = (word: string): boolean => COMMANDS.has(word);
const named = [...new Set([...SHORT_HELP.matchAll(/kiwi ([a-z][a-z-]*)/g)].map((m) => m[1]!))].filter((w) => w !== "help");

describe("kiwi help: a short page for agents, each command's part on request", () => {
  test("the page an agent reads stays short", () => {
    expect(helpFor(undefined, known)).toBe(SHORT_HELP);
    expect(SHORT_HELP.length).toBeLessThanOrEqual(1_200);
    expect(HELP.length).toBeGreaterThan(SHORT_HELP.length * 10);
  });

  test("every command the short page names exists and has its own part of the full help", () => {
    expect(named.length).toBeGreaterThan(10);
    for (const c of named) {
      expect([c, known(c)]).toEqual([c, true]);
      const part = helpFor(c, known);
      expect([c, part.startsWith("no help")]).toEqual([c, false]);
      for (const line of part.split("\n")) expect([c, HELP.includes(line)]).toEqual([c, true]);
    }
  });

  test("a command's part has all its options and none of another command's", () => {
    const send = helpFor("send", known);
    expect(send).toContain("--to WHERE");
    expect(send).toContain("--file PATH");
    expect(send).not.toContain("kiwi reply");
    const task = helpFor("task", known);
    expect(task).toContain("task start|done|note|show T7");
    expect(task).toContain("task checkpoint T7 --file note.md");
    expect(task).not.toContain("spec start N");
  });

  test("help all is everything, and an unknown topic says so above the short page", () => {
    expect(helpFor("all", known)).toBe(HELP);
    expect(helpFor("nosuch", known)).toBe(`no help for "nosuch"\n\n${SHORT_HELP}`);
  });
});
