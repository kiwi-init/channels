import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startRelay } from "../../src/relay/bun.ts";
import { GITHUB_WEBHOOK_PATH } from "../../src/relay/github.ts";
import { devHumanAuth } from "../../src/relay/human.ts";
import { daemonStop } from "../src/daemon-client.ts";
import { DEFAULT_MODS } from "../src/mods-default.ts";
import { appExecutable, attach, launch, screenshot, stop, testEnv, until, type Driver } from "./eb-drive.ts";
import { fillIn, firstChannel } from "./eb-first-run.ts";

if (!process.argv[2]) {
  console.error("usage: bun desktop/scripts/eb-github-mod-check.ts <the app built with CHANNELS_EB_TEST=1> [screenshot dir]");
  process.exit(2);
}

const exe = appExecutable(process.argv[2]);
const shots = process.argv[3] ?? null;
const root = mkdtempSync(join(tmpdir(), "kiwi-github-mod-check-"));
const later = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const problems: string[] = [];
const check = (ok: boolean, what: string): void => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) problems.push(what);
};

const SECRET = crypto.randomUUID();
const REPO = "kiwi-init/mods-check";
const SHA = "c".repeat(40);
const relay = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: join(root, "relay"), human: devHumanAuth(), githubSecret: SECRET, githubPush: null, devNoRateLimits: true });
const RELAY = relay.url.origin;

async function hook(event: string, payload: unknown): Promise<number> {
  const body = JSON.stringify(payload);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return (await fetch(`${RELAY}${GITHUB_WEBHOOK_PATH}`, { method: "POST", headers: { "x-github-event": event, "x-hub-signature-256": `sha256=${sig}` }, body })).status;
}

const clickText = ({ selector, text }: { selector: string; text: string }): boolean => {
  const el = [...document.querySelectorAll<HTMLElement>(selector)].find((e) => (e.textContent ?? "").trim() === text && e.getClientRects().length > 0);
  el?.click();
  return !!el;
};

const clickLabelEnding = ({ selector, ending }: { selector: string; ending: string }): boolean => {
  const el = [...document.querySelectorAll<HTMLElement>(selector)].find((e) => (e.getAttribute("aria-label") ?? "").endsWith(ending) && e.getClientRects().length > 0);
  el?.click();
  return !!el;
};

const submitIn = (label: string): boolean => {
  const input = document.querySelector<HTMLInputElement>(`[role="dialog"] input[aria-label="${label}"]`);
  const add = input?.form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!input?.form || !add || add.disabled) return false;
  input.form.requestSubmit();
  return true;
};

const tabButton = (title: string): { pressed: string | null; alert: string | null } | null => {
  const b = [...document.querySelectorAll<HTMLButtonElement>("nav.tabs button")].find((e) => (e.firstChild?.textContent ?? "").trim() === title);
  return b ? { pressed: b.getAttribute("aria-pressed"), alert: b.querySelector(".tab-red")?.getAttribute("aria-label") ?? null } : null;
};

const pressTab = (title: string): boolean => {
  const b = [...document.querySelectorAll<HTMLButtonElement>("nav.tabs button")].find((e) => (e.firstChild?.textContent ?? "").trim() === title);
  b?.click();
  return !!b;
};

const pressChat = (): boolean => {
  const b = document.querySelector<HTMLButtonElement>("nav.tabs button");
  b?.click();
  return !!b;
};

const topAt = (selector: string): { found: boolean; top: string | null } => {
  const el = document.querySelector<HTMLElement>(selector);
  const r = el?.getBoundingClientRect();
  if (!el || !r?.width || !r.height) return { found: false, top: null };
  const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { found: true, top: at instanceof HTMLIFrameElement ? `frame ${at.title}` : (at?.className ?? null) };
};

const frames = (): string[] => [...document.querySelectorAll("iframe")].map((f) => `${f.title} ${f.style.width}x${f.style.height} ${f.style.visibility || "shown"}`);

const escape = (): boolean => {
  (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  return !document.querySelector('[role="dialog"]');
};

const typeCommand = (text: string): boolean => {
  const area = document.querySelector<HTMLTextAreaElement>(".main .composer textarea");
  if (!area) return false;
  area.focus();
  if (area.value !== text) {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(area, text);
    area.dispatchEvent(new Event("input", { bubbles: true }));
    return false;
  }
  area.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true, cancelable: true }));
  return true;
};

