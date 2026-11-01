import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { throwawayKey } from "./minisign-sign.ts";

const SCRIPT = join(import.meta.dir, "..", "site", "install.sh");
const FIXTURES = join(import.meta.dir, "fixtures", "minisign");
const keyLine = readFileSync(join(FIXTURES, "test.pub"), "utf8").trim().split("\n").at(-1)!;
const sums = join(FIXTURES, "SHA256SUMS");
const signed = join(FIXTURES, "SHA256SUMS.minisig");
const legacy = join(FIXTURES, "SHA256SUMS.legacy.minisig");
const L = 2n ** 252n + 27742317777372353535851937790883648493n;

const work = mkdtempSync(join(tmpdir(), "kiwi-minisign-py-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

const verifier = (): string => {
  const py = readFileSync(SCRIPT, "utf8").split("<<'PYKIWI'\n")[1]?.split("\nPYKIWI")[0];
  if (!py) throw new Error("install.sh no longer carries the python verifier inside it");
  const file = join(work, "minisign-verify.py");
  writeFileSync(file, py);
  return file;
};

const run = (data: string, sig: string, key: string = keyLine) => Bun.spawnSync(["python3", verifier(), data, sig, key]);

const raised = (data: string, sig: string, key: string = keyLine): string | undefined => {
  const r = run(data, sig, key);
  return r.exitCode === 0 ? undefined : r.stderr.toString().trim().split("\n").at(-1);
};

const scalarPlusL = (b64line: string, scalarAt: number): string => {
  const raw = Buffer.from(b64line, "base64");
  const s = raw.subarray(scalarAt, scalarAt + 32).reduceRight((acc, b) => (acc << 8n) | BigInt(b), 0n) + L;
  const out = Buffer.alloc(32);
  let x = s;
  for (let i = 0; i < 32; i++) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return Buffer.concat([raw.subarray(0, scalarAt), out, raw.subarray(scalarAt + 32)]).toString("base64");
};

const withLine = (sigText: string, index: number, line: string): string => {
  const lines = sigText.trim().split("\n");
  lines[index] = line;
  return `${lines.join("\n")}\n`;
};

const have = Bun.which("python3");
(have ? describe : describe.skip)("the installer's built-in signature check", () => {
  test("verifies the checksums minisign signed, raw or prehashed, and tolerates CRLF", () => {
    expect(run(sums, signed).exitCode).toBe(0);
    expect(run(sums, legacy).exitCode).toBe(0);
    const crlf = join(work, "crlf.minisig");
    writeFileSync(crlf, readFileSync(signed, "utf8").replace(/\n/g, "\r\n"));
    expect(run(sums, crlf).exitCode).toBe(0);
  });

  test("refuses changed checksums, another key, an edited trusted comment, or a broken file", () => {
    const changed = join(work, "changed");
    writeFileSync(changed, readFileSync(sums, "utf8").replace("aa11", "aa12"));
    expect(run(changed, signed).exitCode).toBe(1);
    expect(run(sums, signed, throwawayKey().publicKey).exitCode).toBe(1);
    const edited = join(work, "edited.minisig");
    writeFileSync(edited, readFileSync(signed, "utf8").replace("kiwi v9.9.9", "kiwi v9.9.8"));
    expect(run(sums, edited).exitCode).toBe(1);
    const broken = join(work, "broken.minisig");
    writeFileSync(broken, readFileSync(signed, "utf8").split("\n").slice(0, 3).join("\n") + "\n");
    expect(run(sums, broken).exitCode).toBe(1);
    expect(run(sums, signed, "RWT not base64!").exitCode).toBe(1);
  });

  test("says why it refused", () => {
    expect(raised(sums, signed, throwawayKey().publicKey)).toContain("names another key");
  });

  test("refuses a signature whose scalar was shifted by the group order", () => {
    const text = readFileSync(signed, "utf8");
    const lines = text.trim().split("\n");
    const mainShifted = join(work, "main-plus-l.minisig");
    writeFileSync(mainShifted, withLine(text, 1, scalarPlusL(lines[1]!, 42)));
    expect(run(sums, mainShifted).exitCode).toBe(1);
    expect(raised(sums, mainShifted)).toContain("doesn't verify this release's checksums");
    const globalShifted = join(work, "global-plus-l.minisig");
    writeFileSync(globalShifted, withLine(text, 3, scalarPlusL(lines[3]!, 32)));
    expect(run(sums, globalShifted).exitCode).toBe(1);
    expect(raised(sums, globalShifted)).toContain("trusted comment doesn't verify");
  });
});
