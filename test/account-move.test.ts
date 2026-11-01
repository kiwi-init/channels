import { afterAll, beforeAll, beforeEach, describe, expect, setDefaultTimeout, setSystemTime, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signRequest } from "@kiwi/core/auth.ts";
import { Channel } from "@kiwi/core/client.ts";
import { certUntil, nextLink, readDeviceList, rootLink, type DeviceLink } from "@kiwi/core/devices.ts";
import { accountScope, askToEnroll } from "@kiwi/core/enroll.ts";
import { generateIdentity, withExchangeKey, type Identity } from "@kiwi/core/identity.ts";
import { readRecovery, recoveryKey, recoveryLink, sealVault, type RecoveryLink } from "@kiwi/core/recovery.ts";
import { startRelay } from "../src/relay/bun.ts";
import { withGithub, type HumanAuth } from "../src/relay/human.ts";
import { FREEZE_MS, MOVE_PATH, MOVE_TO_HEADER, onMoveHttp, TAKEN, type Adoption, type Freeze, type MoveState, type MoveStore, type Rows } from "../src/relay/move.ts";
import type { AccountStore } from "../src/relay/account.ts";
import { OPEN_POLICY } from "../src/relay/policy.ts";

setDefaultTimeout(30_000);

const CLIENT = "Iv23liTestClient";
const SECRET = "test-secret";
const ghToken = (id: number) => `ghu_${String(id).padStart(36, "0")}`;

const github = (async (_input: string | URL | Request, init?: RequestInit) => {
  const token = (JSON.parse(String(init?.body ?? "{}")) as { access_token?: string }).access_token ?? "";
  const id = Number(/^ghu_0*(\d+)$/.exec(token)?.[1] ?? 0);
  return id ? Response.json({ token, app: { client_id: CLIENT }, user: { id, login: `octo${id}`, name: null, email: null } }) : new Response("not found", { status: 404 });
}) as typeof fetch;

const workos: HumanAuth = { clientId: "client_old", verify: async (t) => /^old:([a-z0-9]+)$/.exec(t)?.[1]?.replace(/^/, "user_") ?? null };

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-account-move-"));
let t = Date.now();
let server: ReturnType<typeof startRelay>;
let relay: string;
let people = 0;

beforeAll(() => {
  server = startRelay({
    port: 0,
    hostname: "127.0.0.1",
    dataDir,
    human: withGithub(workos, { clientId: CLIENT, clientSecret: SECRET }, github),
    policy: { ...OPEN_POLICY, channelsPerOwner: 2 },
    now: () => t,
  });
  relay = server.url.origin;
});

beforeEach(() => {
  t = Date.now();
});