const pageNow = (): Record<string, unknown> => ({
  chan: document.querySelector(".chan")?.className ?? null,
  top: [...document.querySelectorAll(".top button, nav.tabs button")].map((b) => `${b.getAttribute("aria-label") ?? (b.textContent ?? "").trim()} ${b.getClientRects().length ? "shown" : "hidden"}`),
  dialog: (document.querySelector('[role="dialog"]')?.textContent ?? null)?.slice(0, 600),
  panel: (document.querySelector(".panel")?.outerHTML ?? null)?.slice(0, 1_200),
  palette: [...document.querySelectorAll(".palette-item")].map((e) => (e.textContent ?? "").slice(0, 80)),
  frames: [...document.querySelectorAll("iframe")].map((f) => `${f.title} ${f.style.width}x${f.style.height} ${f.style.visibility || "shown"}`),
});

let driver: Driver | null = null;

const step = (what: string, ms: number, act: () => Promise<boolean>) =>
  until(what, ms, () =>
    act().then(
      (done) => (done ? true : null),
      () => null,
    ),
  ).catch(async (e: unknown) => {
    if (driver) console.log(`the page at "${what}": ${JSON.stringify(await driver.evaluate(pageNow, null, 3_000).catch(String), null, 1)}`);
    throw e;
  });

async function answers(d: Driver, why: string): Promise<number> {
  const start = Date.now();
  await d.evaluate(() => true, null, 5_000);
  const page = Date.now() - start;
  const mainStart = Date.now();
  const main = await d.main("browserOpens", 5_000).then(
    () => `answered in ${Date.now() - mainStart} ms`,
    (e: unknown) => String(e),
  );
  console.log(`${why}: the page answered in ${page} ms; frames ${JSON.stringify(await d.evaluate(frames, null, 3_000).catch(String))}; the app's main ${main}`);
  return page;
}

async function shot(name: string): Promise<void> {
  screenshot(shots, name);
}

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    const s = statSync(p, { throwIfNoEntry: false });
    return s?.isDirectory() ? files(p) : s ? [p] : [];
  });
}

