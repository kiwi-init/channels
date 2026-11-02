import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accountClient } from "@kiwi/core/account.ts";
import { rootLink, type DeviceLink } from "@kiwi/core/devices.ts";
import { generateIdentity, withExchangeKey, type Identity } from "@kiwi/core/identity.ts";
import { useHost, type Host } from "../desktop/src/host.ts";
import { githubCalls, linkRecord } from "../desktop/src/ipc/github.ts";
import { freshToken } from "../desktop/src/signin.ts";
import { openStore, store, type StoreFile } from "../desktop/src/store.ts";
import { startRelay } from "../src/relay/bun.ts";
import { withGithub, type HumanAuth } from "../src/relay/human.ts";
import { TAKEN } from "../src/relay/move.ts";
import { OPEN_POLICY } from "../src/relay/policy.ts";

setDefaultTimeout(30_000);

const CLIENT = "Iv23liDesktopMove";
const ghToken = (id: number) => `ghu_${String(id).padStart(36, "0")}`;
const github = (async (_input: string | URL | Request, init?: RequestInit) => {
  const token = (JSON.parse(String(init?.body ?? "{}")) as { access_token?: string }).access_token ?? "";
  const id = Number(/^ghu_0*(\d+)$/.exec(token)?.[1] ?? 0);
  return id ? Response.json({ token, app: { client_id: CLIENT }, user: { id, login: `octo${id}`, name: null, email: null } }) : new Response("not found", { status: 404 });
}) as typeof fetch;
const workos: HumanAuth = { clientId: "client_old", verify: async (t) => /^old:([a-z0-9]+)$/.exec(t)?.[1]?.replace(/^/, "user_") ?? null };

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-desktop-move-"));
const savedClient = process.env.GITHUB_APP_CLIENT_ID;
let server: ReturnType<typeof startRelay>;
let relay: string;
let people = 0;

const host = { push: () => {}, openExternal: async () => {}, tellKeys: () => {} } as unknown as Host;
useHost(host);

beforeAll(() => {
  process.env.GITHUB_APP_CLIENT_ID = CLIENT;
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir, human: withGithub(workos, { clientId: CLIENT, clientSecret: "s" }, github), policy: OPEN_POLICY });
  relay = server.url.origin;
});

afterAll(() => {
  server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
  if (savedClient === undefined) delete process.env.GITHUB_APP_CLIENT_ID;
  else process.env.GITHUB_APP_CLIENT_ID = savedClient;
});

interface Someone {
  id: number;
  old: string;
  gh: string;
  person: Identity;
  desk: Identity;
  links: DeviceLink[];
}

async function someone(): Promise<Someone> {
  const id = ++people;
  const person = await withExchangeKey(await generateIdentity("person"));
  const desk = await withExchangeKey(await generateIdentity("desk"));
  const links = [await rootLink(person, { pk: desk.pk, xpk: desk.xpk!, label: "desk", os: "macOS", as: "desktop" })];
  await accountClient(relay, async () => `old:p${id}`, desk).publish(links);
  return { id, old: `old:p${id}`, gh: ghToken(id), person, desk, links };
}

function open(p: Someone, at = relay): void {
  const file: Partial<StoreFile> = {
    relayUrl: at,
    person: { name: "jow", pk: p.person.pk, sk: p.person.sk, xpk: p.person.xpk!, xsk: p.person.xsk! },
    device: p.desk,
    deviceLinks: p.links,
    signin: { access: p.old, refresh: "r", exp: Number.MAX_SAFE_INTEGER },
    github: { login: `octo${p.id}`, id: p.id, token: p.gh, at: 1, relay: at, clientId: CLIENT },
  };
  openStore({ where: () => "/data/kiwi-store.bin", load: () => ({ ok: true, file, resave: false }), save: () => {} });
}

const linksUnder = async (token: string, d: Identity) => accountClient(relay, async () => token, d).links();

