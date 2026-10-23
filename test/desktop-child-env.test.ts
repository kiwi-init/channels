import { expect, test } from "bun:test";
import { join } from "node:path";
import { parseSync } from "oxc-parser";

import { childEnv, sessionEnv } from "../desktop/src/child-env.ts";

type Node = { type: string; start: number; end: number } & Record<string, unknown>;

const SPAWNERS = new Set(["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]);
const ENV_BUILDERS = new Set(["childEnv", "daemonEnv", "CHILD_ENV", "browserEnv"]);
const PASSED_ON = ["desktop/src/open.ts"];
const CHILD_PROCESS = new Set(["child_process", "node:child_process"]);

const isNode = (v: unknown): v is Node => typeof v === "object" && v !== null && typeof (v as { type?: unknown }).type === "string";
const idName = (v: unknown): string | null => (isNode(v) && v.type === "Identifier" && typeof v["name"] === "string" ? v["name"] : null);
const bare = (name: string): string => name.replace(/\d+$/, "");

function builtEnv(args: unknown): boolean {
  if (!Array.isArray(args)) return false;
  return args.some(
    (a) =>
      isNode(a) &&
      a.type === "ObjectExpression" &&
      Array.isArray(a["properties"]) &&
      a["properties"].some((p) => {
        if (!isNode(p) || p.type !== "Property" || p["computed"] || idName(p["key"]) !== "env") return false;
        const value = p["value"];
        if (!isNode(value) || value.type !== "CallExpression") return false;
        const callee = idName(value["callee"]);
        return callee !== null && ENV_BUILDERS.has(bare(callee));
      }),
  );
}

function spawnsIn(code: string): { spawns: number; bad: string[] } {
  const { program, errors } = parseSync("bundle.js", code, { sourceType: "module" });
  if (errors.length) throw new Error(errors.map((e) => e.message).join("\n"));
  const modules = [...code.matchAll(/^\/\/ (\S+\.[cm]?[jt]sx?)$/gm)].map((m) => ({ at: m.index, file: m[1] ?? "" }));
  const moduleAt = (at: number): string => modules.findLast((m) => m.at <= at)?.file ?? "(entry)";
  const lineAt = (at: number): string =>
    `${moduleAt(at)}: ${code
      .slice(code.lastIndexOf("\n", at) + 1, code.indexOf("\n", at))
      .trim()
      .slice(0, 140)}`;
  const direct = new Set<string>();
  const spaces = new Set<string>();
  for (const s of program.body) {
    if (s.type !== "ImportDeclaration" || !CHILD_PROCESS.has(s.source.value)) continue;
    for (const sp of s.specifiers) {
      if (sp.type !== "ImportSpecifier") spaces.add(sp.local.name);
      else if (SPAWNERS.has(sp.imported.type === "Identifier" ? sp.imported.name : sp.imported.value)) direct.add(sp.local.name);
    }
  }
  let spawns = 0;
  const bad: string[] = [];
  const isBunSpawn = (n: unknown): boolean =>
    isNode(n) && n.type === "MemberExpression" && !n["computed"] && idName(n["object"]) === "Bun" && ["spawn", "spawnSync", "$"].includes(idName(n["property"]) ?? "");
  const isSpaceSpawn = (n: unknown): boolean => isNode(n) && n.type === "MemberExpression" && !n["computed"] && spaces.has(idName(n["object"]) ?? "") && SPAWNERS.has(idName(n["property"]) ?? "");
  const visit = (n: Node, parent: Node | null, key: string): void => {
    if (n.type === "CallExpression") {
      const callee = n["callee"];
      if (direct.has(idName(callee) ?? "") || isSpaceSpawn(callee) || isBunSpawn(callee)) {
        spawns++;
        if (!builtEnv(n["arguments"])) bad.push(`spawned without an env from childEnv: ${lineAt(n.start)}`);
      }
    }
    const asCallee = parent !== null && parent.type === "CallExpression" && key === "callee";
    const asKey = parent !== null && !parent["computed"] && ((parent.type === "MemberExpression" && key === "property") || (parent.type === "Property" && key === "key" && !parent["shorthand"]));
    const asImport = parent !== null && (parent.type === "ImportSpecifier" || parent.type === "ImportNamespaceSpecifier" || parent.type === "ImportDefaultSpecifier");
    const asObject = parent !== null && parent.type === "MemberExpression" && key === "object";
    const name = idName(n);
    if (name !== null && !asCallee && !asKey && !asImport && direct.has(name) && !PASSED_ON.some((f) => moduleAt(n.start).endsWith(f)))
      bad.push(`a spawner passed on, its env unchecked: ${lineAt(n.start)}`);
    if (name !== null && !asKey && !asImport && !asObject && spaces.has(name)) bad.push(`child_process passed on, its env unchecked: ${lineAt(n.start)}`);
    if ((isSpaceSpawn(n) || isBunSpawn(n)) && !asCallee) bad.push(`a spawner passed on, its env unchecked: ${lineAt(n.start)}`);
    if (n.type === "Literal" && typeof n["value"] === "string" && CHILD_PROCESS.has(n["value"]) && parent?.type !== "ImportDeclaration")
      bad.push(`child_process reached other than by import: ${lineAt(n.start)}`);
    for (const [k, v] of Object.entries(n)) {
      if (Array.isArray(v)) {
        for (const c of v) if (isNode(c)) visit(c, n, k);
      } else if (isNode(v)) visit(v, n, k);
    }
  };
  visit(program as unknown as Node, null, "");
  return { spawns, bad };
}

test("a child of the app gets only the names it keeps: never a loader, Bun or Node switch, the store key's fd number, or whatever else the app was started with", () => {
  const from = {
    PATH: "/usr/bin:/bin",
    HOME: "/home/someone",
    LANG: "en_US.UTF-8",
    LC_ALL: "en_US.UTF-8",
    XDG_RUNTIME_DIR: "/run/user/1000",
    DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
    SSH_AUTH_SOCK: "/tmp/ssh/agent",
    https_proxy: "http://proxy:3128",
    KIWI_HOME: "/tmp/kiwi-home",
    KIWI_KEY_FD: "3",
    LD_LIBRARY_PATH: ".",
    LD_PRELOAD: "/tmp/evil.so",
    DYLD_INSERT_LIBRARIES: "/tmp/evil.dylib",
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
    BUN_OPTIONS: "--preload=/tmp/evil.ts",
    BUN_INSPECT: "127.0.0.1:9229",
    NODE_OPTIONS: "--require=/tmp/evil.js",
    ELECTRON_RUN_AS_NODE: "1",
    REX_SESSION: "session:1",
    TERM_PROGRAM: "rex",
    SOMETHING_ELSE: "x",
  };
  expect(childEnv(from)).toEqual({
    PATH: "/usr/bin:/bin",
    HOME: "/home/someone",
    LANG: "en_US.UTF-8",
    LC_ALL: "en_US.UTF-8",
    XDG_RUNTIME_DIR: "/run/user/1000",
    DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
    SSH_AUTH_SOCK: "/tmp/ssh/agent",
    https_proxy: "http://proxy:3128",
    KIWI_HOME: "/tmp/kiwi-home",
  });
  expect(from.KIWI_KEY_FD).toBe("3");
  expect(childEnv({ Path: "C:\\Windows", SystemRoot: "C:\\Windows", ComSpec: "cmd.exe", USERPROFILE: "C:\\Users\\a", lc_ctype: "C" })).toEqual({
    Path: "C:\\Windows",
    SystemRoot: "C:\\Windows",
    ComSpec: "cmd.exe",
    USERPROFILE: "C:\\Users\\a",
    lc_ctype: "C",
  });
});

test("the person's browser keeps their session (an input method, a theme) but never the app's loader, Bun or Node switches or the key's fd number", () => {
  expect(
    sessionEnv({
      PATH: "/usr/bin",
      GTK_IM_MODULE: "fcitx",
      QT_QPA_PLATFORMTHEME: "gtk3",
      LD_LIBRARY_PATH: ".",
      ld_preload: "/tmp/evil.so",
      BUN_OPTIONS: "--preload=x",
      NODE_OPTIONS: "--require=x",
      KIWI_KEY_FD: "3",
    }),
  ).toEqual({
    PATH: "/usr/bin",
    GTK_IM_MODULE: "fcitx",
    QT_QPA_PLATFORMTHEME: "gtk3",
  });
});

test("the check finds every way a bundle can spawn, and passes only a call whose env is built by childEnv or a builder on it", () => {
  const code = [
    'import { spawn as spawn2, execFile } from "child_process";',
    'import * as cp from "node:child_process";',
    "// desktop/src/a.ts",
    'spawn2("ok", [], { stdio: "ignore", env: childEnv() });',
    'execFile("no-env", [], { timeout: 1 });',
    'cp.spawnSync("process-env", [], { env: process.env });',
    'Bun.spawn(["startup-env"]);',
    'Bun.spawnSync({ cmd: ["ok"], env: childEnv2() });',
    "const passed = execFile;",
    'const again = require("child_process");',
    "// desktop/src/open.ts",
    "function open(launch = spawn2) {}",
  ].join("\n");
  expect(spawnsIn(code)).toEqual({
    spawns: 5,
    bad: [
      'spawned without an env from childEnv: desktop/src/a.ts: execFile("no-env", [], { timeout: 1 });',
      'spawned without an env from childEnv: desktop/src/a.ts: cp.spawnSync("process-env", [], { env: process.env });',
      'spawned without an env from childEnv: desktop/src/a.ts: Bun.spawn(["startup-env"]);',
      "a spawner passed on, its env unchecked: desktop/src/a.ts: const passed = execFile;",
      'child_process reached other than by import: desktop/src/a.ts: const again = require("child_process");',
    ],
  });
});

test("every spawn the Electrobun main and the keys code can reach passes an env built by childEnv: Bun.spawn's default is Bun's startup environment, which still holds KIWI_KEY_FD", async () => {
  const src = join(import.meta.dir, "../desktop/src");
  const built = await Bun.build({
    entrypoints: [join(src, "main-eb.ts"), join(src, "channels.ts")],
    target: "bun",
    external: ["electrobun", "electrobun/*", "electron"],
    plugins: [{ name: "electrobun-internals", setup: (b) => void b.onResolve({ filter: /\/\.hutch\// }, (a) => ({ path: a.path, external: true })) }],
    throw: false,
  });
  expect(built.logs.map(String)).toEqual([]);
  const found = await Promise.all(built.outputs.map(async (o) => spawnsIn(await o.text())));
  expect(found.flatMap((f) => f.bad)).toEqual([]);
  expect(found.reduce((n, f) => n + f.spawns, 0)).toBeGreaterThanOrEqual(5);
}, 60_000);
