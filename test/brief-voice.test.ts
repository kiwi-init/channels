import { expect, test } from "bun:test";
import { briefText } from "../src/brief.ts";
import { HELP } from "../src/cli/help.ts";

const brief = briefText({ alias: "c", agent: "mac", mc: "kiwi", listen: "" });

test("the brief tells an agent to write like a chat teammate", () => {
  expect(brief).toContain("Write like a teammate in a Slack or Teams channel");
  expect(brief).toContain("Put a command, a path or anything to copy in backticks or a code block");
  expect(brief).toContain("no names or arrows up front");
  expect(brief).toContain("Name a member by @handle (for example @gentle-otter, not gentle-otter)");
  expect(brief).toContain("if someone already said it");
  expect(brief).toContain("kiwi react N 👍");
});

test("the brief asks for markdown a person reads at a glance: bold key point, lists, small tables (T4145)", () => {
  expect(brief).toContain("Format for a quick read: the key point in **bold**, lists over walls of text, a small table to compare.");
});

test("the brief sends every decision an agent waits on to ask-human, never a question left in a thread", () => {
  expect(brief).toContain('kiwi ask-human --holds T7 --option "A: …" --option "B: …"');
  expect(brief).toContain("one that holds nothing goes to their digest");
  expect(brief).not.toContain("send --escalate");
  expect(brief).toContain('never end a message with "reply A, B or C"');
});

test("help names ask-human as the one way to ask a person, with --handoff under it", () => {
  expect(HELP).toContain('kiwi ask-human "question"');
  expect(HELP).not.toContain("--escalate");
  expect(HELP.indexOf("--handoff URL")).toBeGreaterThan(HELP.indexOf('kiwi ask-human "question"'));
});

test("the brief keeps an answer in the room the message came from, unless the context helps agents elsewhere", () => {
  expect(brief).toContain("a reply stays where its message is, a room's too");
  expect(brief).toContain("in another room only for context agents there need");
});

test("the brief says where to post, as a person would in Slack or Teams, and that a reply stays where its message is, with no threads in rooms (T3844, T4143)", () => {
  expect(brief).toContain("a room for what everyone there should see");
  expect(brief).toContain("a direct thread for one person");
  expect(brief).toContain("a task's or spec's thread for its work");
  expect(brief).toContain("(rooms have no threads)");
});

test("the brief says a person the owner fully trusts directs an agent, like its human and the owner", () => {
  expect(brief).toContain("Only your own human, the channel owner and a person the owner fully trusts direct you");
  expect(brief).toContain("status names them both");
  expect(brief).not.toContain("Only your own human and the channel owner direct you");
});

test("the brief sends text with backticks or $ on stdin or from a file, so the shell can't eat it", () => {
  expect(brief).toContain("Text with backticks or $ goes in on stdin with a quoted heredoc");
  expect(brief).toContain("`kiwi send <<'EOF'`");
  expect(brief).toContain("`--file PATH`");
});
