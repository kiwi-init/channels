// Kiwi's main process: one window, a tray to live in, and the secrets. The
// renderer is web/dist served from kiwi-app://app/ (never file://); everything
// privileged (person key, sign-in, pairing, the daemon) hangs off window.kiwi.

// Identity and pairing are imported straight from src/ and bundled with bun
// build (crypto.ts is WebCrypto-only, and main has WebCrypto): no wrapper, no
// duplicate scheme to drift.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app, BrowserWindow, ipcMain, Menu, nativeImage, nativeTheme, Notification, protocol, safeStorage, shell, Tray } from "electron";

import { generateIdentity, type Identity } from "../../src/identity.ts";
import { answerPair, newSecret, openMailbox, pairCode, readPairAsk, type Mailbox, type PairAsk } from "../../src/mailbox.ts";
import { certifyMachine } from "../../src/person.ts";
import { compareVersions, ensureOnPath, keepCli } from "./cli.ts";
import { applyUpdate, startUpdates, updateState } from "./updater.ts";
import { daemonAdopt, daemonHello, daemonSocketPath, daemonStop, kiwiHome, type HelloResult } from "./daemon-client.ts";
import type { ChannelIdentityView, ComputerView, DaemonStatus, PairAskView, PendingItem, PersonView, SignInResult, StoreSnapshot } from "./bridge.ts";

const PUBLIC_RELAY = "https://channels.kiwiinit.com";
const APP_SCHEME = "kiwi-app";
const APP_HOST = "app";
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

function loadStore(): void {
  try {
    const raw = fs.readFileSync(storePath());
    const json = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(raw)
      : raw.toString("utf8");
    store = { ...defaults(), ...(JSON.parse(json) as Partial<StoreFile>) };
  } catch {
    store = defaults();
  }
  store.relayUrl = normalizeRelay(store.relayUrl) ?? PUBLIC_RELAY;
}

function saveStore(): void {
  const json = JSON.stringify(store);
  const raw = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : Buffer.from(json, "utf8");
  fs.mkdirSync(path.dirname(storePath()), { recursive: true });
  fs.writeFileSync(storePath(), raw, { mode: 0o600 });
}

const snapshot = (): StoreSnapshot => ({ relayUrl: store.relayUrl, person: store.person, channels: store.channels, computers: store.computers, pending: store.pending });
const broadcast = () => win?.webContents.send("kiwi:store", snapshot());
const mutate = (fn: (s: StoreFile) => void) => (fn(store), saveStore(), broadcast());

function normalizeRelay(url: string): string | null {
  try {
    const u = new URL(url.trim());
    if (u.protocol === "https:") return u.origin;
    if (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "::1")) return u.origin;
    return null;
  } catch {
    return null;
  }
}

// ---------- renderer hosting ----------

// Bun inlines __dirname at build time (desktop/src), so a packaged app finds dist/ through the app path.
const preloadPath = () => (app.isPackaged ? path.join(app.getAppPath(), "dist", "preload.js") : path.join(__dirname, "..", "dist", "preload.js"));
const webDist = () => path.join(app.isPackaged ? process.resourcesPath : path.join(__dirname, ".."), app.isPackaged ? "web/dist" : "../web/dist");

const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".map": "application/json" };

