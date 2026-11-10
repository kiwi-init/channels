import { expect, test } from "bun:test";
import { ownerArgs } from "./owner-args.ts";

test("the owner helper reads its own options and leaves everything else in place", () => {
  expect(ownerArgs(["--as", "human", "approve", "123-456", "--name", "win", "--role", "lead"])).toEqual({ opt: { as: "human", name: "win", role: "lead" }, args: ["approve", "123-456"] });
  expect(ownerArgs(["create", "ops", "--as", "win", "--open"])).toEqual({ opt: { as: "win", open: true }, args: ["create", "ops"] });
  expect(ownerArgs(["-c", "ops", "requests"])).toEqual({ opt: { c: "ops" }, args: ["requests"] });
});

test("a key that starts with a dash is the key, not an option (issue 2270)", () => {
  expect(ownerArgs(["--as", "human", "deny", "--CUhIlk"])).toEqual({ opt: { as: "human" }, args: ["deny", "--CUhIlk"] });
  expect(ownerArgs(["--as", "human", "deny", "-CUhIlkQ"])).toEqual({ opt: { as: "human" }, args: ["deny", "-CUhIlkQ"] });
  expect(ownerArgs(["deny", "--as"])).toEqual({ opt: { as: undefined as unknown as string }, args: ["deny"] });
});
