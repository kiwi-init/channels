import { afterAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { names, holds, tailLines } from "../src/loop/fs.ts";
import { realDir, withDb } from "../src/loop/sqlite.ts";
import * as tmux from "../src/loop/tmux.ts";
import * as kimi from "../src/loop/kimi.ts";
import { mimoIdle, mimoSession } from "../src/loop/mimo.ts";
import * as base from "./fixtures/loop-helpers.ts";

const root = mkdtempSync(join(tmpdir(), "kiwi-loop-helpers-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe(`loop helper equivalence against ${base.LOOP_HELPER_BASE}`, () => {
  test("names and holds preserve missing, non-directory, empty and UTF-8 inputs", () => {
    const dir = join(root, "files");
    mkdirSync(dir);
    const file = join(dir, "data");
    writeFileSync(file, "hello \u0000\nnonce 🥝\n");
    const empty = join(dir, "empty");
    writeFileSync(empty, "");
    const missing = join(dir, "missing");
    const broken = join(dir, "broken");
    symlinkSync(missing, broken);
    for (const path of [dir, file, empty, missing, broken]) {
      expect(names(path)).toEqual(base.names(path));
      for (const nonce of ["nonce", "🥝", "", "absent"]) expect(holds(path, nonce)).toBe(base.holds(path, nonce));
      expect(realDir(path)).toBe(base.realDir(path));
    }
    const link = join(root, "linked-files");
    symlinkSync(dir, link);
    expect(realDir(link)).toBe(base.realDir(link));
    expect(names(link)).toEqual(base.names(link));
  });

  test("tail preserves 64 KiB truncation, partial first-line removal, ordering and soft failures", () => {
    const file = join(root, "tail.jsonl");
    for (const content of ["", "one\ntwo\n", "one\nunfinished", "a".repeat(65_536), "a".repeat(65_530) + "\nkept\nunfinished", "🥝".repeat(20_000) + "\nlast\n"]) {
      writeFileSync(file, content);
      expect(tailLines(file)).toEqual(base.tail(file));
    }
    expect(tailLines(root)).toEqual(base.tail(root));
    expect(tailLines(join(root, "missing-tail"))).toEqual(base.tail(join(root, "missing-tail")));
  });

  test("Kimi retains its original runtime exports, including compatibility re-exports", () => {
    expect(Object.keys(kimi).sort()).toEqual(base.KIMI_EXPORTS);
    for (const name of ["paneText", "typeInto", "pasteBracketed", "clearPane", "paneIsOurs", "processes"] as const) expect(kimi[name]).toBe(tmux[name]);
    expect(kimi.paneIsOurs.length).toBe(base.paneIsOurs.length);
  });
});

describe("read-only SQLite lifecycle", () => {
  const home = join(root, "mimo");
  const file = join(home, "data", "mimocode.db");
  mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file);
  db.exec("CREATE TABLE example (value INTEGER); INSERT INTO example VALUES (7)");
  db.close();

  test("path and MiMo env call shapes preserve results, soft errors, read-only access and closing", () => {
    const adapters: (typeof withDb)[] = [base.zcodeWithDb, (path, read, none) => base.mimoWithDb({ MIMOCODE_HOME: dirname(dirname(path)) }, read, none)];
    const readers: ((db: Database) => unknown)[] = [
      (connection) => connection.query("SELECT value FROM example").get(),
      (connection) => connection.exec("INSERT INTO example VALUES (8)"),
      (connection) => connection.query("SELECT * FROM missing_table").all(),
      () => {
        throw new Error("reader failed");
      },
    ];
    for (const original of adapters) {
      for (const read of readers) expect(withDb(file, read, "none")).toEqual(original(file, read, "none"));
      for (const readDb of [original, withDb]) {
        const connection = readDb<Database | null>(file, (opened) => opened, null);
        expect(connection).not.toBeNull();
        if (!connection) throw new Error("database unexpectedly absent");
        expect(() => connection.query("SELECT 1").get()).toThrow();
        let held: Database | undefined;
        expect(
          readDb(
            file,
            (opened) => {
              held = opened;
              throw new Error("reader failed");
            },
            "none",
          ),
        ).toBe("none");
        if (!held) throw new Error("reader was not called");
        const closed = held;
        expect(() => closed.query("SELECT 1").get()).toThrow();
      }
    }
    expect(withDb(file, (connection) => connection.query("SELECT COUNT(*) AS n FROM example").get(), null)).toEqual({ n: 1 });
  });

  test("missing, directory and corrupt databases return the original fallback without creating files", () => {
    const missing = join(root, "missing.db");
    const corrupt = join(root, "corrupt.db");
    writeFileSync(corrupt, "not SQLite");
    for (const path of [missing, root, corrupt]) {
      const read = (connection: Database) => connection.query("SELECT 1").get();
      expect(withDb(path, read, "fallback")).toEqual(base.zcodeWithDb(path, read, "fallback"));
    }
    expect(existsSync(missing)).toBe(false);
  });

  test("MiMo's production env wrapper matches original session/idle readers for absolute and XDG paths", () => {
    for (const env of [{ MIMOCODE_HOME: join(root, "mimo-absolute") }, { MIMOCODE_HOME: "relative-ignored", XDG_DATA_HOME: join(root, "xdg") }]) {
      const file = join(base.mimoRoot("data", env), "mimocode.db");
      const compare = () => {
        expect(mimoSession("nonce", 1_000, root, env)).toBe(base.mimoSession("nonce", 1_000, root, env));
        expect(mimoIdle("session", env)).toEqual(base.mimoIdle("session", env));
      };
      compare();
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, "corrupt");
      compare();
      rmSync(file);
      const connection = new Database(file);
      try {
        connection.exec(
          "CREATE TABLE session (id TEXT, parent_id TEXT, directory TEXT, time_created INTEGER); CREATE TABLE part (session_id TEXT, data TEXT); CREATE TABLE message (session_id TEXT, agent_id TEXT, time_created INTEGER, data TEXT)",
        );
        connection.query("INSERT INTO session VALUES ('session', NULL, ?, 1000)").run(realDir(root));
        connection.exec("INSERT INTO part VALUES ('session', 'nonce')");
        compare();
        for (const data of ["{", '{"role":"user"}', '{"role":"assistant","time":{}}', '{"role":"assistant","time":{"completed":1700}}']) {
          connection.exec("DELETE FROM message");
          connection.query("INSERT INTO message VALUES ('session', 'main', 1100, ?)").run(data);
          compare();
        }
      } finally {
        connection.close();
      }
    }
  });
});

