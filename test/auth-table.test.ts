// Every relay route and the check it needs, each asserted to refuse without it.
// A guard for the Effect rewrite (docs/plans/effect.md): a router rewrite that
// drops one owner() or one signature check fails here, before and after.

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signRequest } from "@kiwi/core/auth.ts";
import { Channel } from "@kiwi/core/client.ts";
import { decodeJoinCode } from "@kiwi/core/crypto.ts";
import { generateIdentity, type Identity } from "@kiwi/core/identity.ts";
import { CLOSE_REMOVED, WS_PROTOCOL } from "@kiwi/core/protocol.ts";
import { startRelay } from "../src/relay/bun.ts";
import { devHumanAuth } from "../src/relay/human.ts";
import { checked } from "./check.ts";

setDefaultTimeout(30_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-auth-table-"));
let server: ReturnType<typeof startRelay>;
let relay: string;
let roomId: string;
let owner: Identity;
let member: Identity;
let stranger: Identity;
let requestId: string;
let ownerCh: Channel;
let code: string;

beforeAll(async () => {
  // A sign-in relay (dev sign-in: the token dev:<name> is dev_<name>), so the create gate is live.
  // Owner acts take the owner key's signature alone: no session.
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir, human: devHumanAuth() });
  relay = server.url.origin;
  owner = await generateIdentity("alice");
  member = await generateIdentity("win");
  stranger = await generateIdentity("eve");
  const made = await Channel.create(relay, owner, { name: "alice", kind: "human" }, [], undefined, "dev:alice");
  roomId = made.access.roomId;
  code = made.code;
  ownerCh = new Channel(made.access, relay, owner);
  const ask = await Channel.requestJoin(relay, made.code, member, { name: "win" });
  await ownerCh.approve((await checked(ownerCh, relay, made.code, [{ id: member, requestId: ask.requestId }]))[0]!);
  // A pending request from someone else, for the request routes.
  const other = await generateIdentity("pat");
  requestId = (await Channel.requestJoin(relay, made.code, other, { name: "pat" })).requestId;
});
afterAll(() => {
  server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

/** A request to a room route, signed by `as` (or not signed), with an optional human session. */
async function room(method: string, path: string, opts: { as?: Identity; human?: string; body?: unknown } = {}): Promise<number> {
  const body = opts.body === undefined ? (method === "GET" || method === "DELETE" ? "" : "{}") : JSON.stringify(opts.body);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.as) headers.authorization = `Bearer ${await signRequest(opts.as, roomId, method, path, body)}`;
  if (opts.human) headers["x-human-token"] = opts.human;
  const res = await fetch(`${relay}/v1/rooms/${roomId}${path}`, { method, headers, body: body || undefined });
  return res.status;
}

const refused = (s: number) => s === 401 || s === 403;

describe("member routes refuse anyone who isn't a member", () => {
  const routes: [string, string][] = [
    ["GET", "/"],
    ["GET", "/messages"],
    ["POST", "/messages"],
    ["GET", "/keys"],
    ["GET", "/icon"],
    ["GET", "/snapshot"],
    ["GET", "/members"],
    ["GET", "/github/diff"],
    ["GET", "/github/issue"],
    ["DELETE", "/members/me"],
    ["GET", `/blobs/${"0".repeat(64)}`],
  ];
  for (const [method, path] of routes) {
    test(`${method} ${path}`, async () => {
      expect(await room(method, path)).toBe(401);
      expect(await room(method, path, { as: stranger })).toBe(404);
      // A member gets past authentication (whatever the body then makes of it).
      if (method !== "DELETE") {
        const mine = await room(method, path, { as: member });
        expect(mine === 401 || mine === 403).toBe(false);
      }
    });
  }
  test("PUT /blobs/<id>", async () => {
    const bytes = new Uint8Array(64).fill(7);
    const id = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
    const put = async (as?: Identity) => {
      const headers: Record<string, string> = { "content-type": "application/octet-stream" };
      if (as) headers.authorization = `Bearer ${await signRequest(as, roomId, "PUT", `/blobs/${id}`, "")}`;
      return (await fetch(`${relay}/v1/rooms/${roomId}/blobs/${id}`, { method: "PUT", headers, body: bytes })).status;
    };
    expect(await put()).toBe(401);
    expect(await put(stranger)).toBe(404);
    expect(await put(member)).toBe(200);
  });
});

describe("owner routes need the owner key's signature, and nothing else", () => {
  const pk = "A".repeat(43);
  const routes: [string, string][] = [
    ["PUT", "/icon"],
    ["PUT", "/title"],
    ["PUT", "/settings"],
    ["PUT", "/github/repos"],
    ["GET", "/github/queue"],
    ["POST", "/github/check"],
    ["POST", "/github/comment"],
    ["POST", "/github/issue/close"],
    ["POST", "/github/ack"],
    ["PUT", "/snapshot"],
    ["GET", "/requests?v=2"],
    ["POST", `/requests/${"0".repeat(8)}-0000-0000-0000-${"0".repeat(12)}/nonce`],
    ["POST", `/requests/${"0".repeat(8)}-0000-0000-0000-${"0".repeat(12)}/deny`],
    ["POST", "/members"],
    ["DELETE", `/members/${pk}`],
    ["PUT", "/delegations"],
    ["GET", "/delegations"],
    ["DELETE", `/delegations/${pk}`],
    ["POST", "/epochs"],
    ["DELETE", "/"],
  ];
  for (const [method, path] of routes) {
    test(`${method} ${path}`, async () => {
      expect(await room(method, path)).toBe(401);
      expect(await room(method, path, { as: stranger, human: "dev:alice" })).toBe(404);
      // A member, even with a session: not the owner key.
      expect(await room(method, path, { as: member, human: "dev:alice" })).toBe(403);
      // The owner key alone is enough: no session, whatever session, or someone else's.
      // (Except closing the channel, which would end this file's room: tried once, at the end.)
      if (path !== "/") {
        const mine = await room(method, path, { as: owner });
        expect(mine === 401 || mine === 403).toBe(false);
        const bob = await room(method, path, { as: owner, human: "dev:bob" });
        expect(bob === 401 || bob === 403).toBe(false);
      }
    });
  }
  test("and with the key, they get through (GET /requests as the example)", async () => {
    expect(await room("GET", "/requests?v=2", { as: owner })).toBe(200);
  });
  test("closing the channel with the owner key alone works", async () => {
    const second = await generateIdentity("second");
    const made = await Channel.create(relay, second, { name: "second" }, [], undefined, "dev:bob");
    const res = await fetch(`${relay}/v1/rooms/${made.access.roomId}/`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${await signRequest(second, made.access.roomId, "DELETE", "/", "")}` },
    });
    expect(res.status).toBe(200);
  });
});

describe("routes with their own checks", () => {
  test("POST /create needs a signature and, here, a session", async () => {
    const fresh = "f".repeat(32);
    const create = async (opts: { as?: Identity; human?: string }) => {
      const body = "{}";
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (opts.as) headers.authorization = `Bearer ${await signRequest(opts.as, fresh, "POST", "/create", body)}`;
      if (opts.human) headers["x-human-token"] = opts.human;
      return (await fetch(`${relay}/v1/rooms/${fresh}/create`, { method: "POST", headers, body })).status;
    };
    expect(refused(await create({}))).toBe(true);
    expect(refused(await create({ as: stranger }))).toBe(true);
    // A good signature but no session, or a session but no signature: still no.
    const someone = await generateIdentity("new-owner");
    expect(refused(await create({ as: someone }))).toBe(true);
    expect(await create({ human: "dev:alice" })).not.toBe(200);
  });

  test("POST /requests is open to anyone holding the join code: no session, no vouch", async () => {
    const joiner = await generateIdentity("open-join");
    const { requestId: id } = await Channel.requestJoin(relay, code, joiner, { name: "open-join" });
    expect(id).toBeTruthy();
  });

  test("a request's status and reveal need the requester's own signature", async () => {
    expect(refused(await room("GET", `/requests/${requestId}`))).toBe(true);
    expect(await room("GET", `/requests/${requestId}`, { as: stranger })).toBe(404);
    expect(refused(await room("POST", `/requests/${requestId}/reveal`))).toBe(true);
    expect(await room("POST", `/requests/${requestId}/reveal`, { as: stranger, body: { nonce: "x" } })).not.toBe(200);
  });

  test("a delegate's own delegation needs its signature, and only a delegate has one", async () => {
    expect(refused(await room("GET", "/delegation"))).toBe(true);
    expect(await room("GET", "/delegation", { as: stranger })).toBe(404);
    expect(await room("GET", "/delegation", { as: member })).toBe(404);
  });

  test("GET /info needs the code's fingerprint", async () => {
    expect(await room("GET", "/info")).toBe(426);
    expect(await room("GET", `/info?fp=${decodeJoinCode(code).ownerFp}`)).toBe(200);
  });

  test("POST /requests needs the code's fingerprint", async () => {
    expect(await room("POST", "/requests", { body: {} })).toBe(426);
    expect(await room("POST", "/requests?fp=wrong", { body: {} })).toBe(404);
  });

  test("removed routes are gone: seats, admit, pairs, usage", async () => {
    // A member (even the owner) asking for one hears 404, not a refusal to authenticate.
    for (const [method, path] of [
      ["POST", "/seats"],
      ["POST", "/admit"],
      ["GET", "/usage"],
      ["POST", "/pairs"],
      ["GET", "/pairs"],
      ["POST", "/pairs/slots"],
    ] as const) {
      expect(await room(method, path, { as: owner, ...(method === "GET" ? {} : { body: {} }) })).toBe(404);
    }
    // ...while a kept route answers with its own refusal, not a 404 (and writes nothing).
    expect(await room("PUT", `/members/${member.pk}/record`, { as: owner, body: { rec: "x", e: -1, post: true } })).toBe(400);
  });
});

describe("removed person routes are gone", () => {
  const routes: [string, string][] = [
    ["GET", "/v1/me/vault"],
    ["PUT", "/v1/me/vault"],
    ["DELETE", "/v1/me/vault"],
    ["GET", "/v1/me/channels"],
    ["GET", "/v1/me/usage"],
    ["POST", "/v1/me/devices/transfers"],
    ["GET", "/v1/me/machines"],
    ["POST", "/v1/machines"],
    ["GET", `/v1/machines/${"A".repeat(43)}`],
  ];
  for (const [method, path] of routes) {
    test(`${method} ${path}`, async () => {
      const res = await fetch(`${relay}${path}`, { method, headers: { "content-type": "application/json", "x-human-token": "dev:alice" }, body: method === "GET" ? undefined : "{}" });
      expect(res.status).toBe(404);
    });
  }
});

describe("the live stream (WebSocket)", () => {
  /** Open the room's socket as `as`; resolves to "open" or the close code if it never opens. */
  const connect = async (as?: Identity) => {
    const u = new URL(`/v1/rooms/${roomId}/ws`, relay);
    u.protocol = "ws:";
    const protocols = as ? [WS_PROTOCOL, await signRequest(as, roomId, "GET", "/ws")] : [WS_PROTOCOL];
    const ws = new WebSocket(u, protocols);
    const opened = await new Promise<"open" | number>((resolve) => {
      ws.onopen = () => resolve("open");
      ws.onclose = (e) => resolve(e.code);
      ws.onerror = () => {};
    });
    return { ws, opened };
  };

  test("no key, or a stranger's, can't open it; a member can", async () => {
    expect((await connect()).opened).not.toBe("open");
    expect((await connect(stranger)).opened).not.toBe("open");
    const m = await connect(member);
    expect(m.opened).toBe("open");
    m.ws.close();
  });

  test("a removed member's open socket is closed (CLOSE_REMOVED), and it can't open another", async () => {
    const bye = await generateIdentity("bye");
    const ask = await Channel.requestJoin(relay, code, bye, { name: "bye" });
    const req = (await checked(ownerCh, relay, code, [{ id: bye, requestId: ask.requestId }])).find((r) => r.pk === bye.pk)!;
    await ownerCh.approve(req);
    const { ws, opened } = await connect(bye);
    expect(opened).toBe("open");
    const closed = new Promise<number>((resolve) => (ws.onclose = (e) => resolve(e.code)));
    await ownerCh.remove(bye.pk);
    expect(await closed).toBe(CLOSE_REMOVED);
    expect((await connect(bye)).opened).not.toBe("open");
  });
});
