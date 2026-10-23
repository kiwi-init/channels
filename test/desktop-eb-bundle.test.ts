import { expect, test } from "bun:test";
import { bundleProblems, RELEASE_ID, urlSchemeProblems } from "../desktop/scripts/eb-bundle.ts";

const table = "var internalRpcHandlers = { message: { webviewTagExecuteJavascript: (params) => {} } };";

test("the built app has one internal RPC table for the lock to reach, and a preload with no socket", () => {
  expect(bundleProblems(table, "window.kiwi = bridge;")).toEqual([]);
  expect(bundleProblems(`${table}\n${table}`, "x")).toEqual([expect.stringContaining("defines Electrobun's internal RPC table 2 times")]);
  expect(bundleProblems("var nothing = 1;", "x")).toEqual([expect.stringContaining("0 times")]);
  expect(bundleProblems(table, "")).toEqual([expect.stringContaining("preload bundle is empty")]);
  expect(bundleProblems(table, 'new WebSocket("ws://127.0.0.1:50000/socket")')).toEqual([expect.stringContaining("uses a WebSocket")]);
});

test("the release bundle registers kiwi:// and a test bundle never does (T438)", () => {
  const plist = (schemes: string[]) =>
    `<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>x</string>${schemes.length ? `<key>CFBundleURLTypes</key><array><dict><key>CFBundleURLName</key><string>x</string><key>CFBundleURLSchemes</key><array>${schemes.map((s) => `<string>${s}</string>`).join("")}</array></dict></array>` : ""}</dict></plist>`;
  expect(urlSchemeProblems(plist(["kiwi"]), RELEASE_ID, "kiwi")).toEqual([]);
  expect(urlSchemeProblems(plist([]), RELEASE_ID, "kiwi")).toEqual([expect.stringContaining("registers no kiwi:// scheme")]);
  expect(urlSchemeProblems(plist(["other"]), RELEASE_ID, "kiwi")).toEqual([expect.stringContaining("registers no kiwi:// scheme")]);
  expect(urlSchemeProblems(plist([]), "com.kiwiinit.channels.eb-test", "kiwi")).toEqual([]);
  expect(urlSchemeProblems(plist(["kiwi"]), "com.kiwiinit.channels.eb-test", "kiwi")).toEqual([expect.stringContaining("could take links meant for the installed Channels")]);
});
