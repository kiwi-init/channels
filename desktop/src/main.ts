// Kiwi's main process: one window, a tray to live in, and the secrets. The
// renderer is web/dist served from kiwi-app://app/ (never file://); everything
// privileged (person key, sign-in, pairing, the daemon) hangs off window.kiwi.

// Identity and pairing are imported straight from src/ and bundled with bun
// build (crypto.ts is WebCrypto-only, and main has WebCrypto): no wrapper, no
// duplicate scheme to drift.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, Notification, protocol, safeStorage, shell, Tray } from "electron";

import { generateIdentity, type Identity } from "../../src/identity.ts";
import { answerPair, newSecret, openMailbox, pairCode, readPairAsk, type Mailbox, type PairAsk } from "../../src/mailbox.ts";
import { certifyMachine } from "../../src/person.ts";
import { compareVersions, ensureOnPath, keepCli } from "./cli.ts";
import { APP_HOST, APP_SCHEME, csp, externalUrl, fileFor, isAppUrl, normalizeRelay, readStore } from "./guard.ts";
import { applyUpdate, startUpdates, updateState } from "./updater.ts";
import { daemonAdopt, daemonHello, daemonSocketPath, daemonStop, kiwiHome, spawnDaemon, type HelloResult } from "./daemon-client.ts";
import type { ChannelIdentityView, ComputerView, DaemonStatus, PairAskView, PendingItem, PersonView, SignInResult, StoreSnapshot } from "./bridge.ts";

const PUBLIC_RELAY = "https://channels.kiwiinit.com";
const JOIN_SCHEME = "kiwi";

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let deepLink: string | null = null;
let quitting = false;

// ---------- secrets store ----------

interface StoreFile {
  relayUrl: string;
  person: PersonView | null;
  channels: ChannelIdentityView[];
  computers: ComputerView[];
  pending: PendingItem[];
  signin?: { access: string; refresh: string; exp: number };
}

const storePath = () => path.join(app.getPath("userData"), "kiwi-store.bin");

function defaults(): StoreFile {
  return { relayUrl: PUBLIC_RELAY, person: null, channels: [], computers: [], pending: [] };
}

let store: StoreFile = defaults();

/**
 * Why the saved store couldn't be read (a locked keychain, encryption that went away, a damaged file),
 * or null. While set, nothing is written over that file: an empty store saved there would wipe the
 * person's key and every channel's.
 */
let storeBroken: string | null = null;

function loadStore(): void {
  let raw: Buffer | null = null;
  try {
    raw = fs.readFileSync(storePath());
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") storeBroken = e instanceof Error ? e.message : String(e);
  }
  const read = storeBroken ? null : readStore(raw, safeStorage.isEncryptionAvailable() ? (b) => safeStorage.decryptString(b) : null);
  if (read?.kind === "ok") store = { ...defaults(), ...(read.json as Partial<StoreFile>) };
  else {
    store = defaults();
    if (read?.kind === "unreadable") storeBroken = read.why;
  }
  store.relayUrl = normalizeRelay(store.relayUrl) ?? PUBLIC_RELAY;
}

const brokenError = () => new Error(`Kiwi can't read its saved keys (${storeBroken}), so it saves nothing over them. Unlock your keychain, then quit and reopen Kiwi. The file is ${storePath()}.`);

