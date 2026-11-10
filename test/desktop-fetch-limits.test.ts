import { describe, expect, test } from "bun:test";
import { generateIdentity, withExchangeKey } from "@kiwi/core/identity.ts";
import { avatar, listRepos, tokenForRelay } from "../desktop/src/github-flow.ts";
import { askMachine, machineOnline, personMachines, unpairAt } from "../desktop/src/remote.ts";
import { FETCH_MS, timedFetch, within } from "../desktop/src/within.ts";

const RELAY = "https://relay.test";

function blackHole() {
  const signals: (AbortSignal | null | undefined)[] = [];
  const hung = ((_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    signals.push(init?.signal);
    return new Promise<Response>((_ok, fail) => init?.signal?.addEventListener("abort", () => fail(init.signal!.reason as Error)));
  }) as typeof fetch;
  return { signals, hung };
}

describe("fetches from the desktop's main process have a time limit (T1765)", () => {
  test(`the limit is ${FETCH_MS / 1000} s, and a server that accepts the connection and never answers is given up on`, async () => {
    expect(FETCH_MS).toBe(15_000);
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Promise<Response>(() => {}) });
    try {
      const from = Date.now();
      const out = await fetch(server.url, within({}, 150)).then(
        () => "answered",
        (err: unknown) => (err instanceof Error ? err.name : String(err)),
      );
      expect(out).toBe("TimeoutError");
      expect(Date.now() - from).toBeLessThan(2_000);
    } finally {
      await server.stop(true);
    }
  });

  test("within keeps the request's own fields and timedFetch passes a limit along", async () => {
    const init = within({ method: "POST", body: "x" });
    expect(init.method).toBe("POST");
    expect(init.body).toBe("x");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("ok") });
    try {
      expect(await (await timedFetch(server.url)).text()).toBe("ok");
    } finally {
      await server.stop(true);
    }
  });

  test("the GitHub calls each carry one: the relay's config, the repo list, the avatar", async () => {
    const b = blackHole();
    void tokenForRelay(RELAY, { token: "t", relay: RELAY, clientId: "c" }, b.hung);
    void listRepos("t", b.hung).catch(() => {});
    void avatar(1, b.hung).catch(() => {});
    await new Promise((r) => setTimeout(r, 10));
    expect(b.signals).toHaveLength(3);
    for (const s of b.signals) expect(s).toBeInstanceOf(AbortSignal);
  });

  test("the calls about a person's computers each carry one: the ask, online, unpair, the list", async () => {
    const b = blackHole();
    const person = await withExchangeKey(await generateIdentity("person"));
    const machine = await withExchangeKey(await generateIdentity("machine"));
    const asker = { signer: person, person: person.pk, relay: RELAY, fetch: b.hung };
    void askMachine(asker, { pk: machine.pk, xpk: machine.xpk! }, "settings", {}, { timeoutMs: 50 });
    void machineOnline(asker, machine.pk);
    void unpairAt(asker, machine.pk);
    void personMachines(asker);
    await new Promise((r) => setTimeout(r, 50));
    expect(b.signals).toHaveLength(4);
    for (const s of b.signals) expect(s).toBeInstanceOf(AbortSignal);
  });
});
