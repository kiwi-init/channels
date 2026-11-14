import { afterAll, beforeAll, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import { generateIdentity } from "@kiwi/core/identity.ts";
import { startRelay } from "../src/relay/bun.ts";
import { setupChannel, type OwnerSetup } from "./owner.ts";

setDefaultTimeout(60_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-member-reads-"));
let server: ReturnType<typeof startRelay>;
let s: OwnerSetup;
const realFetch = globalThis.fetch;
let calls: string[] = [];

const counted = (what: string) => calls.filter((c) => c === what).length;

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  s = await setupChannel(server.url.origin, { ownerName: "jon" });
  globalThis.fetch = Object.assign(
    (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      const path = url.pathname.replace(/^\/v1\/rooms\/[^/]+/, "");
      if (method === "GET" && (path === "/members" || path === "/requests")) calls.push(path.slice(1));
      return realFetch(input, init);
    },
    { preconnect: realFetch.preconnect },
  );
});

beforeEach(() => {
  calls = [];
});

afterAll(() => {
  globalThis.fetch = realFetch;
  server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

describe("member reads: one fetch serves the readers that can share it (#3909)", () => {
  test("auto-approve with nobody waiting reads the requests once and the member list not at all", async () => {
    const ch = new Channel(s.access, s.relay, s.owner);
    expect(await ch.autoApprove(s.person.pk)).toEqual([]);
    expect({ requests: counted("requests"), members: counted("members") }).toEqual({ requests: 1, members: 0 });
  });

  test("the member list is fresh by default: two reads make two fetches", async () => {
    const ch = new Channel(s.access, s.relay, s.owner);
    await ch.members();
    await ch.members();
    expect(counted("members")).toBe(2);
  });

  test("a waiting request lists its asker against a member list read a moment ago, without a second fetch", async () => {
    const ch = new Channel(s.access, s.relay, s.owner);
    const asker = await generateIdentity("asker");
    await Channel.requestJoin(s.relay, s.code, asker, { name: "asker" });
    calls = [];
    await ch.members();
    const listed = await ch.requests();
    expect(listed.map((r) => r.name)).toContain("asker");
    expect(counted("members")).toBe(1);
  });

  test("a write in between makes the next shared read fetch again", async () => {
    const ch = new Channel(s.access, s.relay, s.owner);
    await Channel.requestJoin(s.relay, s.code, await generateIdentity("waiting"), { name: "waiting" });
    await ch.members();
    const asker = await generateIdentity("denied");
    const { requestId } = await Channel.requestJoin(s.relay, s.code, asker, { name: "denied" });
    await ch.deny(requestId);
    calls = [];
    await ch.requests();
    expect(counted("members")).toBe(1);
  });
});