/** Write the store: encrypted when the system can, to a temporary file first, so a crash never leaves half of one. */
function saveStore(): void {
  if (storeBroken) throw brokenError();
  const json = JSON.stringify(store);
  const raw = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : Buffer.from(json, "utf8");
  const file = storePath();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, raw, { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

/** Say once, at start, that the saved keys couldn't be read: the app runs, but saves nothing until a restart reads them. */
function warnIfBroken(): void {
  if (!storeBroken) return;
  void dialog.showMessageBox({ type: "error", message: "Kiwi can't read its saved keys", detail: brokenError().message });
}

const snapshot = (): StoreSnapshot => ({ relayUrl: store.relayUrl, person: store.person, channels: store.channels, computers: store.computers, pending: store.pending });
const broadcast = () => win?.webContents.send("kiwi:store", snapshot());
const mutate = (fn: (s: StoreFile) => void) => {
  if (storeBroken) throw brokenError();
  fn(store);
  saveStore();
  broadcast();
};

// ---------- renderer hosting ----------

// Bun inlines __dirname at build time (desktop/src), so a packaged app finds dist/ through the app path.
const preloadPath = () => (app.isPackaged ? path.join(app.getAppPath(), "dist", "preload.js") : path.join(__dirname, "..", "dist", "preload.js"));
const webDist = () => path.join(app.isPackaged ? process.resourcesPath : path.join(__dirname, ".."), app.isPackaged ? "web/dist" : "../web/dist");

const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".map": "application/json" };

/** Headers for everything kiwi-app:// serves: the type, and the CSP (guard.ts), so script that got in can't reach out. */
const webHeaders = (type: string): Record<string, string> => ({
  "content-type": type,
  "content-security-policy": csp(store.relayUrl),
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
});

function serveWeb(): void {
  protocol.handle(APP_SCHEME, (req) => {
    const u = new URL(req.url);
    // Only kiwi-app://app/, and only a file inside web/dist (guard.ts: no climbing out, no bad escapes).
    const file = u.host === APP_HOST ? fileFor(webDist(), u.pathname) : null;
    if (!file) return new Response("not found", { status: 404 });
    try {
      const body = fs.readFileSync(file);
      return new Response(new Uint8Array(body), { headers: webHeaders(MIME[path.extname(file)] ?? "application/octet-stream") });
    } catch {
      if (path.basename(file) !== "index.html") return serveWebFallback();
      return new Response("not found", { status: 404 });
    }
  });
}

function serveWebFallback(): Response {
  try {
    const body = fs.readFileSync(path.join(webDist(), "index.html"));
    return new Response(new Uint8Array(body), { headers: webHeaders("text/html") });
  } catch {
    return new Response("run `bun run web:build` in the repo root first", { status: 500 });
  }
}

// The relay isn't on the URL: the page gets it from window.kiwi (the snapshot), which only main sets.
const entryUrl = () => `${APP_SCHEME}://${APP_HOST}/index.html`;

// ---------- window + tray ----------

/** A link that may leave the app goes to the system browser (http(s) only); anything else goes nowhere. */
function openOutside(url: string): void {
  const ext = externalUrl(url);
  if (ext) void shell.openExternal(ext);
}

/**
 * Every page this app makes shows kiwi-app:// and nothing else: a page holding window.kiwi (the person's
 * keys, the sign-in) must never become someone else's. A link that opens a window (target=_blank in a
 * message) or navigates away goes to the system browser instead, with no window.kiwi there.
 */
function guardContents(wc: Electron.WebContents): void {
  wc.setWindowOpenHandler(({ url }) => {
    openOutside(url);
    return { action: "deny" };
  });
  const stay = (e: Electron.Event, url: string) => {
    if (isAppUrl(url)) return;
    e.preventDefault();
    openOutside(url);
  };
  wc.on("will-navigate", stay);
  wc.on("will-redirect", stay);
  wc.on("will-attach-webview", (e) => e.preventDefault());
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    autoHideMenuBar: true,
    // No title bar on a Mac: the app's own header row (52px, web/src/index.css --chrome-h) carries
    // the traffic lights, centred on it, and moves the window. Elsewhere the system frame stays.
    ...(process.platform === "darwin" ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 20, y: 20 } } : {}),
    // The canvas, so the window never flashes white (or black) before the page paints.
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0d0d0e" : "#ffffff",
    webPreferences: { preload: preloadPath(), contextIsolation: true, sandbox: true },
  });
  void win.loadURL(entryUrl());
  // Closing keeps the app running (background auto-approval + notifications); Quit lives in the tray.
  win.on("close", (e) => {
    if (quitting) return;
    e.preventDefault();
    win?.hide();
  });
  win.on("closed", () => (win = null));
  if (deepLink) win.webContents.send("kiwi:deep-link", deepLink);
}

/** Restart into a downloaded update: put it in place for when this quits, and quit. */
function restartToUpdate(): void {
  if (!applyUpdate(true)) return;
  quitting = true;
  app.quit();
}

function trayMenu(): Electron.Menu {
  const u = updateState();
  return Menu.buildFromTemplate([
    { label: "Open Kiwi", click: showWindow },
    ...(u?.state === "ready" ? [{ label: `Restart to update to ${u.version}`, click: restartToUpdate }] : []),
    { type: "separator" },
    { label: "Quit", click: () => (quitting = true, app.quit()) },
  ]);
}

function createTray(): void {
  const icon = trayIcon();
  tray = new Tray(icon);
  tray.setToolTip("Kiwi");
  tray.setContextMenu(trayMenu());
  tray.on("click", () => (win && !win.isDestroyed() && win.isVisible() ? win.hide() : showWindow()));
}

