import { expect, test } from "bun:test";
import { readDoctorFindings } from "../desktop/src/doctor-view.ts";

test("Settings reads kiwi doctor --json: each check that passed, each problem with its fix, and anything else as no answer", () => {
  const findings = [
    { ok: true, what: "version  0.27.3" },
    { ok: false, what: "Claude Code hooks are not installed.", how: "Run kiwi hooks install." },
  ];
  expect(readDoctorFindings(JSON.stringify({ findings }))).toEqual(findings);
  const odd = [...findings, { ok: false, what: "a problem with no fix" }, { ok: true, what: "" }, { ok: "yes", what: "x" }, "text", null];
  expect(readDoctorFindings(JSON.stringify({ findings: odd }))).toEqual(findings);
  expect(readDoctorFindings(JSON.stringify({ findings: [{ ok: true, what: "x".repeat(2_001) }] }))).toEqual([]);
  expect(readDoctorFindings("ok   version  0.27.3")).toBeNull();
  expect(readDoctorFindings(JSON.stringify({ hooks: [] }))).toBeNull();
});
