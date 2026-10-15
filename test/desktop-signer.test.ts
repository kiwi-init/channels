import { describe, expect, test } from "bun:test";

import { designatedRequirement, developerTeam, signedLikeThis, type RunTool, type ToolResult } from "../desktop/src/signer.ts";

const DEVELOPER_ID = 'identifier "com.kiwiinit.channels" and anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] /* exists */ and certificate leaf[field.1.2.840.113635.100.6.1.13] /* exists */ and certificate leaf[subject.OU] = AB12CD34EF';
const AD_HOC = 'cdhash H"4f2a9c0d1e7b3a5f6c8d9e0f1a2b3c4d5e6f7a8b"';

const RUNNING = "/Applications/Kiwi.app";
const NEXT = "/tmp/kiwi-update-x/Kiwi.app";

function stub(answers: { requirement?: string; displayCode?: number; verify?: number; assess?: number }) {
  const calls: string[][] = [];
  const run: RunTool = async (cmd, args): Promise<ToolResult> => {
    calls.push([cmd, ...args]);
    if (cmd.endsWith("codesign") && args[0] === "-d") {
      return { code: answers.displayCode ?? 0, out: `Executable=${RUNNING}/Contents/MacOS/Kiwi\ndesignated => ${answers.requirement ?? DEVELOPER_ID}\n` };
    }
    if (cmd.endsWith("codesign")) return { code: answers.verify ?? 0, out: "" };
    if (cmd.endsWith("spctl")) return { code: answers.assess ?? 0, out: "" };
    return { code: 127, out: "" };
  };
  return { run, calls };
}

describe("the macOS updater's signature check", () => {
  test("a Developer ID requirement is read from codesign and its team found", () => {
    const req = designatedRequirement(`Executable=/x\ndesignated => ${DEVELOPER_ID}\n`);
    expect(req).toBe(DEVELOPER_ID);
    expect(developerTeam(req!)).toBe("AB12CD34EF");
    expect(developerTeam(AD_HOC)).toBeNull();
    expect(developerTeam('certificate leaf[subject.OU] = "AB12CD34EF"')).toBeNull();
    expect(designatedRequirement("Executable=/x\n")).toBeNull();
  });

  test("an update signed like the running app, and accepted by Gatekeeper, goes in", async () => {
    const { run, calls } = stub({});
    expect(await signedLikeThis(RUNNING, NEXT, run)).toBe(true);
    expect(calls).toEqual([
      ["/usr/bin/codesign", "-d", "-r-", RUNNING],
      ["/usr/bin/codesign", "--verify", "--deep", "--strict", "-R", `=${DEVELOPER_ID}`, NEXT],
      ["/usr/sbin/spctl", "--assess", "--type", "execute", NEXT],
    ]);
  });

  test("a bundle that fails the running app's requirement is refused before Gatekeeper is asked", async () => {
    const { run, calls } = stub({ verify: 3 });
    expect(await signedLikeThis(RUNNING, NEXT, run)).toBe(false);
    expect(calls.some(([cmd]) => cmd!.endsWith("spctl"))).toBe(false);
  });

  test("a bundle Gatekeeper rejects is refused", async () => {
    const { run } = stub({ assess: 3 });
    expect(await signedLikeThis(RUNNING, NEXT, run)).toBe(false);
  });

  test("an ad-hoc running app never swaps itself, and asks nothing more", async () => {
    const { run, calls } = stub({ requirement: AD_HOC });
    expect(await signedLikeThis(RUNNING, NEXT, run)).toBe(false);
    expect(calls).toHaveLength(1);
  });

  test("a running app codesign can't read is refused, and asks nothing more", async () => {
    const { run, calls } = stub({ displayCode: 1 });
    expect(await signedLikeThis(RUNNING, NEXT, run)).toBe(false);
    expect(calls).toHaveLength(1);
  });
});
