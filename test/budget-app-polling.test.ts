import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ChannelIdentityView, ChannelOps } from "../desktop/src/bridge.ts";
import { Keyring, type KeyHost } from "../desktop/src/keyring.ts";
import { acceptSeat, withAccess } from "../desktop/src/seats.ts";
import { tendOnPush, tendOwned } from "../web/src/lib/approval-tend.ts";
import { makeWatches } from "../web/src/lib/watch.ts";
import { decodeJoinCode } from "../src/crypto.ts";
import { generateIdentity, type Identity } from "../src/identity.ts";
import { provePerson } from "../src/person.ts";
import { startRelay } from "../src/relay/bun.ts";
import { memoryBudget } from "./check.ts";
import { trafficProxy, type Traffic } from "./traffic.ts";

setDefaultTimeout(120_000);

const HEADS_EVERY_BEFORE = 15_000;
const TEND_EVERY_BEFORE = 20_000;
const SAFETY_EVERY_AFTER = 300_000;
const BUDGET = { idleHttpPerMinute: 4 } as const;

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-budget-app-"));
let server: ReturnType<typeof startRelay>;
let proxy: ReturnType<typeof trafficProxy>;

function keyring(person: Identity | null): Keyring {
  let seats: ChannelIdentityView[] = [];
  const host: KeyHost = {
    relay: () => proxy.url,
    seats: () => seats,
    save: async (entry) => void (seats = acceptSeat(seats, entry)),
    access: async (code, pk, access) => void (seats = withAccess(seats, code, pk, access)),
    forget: async (code) => void (seats = seats.filter((c) => c.code !== code)),
    prove: async (code, memberPk) => (person ? provePerson(person, decodeJoinCode(code).roomId, memberPk) : null),
    person: () => person?.pk ?? null,
    budget: memoryBudget(),
  };
  return new Keyring(host);
}

async function until<T>(get: () => T | undefined, label: string, ms = 20_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = get();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
    await Bun.sleep(25);
  }
}

const measure = async (run: () => Promise<unknown>): Promise<Traffic> => {
  await Bun.sleep(150);
  proxy.reset();
  await run();
  await Bun.sleep(150);
  return proxy.reset();
};

let ada: Identity;
let app: Keyring;
let cy: Keyring;
const owned: string[] = [];
const joined: string[] = [];

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  proxy = trafficProxy(server.url.origin);
  ada = await generateIdentity("Ada");
  app = keyring(ada);
  cy = keyring(await generateIdentity("Cy"));
  for (const name of ["one", "two", "three"]) owned.push((await app.create(name, null, { name: "Ada" })).code!);
  for (const name of ["four", "five"]) {
    const code = (await cy.create(name, null, { name: "Cy" })).code!;
    const asked = await app.requestJoin(code, "ada");
    await cy.call(code, "requests");
    await app.joinStatus(code);
    const req = (await cy.call(code, "requests")).find((r) => r.pk === asked.pk);
    await cy.call(code, "approve", req!, undefined, {});
    expect((await app.joinStatus(code)).status).toBe("in");
    joined.push(code);
  }
});

