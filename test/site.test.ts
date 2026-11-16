import { expect, test } from "bun:test";
import { join } from "node:path";

const SOURCE = await Bun.file(join(import.meta.dir, "../site/app.js")).text();
const CODE = `mc2-${"A".repeat(22)}-${"B".repeat(16)}`;

interface Node {
  hidden: boolean;
  href: string;
  src: string;
  title: string;
  tabIndex: number;
  textContent: string;
  attrs: Record<string, string>;
  props: Record<string, string>;
  classes: Set<string>;
  children: Node[];
  listeners: Record<string, () => void>;
  contentWindow: { posted: unknown[]; postMessage: (data: unknown) => void };
  removed: boolean;
  style: { setProperty: (name: string, value: string) => void };
  classList: { add: (name: string) => void };
  append: (...nodes: Node[]) => void;
  setAttribute: (name: string, value: string) => void;
  addEventListener: (type: string, fn: () => void) => void;
  remove: () => void;
}

function node(): Node {
  const posted: unknown[] = [];
  const n: Node = {
    hidden: false,
    href: "",
    src: "",
    title: "",
    tabIndex: 0,
    textContent: "",
    attrs: {},
    props: {},
    classes: new Set(),
    children: [],
    listeners: {},
    contentWindow: { posted, postMessage: (data) => posted.push(data) },
    removed: false,
    style: { setProperty: (name, value) => (n.props[name] = value) },
    classList: { add: (name) => n.classes.add(name) },
    append: (...nodes) => n.children.push(...nodes),
    setAttribute: (name, value) => (n.attrs[name] = value),
    addEventListener: (type, fn) => (n.listeners[type] = fn),
    remove: () => (n.removed = true),
  };
  return n;
}

interface Nav {
  userAgent: string;
  userAgentData?: { getHighEntropyValues: (hints: string[]) => Promise<{ architecture?: string }> };
}

type Message = (e: { source: unknown; data: unknown }) => void;

function load(pathname: string, hash = "", navigator: Nav = { userAgent: "" }, withScene = false) {
  const page = {
    landing: node(),
    invite: node(),
    "open-app": node(),
    "join-cmd": node(),
    download: node(),
    "ios-beta": node(),
    ...(withScene ? { scene: node() } : {}),
  };
  const isPart = (id: string): id is keyof typeof page => id in page;
  const body = { dataset: {} as Record<string, string> };
  const document = {
    body,
    getElementById: (id: string) => (isPart(id) ? page[id] : null),
    createElement: () => node(),
    querySelectorAll: () => [],
  };
  const location = { pathname, hash, origin: "https://channels.example" };
  const messages: Message[] = [];
  const motion = { matches: false, addEventListener: () => {} };
  new Function("document", "location", "navigator", "matchMedia", "addEventListener", SOURCE)(
    document,
    location,
    navigator,
    () => motion,
    (type: string, fn: Message) => type === "message" && messages.push(fn),
  );
  const frame = (page as { scene?: Node }).scene?.children[0];
  const message = (source: unknown, data: unknown) => messages.forEach((fn) => fn({ source, data }));
  return Object.assign(page, { body, frame, message });
}

test("an invite path opens the invite with its code", () => {
  const page = load(`/join/${CODE}`);
  expect(page.landing.hidden).toBe(true);
  expect(page["open-app"].href).toBe(`kiwi://join/${CODE}`);
  expect(page["join-cmd"].textContent).toBe(`curl -fsSL https://channels.example/install | sh -s -- join ${CODE}`);
});

test("an invite path with a trailing slash still opens the invite", () => {
  expect(load(`/join/${CODE}/`)["open-app"].href).toBe(`kiwi://join/${CODE}`);
});

test("a malformed percent escape in the path shows the landing page instead of throwing", () => {
  const page = load("/join/%E0%A4%A");
  expect(page.landing.hidden).toBe(false);
  expect(page.invite.hidden).toBe(false);
});

test("a path that isn't a join code is not shown as one", () => {
  const page = load("/join/<script>");
  expect(page["open-app"].href).toBe("");
  expect(page.landing.hidden).toBe(false);
});