/** desktop/assets: shipped beside the app (extraResources), read from the source tree in development. */
const assetsDir = () => (app.isPackaged ? path.join(process.resourcesPath, "assets") : path.join(__dirname, "..", "assets"));

/**
 * The tray's icon: a Mac menu bar takes a template (black and alpha, which it tints for a light or
 * dark bar); a Linux panel, colour. nativeImage picks up the @2x file beside each by itself. (It
 * can't read SVG: the tray used to look for web/dist's favicon and showed nothing, on either.)
 */
function trayIcon(): Electron.NativeImage {
  const mac = process.platform === "darwin";
  const img = nativeImage.createFromPath(path.join(assetsDir(), mac ? "trayTemplate.png" : "tray.png"));
  if (mac) img.setTemplateImage(true);
  return img;
}

// ---------- deep links (kiwi://join/<code>) ----------

function handleDeepLink(url: string): void {
  if (!url.startsWith(`${JOIN_SCHEME}://join/`)) return;
  deepLink = url;
  win?.webContents.send("kiwi:deep-link", url);
  // A link can arrive before ready (a Mac launching the app for it): the window it opens takes it then.
  if (app.isReady()) showWindow();
}

// ---------- sign-in ----------

// WorkOS device authorization, per the plan: the system browser takes the
// person to approve, main polls the token endpoint for the result. Endpoint
// paths follow WorkOS user management; check them against the WorkOS version
// pinned when this is first exercised end to end.
const WORKOS_DEVICE_URL = "https://api.workos.com/user_management/authorize/device";
const WORKOS_TOKEN_URL = "https://api.workos.com/user_management/authenticate";

interface RelayConfig {
  workosClientId?: string | null;
  dev?: boolean;
}

async function relayConfig(relay: string): Promise<RelayConfig> {
  const res = await fetch(new URL("/v1/config", relay));
  if (!res.ok) throw new Error(`the relay returned ${res.status}`);
  return (await res.json()) as RelayConfig;
}

async function workosDeviceSignIn(clientId: string): Promise<{ access: string; refresh: string; exp: number }> {
  const start = await (await fetch(WORKOS_DEVICE_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: clientId, scope: "openid profile email offline_access" }),
  })).json() as { device_code?: string; user_code?: string; verification_uri?: string; verification_uri_complete?: string; expires_in?: number; interval?: number };
  if (!start.device_code) throw new Error("the relay's sign-in didn't start");
  const given = start.verification_uri_complete ?? (start.verification_uri ? `${start.verification_uri}?user_code=${encodeURIComponent(start.user_code ?? "")}` : null);
  // Only a web page goes to the browser: never a file, an app's scheme, or anything else a reply could name.
  const verifyUrl = given && URL.canParse(given) && new URL(given).protocol === "https:" ? given : null;
  if (!verifyUrl) throw new Error("the relay's sign-in didn't start");
  await shell.openExternal(verifyUrl);
  const until = Date.now() + (start.expires_in ?? 600) * 1000;
  for (;;) {
    await new Promise((r) => setTimeout(r, (start.interval ?? 5) * 1000));
    const res = await fetch(WORKOS_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: start.device_code, client_id: clientId }),
    });
    if (res.status === 400) {
      const err = ((await res.json().catch(() => ({}))) as { error?: string }).error;
      if (err === "authorization_pending" || err === "slow_down") {
        if (Date.now() > until) throw new Error("sign-in timed out");
        continue;
      }
      throw new Error("sign-in was declined");
    }
    if (!res.ok) throw new Error(`sign-in failed (${res.status})`);
    const tok = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!tok.access_token || !tok.refresh_token) throw new Error("sign-in came back without a token");
    return { access: tok.access_token, refresh: tok.refresh_token, exp: Date.now() + (tok.expires_in ?? 3600) * 1000 };
  }
}

async function signInMain(): Promise<SignInResult> {
  const config = await relayConfig(store.relayUrl);
  if (config.dev) return { dev: true };
  if (!config.workosClientId) throw new Error("this relay has no sign-in");
  const sess = await workosDeviceSignIn(config.workosClientId);
  mutate((s) => (s.signin = sess));
  return { token: sess.access };
}

// One refresh at a time: WorkOS turns the refresh token over on each use, so a second refresh racing
// the first with the same one is refused, reads as signed out, and sends the person to sign in again.
let refreshing: Promise<string | null> | null = null;

