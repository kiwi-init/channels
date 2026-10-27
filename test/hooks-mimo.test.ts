import { afterAll, afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { howMessagesReachYou } from "../src/hooks.ts";
import { extraInstalled, hooksStatus, installExtra, uninstallExtra } from "../src/hooks/install/extra.ts";
import { updateConfig } from "../src/config.ts";
import { installMimo, migrateMimo, mimoConfigRoot, mimoInstalled, mimoPluginPath, mimoPluginSource, uninstallMimo } from "../src/hooks/install/mimo.ts";
import { handoffFrom } from "../src/hooks/listen.ts";
import { kiwiCmd } from "./owner.ts";

const made: string[] = [];
const prev = new Map<string, string | undefined>();

function scratch(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  made.push(d);
  return d;
}

function setEnv(vars: Record<string, string>): void {
  for (const [k, v] of Object.entries(vars)) {
    if (!prev.has(k)) prev.set(k, process.env[k]);
    process.env[k] = v;
  }
}

afterEach(() => {
  for (const [k, v] of prev) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  prev.clear();
  delete (globalThis as { __kiwi?: unknown }).__kiwi;
});

afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

type Prompted = { path: { id: string }; body: { parts: { type: string; text: string }[] }; throwOnError?: boolean };
type Hooks = {
  "shell.env": (input: { cwd?: string; sessionID?: string }, output: { env: Record<string, string> }) => Promise<void>;
  event: (input: { event: { type: string; properties?: { info?: { id?: string; parentID?: string; directory?: string } } } }) => Promise<void>;
};

async function until(what: string, ok: () => boolean, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(25);
  }
}

test("MiMoCode's plugin folder: KIWI_MIMO_DIR, then an absolute MIMOCODE_HOME, then XDG_CONFIG_HOME, then ~/.config", () => {
  expect(mimoConfigRoot({ KIWI_MIMO_DIR: "/k", MIMOCODE_HOME: "/m" })).toBe("/k");
  expect(mimoConfigRoot({ MIMOCODE_HOME: "/m", XDG_CONFIG_HOME: "/x" })).toBe("/m/config");
  expect(mimoConfigRoot({ MIMOCODE_HOME: "relative", XDG_CONFIG_HOME: "/x" })).toBe("/x/mimocode");
  expect(mimoConfigRoot({})).toBe(join(homedir(), ".config", "mimocode"));
  expect(mimoPluginPath({ MIMOCODE_HOME: "/m" })).toBe("/m/config/plugin/kiwi.ts");
});

test("a listen without landed hands over at once; with it, only a token shaped like the ones the listener prints can settle a handoff", () => {
  const token = crypto.randomUUID();
  expect(handoffFrom(undefined)).toEqual({ kind: "at-once" });
  expect(handoffFrom(null)).toEqual({ kind: "acked", landed: null });
  expect(handoffFrom(token)).toEqual({ kind: "acked", landed: token });
  expect(handoffFrom(`extra.${token}`)).toEqual({ kind: "acked", landed: null });
  expect(handoffFrom(`../${token}`)).toEqual({ kind: "acked", landed: null });
  expect(handoffFrom(token.toUpperCase())).toEqual({ kind: "acked", landed: null });
  expect(handoffFrom(42)).toEqual({ kind: "acked", landed: null });
});

test("install writes the plugin once, uninstall removes only a plugin of Kiwi's", () => {
  const dir = scratch("hk-mimo-");
  setEnv({ KIWI_MIMO_DIR: dir });
  expect(mimoInstalled()).toBe(false);
  const path = installMimo();
  expect(path).toBe(join(dir, "plugin", "kiwi.ts"));
  expect(mimoInstalled()).toBe(true);
  const text = readFileSync(path, "utf8");
  expect(text).toContain("export const KiwiPlugin = async");
  expect(text.match(/^export /gm)).toHaveLength(1);
  expect(text).toMatch(/^const LISTEN = ".* hook listen # kiwi";$/m);
  writeFileSync(path, text.replace("RETRY_MS = 30_000", "RETRY_MS = 1"));
  expect(mimoInstalled()).toBe(false);
  uninstallMimo();
  expect(existsSync(path)).toBe(false);
  writeFileSync(path, "export const Mine = async () => ({});\n");
  uninstallMimo();
  expect(readFileSync(path, "utf8")).toBe("export const Mine = async () => ({});\n");
});

