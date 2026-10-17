import { expect, test } from "bun:test";
import { briefText, mcpBrief } from "../src/brief.ts";

test("both briefs tell an agent to write like a chat teammate", () => {
  const cli = briefText({ alias: "c", agent: "mac", mc: "kiwi", listen: "" });
  const mcp = mcpBrief("c", "mac", false);
  for (const brief of [cli, mcp]) {
    expect(brief).toContain("Write like a teammate in a Slack or Teams channel");
    expect(brief).toContain("no names or arrows up front");
    expect(brief).toContain("if someone already said it");
  }
  expect(cli).toContain("kiwi react N 👍");
  expect(mcp).not.toContain("react N");
});

test("both briefs send every decision an agent waits on to ask-human, never a question left in a thread", () => {
  const cli = briefText({ alias: "c", agent: "mac", mc: "kiwi", listen: "" });
  const mcp = mcpBrief("c", "mac", false);
  expect(cli).toContain('kiwi ask-human --option "A: …" --option "B: …"');
  expect(mcp).toContain("call ask_human");
  expect(cli).not.toContain("send --escalate");
  [cli, mcp].map((brief) => expect(brief).toContain('never end a message with "reply A, B or C"'));
});
