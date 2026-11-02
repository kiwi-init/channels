import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function launch(running: string, install: "works" | "blocked"): { stops: number; spawned: string | null; dir: string } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "kiwi-up-")));
  dirs.push(dir);
  const marker = join(dir, "spawned");
  mkdirSync(join(dir, "resources"));
  mkdirSync(join(dir, "home"));
  const bundled = join(dir, "resources", "kiwi");
  writeFileSync(bundled, `#!/bin/sh\nif [ "$1" = daemon ]; then echo "$0" > ${JSON.stringify(marker)}; else echo "kiwi 9.9.9"; fi\n`);
  chmodSync(bundled, 0o755);
  if (install === "blocked") writeFileSync(join(dir, "blocked"), "");
  const script = join(dir, "run.ts");
  const root = join(import.meta.dir, "..");
  writeFileSync(
    script,
    `import { existsSync, readFileSync } from "node:fs";
import { keepDaemon } from ${JSON.stringify(join(root, "desktop/src/bundled-daemon.ts"))};
import { daemonSocketPath } from ${JSON.stringify(join(root, "desktop/src/daemon-client.ts"))};
import { useHost } from ${JSON.stringify(join(root, "desktop/src/host.ts"))};
import { fakeHost } from ${JSON.stringify(join(root, "test/fake-host.ts"))};
useHost(fakeHost({ packaged: true, version: "9.9.9", paths: { resources: ${JSON.stringify(join(dir, "resources"))}, data: ${JSON.stringify(join(dir, "data"))} } }).host);
let stops = 0;
function serve(version: string): void {
  const server = Bun.listen({
    unix: daemonSocketPath(),
    socket: {
      data(socket, data) {
        for (const line of new TextDecoder().decode(data).split("\\n")) {
          if (!line.trim()) continue;
          const req = JSON.parse(line) as { id: number; verb: string };
          if (req.verb !== "stop") {
            socket.write(JSON.stringify({ id: req.id, ok: true, version, machine: "m", mxpk: "x", certified: false, person: null }) + "\\n");
            continue;
          }
          stops += 1;
          socket.write(JSON.stringify({ id: req.id, ok: true }) + "\\n");
          socket.flush();
          server.stop(true);
          const reopen = setInterval(() => {
            if (!existsSync(${JSON.stringify(marker)})) return;
            clearInterval(reopen);
            serve("9.9.9");
          }, 50);
        }
      },
    },
  });
}
serve(${JSON.stringify(running)});
await keepDaemon(() => true);
console.log(JSON.stringify({ stops, spawned: existsSync(${JSON.stringify(marker)}) ? readFileSync(${JSON.stringify(marker)}, "utf8").trim() : null }));
process.exit(0);
`,
  );
  const r = Bun.spawnSync(["bun", script], {
    cwd: dir,
    env: {
      PATH: process.env["PATH"] ?? "",
      HOME: join(dir, "home"),
      SHELL: "/bin/zsh",
      TMPDIR: process.env["TMPDIR"] ?? "/tmp",
      KIWI_HOME: join(dir, "home"),
      KIWI_INSTALL: install === "blocked" ? join(dir, "blocked", "bin") : join(dir, "install"),
      HOMEBREW_PREFIX: join(dir, "nobrew"),
    },
  });
  expect(r.exitCode, r.stderr.toString()).toBe(0);
  return { ...(JSON.parse(r.stdout.toString()) as { stops: number; spawned: string | null }), dir };
}

describe.skipIf(process.platform === "win32")("an updated app replaces the daemon serving it", () => {
  test("an older daemon gives way to the kept CLI", () => {
    const seen = launch("1.0.0", "works");
    expect(seen.stops).toBe(1);
    expect(seen.spawned).toBe(join(seen.dir, "install", "kiwi"));
  }, 30_000);

  test("an older daemon gives way to the app's own copy when the CLI can't be kept", () => {
    const seen = launch("1.0.0", "blocked");
    expect(seen.stops).toBe(1);
    expect(seen.spawned).toBe(join(seen.dir, "resources", "kiwi"));
  }, 30_000);

  test("a daemon as new as the app keeps running", () => {
    const seen = launch("9.9.9", "blocked");
    expect(seen.stops).toBe(0);
    expect(seen.spawned).toBeNull();
  }, 30_000);
});
