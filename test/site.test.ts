import { expect, test } from "bun:test";
import { join } from "node:path";

const SOURCE = await Bun.file(join(import.meta.dir, "../site/app.js")).text();
const CODE = `mc2-${"A".repeat(22)}-${"B".repeat(16)}`;

interface Node {
  hidden: boolean;
  href: string;
  textContent: string;
  className: string;
  children: Node[];
  append: (...nodes: Node[]) => void;
}

function node(): Node {
  const n: Node = { hidden: false, href: "", textContent: "", className: "", children: [], append: (...nodes) => n.children.push(...nodes) };
  return n;
}

interface Nav {
  userAgent: string;
  userAgentData?: { getHighEntropyValues: (hints: string[]) => Promise<{ architecture?: string }> };
}

function load(pathname: string, hash = "", navigator: Nav = { userAgent: "" }) {
  const page = { landing: node(), invite: node(), "open-app": node(), "join-cmd": node(), downloads: node(), download: node(), "download-for": node() };
  const isPart = (id: string): id is keyof typeof page => id in page;
  const document = {
    getElementById: (id: string) => (isPart(id) ? page[id] : null),
    createElement: () => node(),
    querySelectorAll: () => [],
  };
  const location = { pathname, hash, origin: "https://channels.example" };
  new Function("document", "location", "navigator", SOURCE)(document, location, navigator);
  return page;
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
  expect(page.downloads.children.length).toBe(4);
});

test("a path that isn't a join code is not shown as one", () => {
  const page = load("/join/<script>");
  expect(page["open-app"].href).toBe("");
  expect(page.downloads.children.length).toBe(4);
});

test("the renderer's hash invite still works", () => {
  expect(load("/", `#${CODE}`)["open-app"].href).toBe(`kiwi://join/${CODE}`);
});

const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("a Mac downloads the Apple silicon build when the browser can't say which chip", async () => {
  const page = load("/", "", { userAgent: MAC });
  await settle();
  expect(page.download.href).toEndWith("/Channels-0.20.0-mac-arm64.dmg");
  expect(page["download-for"].textContent).toBe("macOS · Apple silicon");
});

test("a Mac whose browser reports an x86 chip downloads the Intel build", async () => {
  const page = load("/", "", { userAgent: MAC, userAgentData: { getHighEntropyValues: async () => ({ architecture: "x86" }) } });
  await settle();
  expect(page.download.href).toEndWith("/Channels-0.20.0-mac-x64.dmg");
});

test("a Mac whose browser refuses the chip hint still gets Apple silicon", async () => {
  const page = load("/", "", { userAgent: MAC, userAgentData: { getHighEntropyValues: () => Promise.reject(new Error("denied")) } });
  await settle();
  expect(page.download.href).toEndWith("/Channels-0.20.0-mac-arm64.dmg");
});

test("Ubuntu gets the .deb and other Linux the AppImage", async () => {
  const ubuntu = load("/", "", { userAgent: "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0" });
  const linux = load("/", "", { userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36" });
  await settle();
  expect(ubuntu.download.href).toEndWith("/Channels-0.20.0-linux-amd64.deb");
  expect(linux.download.href).toEndWith("/Channels-0.20.0-linux-x86_64.AppImage");
});

test("Windows, phones and ARM Linux keep the button on the full list", async () => {
  for (const userAgent of [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
    "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  ]) {
    const page = load("/", "", { userAgent });
    await settle();
    expect(page.download.href).toBe("");
    expect(page.downloads.children.length).toBe(4);
  }
});
