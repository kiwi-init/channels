import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CLI_COMPILE } from "../scripts/cli-bundle.ts";

test.skipIf(process.platform === "win32")(
  "a kiwi compiled as scripts/build-cli.ts compiles it loads no bunfig.toml or .env from the folder it starts in, so a project there can't preload code into it or set its environment (T1365)",
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "kiwi-autoload-"));
    try {
      const probe = join(dir, "probe.js");
      writeFileSync(probe, 'console.log(process.env["KIWI_FROM_DOTENV"] ?? "no .env");\n');
      const bin = join(dir, "probe");
      const built = await Bun.build({ entrypoints: [probe], compile: { ...CLI_COMPILE, outfile: bin } });
      expect(built.success).toBe(true);
      const project = join(dir, "project");
      mkdirSync(project);
      writeFileSync(join(project, "bunfig.toml"), 'preload = ["./preload.js"]\n');
      writeFileSync(join(project, "preload.js"), 'require("node:fs").writeFileSync("preload-ran", "");\n');
      writeFileSync(join(project, ".env"), "KIWI_FROM_DOTENV=1\n");
      const out = execFileSync(bin, [], { cwd: project, encoding: "utf8", env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin", HOME: dir } });
      expect({ out: out.trim(), preloaded: existsSync(join(project, "preload-ran")) }).toEqual({ out: "no .env", preloaded: false });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
  60_000,
);
