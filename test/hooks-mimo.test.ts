import { afterAll, afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { howMessagesReachYou } from "../src/hooks.ts";
import { extraInstalled, hooksStatus, installExtra, uninstallExtra } from "../src/hooks/install/extra.ts";
import { installMimo, mimoConfigRoot, mimoInstalled, mimoPluginPath, mimoPluginSource, uninstallMimo } from "../src/hooks/install/mimo.ts";
import { handoffFrom } from "../src/hooks/listen.ts";

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
  event: (input: { event: { type: string; properties?: { info?: { id?: string; parentID?: string } } } }) => Promise<void>;
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
  const dir = scratch("hk-mimo-tsc-");
  const file = join(dir, "kiwi.ts");
  writeFileSync(file, mimoPluginSource("'kiwi' hook listen # kiwi"));
  const tsc = Bun.spawn(
    [process.execPath, "x", "tsc", "--ignoreConfig", "--strict", "--noEmit", "--skipLibCheck", "--target", "es2022", "--module", "esnext", "--moduleResolution", "bundler", "--types", "bun", file],
    {
      cwd: join(import.meta.dir, ".."),
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const out = await new Response(tsc.stdout).text();
  expect(await tsc.exited, out).toBe(0);
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