afterAll(() => {
  server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

interface Person {
  user: string;
  old: string;
  github: string;
  gh: string;
}

const person = (): Person => {
  const n = ++people;
  return { user: `user_p${n}`, old: `old:p${n}`, github: `github_${n}`, gh: ghToken(n) };
};

const device = async (name: string) => withExchangeKey(await generateIdentity(name));

async function call(token: string, scope: string, id: Identity | null, method: string, path: string, body?: unknown): Promise<Response> {
  const text = body === undefined ? "" : JSON.stringify(body);
  const headers: Record<string, string> = { "x-human-token": token };
  if (id) headers.authorization = `Bearer ${await signRequest(id, accountScope(scope), method, path, text)}`;
  if (text) headers["content-type"] = "application/json";
  return fetch(relay + path, { method, headers, ...(text ? { body: text } : {}) });
}

async function move(p: Person, signer: Identity, opts: { to?: string; scope?: string; gh?: string | null; from?: string } = {}): Promise<Response> {
  const text = JSON.stringify({ to: opts.to ?? p.github });
  const headers: Record<string, string> = {
    "x-human-token": opts.from ?? p.old,
    authorization: `Bearer ${await signRequest(signer, accountScope(opts.scope ?? p.user), "POST", MOVE_PATH, text)}`,
    "content-type": "application/json",
  };
  if (opts.gh !== null) headers[MOVE_TO_HEADER] = opts.gh ?? p.gh;
  return fetch(relay + MOVE_PATH, { method: "POST", headers, body: text });
}

const view = async (token: string, path = "/v1/account") => (await call(token, "", null, "GET", path)).json() as Promise<{ user: string; links: unknown[] }>;
const errorOf = async (res: Response) => ((await res.json()) as { error: string }).error;

async function firstApp(token: string, scope: string): Promise<{ person: Identity; desk: Identity; links: DeviceLink[] }> {
  const root = await device("person");
  const desk = await device("desk");
  const links = [await rootLink(root, { pk: desk.pk, xpk: desk.xpk!, label: "desk", os: "macOS", as: "desktop" })];
  expect((await call(token, scope, desk, "PUT", "/v1/account", { links })).status).toBe(204);
  return { person: root, desk, links };
}

async function grown(links: DeviceLink[], signer: Identity, d: Identity): Promise<DeviceLink[]> {
  const read = await readDeviceList(links);
  if (!read.ok) throw new Error(read.why);
  return [...links, await nextLink(read.list, signer, { op: "add", device: d.pk, dxpk: d.xpk!, label: "phone", os: "iOS", as: "phone", approve: false, until: certUntil(Date.now()) }, Date.now())];
}

async function withVault(p: Person): Promise<{ person: Identity; desk: Identity; links: DeviceLink[]; chain: RecoveryLink[] }> {
  const first = await firstApp(p.old, p.user);
  const key = await recoveryKey(new Uint8Array(32).fill(7));
  const chain = [await recoveryLink(first.person, first.person.pk, null, { pk: key.pk, xpk: key.xpk! }, t)];
  expect((await call(p.old, p.user, first.desk, "PUT", "/v1/account/vault", { recovery: chain })).status).toBe(204);
  const list = await readDeviceList(first.links);
  if (!list.ok) throw new Error(list.why);
  const read = await readRecovery(chain, list.list, t);
  if (!read.ok) throw new Error(read.why);
  const vault = await sealVault(first.desk, read.recovery, 1, { person: first.person, channels: [{ label: "home", code: "c", owner: first.desk }] }, t);
  expect((await call(p.old, p.user, first.desk, "PUT", "/v1/account/vault", { vault })).status).toBe(204);
  return { ...first, chain };
}

describe("moving an account from a WorkOS id to a GitHub id (T261)", () => {
  test("devices, the recovery chain and the vault move to github_<id>, and older apps keep seeing the same account", async () => {
    const p = person();
    const { desk, links, chain } = await withVault(p);
    const before = await (await call(p.old, "", null, "GET", "/v1/account/vault")).json();

    const res = await move(p, desk);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: p.github, rooms: 0 });

    expect(await view(p.gh)).toEqual({ user: p.github, links });
    expect(await (await call(p.gh, "", null, "GET", "/v1/account/vault")).json()).toEqual(before);
    expect((before as { recovery: unknown[] }).recovery).toEqual(chain);
    expect(await view(p.old)).toEqual({ user: p.github, links });

    const longer = await grown(links, desk, await device("phone"));
    expect((await call(p.old, p.user, desk, "PUT", "/v1/account", { links: longer })).status).toBe(204);
    expect((await view(p.gh)).links).toEqual(longer);
    const next = await grown(longer, desk, await device("tablet"));
    expect((await call(p.old, p.github, desk, "PUT", "/v1/account", { links: next })).status).toBe(204);
    expect((await view(p.gh)).links).toEqual(next);
  });

  test("running it again changes nothing and answers the same", async () => {
    const p = person();
    const { desk, links } = await firstApp(p.old, p.user);
    expect((await move(p, desk)).status).toBe(200);
    const again = await move(p, desk);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ user: p.github, rooms: 0 });
    expect(await view(p.gh)).toEqual({ user: p.github, links });
  });

  test("a GitHub account with devices of its own is refused, and the WorkOS account stays exactly as it was", async () => {
    const p = person();
    const { desk, links } = await firstApp(p.old, p.user);
    const theirs = await firstApp(p.gh, p.github);

    const res = await move(p, desk);
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toBe(TAKEN);
    expect(await view(p.old)).toEqual({ user: p.user, links });
    expect(await view(p.gh)).toEqual({ user: p.github, links: theirs.links });
    const longer = await grown(links, desk, await device("phone"));
    expect((await call(p.old, p.user, desk, "PUT", "/v1/account", { links: longer })).status).toBe(204);
  });

  test("only the person key or an approving device of the account moves it, to the GitHub account signed in", async () => {
    const p = person();
    const { person: root, desk } = await firstApp(p.old, p.user);

    expect((await move(p, await device("stranger"))).status).toBe(403);
    expect((await move(p, desk, { scope: "user_someone" })).status).toBe(401);
    expect((await move(p, desk, { to: "github_999999" })).status).toBe(400);
    const noGithub = await move(p, desk, { gh: null });
    expect(noGithub.status).toBe(401);
    expect(((await noGithub.json()) as { tag: string }).tag).toBe("SignInRequired");
    expect((await move(p, desk, { gh: p.old })).status).toBe(401);
    expect((await move(p, desk, { from: p.gh, scope: p.github })).status).toBe(400);
    expect((await view(p.old)).user).toBe(p.user);

    expect((await move(p, root)).status).toBe(200);
  });

  test("an account that moved to one GitHub account doesn't move to another", async () => {
    const p = person();
    const other = person();
    const { desk } = await firstApp(p.old, p.user);
    expect((await move(p, desk)).status).toBe(200);
    const res = await move(p, desk, { to: other.github, gh: other.gh });
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toContain("another GitHub account");
    expect(await view(other.gh)).toEqual({ user: other.github, links: [] });
  });

  test("a device asking to join holds the move until it's answered", async () => {
    const p = person();
    const { desk } = await firstApp(p.old, p.user);
    const laptop = await device("laptop");
    const { ask } = await askToEnroll(laptop, { label: "laptop", os: "macOS", as: "desktop" });
    expect((await call(p.old, p.user, laptop, "POST", "/v1/account/ask", { ask })).status).toBe(202);
    const res = await move(p, desk);
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toContain("asking to join");
    expect((await view(p.old)).user).toBe(p.user);
  });

  test("an empty WorkOS account moves too, so a second one can't later move onto the same GitHub account", async () => {
    const p = person();
    const signer = await device("any");
    expect((await move(p, signer)).status).toBe(200);
    const q = { ...person(), github: p.github, gh: p.gh };
    const { desk } = await firstApp(q.old, q.user);
    const res = await move(q, desk);
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toBe(TAKEN);
  });

  test("owned channels count against the GitHub account afterwards, for new apps and older ones alike", async () => {
    const p = person();
    const { desk } = await firstApp(p.old, p.user);
    const owners = await Promise.all([generateIdentity("a"), generateIdentity("b"), generateIdentity("c")]);
    for (const o of owners.slice(0, 2)) expect((await Channel.create(relay, o, { name: "jow", kind: "human" }, [], undefined, p.old)).code).toBeTruthy();

    const res = await move(p, desk);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: p.github, rooms: 2 });
    await expect(Channel.create(relay, owners[2]!, { name: "jow", kind: "human" }, [], undefined, p.gh)).rejects.toMatchObject({ status: 429 });
    await expect(Channel.create(relay, owners[2]!, { name: "jow", kind: "human" }, [], undefined, p.old)).rejects.toMatchObject({ status: 429 });
    expect(await (await move(p, desk)).json()).toEqual({ user: p.github, rooms: 0 });
  });
});

