import { describe, expect, test } from "bun:test";

import { installLine, joinCommand } from "./join-line";
import { relayOrigin } from "@kiwi/secrets/relay.ts";

describe("relayOrigin", () => {
  test("keeps an http or https relay as its origin", () => {
    expect(relayOrigin("https://channels.kiwiinit.com")).toBe("https://channels.kiwiinit.com");
    expect(relayOrigin("https://relay.example.org/")).toBe("https://relay.example.org");
    expect(relayOrigin("http://localhost:8787")).toBe("http://localhost:8787");
    expect(relayOrigin("http://[::1]:8787")).toBe("http://[::1]:8787");
    expect(relayOrigin("https://Relay.Example.org/some/path")).toBe("https://relay.example.org");
  });

  test("refuses a host a shell would read as more than a word", () => {
    expect(relayOrigin("https://a;b$(id)/")).toBeNull();
    expect(relayOrigin("https://a&b")).toBeNull();
    expect(relayOrigin("http://ex`id`.com:8080")).toBeNull();
    expect(relayOrigin("https://x'y.example")).toBeNull();
  });

  test("refuses what isn't a web URL", () => {
    expect(relayOrigin("javascript:alert(1)")).toBeNull();
    expect(relayOrigin("file:///etc/passwd")).toBeNull();
    expect(relayOrigin("relay.example.org")).toBeNull();
    expect(relayOrigin(null)).toBeNull();
    expect(relayOrigin(42)).toBeNull();
  });

  test("a path in the URL never reaches the command", () => {
    const origin = relayOrigin("https://relay.example/; printf PWN >&2; #");
    expect(origin).toBe("https://relay.example");
    expect(joinCommand(origin ?? "", "mc2-x")).toBe("curl -fsSL https://relay.example/install | sh -s -- join mc2-x --relay https://relay.example");
  });

  test("a fully qualified name with its root dot is a relay too", () => {
    expect(relayOrigin("https://relay.example.org./")).toBe("https://relay.example.org.");
  });
});

describe("the lines people paste", () => {
  test("an IPv6 relay is quoted, so a shell that globs brackets takes it as one word", () => {
    expect(joinCommand("http://[::1]:8787", "mc2-x")).toBe("curl -fsSL 'http://[::1]:8787/install' | sh -s -- join mc2-x --relay 'http://[::1]:8787'");
    expect(installLine("http://[::1]:8787", "login")).toBe("curl -fsSL 'http://[::1]:8787/install' | sh -s -- login");
  });

  test("the public relay's lines stay as they were", () => {
    expect(installLine("https://channels.kiwiinit.com")).toBe("curl -fsSL https://channels.kiwiinit.com/install | sh");
    expect(joinCommand("https://channels.kiwiinit.com", "mc2-x")).toBe("curl -fsSL https://channels.kiwiinit.com/install | sh -s -- join mc2-x");
  });

  test("a shell hands curl and the installer exactly the words the line means", () => {
    const line = joinCommand("http://[::1]:8787", "mc2-x");
    const stubs = `curl() { printf 'curl:%s\\n' "$@"; }; sh() { cat >/dev/null; printf 'sh:%s\\n' "$@"; }; `;
    const out = Bun.spawnSync(["/bin/sh", "-c", stubs + line]).stdout.toString();
    expect(out.split("\n").filter(Boolean)).toEqual(["sh:-s", "sh:--", "sh:join", "sh:mc2-x", "sh:--relay", "sh:http://[::1]:8787"]);
  });
});