async function freshToken(): Promise<string | null> {
  const s = store.signin;
  if (!s) return null;
  if (Date.now() < s.exp - 60_000) return s.access;
  refreshing ??= refreshToken(s).finally(() => (refreshing = null));
  return refreshing;
}

async function refreshToken(s: NonNullable<StoreFile["signin"]>): Promise<string | null> {
  try {
    const config = await relayConfig(store.relayUrl);
    if (!config.workosClientId) return s.access;
    const res = await fetch(WORKOS_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant_type: "refresh_token", refresh_token: s.refresh, client_id: config.workosClientId }),
    });
    if (!res.ok) throw new Error("refresh refused");
    const tok = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!tok.access_token) throw new Error("no token");
    // A sign-out (or a change of relay) while this ran stands: its session isn't put back.
    if (store.signin !== s) return store.signin?.access ?? null;
    mutate((st) => (st.signin = { access: tok.access_token as string, refresh: tok.refresh_token ?? s.refresh, exp: Date.now() + (tok.expires_in ?? 3600) * 1000 }));
    return store.signin?.access ?? null;
  } catch {
    return null;
  }
}

// ---------- pairing ----------

// stop ends a poll's wait when this pairing is cancelled, answered or replaced.
let pairing: { secret: string; mailbox: Mailbox; ask: PairAsk | null; stop: AbortController } | null = null;

function requirePerson(): Identity {
  const p = store.person;
  if (!p || !p.xsk) throw new Error("make your person key first");
  return { name: p.name, pk: p.pk, sk: p.sk, xpk: p.xpk, xsk: p.xsk };
}

function upsertComputer(c: ComputerView): void {
  mutate((s) => {
    s.computers = [...s.computers.filter((x) => x.machinePk !== c.machinePk), c];
  });
}

// ---------- the bundled daemon ----------

function bundledKiwi(): string {
  const exe = process.platform === "win32" ? "kiwi.exe" : "kiwi";
  const fromPkg = path.join(process.resourcesPath, exe);
  if (app.isPackaged && fs.existsSync(fromPkg)) return fromPkg;
  const fromRepo = path.join(__dirname, "..", "..", "dist", exe);
  if (fs.existsSync(fromRepo)) return fromRepo;
  throw new Error("the bundled kiwi binary is missing (repo root `bun run build` makes dist/kiwi)");
}

/** The kiwi this app runs: the one it keeps in ~/.kiwi/bin (cli.ts) once packaged, else the repo's build. */
let kiwiBin: { path: string; version: string } | null = null;