const EMPTY: Rows = {};

class Accounts {
  data = new Map<string, Rows>();
  moves = new Map<string, { to: string; id: string; at: number; done: boolean }>();
  adoptions = new Map<string, { id: string; state: "adopted" | "abandoned" }>();
  owned = new Map<string, string[]>();
  reowned: string[] = [];
  fail = new Set<keyof MoveStore>();

  private trip(step: keyof MoveStore): void {
    if (this.fail.has(step)) throw new Error(`${step} failed`);
  }

  store(): MoveStore {
    const holds = (to: string) => [...this.adoptions].some(([k, v]) => k.startsWith(`${to}<`) && v.state === "adopted") || Object.values(this.data.get(to) ?? EMPTY).some((rows) => rows.length > 0);
    return {
      state: async (from): Promise<MoveState> => {
        const m = this.moves.get(from);
        return m ? (m.done ? { moved: m.to } : { frozen: { to: m.to, id: m.id, at: m.at } }) : null;
      },
      freeze: async (from, f: Freeze) => {
        this.trip("freeze");
        if (this.moves.has(from)) return false;
        this.moves.set(from, { ...f, done: false });
        return true;
      },
      thaw: async (from, id) => {
        const m = this.moves.get(from);
        if (m && m.id === id && !m.done) this.moves.delete(from);
      },
      settle: async (from, to, id) => {
        this.trip("settle");
        const m = this.moves.get(from);
        if (m && m.to === to && m.id === id) m.done = true;
      },
      rows: async (from) => structuredClone(this.data.get(from) ?? EMPTY),
      busy: async () => null,
      holds: async (to) => holds(to),
      adopt: async (to, from, id, rows): Promise<Adoption> => {
        this.trip("adopt");
        const had = this.adoptions.get(`${to}<${from}`);
        if (had?.state === "adopted") return "adopted";
        if (had?.id === id) return "abandoned";
        if (holds(to)) return "taken";
        this.data.set(to, structuredClone(rows));
        this.adoptions.set(`${to}<${from}`, { id, state: "adopted" });
        return "adopted";
      },
      abandon: async (to, from, id) => {
        if (this.adoptions.get(`${to}<${from}`)?.state === "adopted") return "adopted";
        this.adoptions.set(`${to}<${from}`, { id, state: "abandoned" });
        return "abandoned";
      },
      rooms: async (from) => [...(this.owned.get(from) ?? [])],
      reown: async (room, from, to) => {
        this.trip("reown");
        this.owned.set(
          from,
          (this.owned.get(from) ?? []).filter((r) => r !== room),
        );
        this.owned.set(to, [...(this.owned.get(to) ?? []), room]);
        this.reowned.push(room);
      },
    };
  }
}

