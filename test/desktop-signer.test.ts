import { describe, expect, test } from "bun:test";

import { developerIdRequirement, signedLikeThisApp, type RunTool, type ToolRun } from "../desktop/src/signer.ts";

const REQ =
  'identifier "com.kiwiinit.kiwi" and anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] /* exists */ and certificate leaf[field.1.2.840.113635.100.6.1.13] /* exists */ and certificate leaf[subject.OU] = ABCDE12345';
const DISPLAYED = `Executable=/Applications/Kiwi.app/Contents/MacOS/Kiwi\ndesignated => ${REQ}\n`;
const AD_HOC = 'Executable=/Applications/Kiwi.app/Contents/MacOS/Kiwi\ndesignated => cdhash H"0123456789abcdef0123456789abcdef01234567"\n';

function tools(answers: { display?: ToolRun; verify?: ToolRun; assess?: ToolRun }): { run: RunTool; calls: string[][] } {
  const calls: string[][] = [];
  const run: RunTool = async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === "/usr/sbin/spctl") return answers.assess ?? { code: 0, out: "" };
    if (args[0] === "-d") return answers.display ?? { code: 0, out: DISPLAYED };
    return answers.verify ?? { code: 0, out: "" };
  };
  return { run, calls };
}

describe("developerIdRequirement", () => {
  test("reads a Developer ID app's designated requirement", () => {
    expect(developerIdRequirement(DISPLAYED)).toBe(REQ);
  });

  test("an ad-hoc or unsigned app has none to hold an update to", () => {
    expect(developerIdRequirement(AD_HOC)).toBeNull();
    expect(developerIdRequirement("code object is not signed at all\n")).toBeNull();
    expect(developerIdRequirement(`designated => identifier "com.kiwiinit.kiwi" and anchor apple generic\n`)).toBeNull();
  });

  test("a requirement that an alternative or a negation could loosen is not one to hold an update to", () => {
    expect(developerIdRequirement(`designated => (${REQ}) or true\n`)).toBeNull();
    expect(developerIdRequirement(`designated => ${REQ} or anchor apple\n`)).toBeNull();
    expect(developerIdRequirement(`designated => ${REQ} and ! identifier "x"\n`)).toBeNull();
  });

  test("words inside quoted values don't count as operators", () => {
    const quoted = REQ.replace('identifier "com.kiwiinit.kiwi"', 'identifier "com.or.kiwi (beta)"');
    expect(developerIdRequirement(`designated => ${quoted}\n`)).toBe(quoted);
  });
});

describe("signedLikeThisApp", () => {
  test("an update passes when codesign holds it to the running app's requirement and Gatekeeper accepts it", async () => {
    const { run, calls } = tools({});
    expect(await signedLikeThisApp("/Applications/Kiwi.app", "/tmp/u/Kiwi.app", run)).toBe(true);
    expect(calls).toEqual([
      ["/usr/bin/codesign", "-d", "-r-", "/Applications/Kiwi.app"],
      ["/usr/bin/codesign", "--verify", "--deep", "--strict", "-R", `=${REQ}`, "/tmp/u/Kiwi.app"],
      ["/usr/sbin/spctl", "--assess", "--type", "execute", "/tmp/u/Kiwi.app"],
    ]);
  });

  test("an update signed by anyone else fails codesign's requirement test and is refused", async () => {
    const { run } = tools({ verify: { code: 3, out: "test-requirement: code failed to satisfy specified code requirement(s)" } });
    expect(await signedLikeThisApp("/Applications/Kiwi.app", "/tmp/u/Kiwi.app", run)).toBe(false);
  });

  test("an update Gatekeeper rejects (not notarized) is refused", async () => {
    const { run } = tools({ assess: { code: 3, out: "rejected" } });
    expect(await signedLikeThisApp("/Applications/Kiwi.app", "/tmp/u/Kiwi.app", run)).toBe(false);
  });

  test("an ad-hoc running app never swaps itself, and asks nothing more of the update", async () => {
    const { run, calls } = tools({ display: { code: 0, out: AD_HOC } });
    expect(await signedLikeThisApp("/Applications/Kiwi.app", "/tmp/u/Kiwi.app", run)).toBe(false);
    expect(calls.length).toBe(1);
  });
});
