import { Database } from "bun:sqlite";
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { forgetSecretCopies } from "../src/config/wipe.ts";
import { RoomDb, type Sql } from "../src/relay/room.ts";

const sqlOf = (db: Database): Sql => ({
  run: (q, ...p) => void db.query(q).run(...p),
  all: <T>(q: string, ...p: (string | number | null)[]) => db.query(q).all(...p) as T[],
});

describe("channel secrets are gone, and nothing they kept stays behind", () => {
  test("a channel that held sealed secrets drops them when the relay opens it", () => {
    const mem = new Database(":memory:");
    const db = new RoomDb(sqlOf(mem), "e".repeat(32));
    db.init();
    mem.run("CREATE TABLE secrets (id TEXT NOT NULL, pk TEXT NOT NULL, box TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (id, pk))");
    mem.run("INSERT INTO secrets VALUES ('s1', 'pk', 'sealed', 1)");
    db.migrate();
    expect(mem.query("SELECT name FROM sqlite_master WHERE name = 'secrets'").all()).toEqual([]);
    mem.close();
  });

  const kiwiHome = mkdtempSync(join(tmpdir(), "kiwi-secrets-gone-"));
  const before = process.env["KIWI_HOME"];
  afterAll(() => {
    if (before === undefined) delete process.env["KIWI_HOME"];
    else process.env["KIWI_HOME"] = before;
    rmSync(kiwiHome, { recursive: true, force: true });
  });

  test("a computer forgets the sealed copies an earlier kiwi kept", () => {
    process.env["KIWI_HOME"] = kiwiHome;
    const kept = join(kiwiHome, "secrets", "room");
    mkdirSync(kept, { recursive: true });
    writeFileSync(join(kept, "agent.json"), "[]");
    forgetSecretCopies();
    expect(existsSync(join(kiwiHome, "secrets"))).toBe(false);
    forgetSecretCopies();
  });
});
