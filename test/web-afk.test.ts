import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startRelay } from "../src/relay/bun.ts";

const tmp = mkdtempSync(join(tmpdir(), "kiwi-web-afk-"));
const dist = join(tmp, "dist");
mkdirSync(join(dist, "afk"), { recursive: true });
writeFileSync(join(dist, "index.html"), "<!doctype html><title>app</title>");
for (const name of ["index", "scene", "frame"]) writeFileSync(join(dist, "afk", `${name}.html`), `<!doctype html><title>${name}</title>`);
mkdirSync(join(dist, "afk", "scenes"), { recursive: true });
writeFileSync(join(dist, "afk", "scenes", "rain.html"), "<!doctype html><title>rain</title>");

let server: ReturnType<typeof startRelay>;
let relay: string;

beforeAll(() => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: join(tmp, "data"), web: { dir: dist } });
  relay = server.url.origin;
});
afterAll(() => {
  server.stop(true);
  rmSync(tmp, { recursive: true, force: true });
});

test("the AFK scene, the gallery's scenes and the studio's frame get a CSP with no network, framed only by the site", async () => {
  for (const path of ["/afk/scene", "/afk/scene.html", "/afk/scenes/rain", "/afk/scenes/rain.html", "/afk/frame", "/afk/frame.html"]) {
    const res = await fetch(relay + path);
    expect(res.status).toBe(200);
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toStartWith("default-src 'none';");
    expect(csp).not.toContain("connect-src");
    expect(csp).toContain("frame-ancestors 'self'");
  }
  expect((await fetch(relay + "/afk/frame")).headers.get("content-security-policy")).toContain("'unsafe-eval'");
  for (const path of ["/afk/scene", "/afk/scenes/rain"]) expect((await fetch(relay + path)).headers.get("content-security-policy")).not.toContain("'unsafe-eval'");
});

test("the studio page keeps the site's own CSP", async () => {
  for (const path of ["/afk/", "/afk/index.html"]) {
    const csp = (await fetch(relay + path)).headers.get("content-security-policy") ?? "";
    expect(csp).toContain("frame-ancestors 'none'");
  }
});
