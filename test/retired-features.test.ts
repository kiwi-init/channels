import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { commandFor } from "../src/cli/commands.ts";
import { HELP } from "../src/cli/help.ts";
import { UI_CONTRACT, UI_SURFACES } from "../desktop/src/ui-contract.ts";

const ROOT = join(import.meta.dir, "..");

describe("what the intents review retired stays gone (#152)", () => {
  test("kiwi terminal and kiwi rex run nothing, and help names neither", async () => {
    for (const name of ["terminal", "rex"]) expect([name, await commandFor(name)]).toEqual([name, undefined]);
    expect(HELP).not.toMatch(/kiwi (terminal|rex) /);
  });

  test("the app's bridge offers no terminal calls", () => {
    const now = UI_SURFACES[UI_CONTRACT] ?? [];
    for (const call of ["kiwi.terminals", "kiwi.terminalHelpers", "kiwi.seatPlaces", "kiwi.showSeat"]) expect([call, now.includes(call)]).toEqual([call, false]);
  });

  test("the intents map lists no retired intent", () => {
    expect(readFileSync(join(ROOT, "intents.yaml"), "utf8")).not.toMatch(/^\s+status: retired$/m);
  });
});
