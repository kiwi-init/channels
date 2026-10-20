import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signRequest } from "@kiwi/core/auth.ts";
import { Channel } from "@kiwi/core/client.ts";
import { seal } from "@kiwi/core/crypto.ts";
import { generateIdentity, sign, verify } from "@kiwi/core/identity.ts";
import { PROTOCOL_VERSION } from "@kiwi/core/protocol.ts";
import { fold } from "@kiwi/core/state.ts";
import { startRelay } from "../src/relay/bun.ts";

setDefaultTimeout(30_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-verify-total-"));
let server: ReturnType<typeof startRelay> | undefined;
let relay = "";

beforeAll(() => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  relay = server.url.origin;
});
afterAll(() => {
  server?.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

describe("a signature check never throws (T1123)", () => {
  test("a pk or sig that isn't base64url reads as unsigned", async () => {
    const id = await generateIdentity("dev");
    const good = await sign(id, { what: "x" });
    expect(await verify(good)).toBe(true);
    for (const pk of ["!!!", "not base64 at all", "%%", "a b"]) expect(await verify({ ...good, pk })).toBe(false);
    expect(await verify({ ...good, sig: "!!!" })).toBe(false);
    expect(await verify({ what: "x" })).toBe(false);
  });

  test("a member's message whose pk isn't base64url can't stop anyone loading the channel", async () => {
    const owner = await generateIdentity("human");
    const mallory = await generateIdentity("mallory");
    const made = await Channel.create(relay, owner, { name: "human" }, [{ ...mallory, info: { name: "mallory" } }]);
    const ownerCh = new Channel(made.access, relay, owner);
    await ownerCh.send("before");
    const roomId = made.access.roomId;
    const key = made.access.keys["0"]!;
    const payload = { v: PROTOCOL_VERSION, id: "bad-pk-1", from: "mallory", kind: "msg", body: "hello", ts: Date.now(), pk: "!!! not a key !!!", sig: "!!!" };
    const body = JSON.stringify({ ...(await seal(key, roomId, payload)), e: 0 });
    const auth = await signRequest(mallory, roomId, "POST", "/messages", body);
    const res = await fetch(new URL(`/v1/rooms/${roomId}/messages`, relay), { method: "POST", body, headers: { "content-type": "application/json", authorization: `Bearer ${auth}` } });
    expect(res.status).toBe(200);
    await ownerCh.send("after");
    const { messages } = await ownerCh.history(0);
    expect(messages.map((m) => m.body)).toEqual(expect.arrayContaining(["before", "hello", "after"]));
    const bad = messages.find((m) => m.id === "bad-pk-1")!;
    expect(bad.sigOk).toBe(false);
    const state = fold(
      messages,
      (await ownerCh.members()).map((m) => ({ name: m.name, pk: m.pk, owner: m.owner, at: m.at, active: m.active })),
    );
    expect(state.trust.get(bad.seq)).toBe("forged");
  });
});