async function ensureDaemon(): Promise<HelloResult | null> {
  const home = kiwiHome();
  const running = await daemonHello(home);
  // One running an older kiwi than the app keeps here is stopped, so this computer's daemon is the
  // same kiwi its agents run (an app update brings both along).
  if (running && !(kiwiBin && compareVersions(running.version, kiwiBin.version) < 0)) return running;
  if (running) {
    await daemonStop(home);
    for (let i = 0; i < 20 && (await daemonHello(home, 500)); i++) await new Promise((r) => setTimeout(r, 250));
  }
  // Start it as `kiwi daemon` for ~/.kiwi, on the app's relay.
  spawnDaemon(kiwiBin?.path ?? bundledKiwi(), home, store.relayUrl);
  const until = Date.now() + 10_000;
  for (;;) {
    const hello = await daemonHello(home);
    if (hello) return hello;
    if (Date.now() > until) return null;
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function adoptDaemon(): Promise<ComputerView> {
  const person = requirePerson();
  const home = kiwiHome();
  const hello = (await daemonHello(home)) ?? (await ensureDaemon());
  if (!hello) throw new Error(`no daemon answers at ${daemonSocketPath(home)}`);
  const label = os.hostname().split(".")[0] || "this computer";
  const cert = await certifyMachine(person, { pk: hello.machine.pk, xpk: hello.machine.xpk, label });
  await daemonAdopt(home, { cert, person: { pk: person.pk, xpk: person.xpk as string, name: person.name } });
  const c: ComputerView = { label, os: process.platform, machinePk: hello.machine.pk, machineXpk: hello.machine.xpk, personPk: person.pk, at: Date.now(), own: true };
  upsertComputer(c);
  return c;
}

/** The CLI here, current: the app does this on every start (cli.ts); this is the same, on request. */
async function installCli(): Promise<{ path: string }> {
  kiwiBin = await keepCli(bundledKiwi(), app.getVersion());
  ensureOnPath();
  return { path: kiwiBin.path };
}

// ---------- ipc ----------

/** Set while kiwi:create-person is making the key (it awaits): a second call then is refused. */
let makingPerson = false;

function wireIpc(): void {
  // Synchronous snapshot at load; main decrypted once at startup (see loadStore).
  ipcMain.on("kiwi:snapshot-sync", (e) => (e.returnValue = snapshot()));
  ipcMain.handle("kiwi:relay-url", () => store.relayUrl);
  ipcMain.handle("kiwi:set-relay-url", (_e, url: string) => {
    const norm = normalizeRelay(url);
    if (!norm) throw new Error("that isn't a relay URL (https, or http on localhost)");
    mutate((s) => {
      s.relayUrl = norm;
      s.signin = undefined;
    });
    win?.loadURL(entryUrl());
    return norm;
  });
  ipcMain.handle("kiwi:create-person", async (_e, name: string) => {
    // One person key, for good: every computer's certificate and channel seat is signed by it. Making
    // one awaits, so a second call while the first is still making it is refused too, and the store is
    // checked again right before the write.
    if (store.person || makingPerson) throw new Error("this app already has your person key");
    makingPerson = true;
    try {
      const clean = name.replace(/[\u0000-\u001f\u007f-\u009f\u2028-\u2069]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "someone";
      const id = await generateIdentity(clean);
      const person: PersonView = { name: clean, pk: id.pk, sk: id.sk, xpk: id.xpk as string, xsk: id.xsk as string };
      if (store.person) throw new Error("this app already has your person key");
      mutate((s) => (s.person = person));
      return person;
    } finally {
      makingPerson = false;
    }
  });
  ipcMain.handle("kiwi:save-channels", (_e, channels: ChannelIdentityView[]) => mutate((s) => (s.channels = channels)));
  ipcMain.handle("kiwi:save-computers", (_e, computers: ComputerView[]) => mutate((s) => (s.computers = computers)));
  ipcMain.handle("kiwi:set-pending", (_e, pending: PendingItem[]) => mutate((s) => (s.pending = pending)));
  ipcMain.handle("kiwi:sign-in", (): Promise<SignInResult> => signInMain());
  ipcMain.handle("kiwi:dev-sign-in", async (_e, name: string) => {
    // Only a relay that says it takes dev sign-in (bun relay --dev-sign-in) gets a dev token kept for it.
    if (!(await relayConfig(store.relayUrl)).dev) throw new Error("this relay doesn't take dev sign-in");
    const clean = name.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) || "dev";
    mutate((s) => (s.signin = { access: `dev:${clean}`, refresh: "", exp: Number.MAX_SAFE_INTEGER }));
    return { token: `dev:${clean}` };
  });
  ipcMain.handle("kiwi:token", () => freshToken());
  ipcMain.handle("kiwi:sign-out", () => mutate((s) => (s.signin = undefined)));
  ipcMain.handle("kiwi:pair-begin", async () => {
    pairing?.stop.abort();
    pairing?.mailbox.drop().catch(() => {});
    const secret = newSecret();
    pairing = { secret, mailbox: await openMailbox(store.relayUrl, secret), ask: null, stop: new AbortController() };
    return { code: pairCode(secret) };
  });
  // One short wait on slot a per call; the renderer polls until the person cancels.
  // A cancel, an answer or a new pairing can land during the wait: the poll keeps to the pairing it
  // began on, and once that one is gone it has nothing to say.
  ipcMain.handle("kiwi:pair-poll", async (): Promise<PairAskView | null> => {
    const p = pairing;
    if (!p) throw new Error("pairing hasn't started");
    const raw = await p.mailbox.wait("a", { timeoutMs: 20_000, everyMs: 1_500, signal: p.stop.signal }).catch((err: unknown) => {
      if (pairing === p) throw err;
      return null;
    });
    const ask = await readPairAsk(raw, p.mailbox);
    if (!ask || pairing !== p) return null;
    p.ask = ask;
    return { label: ask.label, os: ask.os, machinePk: ask.pk, at: ask.at };
  });
  ipcMain.handle("kiwi:pair-answer", async (_e, accept: boolean) => {
    if (!pairing) throw new Error("pairing hasn't started");
    const { mailbox, ask, stop } = pairing;
    pairing = null;
    stop.abort();
    if (!accept || !ask) {
      await mailbox.drop();
      return null;
    }
    const person = requirePerson();
    await answerPair(person, mailbox, ask);
    await mailbox.drop().catch(() => {});
    upsertComputer({ label: ask.label, os: ask.os, machinePk: ask.pk, machineXpk: ask.mxpk, personPk: person.pk, at: Date.now() });
    return { machinePk: ask.pk };
  });
  ipcMain.handle("kiwi:pair-cancel", async () => {
    const p = pairing;
    pairing = null;
    p?.stop.abort();
    await p?.mailbox.drop().catch(() => {});
  });
  ipcMain.handle("kiwi:daemon-status", async (): Promise<DaemonStatus> => {
    const hello = await daemonHello();
    if (!hello) return { running: false };
    return { running: true, version: hello.version, machinePk: hello.machine.pk, pairedPerson: hello.paired ? { pk: hello.paired.person, name: hello.paired.name } : null };
  });
  ipcMain.handle("kiwi:daemon-adopt", () => adoptDaemon());
  ipcMain.handle("kiwi:install-cli", () => installCli());
  ipcMain.handle("kiwi:update-state", () => updateState());
  ipcMain.handle("kiwi:update-install", () => restartToUpdate());
  // Each notification is held until it's clicked or closed: one nothing refers to is garbage collected,
  // and its click with it. A Mac doesn't always say when one is closed (Notification Center keeps
  // them), so past 100 the oldest are let go.
  const shown = new Set<Notification>();
  ipcMain.handle("kiwi:notify", (_e, title: string, body: string) => {
    const n = new Notification({ title, body });
    shown.add(n);
    for (const old of shown) if (shown.size > 100) shown.delete(old);
    const done = () => shown.delete(n);
    n.on("click", () => (done(), showWindow()));
    n.on("close", done);
    n.on("failed", done);
    n.show();
  });
  ipcMain.handle("kiwi:open-external", (_e, url: string) => {
    const ext = externalUrl(url);
    if (!ext) throw new Error("only http(s) links open outside");
    return shell.openExternal(ext);
  });
  // Each link is the renderer's once: a reload doesn't open the channel again.
  ipcMain.handle("kiwi:deep-link", () => {
    const link = deepLink;
    deepLink = null;
    return link;
  });
}

// Bring the window back: recreate it if it was destroyed, restore, show and focus.
function showWindow(): void {
  if (!win || win.isDestroyed()) createWindow();
  if (win?.isMinimized()) win.restore();
  win?.show();
  win?.focus();
}

// ---------- startup ----------

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", (_e, argv) => {
    const link = argv.find((a) => a.startsWith(`${JOIN_SCHEME}://`));
    if (link) handleDeepLink(link);
    else showWindow();
  });
  app.on("open-url", (e, url) => (e.preventDefault(), handleDeepLink(url)));
  if (process.platform !== "darwin") {
    const link = process.argv.find((a) => a.startsWith(`${JOIN_SCHEME}://`));
    if (link) deepLink = link;
  }
  if (process.defaultApp && process.argv.length >= 2) app.setAsDefaultProtocolClient(JOIN_SCHEME, process.execPath, [path.resolve(process.argv[1] as string)]);

  app.on("web-contents-created", (_e, wc) => guardContents(wc));
  // Privileged schemes must be registered before the ready event (Electron ignores them after).
  protocol.registerSchemesAsPrivileged([{ scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
  void app.whenReady().then(async () => {
    loadStore();
    warnIfBroken();
    serveWeb();
    wireIpc();
    createWindow();
    createTray();
    // The app's own updates, from proper releases (updater.ts): the window and the tray hear each step.
    startUpdates((u) => {
      win?.webContents.send("kiwi:update", u);
      tray?.setContextMenu(trayMenu());
    });
    app.on("activate", showWindow);
    // Its own computer's kiwi, kept current by the app (cli.ts: nobody installs or updates it by
    // hand), then its daemon on that kiwi; adopting (certify + hand back) is the renderer's call
    // once a person key exists (daemonAdopt). A development run leaves the installed kiwi alone.
    void (async () => {
      if (app.isPackaged) {
        try {
          kiwiBin = await keepCli(bundledKiwi(), app.getVersion());
          ensureOnPath();
        } catch {
          // The daemon still runs from the app's own copy below.
        }
      }
      await ensureDaemon();
    })().catch(() => {});
  });

  app.on("window-all-closed", () => {
    // The tray keeps us alive for background auto-approval; Quit is in its menu.
  });
  // Any real quit (⌘Q, the Dock's Quit, a logout, the tray's Quit) lets the window close: closing it
  // otherwise only hides it, and would cancel the quit.
  app.on("before-quit", () => (quitting = true));
}
