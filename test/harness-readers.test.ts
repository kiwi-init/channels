import { Database } from "bun:sqlite";
import { afterAll, afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harnessActivity, harnessModel } from "../src/harness.ts";

const root = mkdtempSync(join(tmpdir(), "kiwi-harness-readers-"));
let n = 0;
const fresh = (): string => {
  const dir = join(root, String(n++));
  mkdirSync(dir, { recursive: true });
  return dir;
};

const NOW = Date.UTC(2030, 0, 16, 1, 15);

afterEach(() => setSystemTime());
afterAll(() => rmSync(root, { recursive: true, force: true }));

type Columns = "full" | "model-only" | "activity-only";

function opencode(columns: Columns, row: { model?: string; idle?: number | null; updated?: number | null } = {}): string {
  const data = fresh();
  mkdirSync(join(data, "opencode"));
  const db = new Database(join(data, "opencode", "opencode.db"));
  const cols = { full: "id TEXT, model TEXT, time_idle INTEGER, time_updated INTEGER", "model-only": "id TEXT, model TEXT", "activity-only": "id TEXT, time_idle INTEGER, time_updated INTEGER" }[
    columns
  ];
  db.run(`CREATE TABLE session_v2 (${cols})`);
  if (columns === "model-only") db.run("INSERT INTO session_v2 VALUES (?, ?)", ["ses-1", row.model ?? null]);
  else if (columns === "activity-only") db.run("INSERT INTO session_v2 VALUES (?, ?, ?)", ["ses-1", row.idle ?? null, row.updated ?? null]);
  else db.run("INSERT INTO session_v2 VALUES (?, ?, ?, ?)", ["ses-1", row.model ?? null, row.idle ?? null, row.updated ?? null]);
  db.close();
  return data;
}

type GrokSession = { summary?: string; updatedAt?: number };

function grok(workspaces: GrokSession[]): string {
  const home = fresh();
  for (const [i, ws] of workspaces.entries()) {
    const dir = join(home, "sessions", `ws-${i}`, "grok-1");
    mkdirSync(dir, { recursive: true });
    if (ws.summary !== undefined) writeFileSync(join(dir, "summary.json"), ws.summary);
    if (ws.updatedAt !== undefined) {
      writeFileSync(join(dir, "updates.jsonl"), "{}\n");
      utimesSync(join(dir, "updates.jsonl"), ws.updatedAt / 1000, ws.updatedAt / 1000);
    }
  }
  return home;
}

function grokInOrder(first: GrokSession, second: GrokSession): string {
  const home = grok([{}, {}]);
  const [a, b] = readdirSync(join(home, "sessions"));
  for (const [ws, s] of [
    [a, first],
    [b, second],
  ] as const) {
    const dir = join(home, "sessions", ws ?? "", "grok-1");
    if (s.summary !== undefined) writeFileSync(join(dir, "summary.json"), s.summary);
  }
  return home;
}

const summary = (id: string): string => JSON.stringify({ current_model_id: id });
const opencodeModelJson = (id: string): string => JSON.stringify({ id, providerID: "anthropic" });

describe("harnessModel at base 2b432da (#2414)", () => {
  test("OpenCode with a full schema reads its model", async () => {
    expect(await harnessModel({ OPENCODE_SESSION_ID: "ses-1", XDG_DATA_HOME: opencode("full", { model: opencodeModelJson("claude-sonnet-4-5") }) }, { tree: {} })).toBe("claude-sonnet-4-5");
  });

  test("OpenCode with only the model column still reads its model", async () => {
    expect(await harnessModel({ OPENCODE_SESSION_ID: "ses-1", XDG_DATA_HOME: opencode("model-only", { model: opencodeModelJson("gpt-5") }) }, { tree: {} })).toBe("gpt-5");
  });

  test("OpenCode with only the activity columns can't tell the model", async () => {
    expect(await harnessModel({ OPENCODE_SESSION_ID: "ses-1", XDG_DATA_HOME: opencode("activity-only", { idle: 5, updated: 4 }) }, { tree: {} })).toBeUndefined();
  });

  test("OpenCode with no database can't tell", async () => {
    expect(await harnessModel({ OPENCODE_SESSION_ID: "ses-1", XDG_DATA_HOME: fresh() }, { tree: {} })).toBeUndefined();
  });

  test("Grok reads the first workspace holding the session", async () => {
    expect(await harnessModel({ GROK_SESSION_ID: "grok-1", GROK_HOME: grok([{ summary: summary("grok-4") }]) }, { tree: {} })).toBe("grok-4");
  });

  test("Grok with a malformed first match can't tell, rather than trying the next workspace", async () => {
    expect(await harnessModel({ GROK_SESSION_ID: "grok-1", GROK_HOME: grokInOrder({ summary: "{not json" }, { summary: summary("grok-4") }) }, { tree: {} })).toBeUndefined();
  });

  test("Grok with no sessions folder can't tell", async () => {
    expect(await harnessModel({ GROK_SESSION_ID: "grok-1", GROK_HOME: fresh() }, { tree: {} })).toBeUndefined();
  });

  test("with several flags, the first reader that answers wins and later ones aren't used", async () => {
    const env = { GROK_SESSION_ID: "grok-1", GROK_HOME: grok([{ summary: summary("grok-4") }]), OPENCODE_SESSION_ID: "ses-1", XDG_DATA_HOME: opencode("full", { model: opencodeModelJson("gpt-5") }) };
    expect(await harnessModel(env, { tree: {} })).toBe("grok-4");
  });

  test("a reader with nothing to say is followed by the next one", async () => {
    const env = { GROK_SESSION_ID: "grok-1", GROK_HOME: grok([{}]), OPENCODE_SESSION_ID: "ses-1", XDG_DATA_HOME: opencode("full", { model: opencodeModelJson("gpt-5") }) };
    expect(await harnessModel(env, { tree: {} })).toBe("gpt-5");
  });

  test("a throwing reader is followed by the next one", async () => {
    const env = { GROK_SESSION_ID: "grok-1", GROK_HOME: fresh(), OPENCODE_SESSION_ID: "ses-1", XDG_DATA_HOME: opencode("full", { model: opencodeModelJson("gpt-5") }) };
    expect(await harnessModel(env, { tree: {} })).toBe("gpt-5");
  });

  test("a rejecting reader is followed by the next one", async () => {
    const env = { GROK_SESSION_ID: "grok-1", GROK_HOME: grok([{ summary: summary("grok-4") }]), OPENCODE_SESSION_ID: "ses-1", XDG_DATA_HOME: opencode("activity-only", { idle: 5, updated: 4 }) };
    expect(await harnessModel({ ...env, GROK_HOME: fresh() }, { tree: {} })).toBeUndefined();
    expect(await harnessModel(env, { tree: {} })).toBe("grok-4");
  });
});

