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

function load(pathname: string, hash = "") {
  const page = { landing: node(), invite: node(), "open-app": node(), "join-cmd": node(), downloads: node() };
  const isPart = (id: string): id is keyof typeof page => id in page;
  const document = {
    getElementById: (id: string) => (isPart(id) ? page[id] : null),
    createElement: () => node(),
    querySelectorAll: () => [],
  };
  const location = { pathname, hash, origin: "https://channels.example" };
  new Function("document", "location", SOURCE)(document, location);
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
