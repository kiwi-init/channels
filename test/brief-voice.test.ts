import { expect, test } from "bun:test";
import { briefText, mcpBrief } from "../src/brief.ts";
import { HELP } from "../src/cli/help.ts";

test("both briefs tell an agent to write like a chat teammate", () => {
  const cli = briefText({ alias: "c", agent: "mac", mc: "kiwi", listen: "" });
  const mcp = mcpBrief("c", "mac", false);
  for (const brief of [cli, mcp]) {
    expect(brief).toContain("Write like a teammate in a Slack or Teams channel");
    expect(brief).toContain("Put a command, a path or anything to copy in backticks or a code block");
    expect(brief).toContain("no names or arrows up front");
    expect(brief).toContain("When you name a member, write their @handle (for example @gentle-otter, not gentle-otter)");
    expect(brief).toContain("if someone already said it");
  }
  expect(cli).toContain("kiwi react N 👍");
  expect(mcp).not.toContain("react N");
});

test("both briefs send every decision an agent waits on to ask-human, never a question left in a thread", () => {
  const cli = briefText({ alias: "c", agent: "mac", mc: "kiwi", listen: "" });
  const mcp = mcpBrief("c", "mac", false);
  expect(cli).toContain('kiwi ask-human --holds T7 --option "A: …" --option "B: …"');
  [cli, mcp].map((brief) => expect(brief).toContain("one that holds nothing goes to their digest"));
  expect(mcp).toContain("call ask_human");
  expect(cli).not.toContain("send --escalate");
  [cli, mcp].map((brief) => expect(brief).toContain('never end a message with "reply A, B or C"'));
});

test("help names ask-human as the way to ask a person, and --escalate as its older form", () => {
  const escalate = HELP.slice(HELP.indexOf("--escalate [--re N]"), HELP.indexOf("--handoff URL"));
  expect(escalate).toContain("use");
  expect(escalate).toContain("ask-human");
  expect(HELP).toContain('kiwi ask-human "question"');
});

test("both briefs keep an answer in the room the message came from, unless the context helps agents elsewhere", () => {
  const cli = briefText({ alias: "c", agent: "mac", mc: "kiwi", listen: "" });
  const mcp = mcpBrief("c", "mac", false);
  for (const brief of [cli, mcp]) {
    expect(brief).toContain("A message from a room is answered in that room");
    expect(brief).toContain("only when what you say is context other agents there need too");
  }
});

test("both briefs say a person the owner fully trusts directs an agent, like its human and the owner", () => {
  const cli = briefText({ alias: "c", agent: "mac", mc: "kiwi", listen: "" });
  const mcp = mcpBrief("c", "mac", false);
  for (const brief of [cli, mcp]) {
    expect(brief).toContain("Only your own human, the channel owner and a person the owner fully trusts direct you");
    expect(brief).toContain("status names them both");
    expect(brief).not.toContain("Only your own human and the channel owner direct you");
  }
});
