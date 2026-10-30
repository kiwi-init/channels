import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium } from "playwright-core";

import type { AskView, MessageView, Push, Reply, RoomView, Saved } from "../../ios/engine/wire.ts";

const repo = join(import.meta.dir, "../..");
const kotlin = readFileSync(join(repo, "android/app/src/main/java/com/kiwiinit/channels/engine/Engine.kt"), "utf8");

const constant = (name: string): string => {
  const raw = kotlin.match(new RegExp(`const val ${name} =\\s*"""([\\s\\S]*?)"""`))?.[1] ?? kotlin.match(new RegExp(`const val ${name} = "(.*)"\\n`))?.[1]?.replace(/\\"/g, '"');
  if (raw === undefined) throw new Error(`Engine.kt has no ${name}`);
  return raw;
};
const probe = constant("PROBE");
const page = constant("PAGE");
const wrapper = kotlin.match(/"(Promise\.resolve\(\)\.then\(\(\) => \$expr\).*)",\n/)?.[1]?.replace(/\\"/g, '"');
if (!wrapper) throw new Error("Engine.kt has no call wrapper");

const built = await Bun.build({ entrypoints: [join(repo, "ios/engine/main.ts")], target: "browser", format: "iife", minify: true });
const bundle = built.outputs[0];
if (!built.success || !bundle) throw new Error(`the engine didn't bundle: ${built.logs.join("\n")}`);
const engine = await bundle.text();

const dir = mkdtempSync(join(tmpdir(), "android-bridge-"));
const port = String(20_000 + Math.floor(Math.random() * 20_000));
const relay = Bun.spawn(["bun", "ios/scripts/dev-channel.ts", "--port", port, "--dir", dir, "--host", "127.0.0.1"], { cwd: repo, stdout: "pipe", stderr: "pipe" });
const savedFile = join(dir, "phone.json");
for (let i = 0; i < 600 && !existsSync(savedFile); i++) await Bun.sleep(100);

let failed = 0;
const check = (ok: boolean, what: string): void => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failed++;
};

const browser = await chromium.launch({
  args: ["--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults,BlockInsecurePrivateNetworkRequests"],
});
try {
  if (!existsSync(savedFile)) throw new Error(`the dev channel never wrote the phone's keys: ${await new Response(relay.stderr).text()}`);
  const saved = JSON.parse(readFileSync(savedFile, "utf8")) as Saved;
  const tab = await browser.newPage();
  const pushes: Push[] = [];
  const replies = new Map<number, (text: string) => void>();
  let next = 0;
  tab.on("pageerror", (e) => check(false, `no page error (${e.message})`));
  await tab.route("http://localhost/", (r) => r.fulfill({ contentType: "text/html", body: page }));
  await tab.route("http://localhost/engine.js", (r) => r.fulfill({ contentType: "text/javascript", body: engine }));
  await tab.exposeFunction("__push", (text: string) => pushes.push(JSON.parse(text) as Push));
  await tab.exposeFunction("__reply", (id: number, text: string) => replies.get(id)?.(text));
  await tab.addInitScript({ content: "globalThis.kiwiAndroid = { postMessage: (t) => globalThis.__push(t), reply: (id, t) => globalThis.__reply(id, t) };" });
  await tab.goto("http://localhost/");

  const call = (expr: string): Promise<string> => {
    const id = ++next;
    const done = new Promise<string>((resolve) => replies.set(id, resolve));
    void tab.evaluate(wrapper.replace("$expr", expr).replaceAll("$id", String(id)));
    return done;
  };
  const ask = async <T>(request: object): Promise<T> => {
    const reply = JSON.parse(await call(`kiwi.ask(${JSON.stringify(JSON.stringify(request))})`)) as Reply;
    if (!reply.ok) throw new Error(reply.error);
    return reply.value as T;
  };
  const room = async (pred: (r: RoomView) => boolean, ms = 20_000): Promise<RoomView | null> => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      const hit = pushes.flatMap((p) => (p.type === "room" ? [p.room] : [])).findLast(pred);
      if (hit) return hit;
      await Bun.sleep(100);
    }
    return null;
  };

  check((await tab.evaluate("isSecureContext")) === true, "http://localhost/ is a secure context");
  check((await call(probe)) === "ok", "Engine.kt's probe passes: the engine loaded, Ed25519 and X25519 are there");

  await tab.route("http://localhost/v1/config", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ workosClientId: "client_bridge" }) }));
  let direct = 0;
  await tab.route("https://api.workos.com/**", (r) => (direct++, r.abort()));
  const opening = ask<{ url: string | null; code: string }>({ op: "enrollBegin", relay: "http://localhost/", label: "Android bridge check", os: "Android", waitMs: 10_000 });
  let asked: Extract<Push, { type: "fetch" }> | undefined;
  for (let i = 0; i < 200 && !asked; i++) {
    asked = pushes.find((p): p is Extract<Push, { type: "fetch" }> => p.type === "fetch");
    if (!asked) await Bun.sleep(50);
  }
  check(asked?.url === "https://api.workos.com/user_management/authorize/device", "sign-in asks the app to make WorkOS's device call");
  const device = { device_code: "dc", user_code: "ABCD-EFGH", verification_uri_complete: "https://auth.example/device?user_code=ABCD-EFGH", interval: 60 };
  if (asked) await tab.evaluate(`kiwi.fetched(${JSON.stringify(JSON.stringify({ id: asked.id, status: 200, body: JSON.stringify(device) }))})`);
  const signIn = await opening.catch(() => null);
  check(signIn?.code === "ABCD-EFGH" && signIn.url === device.verification_uri_complete, "the app's answer opens the sign-in page");
  check(direct === 0, "the page never calls WorkOS itself, so CORS can't block it");
  await ask({ op: "enrollCancel" });

  await tab.unroute("http://localhost/v1/config");
  await tab.route("http://localhost/v1/config", (r) =>
    r.fulfill({ contentType: "application/json", body: JSON.stringify({ workosClientId: "client_bridge", githubSignIn: true, githubClientId: "Iv23bridge" }) }),
  );
  let directGithub = 0;
  await tab.route("https://github.com/**", (r) => (directGithub++, r.abort()));
  const seen = pushes.length;
  const github = ask<{ url: string | null; code: string }>({ op: "enrollBegin", relay: "http://localhost/", label: "Android bridge check", os: "Android", waitMs: 10_000 });
  let gh: Extract<Push, { type: "fetch" }> | undefined;
  for (let i = 0; i < 200 && !gh; i++) {
    gh = pushes.slice(seen).find((p): p is Extract<Push, { type: "fetch" }> => p.type === "fetch");
    if (!gh) await Bun.sleep(50);
  }
  check(gh?.url === "https://github.com/login/device/code", "on a relay with GitHub sign-in, sign-in asks the app to make GitHub's device call");
  const ghDevice = { device_code: "dc", user_code: "WDJB-MJHT", verification_uri: "https://github.com/login/device", interval: 60 };
  if (gh) await tab.evaluate(`kiwi.fetched(${JSON.stringify(JSON.stringify({ id: gh.id, status: 200, body: JSON.stringify(ghDevice) }))})`);
  const ghSignIn = await github.catch(() => null);
  check(ghSignIn?.code === "WDJB-MJHT" && ghSignIn.url === ghDevice.verification_uri, "the app's answer opens GitHub's sign-in page");
  check(directGithub === 0, "the page never calls GitHub itself, so CORS can't block it");
  await ask({ op: "enrollCancel" });

  check((await ask<number>({ op: "start", saved })) === 1, "start opens one room");

  const live = await room((r) => r.connection === "live" && r.messages.length > 5 && r.asks.length > 0);
  check(live !== null, "a live room arrives through kiwiAndroid.postMessage");
  if (live) {
    const given = (o: object, keys: string[]): boolean => keys.every((k) => (o as Record<string, unknown>)[k] !== undefined && (o as Record<string, unknown>)[k] !== null);
    check(given(live, ["code", "title", "me"]), "the room has every field Wire.kt requires");
    check(
      live.members.every((m) => given(m, ["name", "display", "kind"])),
      "so does every member",
    );
    check(
      live.messages.every((m: MessageView) => given(m, ["seq", "from", "at", "kind", "body"]) && Number.isInteger(m.seq)),
      "and every message",
    );
    check(
      live.tasks.every((t) => given(t, ["id", "title", "state"])),
      "and every task",
    );
    check(
      live.asks.every((a: AskView) => given(a, ["seq", "from", "body", "at", "label"])),
      "and every ask",
    );
    check(
      live.places.every((p) => given(p, ["key", "kind", "title"])),
      "and every place",
    );
    check(live.sideKey !== null, "the lead chat is there");

    const seq = await ask<number>({ op: "send", code: live.code, place: "main", body: "hello from the Android bridge check", re: null, imgs: [] });
    check(Number.isInteger(seq) && seq > 0, "send answers the new seq");
    check((await room((r) => r.messages.some((m) => m.from === r.lead && m.seq > seq))) !== null, "the lead's answer comes back");
    const side = await ask<number>({ op: "send", code: live.code, place: live.sideKey, body: "and one to the lead", re: null, imgs: [] });
    check((await room((r) => (r.side ?? []).some((m) => m.seq === side))) !== null, "a message to the lead chat shows in side");
    await ask<number>({ op: "react", code: live.code, seq, emoji: "👍" });
    check((await room((r) => r.messages.some((m) => m.seq === seq && m.reactions.some((x) => x.emoji === "👍" && x.mine)))) !== null, "a reaction comes back as mine");
    const question = live.asks.find((a) => a.choices.length > 0);
    if (question) {
      await ask<number>({ op: "answer", code: live.code, seq: question.seq, text: question.choices[0] });
      check((await room((r) => !r.asks.some((a) => a.seq === question.seq))) !== null, "answering a question clears it from asks");
    }
  }
} finally {
  await browser.close();
  relay.kill();
  await relay.exited;
  rmSync(dir, { recursive: true, force: true });
}
if (failed) console.log(`${failed} check${failed === 1 ? "" : "s"} failed`);
process.exit(failed ? 1 : 0);
