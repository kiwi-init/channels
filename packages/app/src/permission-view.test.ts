import type { PermissionShown } from "@kiwi/core/permission.ts";
import { describe, expect, test } from "bun:test";

import { permissionCode, permissionNotes, permissionTitle, visibleText } from "./permission-view";

const shown = (over: Partial<PermissionShown>): PermissionShown => ({ tool: "Bash", cwd: "/a", nonce: "nonce-123", expiresAt: 10_000, canAllow: true, ...over });

describe("what a permission row says", () => {
  test("its title follows the tool", () => {
    expect(permissionTitle(shown({ command: "ls" }))).toBe("wants to run a command");
    expect(permissionTitle(shown({ tool: "Edit", paths: ["a.ts"] }))).toBe("wants to edit a file");
    expect(permissionTitle(shown({ tool: "Write", paths: ["a.ts"] }))).toBe("wants to write a file");
    expect(permissionTitle(shown({ tool: "WebFetch", url: "https://x.dev/p" }))).toBe("wants to fetch a page");
    expect(permissionTitle(shown({ tool: "mcp__gh__merge", mcp: { server: "gh", tool: "merge", args: ["pr"] } }))).toBe("wants to use gh · merge");
  });

  test("it shows exactly what will run, with hidden and direction-changing characters made visible", () => {
    expect(permissionCode(shown({ command: "rm -rf dist && bun run build" }))).toBe("rm -rf dist && bun run build");
    expect(permissionCode(shown({ tool: "MultiEdit", paths: ["a.ts", "b.ts"] }))).toBe("a.ts\nb.ts");
    expect(permissionCode(shown({ tool: "mcp__gh__merge", mcp: { server: "gh", tool: "merge", args: ["pr", "method"], values: ["12", '"squash"'] } }))).toBe('gh.merge(pr: 12, method: "squash")');
    expect(permissionCode(shown({ tool: "mcp__gh__merge", mcp: { server: "gh", tool: "merge", args: ["pr"] } }))).toBe("gh.merge(pr)");
    expect(visibleText("echo safe‮;hs.lave‬")).toBe("echo safe\\u{202e};hs.lave\\u{202c}");
    expect(visibleText("a\u0007b​c")).toBe("a\\u{0007}b\\u{200b}c");
    expect(visibleText("line one\nline\ttwo")).toBe("line one\nline\ttwo");
  });

  test("it says when the sandbox is off, when it runs in the background, and when the app can't allow it", () => {
    expect(permissionNotes(shown({ command: "ls" }))).toEqual([]);
    expect(permissionNotes(shown({ command: "ls", sandbox: "off", canAllow: false }))).toEqual(["It asks to run outside the sandbox: allow that in the terminal."]);
    expect(permissionNotes(shown({ command: "ls", background: true }))).toEqual(["It runs in the background."]);
    expect(permissionNotes(shown({ tool: "Edit", paths: ["a.ts"], replaced: "a", content: "b", replaceAll: true }))).toEqual(["It replaces every occurrence in the file."]);
    expect(permissionNotes(shown({ tool: "Write", paths: ["a.ts"], canAllow: false }))).toEqual(["Too long to show all of it here: to allow it, answer in the terminal."]);
  });
});
