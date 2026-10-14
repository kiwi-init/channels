// The shapes the relay accepts (T112): keys and signatures in their own alphabet and length, and
// member records and wrapped keys capped, so a body can't store unbounded junk. Epoch names are
// checked where they're stored (putMember; see quotas.test.ts).

import { expect, test } from "bun:test";
import { fits, JoinRequest, MemberRecord } from "../src/relay/schema.ts";

const key = "A".repeat(43);
const sig = "s".repeat(86);

test("a member record: real keys, a record and wrapped keys of bounded size, epochs as numbers", () => {
  const ok = { pk: key, xpk: key, rec: "r", keys: { "0": "w" } };
  expect(fits(MemberRecord, ok)).toBe(true);
  expect(fits(MemberRecord, { ...ok, pk: "x" })).toBe(false);
  expect(fits(MemberRecord, { ...ok, xpk: `${key}=` })).toBe(false);
  expect(fits(MemberRecord, { ...ok, pk: "A".repeat(42) + "!" })).toBe(false);
  expect(fits(MemberRecord, { ...ok, rec: "r".repeat(8_193) })).toBe(false);
  expect(fits(MemberRecord, { ...ok, keys: { "0": "w".repeat(1_025) } })).toBe(false);
});

test("a join request: real keys and a real signature", () => {
  const ok = { pk: key, xpk: key, box: "b", sig, ts: 1, commit: "c".repeat(43) };
  expect(fits(JoinRequest, { ...ok, sig: "short" })).toBe(false);
  expect(fits(JoinRequest, { ...ok, pk: "x".repeat(1_000) })).toBe(false);
});