test("the renderer's hash invite still works", () => {
  expect(load("/", `#${CODE}`)["open-app"].href).toBe(`kiwi://join/${CODE}`);
});

const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("a Mac downloads the Apple silicon build when the browser can't say which chip", async () => {
  const page = load("/", "", { userAgent: MAC });
  await settle();
  expect(page.download.href).toMatch(/\/Channels-[\d.]+-mac-arm64\.dmg$/);
  expect(page.download.title).toBe("macOS · Apple silicon");
});

test("an Intel Mac gets no app: the button stays on the release page, where the CLI is", async () => {
  const page = load("/", "", { userAgent: MAC, userAgentData: { getHighEntropyValues: async () => ({ architecture: "x86" }) } });
  await settle();
  expect(page.download.href).toBe("");
  expect(page.download.title).toBe("");
});

test("a Mac whose browser refuses the chip hint still gets Apple silicon", async () => {
  const page = load("/", "", { userAgent: MAC, userAgentData: { getHighEntropyValues: () => Promise.reject(new Error("denied")) } });
  await settle();
  expect(page.download.href).toMatch(/\/Channels-[\d.]+-mac-arm64\.dmg$/);
});

test("every Linux, Ubuntu too, gets the AppImage: there is no .deb", async () => {
  const ubuntu = load("/", "", { userAgent: "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0" });
  const linux = load("/", "", { userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36" });
  await settle();
  expect(ubuntu.download.href).toMatch(/\/Channels-[\d.]+-linux-x86_64\.AppImage$/);
  expect(linux.download.href).toMatch(/\/Channels-[\d.]+-linux-x86_64\.AppImage$/);
});

test("an iPhone's button opens the iOS beta on TestFlight", async () => {
  const page = load("/", "", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148" });
  await settle();
  expect(page.download.href).toMatch(/^https:\/\/testflight\.apple\.com\/join\//);
  expect(page.download.textContent).toBe("Get iOS Beta");
  expect(page["ios-beta"].removed).toBe(true);
});

test("Windows, Android and ARM Linux keep the button on the release page", async () => {
  for (const userAgent of [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36",
    "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  ]) {
    const page = load("/", "", { userAgent });
    await settle();
    expect(page.download.href).toBe("");
  }
});

test("the landing frames the AFK scene in a sandbox and sends it the clock", () => {
  const page = load("/", "", undefined, true);
  const frame = page.frame!;
  expect(frame.src).toBe("/afk/scene");
  expect(frame.attrs.sandbox).toBe("allow-scripts");
  expect(page.scene!.props["--sky-top"]).toMatch(/^rgb\(/);
  expect(["day", "night"]).toContain(page.body.dataset.sky!);
  frame.listeners.load!();
  expect(frame.contentWindow.posted[0]).toMatchObject({ kiwi: "afk", type: "state", needs: 0, still: false });
});

test("the scene shows only once it says it's ready, and only that frame can say so", () => {
  const page = load("/", "", undefined, true);
  const frame = page.frame!;
  page.message({}, { kiwi: "afk", type: "ready" });
  expect(frame.classes.has("is-ready")).toBe(false);
  page.message(frame.contentWindow, { kiwi: "afk", type: "ready" });
  expect(frame.classes.has("is-ready")).toBe(true);
});

test("a scene that never says ready is taken down, leaving the sky", async () => {
  const page = load("/", "", undefined, true);
  const frame = page.frame!;
  const timers: (() => void)[] = [];
  const real = globalThis.setTimeout;
  globalThis.setTimeout = ((fn: () => void) => timers.push(fn)) as unknown as typeof setTimeout;
  try {
    frame.listeners.load!();
  } finally {
    globalThis.setTimeout = real;
  }
  timers.forEach((fn) => fn());
  expect(frame.removed).toBe(true);
});

test("the invite page doesn't load the scene", () => {
  const page = load(`/join/${CODE}`, "", undefined, true);
  expect(page.frame).toBeUndefined();
});
