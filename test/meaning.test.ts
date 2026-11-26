import { describe, expect, test } from "bun:test";

import { useHost } from "../desktop/src/host.ts";
import { meaningAsk, meaningRequest, meaningScores, searchMeaning, setTypesafeKey, typesafeKey, type Ask } from "../desktop/src/meaning.ts";
import { openStore, snapshot, store, type StoreFile } from "../desktop/src/store.ts";
import { fakeHost } from "./fake-host.ts";

useHost(fakeHost().host);

const item = (id: number, text = "release goes out friday") => ({ id, from: "ana", where: "# general", text });
const saved: StoreFile[] = [];
const open = (file: Partial<StoreFile> = {}) => openStore({ where: () => "/data/kiwi-store.bin", load: () => ({ ok: true, file, resave: false }), save: (f) => void saved.push(f) });
const yes: Ask = async (body) => ({
  status: 200,
  body: { answers: Object.fromEntries(Object.keys((body as { questions: object }).questions).map((k, i) => [k, { type: "noul", noul: i === 0 ? 0.9 : 0.1 }])) },
});

describe("a meaning search sends Jev only what it needs, and reads its answers back", () => {
  test("an ask names a query and messages, each with an id, who, where and text", () => {
    expect(meaningAsk({ query: " when do we ship ", items: [item(4)] })).toEqual({ query: "when do we ship", items: [item(4)] });
    expect(meaningAsk({ query: "", items: [item(4)] })).toBeNull();
    expect(meaningAsk({ query: "x".repeat(201), items: [] })).toBeNull();
    expect(meaningAsk({ query: "ship", items: [item(1), item(1)] })).toBeNull();
    expect(meaningAsk({ query: "ship", items: [{ ...item(1), text: "x".repeat(601) }] })).toBeNull();
    expect(meaningAsk({ query: "ship", items: Array.from({ length: 161 }, (_, i) => item(i)) })).toBeNull();
  });

  test("extra fields on a message never reach Jev", () => {
    const ask = meaningAsk({ query: "ship", items: [{ ...item(4), secret: "key" }] })!;
    expect(JSON.stringify(meaningRequest(ask.query, ask.items))).not.toContain("secret");
  });

  test("each message gets its own yes-or-no question about the same query", () => {
    const req = meaningRequest("when do we ship", [item(4), item(9, "lunch?")]) as { state: { query: string; messages: unknown[] }; questions: Record<string, { type: string; instructions: string }> };
    expect(req.state).toEqual({
      query: "when do we ship",
      messages: [
        { from: "ana", where: "# general", text: "release goes out friday" },
        { from: "ana", where: "# general", text: "lunch?" },
      ],
    });
    expect(Object.keys(req.questions)).toEqual(["m0", "m1"]);
    expect(req.questions.m1!.type).toBe("noul");
    expect(req.questions.m1!.instructions).toContain("`messages[1]`");
  });

  test("answers map back to message ids, and a missing answer drops that message", () => {
    expect(meaningScores([item(4), item(9)], { answers: { m0: { type: "noul", noul: 0.93 }, m1: { type: "noul" } } })).toEqual([{ id: 4, p: 0.93 }]);
    expect(meaningScores([item(4)], null)).toEqual([]);
  });
});

describe("search by meaning runs on the person's own TypeSafe key, from this computer", () => {
  test("without a key nothing is sent", async () => {
    open();
    let sent = 0;
    expect(await searchMeaning({ query: "ship", items: [item(1)] }, async () => (sent++, null))).toEqual({ failed: "no-key" });
    expect(sent).toBe(0);
  });

  test("with a key, its own key goes to Jev and hits come best first", async () => {
    open({ typesafe: { key: "apikey_mine_1234" } });
    const keys: string[] = [];
    const out = await searchMeaning({ query: "ship", items: Array.from({ length: 10 }, (_, i) => item(i)) }, async (body, key) => (keys.push(key), yes(body, key)));
    expect(keys).toEqual(["apikey_mine_1234", "apikey_mine_1234"]);
    expect("hits" in out && out.hits.slice(0, 2)).toEqual([
      { id: 0, p: 0.9 },
      { id: 8, p: 0.9 },
    ]);
  });

  test("a refused key and no answer at all are told apart", async () => {
    open({ typesafe: { key: "apikey_mine_1234" } });
    expect(await searchMeaning({ query: "ship", items: [item(1)] }, async () => ({ status: 401, body: null }))).toEqual({ failed: "key-refused" });
    expect(await searchMeaning({ query: "ship", items: [item(1)] }, async () => null)).toEqual({ failed: "unreachable" });
  });

  test("a key is saved only after TypeSafe takes it, shows only its last four, and never reaches the UI's snapshot", async () => {
    open();
    expect(await setTypesafeKey("short")).toEqual({ ok: false, why: "malformed" });
    expect(await setTypesafeKey("apikey_bad_00000", async () => ({ status: 401, body: null }))).toEqual({ ok: false, why: "refused" });
    expect(store.typesafe).toBeUndefined();
    expect(await setTypesafeKey("  apikey_good_9876 ", yes)).toEqual({ ok: true, key: { set: true, ends: "9876" } });
    expect(saved.at(-1)?.typesafe).toEqual({ key: "apikey_good_9876" });
    expect(JSON.stringify(snapshot())).not.toContain("apikey_good");
    expect(await setTypesafeKey(null)).toEqual({ ok: true, key: { set: false, ends: null } });
    expect(typesafeKey()).toEqual({ set: false, ends: null });
  });
});
