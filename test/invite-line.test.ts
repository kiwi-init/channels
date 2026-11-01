import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inviteLine } from "@kiwi/app/join-line.ts";

const root = mkdtempSync(join(tmpdir(), "kiwi-invite-line-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function script(path: string, body: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
}

const line = inviteLine("https://relay.example", "mc2-abc", { nick: "Ada Bot" });
const SHELLS = ["sh", "bash", "zsh"].filter((s) => Bun.which(s));

function paste(shell: string, home: string, path: string): { out: string; code: number } {
  const r = Bun.spawnSync([shell, "-c", line], { env: { HOME: home, PATH: path }, stdout: "pipe", stderr: "pipe" });
  return { out: r.stdout.toString() + r.stderr.toString(), code: r.exitCode };
}

describe("the invite line an agent pastes", () => {
  const onPath = join(root, "path-bin");
  script(join(onPath, "kiwi"), `echo "kiwi on PATH: $*"`);
  const curls = join(root, "curl-bin");
  const asked = join(root, "curl-asked");
  script(
    join(curls, "curl"),
    `echo "$*" >> '${asked}'\ncat <<'EOF'\nmkdir -p "$HOME/.kiwi/bin"\nprintf '#!/bin/sh\\necho "kiwi just installed: $*"\\n' > "$HOME/.kiwi/bin/kiwi"\nchmod 755 "$HOME/.kiwi/bin/kiwi"\nEOF`,
  );

  test.each(SHELLS)("in %s, kiwi on PATH runs as it is, with nothing installed", (shell) => {
    const home = mkdtempSync(join(root, "home-"));
    expect(paste(shell, home, `${onPath}:${curls}:/usr/bin:/bin`)).toEqual({ out: "kiwi on PATH: join mc2-abc --relay https://relay.example --nick Ada Bot\n", code: 0 });
    expect(existsSync(asked)).toBe(false);
  });

  test.each(SHELLS)("in %s, a session started before the app put kiwi in ~/.kiwi/bin still runs it there", (shell) => {
    const home = mkdtempSync(join(root, "home-"));
    script(join(home, ".kiwi", "bin", "kiwi"), `echo "the app's kiwi: $*"`);
    expect(paste(shell, home, `${curls}:/usr/bin:/bin`)).toEqual({ out: "the app's kiwi: join mc2-abc --relay https://relay.example --nick Ada Bot\n", code: 0 });
    expect(existsSync(asked)).toBe(false);
  });

  test.each(SHELLS)("in %s, a computer without kiwi installs it from the relay's own /install first, then joins", (shell) => {
    const home = mkdtempSync(join(root, "home-"));
    rmSync(asked, { force: true });
    expect(paste(shell, home, `${curls}:/usr/bin:/bin`)).toEqual({ out: "kiwi just installed: join mc2-abc --relay https://relay.example --nick Ada Bot\n", code: 0 });
    expect(readFileSync(asked, "utf8")).toBe("-fsSL https://relay.example/install\n");
    rmSync(asked, { force: true });
  });

  test("names the install it may run, and refuses a relay address that couldn't sit inside it", () => {
    expect(line).toContain('curl -fsSL "https://relay.example/install" | sh');
    expect(line).toStartWith("sh -c '");
    expect(inviteLine("http://[::1]:8787", "mc2-abc")).toContain('"http://[::1]:8787/install"');
    expect(() => inviteLine("https://relay.example'; rm -rf ~; '", "mc2-abc")).toThrow("can't go in a pasted line");
  });
});