describe("a move that fails partway (T261)", () => {
  const FROM = "user_jow";
  const TO = "github_42";
  let signer: Identity;
  let links: DeviceLink[];

  beforeAll(async () => {
    const root = await device("person");
    signer = await device("desk");
    links = [await rootLink(root, { pk: signer.pk, xpk: signer.xpk!, label: "desk", os: "macOS", as: "desktop" })];
  });

  const accountsOf = (): AccountStore => ({ links: async () => links }) as unknown as AccountStore;

  async function signedAt(text: string, at: number): Promise<string> {
    setSystemTime(new Date(at));
    try {
      return await signRequest(signer, accountScope(FROM), "POST", MOVE_PATH, text);
    } finally {
      setSystemTime();
    }
  }

  async function run(a: Accounts, at: number): Promise<Response> {
    const text = JSON.stringify({ to: TO });
    const req = new Request(`https://relay${MOVE_PATH}`, { method: "POST", headers: { authorization: `Bearer ${await signedAt(text, at)}` }, body: text });
    return onMoveHttp(req, a.store(), accountsOf(), FROM, TO, at).catch((err: unknown) => Response.json({ error: String(err) }, { status: 500 }));
  }

  const seeded = (): Accounts => {
    const a = new Accounts();
    a.data.set(FROM, { links: [{ seq: 1, link: "one" }], vault: [{ k: 1, version: 1, rec: "v" }] });
    a.owned.set(FROM, ["room1", "room2"]);
    return a;
  };

  test("a failed adoption leaves the account frozen for a while, and a retry finishes the move", async () => {
    const a = seeded();
    a.fail.add("adopt");
    expect((await run(a, t)).status).toBe(500);
    expect(a.moves.get(FROM)).toMatchObject({ to: TO, done: false });
    expect(a.data.get(TO)).toBeUndefined();
    a.fail.clear();
    expect((await run(a, t + 1000)).status).toBe(200);
    expect(a.data.get(TO)).toEqual(a.data.get(FROM)!);
    expect(a.moves.get(FROM)).toMatchObject({ to: TO, done: true });
    expect(a.owned.get(TO)).toEqual(["room1", "room2"]);
  });

  test("a freeze nobody comes back to thaws after 10 minutes, and a late adoption for it is refused", async () => {
    const a = seeded();
    a.fail.add("adopt");
    expect((await run(a, t)).status).toBe(500);
    const stale = a.moves.get(FROM)!.id;
    const { accountHome } = await import("../src/relay/move.ts");
    expect(await accountHome(a.store(), FROM, t + FREEZE_MS - 1)).toEqual({ user: FROM, frozen: true });
    expect(await accountHome(a.store(), FROM, t + FREEZE_MS)).toEqual({ user: FROM, frozen: false });
    expect(a.moves.has(FROM)).toBe(false);
    a.fail.clear();
    expect(await a.store().adopt(TO, FROM, stale, a.data.get(FROM)!)).toBe("abandoned");
    expect(a.data.get(TO)).toBeUndefined();
    expect((await run(a, t + FREEZE_MS + 1000)).status).toBe(200);
    expect(a.data.get(TO)).toEqual(a.data.get(FROM)!);
  });

  test("a freeze whose adoption went through settles as moved when its 10 minutes are up", async () => {
    const a = seeded();
    a.fail.add("settle");
    expect((await run(a, t)).status).toBe(500);
    expect(a.data.get(TO)).toEqual(a.data.get(FROM)!);
    a.fail.clear();
    const { accountHome } = await import("../src/relay/move.ts");
    expect(await accountHome(a.store(), FROM, t + FREEZE_MS)).toEqual({ user: TO, frozen: false });
    expect(a.moves.get(FROM)).toMatchObject({ done: true });
  });

  test("rooms that failed to move are picked up by the next run, and none moves twice", async () => {
    const a = seeded();
    let calls = 0;
    const store = a.store();
    const flaky: MoveStore = {
      ...store,
      reown: async (room, from, to) => {
        if (++calls === 2) throw new Error("room busy");
        await store.reown(room, from, to);
      },
    };
    const text = JSON.stringify({ to: TO });
    const once = async () =>
      onMoveHttp(new Request(`https://relay${MOVE_PATH}`, { method: "POST", headers: { authorization: `Bearer ${await signedAt(text, t)}` }, body: text }), flaky, accountsOf(), FROM, TO, t).catch(
        () => null,
      );
    expect(await once()).toBeNull();
    expect(a.owned.get(FROM)).toEqual(["room2"]);
    expect((await once())?.status).toBe(200);
    expect(a.owned.get(FROM)).toEqual([]);
    expect(a.reowned).toEqual(["room1", "room2"]);
  });

  test("the source's rows are never deleted", async () => {
    const a = seeded();
    const before = structuredClone(a.data.get(FROM));
    expect((await run(a, t)).status).toBe(200);
    expect(a.data.get(FROM)).toEqual(before!);
  });
});
