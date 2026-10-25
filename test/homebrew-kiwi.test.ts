import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { homebrewKiwi, keepCli } from "../desktop/src/cli.ts";
import { stableBin } from "../src/hooks/self.ts";

const dirs: string[] = [];
const KEPT = ["KIWI_INSTALL"] as const;
const before = Object.fromEntries(KEPT.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  for (const k of KEPT) {
    const v = before[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function folder(): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), "kiwi-brew-")));
  dirs.push(d);
  return d;
}

function fakeKiwi(file: string, version: string): string {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, `#!/bin/sh\necho "kiwi ${version}"\n`);
  chmodSync(file, 0o755);
  return file;
}

function brewed(prefix: string, version: string): string {
  const keg = fakeKiwi(join(prefix, "Cellar", "kiwi", version, "bin", "kiwi"), version);
  mkdirSync(join(prefix, "bin"), { recursive: true });
  mkdirSync(join(prefix, "opt"), { recursive: true });
  symlinkSync(join("..", "Cellar", "kiwi", version, "bin", "kiwi"), join(prefix, "bin", "kiwi"));
  symlinkSync(join("..", "Cellar", "kiwi", version), join(prefix, "opt", "kiwi"));
  return keg;
}

describe.skipIf(process.platform === "win32")("a kiwi from Homebrew is the one people run", () => {
  test("the app leaves its install folder alone when Homebrew's kiwi runs, and only a Cellar kiwi counts as Homebrew's", async () => {
    const dir = folder();
    const brew = join(dir, "brew");
    brewed(brew, "1.2.3");
    const bundle = fakeKiwi(join(dir, "app", "kiwi"), "9.9.9");
    process.env["KIWI_INSTALL"] = join(dir, "install");
    expect(await keepCli(bundle, "9.9.9", [brew])).toEqual({ path: join(brew, "bin", "kiwi"), version: "1.2.3", updated: false, homebrew: true });
    expect(existsSync(join(dir, "install"))).toBe(false);

    const loose = join(dir, "loose");
    fakeKiwi(join(loose, "bin", "kiwi"), "1.2.3");
    expect(homebrewKiwi([loose, join(dir, "nothing")])).toBeNull();
    expect(await keepCli(bundle, "9.9.9", [loose])).toEqual({ path: join(dir, "install", "kiwi"), version: "9.9.9", updated: true, homebrew: false });
  });

  test("a Homebrew kiwi that won't run doesn't count: the app keeps its own copy", async () => {
    const dir = folder();
    const brew = join(dir, "brew");
    writeFileSync(brewed(brew, "1.2.3"), "#!/bin/sh\nexit 1\n");
    const bundle = fakeKiwi(join(dir, "app", "kiwi"), "9.9.9");
    process.env["KIWI_INSTALL"] = join(dir, "install");
    expect((await keepCli(bundle, "9.9.9", [brew])).homebrew).toBe(false);
  });

  test("the app adds no PATH line beside Homebrew's kiwi, and its daemon runs brew's when it's as new as the app, else the app's own", () => {
    const dir = folder();
    const home = join(dir, "home");
    mkdirSync(home);
    const bundled = fakeKiwi(join(dir, "resources", "kiwi"), "9.9.9");
    const script = join(dir, "run.ts");
    const root = join(import.meta.dir, "..");
    writeFileSync(
      script,
      `import { rmSync } from "node:fs";
import { installCli, kiwiCli } from ${JSON.stringify(join(root, "desktop/src/bundled-daemon.ts"))};
import { useHost } from ${JSON.stringify(join(root, "desktop/src/host.ts"))};
import { fakeHost } from ${JSON.stringify(join(root, "test/fake-host.ts"))};
useHost(fakeHost({ packaged: true, version: "9.9.9", paths: { resources: ${JSON.stringify(join(dir, "resources"))}, data: ${JSON.stringify(join(dir, "data"))} } }).host);
const out = [];
for (const step of process.argv.slice(2)) {
  if (step === "drop") rmSync(${JSON.stringify(join(dir, "brew"))}, { recursive: true, force: true });
  else out.push({ cli: (await installCli()).path, daemon: await kiwiCli() });
}
console.log(JSON.stringify(out));
`,
    );
    const run = (...steps: string[]) => {
      const r = Bun.spawnSync(["bun", script, ...steps], {
        cwd: dir,
        env: { PATH: process.env["PATH"] ?? "", HOME: home, SHELL: "/bin/zsh", TMPDIR: process.env["TMPDIR"] ?? "/tmp", KIWI_INSTALL: join(dir, "install"), HOMEBREW_PREFIX: join(dir, "brew") },
      });
      expect(r.stderr.toString()).toBe("");
      return JSON.parse(r.stdout.toString()) as { cli: string; daemon: string }[];
    };
    const brew = join(dir, "brew", "bin", "kiwi");
    brewed(join(dir, "brew"), "9.9.10");
    expect(run("install")).toEqual([{ cli: brew, daemon: brew }]);
    expect(existsSync(join(home, ".zshrc"))).toBe(false);
    expect(existsSync(join(dir, "install"))).toBe(false);
    rmSync(join(dir, "brew"), { recursive: true });
    brewed(join(dir, "brew"), "1.0.0");
    expect(run("install")).toEqual([{ cli: brew, daemon: bundled }]);
    expect(existsSync(join(home, ".zshrc"))).toBe(false);
    expect(run("drop", "install")).toEqual([{ cli: join(dir, "install", "kiwi"), daemon: join(dir, "install", "kiwi") }]);
    expect(existsSync(join(home, ".zshrc"))).toBe(false);
  });

  test("hooks name a Homebrew kiwi by the link that survives brew upgrade, not its versioned Cellar folder", () => {
    const dir = folder();
    const prefix = join(dir, "brew");
    const keg = brewed(prefix, "2026.10.0");
    expect(stableBin(keg)).toBe(join(prefix, "bin", "kiwi"));
    rmSync(join(prefix, "bin", "kiwi"));
    expect(stableBin(keg)).toBe(join(prefix, "opt", "kiwi", "bin", "kiwi"));
    rmSync(join(prefix, "opt", "kiwi"));
    expect(stableBin(keg)).toBe(keg);
    expect(stableBin("/Users/someone/.kiwi/bin/kiwi")).toBe("/Users/someone/.kiwi/bin/kiwi");
  });
});
