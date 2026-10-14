// The PATH line `kiwi setup` and the desktop app add: the same profile and line as the install script,
// written once, and never when the profile already names the folder.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureOnPath, profileFor } from "../src/shell-path.ts";

const MARK = "# Added by a test.";

function inHome(fn: (home: string) => void) {
  const home = mkdtempSync(join(tmpdir(), "kiwi-path-"));
  try {
    fn(home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

describe("profileFor", () => {
  const home = "/home/ana";
  const at = (SHELL: string | undefined, platform: NodeJS.Platform = "linux", extra: Record<string, string> = {}) =>
    profileFor({ mark: MARK, home, platform, env: { SHELL, ...extra } });

  test("each shell's own profile", () => {
    expect(at("/bin/zsh").file).toBe("/home/ana/.zshrc");
    expect(at("/bin/zsh", "linux", { ZDOTDIR: "/home/ana/.config/zsh" }).file).toBe("/home/ana/.config/zsh/.zshrc");
    expect(at("/bin/bash").file).toBe("/home/ana/.bashrc");
    expect(at("/bin/bash", "darwin").file).toBe("/home/ana/.bash_profile");
    expect(at("/usr/bin/fish").file).toBe("/home/ana/.config/fish/conf.d/kiwi.fish");
    expect(at("/bin/ksh").file).toBe("/home/ana/.profile");
    expect(at(undefined, "darwin").file).toBe("/home/ana/.zshrc");
  });

  test("the line names the folder under $HOME, or as given when it's elsewhere", () => {
    expect(at("/bin/zsh").line).toBe('export PATH="$HOME/.kiwi/bin:$PATH"');
    expect(at("/usr/bin/fish").line).toBe('fish_add_path -g "$HOME/.kiwi/bin"');
    expect(at("/bin/zsh", "linux", { KIWI_INSTALL: "/opt/kiwi/bin" }).line).toBe('export PATH="/opt/kiwi/bin:$PATH"');
  });
});

describe("ensureOnPath", () => {
  test("adds the marked line once, after a profile with no trailing newline", () =>
    inHome((home) => {
      const rc = join(home, ".zshrc");
      writeFileSync(rc, "setopt autocd");
      const o = { mark: MARK, home, platform: "linux" as const, env: { SHELL: "/bin/zsh" } };
      expect(ensureOnPath(o)).toBe(rc);
      expect(ensureOnPath(o)).toBeNull();
      expect(readFileSync(rc, "utf8")).toBe(`setopt autocd\n\n${MARK}\nexport PATH="$HOME/.kiwi/bin:$PATH"\n`);
    }));

  test("a profile naming the folder any common way is left alone", () =>
    inHome((home) => {
      const rc = join(home, ".bashrc");
      for (const spelled of [`${home}/.kiwi/bin`, "$HOME/.kiwi/bin", "${HOME}/.kiwi/bin", "~/.kiwi/bin"]) {
        writeFileSync(rc, `export PATH=${spelled}:$PATH\n`);
        expect(ensureOnPath({ mark: MARK, home, platform: "linux", env: { SHELL: "/bin/bash" } })).toBeNull();
      }
    }));

  test("Windows keeps PATH in the registry: nothing is written", () =>
    inHome((home) => {
      expect(ensureOnPath({ mark: MARK, home, platform: "win32", env: { SHELL: "/bin/zsh" } })).toBeNull();
    }));
});