function serveWeb(): void {
  protocol.handle(APP_SCHEME, (req) => {
    const u = new URL(req.url);
    let p = decodeURIComponent(u.pathname);
    if (p === "/" || !path.extname(p)) p = "/index.html";
    // Stay inside web/dist: an absolute path on the URL must not escape it.
    const file = path.normalize(path.join(webDist(), p));
    if (!file.startsWith(path.normalize(webDist()))) return new Response("not found", { status: 404 });
    try {
      const body = fs.readFileSync(file);
      // The relay URL rides the entry URL's query (?relay=…); assets don't need it.
      return new Response(new Uint8Array(body), { headers: { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" } });
    } catch {
      if (p !== "/index.html") return serveWebFallback();
      return new Response("not found", { status: 404 });
    }
  });
}

function serveWebFallback(): Response {
  try {
    const body = fs.readFileSync(path.join(webDist(), "index.html"));
    return new Response(new Uint8Array(body), { headers: { "content-type": "text/html" } });
  } catch {
    return new Response("run `bun run web:build` in the repo root first", { status: 500 });
  }
}

const entryUrl = () => `${APP_SCHEME}://${APP_HOST}/index.html?relay=${encodeURIComponent(store.relayUrl)}`;

// ---------- window + tray ----------

function createWindow(): void {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    autoHideMenuBar: true,
    // Linux takes the window's icon from here (X11) or from the .desktop entry its app_id names
    // (Wayland: package.json's desktopName). A Mac uses the bundle's icon.icns.
    ...(process.platform === "linux" ? { icon: path.join(assetsDir(), "icon.png") } : {}),
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
  win?.show();
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
  const verifyUrl = start.verification_uri_complete ?? (start.verification_uri ? `${start.verification_uri}?user_code=${start.user_code ?? ""}` : null);
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

async function freshToken(): Promise<string | null> {
  const s = store.signin;
  if (!s) return null;
  if (Date.now() < s.exp - 60_000) return s.access;
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
    mutate((st) => (st.signin = { access: tok.access_token as string, refresh: tok.refresh_token ?? s.refresh, exp: Date.now() + (tok.expires_in ?? 3600) * 1000 }));
    return store.signin?.access ?? null;
  } catch {
    return null;
  }
}

// ---------- pairing ----------

let pairing: { secret: string; mailbox: Mailbox; ask: PairAsk | null } | null = null;

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
  // Start it as `kiwi daemon` for ~/.kiwi.
  const bin = kiwiBin?.path ?? bundledKiwi();
  const child = spawn(bin, ["daemon"], { env: { ...process.env, KIWI_HOME: home }, detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
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
    const clean = name.replace(/[\u0000-\u001f\u007f-\u009f\u2028-\u2069]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "someone";
    const id = await generateIdentity(clean);
    const person: PersonView = { name: clean, pk: id.pk, sk: id.sk, xpk: id.xpk as string, xsk: id.xsk as string };
    mutate((s) => (s.person = person));
    return person;
  });
  ipcMain.handle("kiwi:save-channels", (_e, channels: ChannelIdentityView[]) => mutate((s) => (s.channels = channels)));
  ipcMain.handle("kiwi:save-computers", (_e, computers: ComputerView[]) => mutate((s) => (s.computers = computers)));
  ipcMain.handle("kiwi:set-pending", (_e, pending: PendingItem[]) => mutate((s) => (s.pending = pending)));
  ipcMain.handle("kiwi:sign-in", (): Promise<SignInResult> => signInMain());
  ipcMain.handle("kiwi:dev-sign-in", (_e, name: string) => {
    const clean = name.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) || "dev";
    mutate((s) => (s.signin = { access: `dev:${clean}`, refresh: "", exp: Number.MAX_SAFE_INTEGER }));
    return { token: `dev:${clean}` };
  });
  ipcMain.handle("kiwi:token", () => freshToken());
  ipcMain.handle("kiwi:sign-out", () => mutate((s) => (s.signin = undefined)));
  ipcMain.handle("kiwi:pair-begin", async () => {
    pairing?.mailbox.drop().catch(() => {});
    const secret = newSecret();
    pairing = { secret, mailbox: await openMailbox(store.relayUrl, secret), ask: null };
    return { code: pairCode(secret) };
  });
  // One short wait on slot a per call; the renderer polls until the person cancels.
  ipcMain.handle("kiwi:pair-poll", async (): Promise<PairAskView | null> => {
    if (!pairing) throw new Error("pairing hasn't started");
    const raw = await pairing.mailbox.wait("a", { timeoutMs: 20_000, everyMs: 1_500 });
    const ask = await readPairAsk(raw, pairing.mailbox);
    if (!ask) return null;
    pairing.ask = ask;
    return { label: ask.label, os: ask.os, machinePk: ask.pk, at: ask.at };
  });
  ipcMain.handle("kiwi:pair-answer", async (_e, accept: boolean) => {
    if (!pairing) throw new Error("pairing hasn't started");
    const { mailbox, ask } = pairing;
    pairing = null;
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
  ipcMain.handle("kiwi:notify", (_e, title: string, body: string) => {
    const n = new Notification({ title, body });
    n.on("click", showWindow);
    n.show();
  });
  ipcMain.handle("kiwi:open-external", (_e, url: string) => {
    if (!/^https?:\/\//.test(url)) throw new Error("only http(s) links open outside");
    return shell.openExternal(url);
  });
  ipcMain.handle("kiwi:deep-link", () => deepLink);
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

  // Privileged schemes must be registered before the ready event (Electron ignores them after).
  protocol.registerSchemesAsPrivileged([{ scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
  void app.whenReady().then(async () => {
    loadStore();
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
