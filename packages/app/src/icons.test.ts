import { afterEach, describe, expect, test } from "bun:test";

import { ICON_LIVE } from "@kiwi/channel/icon-event.ts";

import { followIcons } from "./icons.ts";

if (!("window" in globalThis)) Object.assign(globalThis, { window: new EventTarget() });

const changed = (code: string) => window.dispatchEvent(new CustomEvent(ICON_LIVE, { detail: code }));

let stop = () => {};
afterEach(() => stop());

describe("channel icons follow the relay for every channel, open or not (#3909)", () => {
  test("boot loads each channel once; after that only an icon change refetches", () => {
    const loads: string[] = [];
    stop = followIcons(["A", "B"], (code) => loads.push(code));
    expect(loads).toEqual(["A", "B"]);
    changed("B");
    expect(loads).toEqual(["A", "B", "B"]);
  });

  test("an icon changed in a background channel is refetched while another channel is open", () => {
    const loads: string[] = [];
    stop = followIcons(["A", "B"], (code) => loads.push(code));
    loads.length = 0;
    changed("B");
    expect(loads).toEqual(["B"]);
  });

  test("a channel this browser isn't in, or a stopped follow, refetches nothing", () => {
    const loads: string[] = [];
    stop = followIcons(["A"], (code) => loads.push(code));
    loads.length = 0;
    changed("Z");
    stop();
    changed("A");
    expect(loads).toEqual([]);
  });
});