describe("the desktop moves its account to the GitHub sign-in (T261)", () => {
  test("holding both sessions, it moves the account once, and then reaches it with GitHub", async () => {
    const p = await someone();
    open(p);
    expect(await freshToken()).toBe(p.old);

    const s = await githubCalls(host).githubStatus();
    expect(s.moveRefused).toBeUndefined();
    expect(store.github?.moved).toBe(true);
    expect(await freshToken()).toBe(p.gh);
    expect(await linksUnder(p.gh, p.desk)).toEqual(p.links);
    expect(await linksUnder(p.old, p.desk)).toEqual(p.links);

    expect((await githubCalls(host).githubStatus()).moveRefused).toBeUndefined();
    expect(store.github?.moved).toBe(true);
  });

  test("an account another computer already moved is only marked moved here", async () => {
    const p = await someone();
    open(p);
    await githubCalls(host).githubStatus();
    open(p);
    expect(store.github?.moved).toBeUndefined();
    expect((await githubCalls(host).githubStatus()).moveRefused).toBeUndefined();
    expect(store.github?.moved).toBe(true);
  });

  test("a refusal reaches Settings, the account stays under WorkOS, and it isn't asked again until GitHub is signed in again", async () => {
    const p = await someone();
    const theirs = await withExchangeKey(await generateIdentity("theirs"));
    const own = await withExchangeKey(await generateIdentity("own"));
    await accountClient(relay, async () => p.gh, own).publish([await rootLink(theirs, { pk: own.pk, xpk: own.xpk!, label: "other", os: "Linux", as: "desktop" })]);
    open(p);

    const s = await githubCalls(host).githubStatus();
    expect(s.moveRefused).toBe(TAKEN);
    expect(store.github?.moved).toBeUndefined();
    expect(await freshToken()).toBe(p.old);
    expect(await linksUnder(p.old, p.desk)).toEqual(p.links);
    expect((await githubCalls(host).githubStatus()).moveRefused).toBe(TAKEN);
  });

  test("a relay it can't reach leaves nothing marked, and says nothing to the person", async () => {
    const p = await someone();
    const gone = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: (req) =>
        new URL(req.url).pathname === "/v1/config" ? Response.json({ workosClientId: "client_old", githubClientId: CLIENT, githubSignIn: true }) : new Response("down", { status: 503 }),
    });
    try {
      open(p, gone.url.origin);
      expect((await githubCalls(host).githubStatus()).moveRefused).toBeUndefined();
      expect(store.github?.moved).toBeUndefined();
    } finally {
      gone.stop(true);
    }
  });

  test("a relay that doesn't move accounts yet gets asked again later, and the person sees nothing", async () => {
    const p = await someone();
    const moves: string[] = [];
    const older = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: (req) => {
        const path = new URL(req.url).pathname;
        if (path === "/v1/config") return Response.json({ workosClientId: "client_old", githubClientId: CLIENT, githubSignIn: true });
        if (path === "/v1/account") return Response.json({ user: `user_p${p.id}`, links: p.links });
        moves.push(path);
        return Response.json({ error: "not found", tag: "NotFound" }, { status: 404 });
      },
    });
    try {
      open(p, older.url.origin);
      expect((await githubCalls(host).githubStatus()).moveRefused).toBeUndefined();
      expect(store.github?.moved).toBeUndefined();
      expect(await freshToken()).toBe(p.old);
      expect((await githubCalls(host).githubStatus()).moveRefused).toBeUndefined();
      expect(moves).toEqual(["/v1/account/move", "/v1/account/move"]);
    } finally {
      older.stop(true);
    }
  });

  test("a link made again for the same GitHub account remembers the move, and another account's doesn't", () => {
    const moved = { login: "octo", id: 9, token: "t", at: 1, moved: true };
    expect(linkRecord({ person: null, github: moved }, { login: "octo", id: 9, token: "u" }, "r", CLIENT, 2).moved).toBe(true);
    expect(linkRecord({ person: null, github: moved }, { login: "mona", id: 10, token: "u" }, "r", CLIENT, 2).moved).toBeUndefined();
  });
});