const fakeTmux = join(root, "tmux");
writeFileSync(
  fakeTmux,
  `#!/bin/sh
printf '%s\\000' "$@" >> "$LOOP_TMUX_CALLS"
printf '\\n' >> "$LOOP_TMUX_CALLS"
if [ "$4" = "$LOOP_TMUX_FAIL" ]; then exit 1; fi
if [ "$4" = "load-buffer" ]; then cp "$7" "$LOOP_TMUX_PROMPT"; fi
if [ "$4" = "capture-pane" ] || [ "$4" = "display-message" ]; then printf '%s' "$LOOP_TMUX_OUTPUT"; fi
exit 0
`,
  { mode: 0o700 },
);

function tmuxResult(run: () => unknown, output: string, fail = "") {
  const keys = ["KIWI_TMUX", "LOOP_TMUX_CALLS", "LOOP_TMUX_OUTPUT", "LOOP_TMUX_FAIL", "LOOP_TMUX_PROMPT"];
  const before = keys.map((key) => [key, process.env[key]] as const);
  const callsFile = join(root, "tmux-calls");
  const promptFile = join(root, "tmux-prompt");
  rmSync(promptFile, { force: true });
  writeFileSync(callsFile, "");
  Object.assign(process.env, { KIWI_TMUX: fakeTmux, LOOP_TMUX_CALLS: callsFile, LOOP_TMUX_OUTPUT: output, LOOP_TMUX_FAIL: fail, LOOP_TMUX_PROMPT: promptFile });
  try {
    const value = run();
    const calls: unknown = readFileSync(callsFile, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split("\u0000").slice(0, -1));
    if (!Array.isArray(calls)) throw new Error("invalid recorded calls");
    const paths = calls.flatMap((call: unknown) => (Array.isArray(call) && call[3] === "load-buffer" && typeof call[6] === "string" ? [call[6]] : []));
    const normalized = JSON.stringify(calls).replace(/[^" ]*kiwi-loop-[^/" ]+\/prompt\.txt/g, "<prompt-file>");
    return { value, calls: JSON.parse(normalized), prompt: existsSync(promptFile) ? readFileSync(promptFile, "utf8") : null, cleaned: paths.every((path) => !existsSync(path)) };
  } finally {
    for (const [key, value] of before) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe("tmux helpers with deterministic subprocess replies and process lists", () => {
  test("pane text, bracketed paste and clear preserve arguments, results and failed-command handling", () => {
    for (const output of ["captured text\n", "1\n", "0", ""]) {
      for (const fail of ["", "capture-pane", "display-message", "send-keys", "clear-history"]) {
        expect(tmuxResult(() => tmux.paneText("socket", "%7"), output, fail)).toEqual(tmuxResult(() => base.paneText("socket", "%7"), output, fail));
        expect(tmuxResult(() => tmux.pasteBracketed("socket", "%7"), output, fail)).toEqual(tmuxResult(() => base.pasteBracketed("socket", "%7"), output, fail));
        expect(tmuxResult(() => tmux.clearPane("socket", "%7"), output, fail)).toEqual(tmuxResult(() => base.clearPane("socket", "%7"), output, fail));
      }
    }
  });

  test("typing preserves multiline prompt bytes, stop-on-error behavior and temporary cleanup", () => {
    for (const fail of ["", "load-buffer", "paste-buffer", "send-keys", "delete-buffer"]) {
      const text = "first line\n🥝 $HOME `literal`\n";
      const actual = tmuxResult(() => tmux.typeInto("socket", "%7", text), "", fail);
      expect(actual).toEqual(tmuxResult(() => base.typeInto("socket", "%7", text), "", fail));
      expect(actual.cleaned).toBe(true);
      if (fail !== "load-buffer") expect(actual.prompt).toBe(text);
    }
  });

  test("pane ownership preserves injected ancestry, invalid PIDs, the 64-hop bound and default processes", () => {
    const chain = Array.from({ length: 70 }, (_, i) => ({ pid: i === 0 ? process.pid : 2_000_000 + i, ppid: 2_000_001 + i, start: "fixed", args: "test" }));
    for (const output of [String(process.pid), "2000001", "2000063", "2000064", "2", "1", "0", "bad", ""]) {
      for (const procs of [[], chain, [{ pid: process.pid, ppid: process.pid, start: "fixed", args: "cycle" }]]) {
        expect(tmuxResult(() => tmux.paneIsOurs("socket", "%7", procs), output)).toEqual(tmuxResult(() => base.paneIsOurs("socket", "%7", procs), output));
      }
    }
    expect(tmuxResult(() => kimi.paneIsOurs("socket", "%7"), String(process.pid))).toEqual(tmuxResult(() => base.paneIsOurs("socket", "%7"), String(process.pid)));
  });

  test("process listings preserve parsing and command failure", () => {
    const bin = join(root, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "ps"), '#!/bin/sh\nprintf "%s" "$LOOP_PS_TEXT"\nexit "$LOOP_PS_CODE"\n', { mode: 0o700 });
    const keys = ["PATH", "LOOP_PS_TEXT", "LOOP_PS_CODE"];
    const before = keys.map((key) => [key, process.env[key]] as const);
    try {
      process.env.PATH = `${bin}:${process.env.PATH ?? ""}`;
      process.env.LOOP_PS_TEXT = " 123 1 Mon Nov 9 12:00:00 2026 /bin/kiwi hook listen\ninvalid\n124 123 Tue Nov 10 01:02:03 2026 agent --flag\n";
      for (const code of ["0", "1"]) {
        process.env.LOOP_PS_CODE = code;
        expect(tmux.processes()).toEqual(base.processes());
      }
    } finally {
      for (const [key, value] of before) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