const app = launch(exe, testEnv(root, join(root, "driver.sock"), RELAY));
try {
  const d = await attach(join(root, "driver.sock"));
  driver = d;
  await firstChannel(d, 0);
  type Mod = { name: string; version: string | null; state: string; why?: string };
  const mods = () => d.evaluate(() => (window as unknown as { kiwi: { mods(): Promise<Mod[]> } }).kiwi.mods(), null, 15_000);
  const github = await until("the GitHub mod, installed on first start", 90_000, async () => (await mods()).find((m) => m.name === "github" && m.state !== "asks") ?? null).catch(async () => {
    console.log(`mods: ${JSON.stringify(await mods().catch(String))}`);
    return null;
  });
  console.log(`the GitHub mod: ${JSON.stringify(github)}`);
  check(github?.state === "on", "with an empty ~/.kiwi/ the app installs the GitHub mod on first start, already approved, and it runs");
  const pin = DEFAULT_MODS.find((p) => p.name === "github")!;
  const sources = JSON.parse(readFileSync(join(root, ".kiwi", "mods", ".sources.json"), "utf8")) as Record<string, { commit?: string }>;
  check(sources["github"]?.commit === pin.commit, `it's the copy pinned in the app (kiwi-init/mods@${pin.commit.slice(0, 7)})`);
  await step("the channel", 30_000, () => d.evaluate(() => !!document.querySelector(".chan"), null, 2_000));
  await later(2_000);
  check(!(await d.evaluate(tabButton, "GitHub", 2_000)), "a channel with no repos shows no GitHub tab, as on main");

  await step("the channel's settings", 10_000, () => d.evaluate(clickLabelEnding, { selector: "button", ending: ": channel settings" }, 2_000));
  await step("the settings' GitHub section", 10_000, () => d.evaluate(clickText, { selector: '[role="dialog"] .modal-seg button', text: "GitHub" }, 2_000));
  await step("the repo, typed", 10_000, () => d.evaluate(fillIn, { selector: '[role="dialog"] input[aria-label="Add a repo"]', value: REPO }, 2_000));
  await step("Add", 10_000, () => d.evaluate(submitIn, "Add a repo", 2_000));
  await step("the repo, linked", 30_000, () => d.evaluate((repo) => [...document.querySelectorAll('[role="dialog"] .cset-repo-name')].some((a) => a.textContent === repo), REPO, 2_000));
  await step("the settings, closed", 10_000, () => d.evaluate(escape, null, 2_000));

  const tab = await until("the GitHub tab", 30_000, () => d.evaluate(tabButton, "GitHub", 2_000)).catch(() => null);
  check(!!tab, "linking a repo brings the GitHub tab into the channel's header, drawn by the mod's tab()");
  await step("the GitHub tab, pressed", 10_000, () => d.evaluate(pressTab, "GitHub", 2_000));
  const empty = await until("the mod's tab frame", 20_000, async () => {
    const t = await d.evaluate(topAt, ".mod-tab-slot", 2_000);
    return t.found && t.top?.startsWith("frame") ? t : null;
  }).catch(() => null);
  console.log(`at the tab: ${JSON.stringify(empty)}`);
  check(empty?.top === "frame github's tab", "the GitHub tab is the mod's own frame, on top of its slot");
  await shot("github-tab-empty");

  const pr = {
    number: 42,
    title: "The GitHub tab is a mod",
    html_url: `https://github.com/${REPO}/pull/42`,
    state: "open",
    merged: false,
    head: { ref: "github-mod", sha: SHA },
    additions: 120,
    deletions: 80,
    changed_files: 6,
  };
  check(
    (await hook("pull_request", { action: "opened", repository: { full_name: REPO }, sender: { login: "octocat" }, pull_request: pr })) === 202,
    "the relay takes a signed pull_request webhook for the linked repo",
  );
  check(
    (await hook("check_run", {
      action: "completed",
      repository: { full_name: REPO },
      check_run: { id: 7, name: "unit", status: "completed", conclusion: "failure", head_sha: SHA, html_url: `https://github.com/${REPO}/actions/runs/7` },
    })) === 202,
    "and a failed check on its head",
  );
  const red = await until("the tab's red dot", 150_000, async () => {
    const t = await d.evaluate(tabButton, "GitHub", 2_000);
    return t?.alert ? t : null;
  }).catch(() => null);
  console.log(`the tab, after the PR: ${JSON.stringify(red)}`);
  check(red?.alert === "An open pull request's checks failed", "a PR with a failed check reaches the mod's snapshot, and the mod's tab shows the red dot");
  await later(1_000);
  await shot("github-tab-pr");

  await step("the chat", 10_000, () => d.evaluate(pressChat, null, 2_000));
  await later(2_000);
  const hidden = await d.evaluate(topAt, ".mod-tab-slot", 2_000);
  check(!hidden.found, "away from the GitHub tab, its slot is gone");
  const page = await answers(d, "with the tab frame hidden");
  check(page < 1_000, `the page keeps answering while the mod's tab frame is hidden (${page} ms)`);
  await later(3_000);
  const still = await answers(d, "3 s later");
  check(still < 1_000, `and 3 s later (${still} ms)`);

  await step("/prs, typed", 10_000, () => d.evaluate(typeCommand, "/prs", 2_000));
  const back = await until("the GitHub tab, from /prs", 15_000, async () => {
    const t = await d.evaluate(tabButton, "GitHub", 2_000);
    return t?.pressed === "true" ? t : null;
  }).catch(() => null);
  check(!!back, "/prs opens the GitHub tab");
  const again = await until("the mod's tab frame, again", 15_000, async () => {
    const t = await d.evaluate(topAt, ".mod-tab-slot", 2_000);
    return t.top?.startsWith("frame") ? t : null;
  }).catch(() => null);
  check(again?.top === "frame github's tab", "coming back to the tab shows the same frame on top again");
  await shot("github-tab-prs");

  const opens = (await d.main("browserOpens")) as string[];
  console.log(`opened in the browser: ${JSON.stringify(opens)}`);
  check(app.exitCode === null && app.signalCode === null, "the app is still running");
  d.close();
} catch (e) {
  problems.push(e instanceof Error ? e.message : String(e));
  console.log(`FAIL ${problems.at(-1)}`);
} finally {
  await stop(app);
  await daemonStop(join(root, ".kiwi"), 2_000).catch(() => false);
  relay.stop(true);
  for (const f of files(join(root, "home"))) {
    if (!/main\.log$/.test(f)) continue;
    const lines = readFileSync(f, "utf8")
      .split("\n")
      .filter((l) => /mod|github|install|refused/i.test(l));
    if (lines.length) console.log(`${f}:\n${lines.join("\n")}`);
  }
  rmSync(root, { recursive: true, force: true });
}
if (problems.length) process.exit(1);
console.log("ok: the GitHub tab is a mod the app installs on first start; it follows the channel's GitHub state, and leaving the tab doesn't stall the app");
