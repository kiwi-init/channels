import { expect, test } from "bun:test";
import { REX_UNKNOWN, rexStatusOf } from "../desktop/src/rex-status.ts";

test("Settings reads kiwi rex status --json, and anything else as Rex not found", () => {
  expect(rexStatusOf('{"found":true,"version":"0.0.1792433367-g93d474","server":"running","helpers":"on","rotation":"off"}')).toEqual({
    found: true,
    version: "0.0.1792433367-g93d474",
    server: "running",
    helpers: "on",
    rotation: "off",
  });
  expect(rexStatusOf('{"found":true,"server":"stopped","helpers":"off","rotation":"on"}')).toEqual({ found: true, server: "stopped", helpers: "off", rotation: "on" });
  expect(rexStatusOf('{"found":"yes","version":"has spaces","server":"up","helpers":true,"rotation":1}')).toEqual(REX_UNKNOWN);
  expect(rexStatusOf("Rex isn't installed on this computer")).toEqual(REX_UNKNOWN);
  expect(rexStatusOf("[]")).toEqual(REX_UNKNOWN);
});
