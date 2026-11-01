// Which check each room route declares (src/relay/route.ts). Loosening one is a deliberate edit here.

import { expect, test } from "bun:test";
import { routeTable } from "../src/relay/route.ts";

test("every route declares its check", () => {
  expect(routeTable.map((r) => `${r.method} ${r.path} ${r.guard}`)).toEqual([
    "GET /info public",
    "POST /create creator",
    "POST /requests joiner",
    "POST /^\\/requests\\/([0-9a-f-]{36})\\/reveal$/ requester",
    "GET /^\\/requests\\/([0-9a-f-]{36})$/ requester",
    "GET / member",
    "GET /messages member",
    "GET /^\\/pages\\/(\\d{1,9})$/ member",
    "POST /messages member",
    "POST /read member",
    "GET /^\\/note\\/([A-Za-z0-9_-]{43})$/ member",
    "PUT /^\\/note\\/([A-Za-z0-9_-]{43})$/ member",
    "PUT /^\\/blobs\\/([0-9a-f]{64})$/ member",
    "GET /^\\/blobs\\/([0-9a-f]{64})$/ member",
    "GET /keys member",
    "GET /icon member",
    "PUT /icon owner",
    "PUT /title owner",
    "PUT /settings owner",
    "PUT /github/repos owner",
    "GET /github/queue owner",
    "GET /github/diff member",
    "POST /github/check owner",
    "POST /github/comment owner",
    "GET /github/issue member",
    "GET /github/rules owner",
    "GET /github/releases owner",
    "POST /github/issue/close owner",
    "POST /github/ack owner",
    "GET /snapshot member",
    "PUT /snapshot owner",
    "GET /members reader",
    "DELETE /members/me member",
    "GET /requests requester",
    "POST /^\\/requests\\/([0-9a-f-]{36})\\/nonce$/ admitter",
    "POST /^\\/requests\\/([0-9a-f-]{36})\\/deny$/ owner",
    "POST /members admitter",
    "DELETE /^\\/members\\/([A-Za-z0-9_-]{20,})$/ owner",
    "PUT /^\\/members\\/([A-Za-z0-9_-]{20,})\\/record$/ owner",
    "PUT /^\\/members\\/([A-Za-z0-9_-]{20,})\\/post$/ owner",
    "PUT /delegations owner",
    "GET /delegations owner",
    "DELETE /^\\/delegations\\/([A-Za-z0-9_-]{43})$/ owner",
    "GET /delegation requester",
    "POST /epochs owner",
    "DELETE / owner",
  ]);
});

test("the only public room route is the one meant to be", () => {
  // GET /info answers anyone holding the join code (it's how a joiner pins the owner key). A new public
  // row has to be added here on purpose, with its own refusal rows in the auth table if it checks anything.
  expect(routeTable.filter((r) => r.guard === "public").map((r) => `${r.method} ${r.path}`)).toEqual(["GET /info"]);
});

test("0.11: the signed-in person routes, machine links, pairing, seats and usage are gone", async () => {
  const { startRelay } = await import("../src/relay/bun.ts");
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "kiwi-gone-"));
  const r = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: dir, human: { clientId: "c", verify: async (t: string) => (t ? t : null) } });
  try {
    for (const [method, path] of [
      ["GET", "/v1/me/channels"],
      ["GET", "/v1/me/usage"],
      ["GET", "/v1/me/vault"],
      ["POST", "/v1/me/devices/transfers"],
      ["GET", "/v1/me/machines"],
      ["POST", "/v1/machines"],
      ["GET", `/v1/machines/${"a".repeat(43)}`],
    ]) {
      const res = await fetch(`${r.url.origin}${path}`, { method, headers: { "x-human-token": "user_a" }, body: method === "GET" ? undefined : "{}" });
      expect(`${method} ${path} ${res.status}`).toBe(`${method} ${path} 404`);
    }
    // No room route serves them either: they aren't in the table at all.
    const paths = routeTable.map((x) => x.path);
    for (const gone of ["/seats", "/admit", "/usage", "/pairs"]) expect(paths.some((p) => p.includes(gone.slice(1)))).toBe(false);
  } finally {
    r.stop(true);
    rmSync(dir, { recursive: true, force: true });
  }
});