describe("harnessActivity at base 2b432da (#2414)", () => {
  test("OpenCode idle after its last change reads idle since then, with its model", async () => {
    expect(await harnessActivity({ OPENCODE_SESSION_ID: "ses-1", XDG_DATA_HOME: opencode("full", { model: opencodeModelJson("gpt-5"), idle: 200, updated: 100 }) })).toEqual({
      state: "idle",
      since: 200,
      model: "gpt-5",
    });
  });

  test("OpenCode changed after it went idle reads working", async () => {
    expect(await harnessActivity({ OPENCODE_SESSION_ID: "ses-1", XDG_DATA_HOME: opencode("full", { model: opencodeModelJson("gpt-5"), idle: 100, updated: 200 }) })).toEqual({
      state: "working",
      model: "gpt-5",
    });
  });

  test("OpenCode with no update time reads unknown, still with its model", async () => {
    expect(await harnessActivity({ OPENCODE_SESSION_ID: "ses-1", XDG_DATA_HOME: opencode("full", { model: opencodeModelJson("gpt-5"), idle: 100, updated: null }) })).toEqual({
      state: "unknown",
      model: "gpt-5",
    });
  });

  test("OpenCode with only the activity columns reads its state, without a model", async () => {
    expect(await harnessActivity({ OPENCODE_SESSION_ID: "ses-1", XDG_DATA_HOME: opencode("activity-only", { idle: 200, updated: 100 }) })).toEqual({ state: "idle", since: 200 });
  });

  test("OpenCode with only the model column can't tell what it's doing", async () => {
    expect(await harnessActivity({ OPENCODE_SESSION_ID: "ses-1", XDG_DATA_HOME: opencode("model-only", { model: opencodeModelJson("gpt-5") }) })).toBeUndefined();
  });

  test("OpenCode with no database can't tell", async () => {
    expect(await harnessActivity({ OPENCODE_SESSION_ID: "ses-1", XDG_DATA_HOME: fresh() })).toBeUndefined();
  });

  test("Grok quiet for over a minute reads idle since its last update, on a fixed clock", async () => {
    setSystemTime(new Date(NOW));
    const at = NOW - 61_000;
    expect(await harnessActivity({ GROK_SESSION_ID: "grok-1", GROK_HOME: grok([{ summary: summary("grok-4"), updatedAt: at }]) })).toEqual({ state: "idle", since: at, model: "grok-4" });
  });

  test("Grok updated within the minute reads working", async () => {
    setSystemTime(new Date(NOW));
    expect(await harnessActivity({ GROK_SESSION_ID: "grok-1", GROK_HOME: grok([{ summary: summary("grok-4"), updatedAt: NOW - 30_000 }]) })).toEqual({ state: "working", model: "grok-4" });
  });

  test("with several flags, the first reader that answers wins", async () => {
    setSystemTime(new Date(NOW));
    const env = {
      GROK_SESSION_ID: "grok-1",
      GROK_HOME: grok([{ summary: summary("grok-4"), updatedAt: NOW - 30_000 }]),
      OPENCODE_SESSION_ID: "ses-1",
      XDG_DATA_HOME: opencode("full", { model: opencodeModelJson("gpt-5"), idle: 200, updated: 100 }),
    };
    expect(await harnessActivity(env)).toEqual({ state: "working", model: "grok-4" });
  });

  test("a reader with nothing to say, then a throwing one, is followed by the next", async () => {
    const env = { GROK_SESSION_ID: "grok-1", GROK_HOME: fresh(), OPENCODE_SESSION_ID: "ses-1", XDG_DATA_HOME: opencode("full", { model: opencodeModelJson("gpt-5"), idle: 200, updated: 100 }) };
    expect(await harnessActivity(env)).toEqual({ state: "idle", since: 200, model: "gpt-5" });
    expect(await harnessActivity({ ...env, GROK_HOME: grok([{}]) })).toEqual({ state: "idle", since: 200, model: "gpt-5" });
  });

  test("a rejecting reader with nothing after it can't tell", async () => {
    expect(
      await harnessActivity({ GROK_SESSION_ID: "grok-1", GROK_HOME: grok([{}]), OPENCODE_SESSION_ID: "ses-1", XDG_DATA_HOME: opencode("model-only", { model: opencodeModelJson("gpt-5") }) }),
    ).toBeUndefined();
  });
});