afterAll(() => {
  app?.stopAll();
  proxy?.stop();
  server?.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

const pinged: string[] = [];
const told = new Set<string>();
const tend = (code: string) =>
  tendOwned(
    ada.pk,
    code,
    { autoApprove: (p) => app.call(code, "autoApprove", p), requests: (o) => app.call(code, "requests", o) },
    (_t, body) => pinged.push(body),
    told,
  );
const headTick = () => Promise.all([...owned, ...joined].map((code) => app.call(code, "head")));
const tendPass = async () => {
  for (const code of owned) await tend(code);
};

describe("the app's sidebar and approval, idle, for 5 channels (3 owned)", () => {
  let before = 0;

  test("before: GET / per channel every 15s and autoApprove + requests per owned channel every 20s", async () => {
    const heads = await measure(headTick);
    const pass = await measure(tendPass);
    before = (heads.http * 60_000) / HEADS_EVERY_BEFORE + (pass.http * 60_000) / TEND_EVERY_BEFORE;
    console.log(`before: ${heads.http} http per 15s head tick ${JSON.stringify(heads.routes)}, ${pass.http} http per 20s approval pass ${JSON.stringify(pass.routes)} -> ${before} http/min idle`);
    expect(before).toBeGreaterThan(BUDGET.idleHttpPerMinute);
  });

  test("after: one watch socket per channel, pushed heads and requests, a 5-minute safety poll", async () => {
    let live = 0;
    const via: Pick<ChannelOps, "follow"> = {
      follow: (code, since, on, opts) => {
        live++;
        const stop = app.follow(code, since, on, opts);
        return () => {
          live--;
          stop();
        };
      },
    };
    const w = makeWatches(via);
    const heads: Record<string, number> = {};
    const all = [...owned, ...joined];
    proxy.reset();
    const sidebar = all.map((code) =>
      w.watch(code, (ev) => {
        if (ev._tag === "Head") heads[code] = Math.max(heads[code] ?? 0, ev.seq);
      }),
    );
    let tends = 0;
    const tending = tendOnPush(owned, w.watch, async (code) => {
      tends++;
      await tend(code);
    });
    expect(live).toBe(5);
    await until(() => (all.every((c) => heads[c] !== undefined) && tends >= owned.length ? true : undefined), "every head and the first tend");
    await Bun.sleep(300);
    const opened = proxy.reset();
    console.log(`after, connecting: ${opened.sockets} sockets, ${opened.http} http ${JSON.stringify(opened.routes)}, frames down ${JSON.stringify(opened.framesDown)}`);
    expect(opened.sockets).toBe(5);

    const idle = await measure(() => Bun.sleep(3_000));
    const safety = (await measure(headTick)).http + (await measure(tendPass)).http;
    const after = (idle.http * 60_000) / 3_000 + (safety * 60_000) / SAFETY_EVERY_AFTER;
    console.log(`after: ${idle.http} http in 3s idle, ${safety} http per 5-minute safety poll -> ${after} http/min idle (before ${before})`);
    expect(idle.http).toBe(0);
    expect(after).toBeLessThanOrEqual(BUDGET.idleHttpPerMinute);
    expect(after).toBeLessThan(before);

    const background = joined[0]!;
    const was = heads[background]!;
    const sent = await measure(async () => {
      const seq = await cy.call(background, "send", "news in a background channel", {});
      await until(() => (heads[background] === seq ? true : undefined), "the pushed head");
    });
    console.log(`after, a message in a background channel: head ${was} -> ${heads[background]}, frames down ${JSON.stringify(sent.framesDown)}, ${sent.bytesDown} B down`);
    expect(heads[background]).toBeGreaterThan(was);
    expect(sent.framesDown.head).toBe(1);
    expect(sent.framesDown.msg).toBeUndefined();

    const target = owned[0]!;
    const tendsBefore = tends;
    const asked = await measure(async () => {
      const dee = keyring(await generateIdentity("Dee"));
      await dee.requestJoin(target, "dee");
      await until(() => (pinged.includes("dee asks to join") ? true : undefined), "the approval pass");
    });
    console.log(`after, a join request: ${tends - tendsBefore} approval pass, frames down ${JSON.stringify(asked.framesDown)}, http ${JSON.stringify(asked.routes)}`);
    expect(tends).toBeGreaterThan(tendsBefore);
    expect(asked.framesDown.request).toBeGreaterThanOrEqual(1);

    const lent = w.lend(background);
    expect(live).toBe(4);
    lent.release();
    expect(live).toBe(5);
    tending.stop();
    expect(live).toBe(5);
    for (const stop of sidebar) stop();
    expect(live).toBe(0);
  });
});
