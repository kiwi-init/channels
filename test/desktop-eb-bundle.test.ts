import { expect, test } from "bun:test";
import { bundleProblems } from "../desktop/scripts/eb-bundle.ts";

const table = "var internalRpcHandlers = { message: { webviewTagExecuteJavascript: (params) => {} } };";

test("the built app has one internal RPC table for the lock to reach, and a preload with no socket", () => {
  expect(bundleProblems(table, "window.kiwi = bridge;")).toEqual([]);
  expect(bundleProblems(`${table}\n${table}`, "x")).toEqual([expect.stringContaining("defines Electrobun's internal RPC table 2 times")]);
  expect(bundleProblems("var nothing = 1;", "x")).toEqual([expect.stringContaining("0 times")]);
  expect(bundleProblems(table, "")).toEqual([expect.stringContaining("preload bundle is empty")]);
  expect(bundleProblems(table, 'new WebSocket("ws://127.0.0.1:50000/socket")')).toEqual([expect.stringContaining("uses a WebSocket")]);
});