test("the plugin is strict TypeScript", async () => {
  const dir = scratch("hk-mimo-tsrs-");
  const file = join(dir, "kiwi.ts");
  writeFileSync(file, mimoPluginSource("'kiwi' hook listen # kiwi"));
  const tsrs = Bun.spawn(
    [process.execPath, "x", "tsrs", "--ignoreConfig", "--strict", "--noEmit", "--skipLibCheck", "--target", "es2022", "--module", "esnext", "--moduleResolution", "bundler", "--types", "bun", file],
    {
      cwd: join(import.meta.dir, ".."),
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const out = await new Response(tsrs.stdout).text();
  expect(await tsrs.exited, out).toBe(0);
});

test("the plugin names a child session's root on the agent's shell, and a message for it starts a turn in that root session", async () => {
  const dir = scratch("hk-mimo-run-");
  const calls = join(dir, "calls.log");
  const fake = join(dir, "listen.sh");
  writeFileSync(
    fake,
    `#!/bin/sh\necho "$MIMOCODE_SESSION_ID $(cat)" >> ${JSON.stringify(calls)}\nif [ ! -e ${JSON.stringify(join(dir, "once"))} ]; then touch ${JSON.stringify(join(dir, "once"))}; echo "handoff-1"; echo "New Kiwi Channels messages for you (ch)" >&2; exit 2; fi\nsleep 30\n`,
  );
  chmodSync(fake, 0o755);
  const file = join(dir, "kiwi.ts");
  writeFileSync(file, mimoPluginSource(fake));
  const prompted: Prompted[] = [];
  const parents: Record<string, string> = { ses_child: "ses_root" };
  const client = {
    session: {
      get: async ({ path }: { path: { id: string } }) => ({ data: parents[path.id] ? { parentID: parents[path.id] } : {} }),
      promptAsync: async (o: Prompted) => void prompted.push(o),
    },
  };
  const mod = (await import(file)) as { KiwiPlugin: (input: { client: typeof client }) => Promise<Hooks> };
  expect(Object.keys(mod)).toEqual(["KiwiPlugin"]);
  const hooks = await mod.KiwiPlugin({ client });
  const out = { env: {} as Record<string, string> };
  await hooks["shell.env"]({ cwd: dir, sessionID: "ses_child" }, out);
  expect(out.env.MIMOCODE_SESSION_ID).toBe("ses_root");
  await until("the wake", () => prompted.length === 1);
  expect(prompted[0]).toEqual({ path: { id: "ses_root" }, body: { parts: [{ type: "text", text: "New Kiwi Channels messages for you (ch)" }] }, throwOnError: true });
  await until("the listener started again", () => existsSync(calls) && readFileSync(calls, "utf8").trim().split("\n").length === 2);
  const [first, second] = readFileSync(calls, "utf8").trim().split("\n");
  expect(first).toStartWith("ses_root ");
  expect(JSON.parse(first!.slice("ses_root ".length))).toEqual({ session_id: "ses_root", cwd: dir, hook_event_name: "listen", landed: null });
  expect(JSON.parse(second!.slice("ses_root ".length))).toEqual({ session_id: "ses_root", cwd: dir, hook_event_name: "listen", landed: "handoff-1" });
  await hooks["shell.env"]({ cwd: dir, sessionID: "ses_root" }, { env: {} });
  expect(readFileSync(calls, "utf8").trim().split("\n")).toHaveLength(2);
  await hooks.event({ event: { type: "session.deleted", properties: { info: { id: "ses_root" } } } });
  expect(prompted).toHaveLength(1);
});

test("a wake MiMoCode refuses, by rejecting or by answering with an error, is sent again before the listener runs again, so the messages it carries aren't lost", async () => {
  const dir = scratch("hk-mimo-refused-");
  const calls = join(dir, "calls.log");
  const fake = join(dir, "listen.sh");
  writeFileSync(
    fake,
    `#!/bin/sh\necho "$MIMOCODE_SESSION_ID" >> ${JSON.stringify(calls)}\nif [ ! -e ${JSON.stringify(join(dir, "once"))} ]; then touch ${JSON.stringify(join(dir, "once"))}; echo "New Kiwi Channels messages for you (ch)" >&2; exit 2; fi\nsleep 30\n`,
  );
  chmodSync(fake, 0o755);
  const file = join(dir, "kiwi.ts");
  writeFileSync(file, mimoPluginSource(fake));
  const listens = () => (existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").length : 0);
  const tries: { text: string; listens: number }[] = [];
  const client = {
    session: {
      get: async () => ({ data: {} }),
      promptAsync: async (o: Prompted) => {
        tries.push({ text: o.body.parts.map((p) => p.text).join(""), listens: listens() });
        if (tries.length === 1) throw new Error("connection refused");
        if (tries.length === 2) return { error: { name: "BadRequest" } };
        return { data: true };
      },
    },
  };
  const mod = (await import(file)) as { KiwiPlugin: (input: { client: typeof client }) => Promise<Hooks> };
  const hooks = await mod.KiwiPlugin({ client });
  await hooks["shell.env"]({ cwd: dir, sessionID: "ses_root" }, { env: {} });
  await until("the wake that lands", () => tries.length === 3);
  expect(tries).toEqual([
    { text: "New Kiwi Channels messages for you (ch)", listens: 1 },
    { text: "New Kiwi Channels messages for you (ch)", listens: 1 },
    { text: "New Kiwi Channels messages for you (ch)", listens: 1 },
  ]);
  await until("the listener started again", () => listens() === 2);
  await hooks.event({ event: { type: "session.deleted", properties: { info: { id: "ses_root" } } } });
  expect(tries).toHaveLength(3);
}, 20_000);

test("a wake that can't land stops being sent once its session is deleted", async () => {
  const dir = scratch("hk-mimo-gone-");
  const fake = join(dir, "listen.sh");
  writeFileSync(fake, `#!/bin/sh\necho "New Kiwi Channels messages for you (ch)" >&2\nexit 2\n`);
  chmodSync(fake, 0o755);
  const file = join(dir, "kiwi.ts");
  writeFileSync(file, mimoPluginSource(fake));
  let tries = 0;
  const client = {
    session: {
      get: async () => ({ data: {} }),
      promptAsync: async () => {
        tries += 1;
        throw new Error("connection refused");
      },
    },
  };
  const mod = (await import(file)) as { KiwiPlugin: (input: { client: typeof client }) => Promise<Hooks> };
  const hooks = await mod.KiwiPlugin({ client });
  await hooks["shell.env"]({ cwd: dir, sessionID: "ses_root" }, { env: {} });
  await until("the first refused wake", () => tries >= 1);
  const atDelete = tries;
  await hooks.event({ event: { type: "session.deleted", properties: { info: { id: "ses_root" } } } });
  await Bun.sleep(1_500);
  expect(atDelete).toBe(1);
  expect(tries).toBe(atDelete);
}, 20_000);

test("a client answering with data only, which returns nothing for an HTTP error, is asked to throw instead, so a refused wake is sent again", async () => {
  const dir = scratch("hk-mimo-data-");
  const calls = join(dir, "calls.log");
  const fake = join(dir, "listen.sh");
  writeFileSync(
    fake,
    `#!/bin/sh\necho "$MIMOCODE_SESSION_ID" >> ${JSON.stringify(calls)}\nif [ ! -e ${JSON.stringify(join(dir, "once"))} ]; then touch ${JSON.stringify(join(dir, "once"))}; echo "New Kiwi Channels messages for you (ch)" >&2; exit 2; fi\nsleep 30\n`,
  );
  chmodSync(fake, 0o755);
  const file = join(dir, "kiwi.ts");
  writeFileSync(file, mimoPluginSource(fake));
  const listens = () => (existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").length : 0);
  const tries: number[] = [];
  const client = {
    session: {
      get: async () => ({ data: {} }),
      promptAsync: async (o: Prompted) => {
        tries.push(listens());
        if (tries.length > 1) return undefined;
        if (o.throwOnError) throw { name: "BadRequest" };
        return undefined;
      },
    },
  };
  const mod = (await import(file)) as { KiwiPlugin: (input: { client: typeof client }) => Promise<Hooks> };
  const hooks = await mod.KiwiPlugin({ client });
  await hooks["shell.env"]({ cwd: dir, sessionID: "ses_root" }, { env: {} });
  await until("the wake that lands", () => tries.length === 2);
  expect(tries).toEqual([1, 1]);
  await until("the listener started again", () => listens() === 2);
  await hooks.event({ event: { type: "session.deleted", properties: { info: { id: "ses_root" } } } });
}, 20_000);

test("kiwi hooks install mimo writes the plugin, status says so, and an agent in a named MiMoCode session is told the plugin wakes it", () => {
  const dir = scratch("hk-mimo-extra-");
  setEnv({ KIWI_MIMO_DIR: dir, KIWI_HOME: scratch("hk-mimo-home-") });
  const before = howMessagesReachYou("kiwi", true, { harness: "mimo", session: "ses_1", pid: 9 });
  expect(before).toContain("Kiwi's MiMoCode plugin isn't installed (kiwi hooks install mimo, then restart MiMoCode)");
  expect(installExtra("mimo")).toBe(join(dir, "plugin", "kiwi.ts"));
  expect(extraInstalled("mimo")).toBe(true);
  expect(hooksStatus()).toContain("mimo: installed");
  expect(howMessagesReachYou("kiwi", true, { harness: "mimo", session: "ses_1", pid: 9 })).toBe(
    "Messages for you arrive on their own: Kiwi's MiMoCode plugin wakes you when one comes. Don't run listen.",
  );
  expect(howMessagesReachYou("kiwi", true, { harness: "mimo", session: "mimo-pid-9", pid: 9 })).toContain("restarting MiMoCode loads it");
  uninstallExtra("mimo");
  expect(extraInstalled("mimo")).toBe(false);
});

test("a session whose lookup fails still gets a listener, on its own id, and a message for it starts a turn there", async () => {
  const dir = scratch("hk-mimo-lookup-");
  const calls = join(dir, "calls.log");
  const fake = join(dir, "listen.sh");
  writeFileSync(
    fake,
    `#!/bin/sh\necho "$MIMOCODE_SESSION_ID" >> ${JSON.stringify(calls)}\nif [ ! -e ${JSON.stringify(join(dir, "once"))} ]; then touch ${JSON.stringify(join(dir, "once"))}; echo "New Kiwi Channels messages for you (ch)" >&2; exit 2; fi\nsleep 30\n`,
  );
  chmodSync(fake, 0o755);
  const file = join(dir, "kiwi.ts");
  writeFileSync(file, mimoPluginSource(fake));
  const prompted: Prompted[] = [];
  const client = {
    session: {
      get: async (): Promise<{ data?: { parentID?: string } }> => {
        throw new Error("connection refused");
      },
      promptAsync: async (o: Prompted) => void prompted.push(o),
    },
  };
  const mod = (await import(file)) as { KiwiPlugin: (input: { client: typeof client }) => Promise<Hooks> };
  const hooks = await mod.KiwiPlugin({ client });
  const out = { env: {} as Record<string, string> };
  await hooks["shell.env"]({ cwd: dir, sessionID: "ses_lost" }, out);
  expect(out.env.MIMOCODE_SESSION_ID).toBe("ses_lost");
  await until("the wake", () => prompted.length === 1);
  expect(prompted[0]?.path).toEqual({ id: "ses_lost" });
  expect(readFileSync(calls, "utf8").trim().split("\n")[0]).toBe("ses_lost");
  await hooks.event({ event: { type: "session.deleted", properties: { info: { id: "ses_lost" } } } });
});

test("a new session gets its listener when MiMoCode creates it, before any shell command; a child session's root listens for it", async () => {
  const dir = scratch("hk-mimo-created-");
  const calls = join(dir, "calls.log");
  const fake = join(dir, "listen.sh");
  writeFileSync(fake, `#!/bin/sh\necho "$MIMOCODE_SESSION_ID $(cat)" >> ${JSON.stringify(calls)}\nsleep 30\n`);
  chmodSync(fake, 0o755);
  const file = join(dir, "kiwi.ts");
  writeFileSync(file, mimoPluginSource(fake));
  let lookups = 0;
  const client = {
    session: {
      get: async () => {
        lookups += 1;
        return { data: {} };
      },
      promptAsync: async () => undefined,
    },
  };
  const mod = (await import(file)) as { KiwiPlugin: (input: { client: typeof client }) => Promise<Hooks> };
  const hooks = await mod.KiwiPlugin({ client });
  const started = () => (existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n") : []);
  await hooks.event({ event: { type: "session.created", properties: { info: { id: "ses_new", directory: dir } } } });
  await until("the new session's listener", () => started().length === 1);
  expect(started()[0]).toBe(`ses_new ${JSON.stringify({ session_id: "ses_new", cwd: dir, hook_event_name: "listen", landed: null })}`);
  await hooks.event({ event: { type: "session.created", properties: { info: { id: "ses_sub", parentID: "ses_new", directory: dir } } } });
  const out = { env: {} as Record<string, string> };
  await hooks["shell.env"]({ cwd: dir, sessionID: "ses_sub" }, out);
  expect(out.env.MIMOCODE_SESSION_ID).toBe("ses_new");
  await Bun.sleep(300);
  expect(started()).toHaveLength(1);
  expect(lookups).toBe(0);
  await hooks.event({ event: { type: "session.deleted", properties: { info: { id: "ses_new" } } } });
});

test("a session whose lookup failed once and then works keeps one listener, its root's: the one on its own id stops", async () => {
  const dir = scratch("hk-mimo-relookup-");
  const calls = join(dir, "calls.log");
  const fake = join(dir, "listen.sh");
  writeFileSync(fake, `#!/bin/sh\necho "$MIMOCODE_SESSION_ID $$" >> ${JSON.stringify(calls)}\nsleep 30\n`);
  chmodSync(fake, 0o755);
  const file = join(dir, "kiwi.ts");
  writeFileSync(file, mimoPluginSource(fake));
  let lookups = 0;
  const client = {
    session: {
      get: async ({ path }: { path: { id: string } }): Promise<{ data?: { parentID?: string } }> => {
        lookups += 1;
        if (lookups === 1) throw new Error("connection refused");
        return { data: path.id === "ses_child" ? { parentID: "ses_root" } : {} };
      },
      promptAsync: async () => undefined,
    },
  };
  const mod = (await import(file)) as { KiwiPlugin: (input: { client: typeof client }) => Promise<Hooks> };
  const hooks = await mod.KiwiPlugin({ client });
  const started = () => (existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n") : []);
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      // Signal 0 throws only once no process has that pid.
      return false;
    }
  };
  await hooks["shell.env"]({ cwd: dir, sessionID: "ses_child" }, { env: {} });
  await until("the listener on the session's own id", () => started().length === 1);
  const out = { env: {} as Record<string, string> };
  await hooks["shell.env"]({ cwd: dir, sessionID: "ses_child" }, out);
  expect(out.env.MIMOCODE_SESSION_ID).toBe("ses_root");
  await until("the root's listener", () => started().length === 2);
  const [own, root] = started().map((line) => line.split(" "));
  expect(own?.[0]).toBe("ses_child");
  expect(root?.[0]).toBe("ses_root");
  await until("the listener on the session's own id to stop", () => !alive(Number(own?.[1])));
  expect(alive(Number(root?.[1]))).toBe(true);
  await Bun.sleep(300);
  expect(started()).toHaveLength(2);
  await hooks.event({ event: { type: "session.deleted", properties: { info: { id: "ses_root" } } } });
});

test("a plugin of Kiwi's from an older kiwi is rewritten at the listen hook; a kiwi.ts that isn't Kiwi's, and no kiwi.ts, are left alone", () => {
  const dir = scratch("hk-mimo-migrate-");
  setEnv({ KIWI_MIMO_DIR: dir, KIWI_HOME: scratch("hk-mimo-migrate-home-") });
  const path = installMimo();
  const current = readFileSync(path, "utf8");
  const stale = current.replace("RETRY_MS = 30_000", "RETRY_MS = 60_000");
  writeFileSync(path, stale);
  expect(mimoInstalled()).toBe(false);
  expect(migrateMimo()).toBe(path);
  expect(readFileSync(path, "utf8")).toBe(current);
  expect(mimoInstalled()).toBe(true);
  expect(migrateMimo()).toBeNull();

  writeFileSync(path, stale);
  setEnv({ KIWI_NO_HOOKS: "1" });
  expect(migrateMimo()).toBeNull();
  delete process.env.KIWI_NO_HOOKS;
  updateConfig((c) => {
    c.harnessHooks = { mimo: "off" };
  });
  expect(migrateMimo()).toBeNull();
  expect(readFileSync(path, "utf8")).toBe(stale);
  updateConfig((c) => {
    c.harnessHooks = {};
  });

  const mine = "export const Mine = async () => ({});\n";
  writeFileSync(path, mine);
  expect(migrateMimo()).toBeNull();
  expect(readFileSync(path, "utf8")).toBe(mine);
  rmSync(path);
  expect(migrateMimo()).toBeNull();
  expect(existsSync(path)).toBe(false);
});

test("a lookup that fails after another one for the same session named its root starts no listener on the session's own id", async () => {
  const dir = scratch("hk-mimo-race-");
  const calls = join(dir, "calls.log");
  const fake = join(dir, "listen.sh");
  writeFileSync(fake, `#!/bin/sh\necho "$MIMOCODE_SESSION_ID" >> ${JSON.stringify(calls)}\nsleep 30\n`);
  chmodSync(fake, 0o755);
  const file = join(dir, "kiwi.ts");
  writeFileSync(file, mimoPluginSource(fake));
  let lookups = 0;
  const client = {
    session: {
      get: async ({ path }: { path: { id: string } }): Promise<{ data?: { parentID?: string } }> => {
        lookups += 1;
        if (lookups === 1) {
          await Bun.sleep(300);
          throw new Error("connection refused");
        }
        return { data: path.id === "ses_child" ? { parentID: "ses_root" } : {} };
      },
      promptAsync: async () => undefined,
    },
  };
  const mod = (await import(file)) as { KiwiPlugin: (input: { client: typeof client }) => Promise<Hooks> };
  const hooks = await mod.KiwiPlugin({ client });
  const slow = { env: {} as Record<string, string> };
  const fast = { env: {} as Record<string, string> };
  await Promise.all([hooks["shell.env"]({ cwd: dir, sessionID: "ses_child" }, slow), hooks["shell.env"]({ cwd: dir, sessionID: "ses_child" }, fast)]);
  expect(fast.env.MIMOCODE_SESSION_ID).toBe("ses_root");
  expect(slow.env.MIMOCODE_SESSION_ID).toBe("ses_root");
  await until("the root's listener", () => existsSync(calls));
  await Bun.sleep(500);
  expect(readFileSync(calls, "utf8").trim().split("\n")).toEqual(["ses_root"]);
  await hooks.event({ event: { type: "session.deleted", properties: { info: { id: "ses_root" } } } });
});

test("kiwi hook listen run from MiMoCode rewrites a plugin of Kiwi's from an older kiwi before it listens", async () => {
  const dir = scratch("hk-mimo-hook-");
  const env = { ...process.env, KIWI_MIMO_DIR: dir, KIWI_HOME: scratch("hk-mimo-hook-home-"), MIMOCODE: "1", MIMOCODE_SESSION_ID: "ses_hook" };
  const kiwi = async (args: string[], stdin?: string) => {
    const p = Bun.spawn(kiwiCmd(args), { cwd: dir, env, stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin), stdout: "pipe", stderr: "pipe" });
    const err = await new Response(p.stderr).text();
    expect(await p.exited, err).toBe(0);
  };
  await kiwi(["hooks", "install", "mimo"]);
  const path = join(dir, "plugin", "kiwi.ts");
  const current = readFileSync(path, "utf8");
  writeFileSync(path, current.replace("RETRY_MS = 30_000", "RETRY_MS = 60_000"));
  await kiwi(["hook", "listen"], JSON.stringify({ session_id: "ses_hook", cwd: dir, hook_event_name: "listen", landed: null }));
  expect(readFileSync(path, "utf8")).toBe(current);
}, 20_000);
