import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { COMMAND_MODULES, COMMANDS, commandFor } from "../src/cli/commands.ts";

describe("the CLI's command table", () => {
  test("each command module's commands are exactly the names the table lists for it", async () => {
    for (const load of COMMAND_MODULES) {
      const listed = [...COMMANDS].filter(([, l]) => l === load).map(([name]) => name);
      expect(Object.keys(await load()).sort()).toEqual(listed.sort());
    }
  });

  test("every listed name runs a command, and other names, prototype ones included, run nothing", async () => {
    for (const name of COMMANDS.keys()) expect([name, typeof (await commandFor(name))]).toEqual([name, "function"]);
    for (const name of ["nope", "constructor", "toString", "__proto__", ""]) expect(await commandFor(name)).toBeUndefined();
  });

  test("a command loads only its own module: nothing imports the command modules up front", () => {
    for (const file of ["src/cli/main.ts", "src/cli/commands.ts"]) {
      const source = readFileSync(join(import.meta.dir, "..", file), "utf8");
      expect([file, source.match(/^import [^;]*from "\.\/commands\/[^"]+";/gm)]).toEqual([file, null]);
    }
  });
});
