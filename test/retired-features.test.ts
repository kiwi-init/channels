import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { commandFor, RENAMED } from "../src/cli/commands.ts";
import { HELP } from "../src/cli/help.ts";
import { UI_CONTRACT, UI_SURFACES } from "../desktop/src/ui-contract.ts";

const ROOT = join(import.meta.dir, "..");

describe("what the intents review retired stays gone (#152)", () => {
  test("kiwi terminal and kiwi rex run nothing, and help names neither", async () => {
    for (const name of ["terminal", "rex"]) expect([name, await commandFor(name)]).toEqual([name, undefined]);
    expect(HELP).not.toMatch(/kiwi (terminal|rex) /);
  });

  test("kiwi mcp runs nothing, help names it nowhere, and the CLI carries no MCP SDK: agents come in through the CLI and hooks", async () => {
    expect(await commandFor("mcp")).toBeUndefined();
    expect(HELP).not.toMatch(/\bmcp\b/i);
    const pkg: unknown = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    const deps = typeof pkg === "object" && pkg !== null && "dependencies" in pkg && typeof pkg.dependencies === "object" && pkg.dependencies !== null ? Object.keys(pkg.dependencies) : [];
    expect(deps).not.toContain("@modelcontextprotocol/sdk");
  });

  test("the app's bridge offers no terminal calls", () => {
    const now = UI_SURFACES[UI_CONTRACT] ?? [];
    for (const call of ["kiwi.terminals", "kiwi.terminalHelpers", "kiwi.seatPlaces", "kiwi.showSeat"]) expect([call, now.includes(call)]).toEqual([call, false]);
  });

  test("each older command name runs nothing and names what replaced it, which runs", async () => {
    for (const [old, now] of Object.entries(RENAMED)) {
      expect([old, await commandFor(old)]).toEqual([old, undefined]);
      expect([old, now, await commandFor(now.split(" ")[0]!)]).toEqual([old, now, expect.any(Function)]);
      expect(HELP).not.toContain(`kiwi ${old} `);
    }
  });

  test("the intents map lists no retired intent", () => {
    expect(readFileSync(join(ROOT, "intents.yaml"), "utf8")).not.toMatch(/^\s+status: retired$/m);
  });
});
