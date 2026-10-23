import type { KiwiBridge } from "../src/bridge.ts";
import { until, type Driver } from "./eb-drive.ts";

interface Page {
  kiwi: KiwiBridge;
  __electrobunWebviewId?: number;
  __electrobunRpcSocketPort?: number;
  __electrobunInternalBridge?: { postMessage(message: string): void };
  __electrobunEventBridge?: { postMessage(message: string): void };
  kiwiStores?: number;
  kiwiStolen?: number;
}

const later = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const answers = (d: Driver): Promise<string> =>
  d.evaluate(
    () =>
      (window as unknown as Page).kiwi.getDeepLink().then(
        (v) => (v === null ? "answered" : `answered ${JSON.stringify(v)}`),
        (e: unknown) => `refused: ${String(e)}`,
      ),
    null,
    5_000,
  );

const where = (d: Driver): Promise<{ title: string; href: string }> => d.evaluate(() => ({ title: document.title, href: location.href }), null, 5_000);

async function step(problems: string[], what: string, run: () => Promise<string | null>): Promise<void> {
  try {
    const wrong = await run();
    if (wrong === null) console.log(`${what}: ok`);
    else problems.push(`${what}: ${wrong}`);
  } catch (e) {
    problems.push(`${what}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function socketClient(port: number, webviewId: number): Promise<{ opened: boolean; got: string[]; send(frame: unknown): void; close(): void }> {
  const got: string[] = [];
  const ws = new WebSocket(`ws://127.0.0.1:${port}/socket?webviewId=${webviewId}`);
  ws.addEventListener("message", (e) => void got.push(String(e.data).slice(0, 200)));
  const opened = await Promise.race([
    new Promise<boolean>((r) => ws.addEventListener("open", () => r(true))),
    new Promise<boolean>((r) => ws.addEventListener("error", () => r(false))),
    later(3_000).then(() => false),
  ]);
  return { opened, got, send: (frame) => ws.send(JSON.stringify(frame)), close: () => ws.close() };
}

export async function bridgeChecks(d: Driver, problems: string[]): Promise<void> {
  await step(problems, "window.kiwi answers our page", async () => {
    const got = await answers(d);
    return got === "answered" ? null : got;
  });

  await step(problems, "page calls to Electrobun's internal webviewTag RPC (ExecuteJavascript, SetNavigationRules, UpdateSrc) change nothing", async () => {
    const before = await where(d);
    await d.evaluate(() => {
      const w = window as unknown as Page;
      const id = w.__electrobunWebviewId;
      const send = (m: unknown) => w.__electrobunInternalBridge?.postMessage(JSON.stringify([JSON.stringify(m)]));
      send({ type: "message", id: "webviewTagExecuteJavascript", payload: { id, js: "document.title = 'scripted by the internal RPC'" } });
      send({ type: "message", id: "webviewTagSetNavigationRules", payload: { id, rules: ["*"] } });
      send({ type: "message", id: "webviewTagUpdateSrc", payload: { id, url: "about:blank" } });
      return "sent";
    }, null);
    await later(1_500);
    await d.evaluate(() => {
      const a = document.createElement("a");
      a.href = "about:blank";
      document.body.append(a);
      a.click();
      a.remove();
      return "clicked";
    }, null);
    await later(1_000);
    const after = await where(d);
    return after.title === before.title && after.href === before.href ? null : `before ${JSON.stringify(before)}, after ${JSON.stringify(after)}`;
  });

  await step(problems, "a local client on Electrobun's 127.0.0.1 RPC socket gets nothing while the page is pushed to, and its requests do nothing", async () => {
    const ids = await d.evaluate(() => ({ port: (window as unknown as Page).__electrobunRpcSocketPort ?? null, id: (window as unknown as Page).__electrobunWebviewId ?? null }), null);
    if (ids.port === null || ids.id === null) {
      console.log("Electrobun's RPC socket: the page names none, so there's nothing to connect to");
      return null;
    }
    const client = await socketClient(ids.port, ids.id);
    if (!client.opened) {
      console.log(`Electrobun's RPC socket: nothing listens on 127.0.0.1:${ids.port}`);
      return null;
    }
    console.log(`Electrobun's RPC socket: a local client connected to 127.0.0.1:${ids.port} as view ${ids.id}`);
    const forged = { id: "local", at: 1, title: "FROM-A-LOCAL-CLIENT", body: null };
    client.send({ type: "request", id: 4242, method: "setPending", params: [[forged]] });
    client.send({ session: "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0", doc: "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f1", packet: { type: "request", id: 4243, method: "setPending", params: [[forged]] } });
    await d.evaluate(
      async () => {
        const w = window as unknown as Page;
        w.kiwiStores = 0;
        w.kiwi.onStore(() => void (w.kiwiStores = (w.kiwiStores ?? 0) + 1));
        for (let i = 0; i < 3; i++) await w.kiwi.setPending([{ id: `page-${i}`, at: i, title: `PAGE-PUSH-${i}`, body: null }]);
        return "pushed";
      },
      null,
      10_000,
    );
    await later(1_000);
    const page = await d.evaluate(() => ({ stores: (window as unknown as Page).kiwiStores ?? 0, pending: (window as unknown as Page).kiwi.getSnapshot().pending.map((p) => p.title) }), null);
    client.close();
    const wrong: string[] = [];
    if (client.got.length) wrong.push(`the client got ${client.got.length} message(s): ${client.got.join(" | ")}`);
    if (page.pending.includes("FROM-A-LOCAL-CLIENT")) wrong.push("the client's setPending reached the store");
    if (page.stores < 3) wrong.push(`the page heard ${page.stores} of 3 store pushes, so the check proved nothing`);
    return wrong.length ? wrong.join("; ") : null;
  });

  await step(problems, "a navigation event the page posts itself (did-commit-navigation to another origin) doesn't turn the bridge off", async () => {
    await d.evaluate(() => {
      const w = window as unknown as Page;
      w.__electrobunEventBridge?.postMessage(
        JSON.stringify({ id: "webviewEvent", type: "message", payload: { id: w.__electrobunWebviewId, eventName: "did-commit-navigation", detail: "https://evil.example/" } }),
      );
      return "posted";
    }, null);
    await later(800);
    const got = await answers(d);
    return got === "answered" ? null : got;
  });

  await step(problems, "a page that replaces globalThis gets none of main's frames, and the bridge keeps answering", async () => {
    await d.evaluate(() => {
      const w = window as unknown as Page;
      w.kiwiStolen = 0;
      Reflect.set(window, "globalThis", { __kiwiReceive: () => void (w.kiwiStolen = (w.kiwiStolen ?? 0) + 1) });
      return "replaced";
    }, null);
    const got = await answers(d);
    const stolen = await d.evaluate(() => (window as unknown as Page).kiwiStolen ?? 0, null);
    return got === "answered" && stolen === 0 ? null : `${got}, ${stolen} frame(s) taken`;
  });

  await step(problems, "after the page's own location.reload() the new document gets its own session, and the bridge answers it", async () => {
    await d.evaluate(() => {
      setTimeout(() => location.reload(), 50);
      return "reloading";
    }, null);
    await later(1_000);
    await until("the page after location.reload()", 30_000, () => d.evaluate(() => (document.querySelector("#root")?.childElementCount ? "up" : null), null, 2_000));
    const got = await answers(d);
    return got === "answered" ? null : got;
  });
}
