import { describe, expect, test } from "bun:test";

import { checkManifest, hostAllowed, needKind, netHosts, unapproved } from "../desktop/src/mods.ts";

const base = { name: "linear-panel", version: "1.0.0", shell: "^3.3", needs: ["panel", "command", "net:api.linear.app"] };

describe("a mod's mod.json", () => {
  test("a mod that fits this app passes, its needs listed once", () => {
    const r = checkManifest({ ...base, needs: [...base.needs, "panel"] }, "linear-panel", "3.3.0");
    expect(r).toEqual({ ok: true, manifest: { ...base } });
  });

  test("a shell range this app's contract doesn't meet switches it off, saying both", () => {
    expect(checkManifest({ ...base, shell: "^4.0" }, "linear-panel", "3.3.0")).toEqual({ ok: false, why: "it needs shell ^4.0, and this app offers 3.3.0" });
    expect(checkManifest({ ...base, shell: "not a range" }, "linear-panel", "3.3.0").ok).toBe(false);
  });

  test("a name that isn't its folder's, or isn't plain, is refused", () => {
    expect(checkManifest(base, "other", "3.3.0")).toEqual({ ok: false, why: 'mod.json names it "linear-panel", but its folder is "other"' });
    expect(checkManifest({ ...base, name: "../keys" }, "../keys", "3.3.0").ok).toBe(false);
    expect(checkManifest({ ...base, name: "Linear" }, "Linear", "3.3.0").ok).toBe(false);
  });

  test("a capability that doesn't exist, or that this app doesn't offer yet, is refused by name", () => {
    expect(checkManifest({ ...base, needs: ["keys"] }, "linear-panel", "3.3.0")).toEqual({ ok: false, why: 'it asks for "keys", which isn\'t a capability' });
    expect(checkManifest({ ...base, needs: ["sidebar"] }, "linear-panel", "3.3.0")).toEqual({ ok: false, why: 'it needs "sidebar", which this app doesn\'t offer yet' });
    expect(checkManifest({ ...base, needs: ["net:http://x.com"] }, "linear-panel", "3.3.0").ok).toBe(false);
    expect(checkManifest({ ...base, needs: ["net:*.linear.app"] }, "linear-panel", "3.3.0").ok).toBe(false);
    expect(checkManifest({ ...base, needs: "panel" }, "linear-panel", "3.3.0").ok).toBe(false);
  });

  test("anything that isn't an object with a version is refused", () => {
    expect(checkManifest(null, "x", "3.3.0").ok).toBe(false);
    expect(checkManifest([], "x", "3.3.0").ok).toBe(false);
    expect(checkManifest({ ...base, version: "one" }, "linear-panel", "3.3.0").ok).toBe(false);
  });
});

describe("a mod's needs", () => {
  test("each need names its kind, rooms and hosts checked", () => {
    expect(needKind("read:#general")).toBe("read");
    expect(needKind("post:general")).toBe("post");
    expect(needKind("read:")).toBeNull();
    expect(needKind("panel:x")).toBeNull();
    expect(needKind("net:api.linear.app")).toBe("net");
    expect(needKind("net:localhost")).toBeNull();
    expect(needKind("net:127.0.0.1")).toBeNull();
    expect(netHosts(["panel", "net:a.example.com", "net:b.example.org"])).toEqual(["a.example.com", "b.example.org"]);
  });

  test("what the person hasn't approved yet", () => {
    expect(unapproved(["panel", "net:api.linear.app"], ["panel"])).toEqual(["net:api.linear.app"]);
    expect(unapproved(["panel"], ["panel", "net:old.example.com"])).toEqual([]);
  });

  test("a fetch goes out only over https to a host the mod listed and the person approved", () => {
    const needs = ["panel", "net:api.linear.app"];
    expect(hostAllowed("https://api.linear.app/graphql", needs, needs)).toBe(true);
    expect(hostAllowed("https://API.LINEAR.APP/graphql", needs, needs)).toBe(true);
    expect(hostAllowed("https://api.linear.app/graphql", needs, ["panel"])).toBe(false);
    expect(hostAllowed("http://api.linear.app/graphql", needs, needs)).toBe(false);
    expect(hostAllowed("https://api.linear.app:8443/", needs, needs)).toBe(false);
    expect(hostAllowed("https://user:pw@api.linear.app/", needs, needs)).toBe(false);
    expect(hostAllowed("https://evil.example.com/?api.linear.app", needs, needs)).toBe(false);
    expect(hostAllowed("https://api.linear.app.evil.com/", needs, needs)).toBe(false);
    expect(hostAllowed("https://evil.com/", ["panel"], ["panel", "net:evil.com"])).toBe(false);
    expect(hostAllowed("not a url", needs, needs)).toBe(false);
  });
});
