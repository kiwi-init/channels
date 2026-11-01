// The installer behind the dashboard's "Add an agent" line: `curl …/install | sh -s -- join CODE --relay URL`
// installs kiwi, then runs `kiwi join CODE --relay URL` with every argument as given, and nothing else.
// Downloads are stubbed: a fake `curl` hands back a script standing in for kiwi, and its checksum.

import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { joinCommand, kiwiJoin } from "@kiwi/app/join-line.ts";

const SCRIPT = join(import.meta.dir, "..", "site", "install.sh");

const TARGETS = ["kiwi-darwin-arm64", "kiwi-darwin-x64", "kiwi-linux-x64", "kiwi-linux-arm64"];

function sandbox(packed: readonly ("gz" | "xz")[] = []) {
  const dir = mkdtempSync(join(tmpdir(), "kiwi-install-"));
  const fake = `#!/bin/sh\nif [ "$1" = --version ]; then echo 9.9.9; exit 0; fi\necho "ran: $*" >> "${dir}/ran"\n`;
  writeFileSync(join(dir, "fake-kiwi"), fake);
  const sha = (b: string | Uint8Array) => createHash("sha256").update(b).digest("hex");
  const sums = TARGETS.map((a) => `${sha(fake)}  ${a}`);
  for (const ext of packed) {
    const tool = ext === "gz" ? "gzip" : "xz";
    Bun.spawnSync(["sh", "-c", `${tool} -c "${dir}/fake-kiwi" > "${dir}/fake-kiwi.${ext}"`]);
    const packedSum = sha(readFileSync(join(dir, `fake-kiwi.${ext}`)));
    sums.push(...TARGETS.map((a) => `${packedSum}  ${a}.${ext}`));
  }
  writeFileSync(join(dir, "sums"), sums.join("\n") + "\n");
  writeFileSync(join(dir, "minisig"), "untrusted comment: signature from a test key\nRUTtest\ntrusted comment: kiwi 9.9.9 SHA256SUMS\ndGVzdA==\n");
  writeFileSync(
    join(dir, "curl"),
    `#!/bin/sh\nurl=""; out=""\nwhile [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2;; -*) shift;; *) url="$1"; shift;; esac; done\n` +
      `echo "$url" >> "${dir}/fetched"\n` +
      `case "$url" in *SHA256SUMS.minisig) cp "${dir}/minisig" "$out";; *SHA256SUMS) cp "${dir}/sums" "$out";; *.gz) cp "${dir}/fake-kiwi.gz" "$out";; *.xz) cp "${dir}/fake-kiwi.xz" "$out";; *) cp "${dir}/fake-kiwi" "$out";; esac\n`,
  );
  chmodSync(join(dir, "curl"), 0o755);
  for (const tool of ["minisign", "python3"]) {
    writeFileSync(join(dir, tool), `#!/bin/sh\necho "$*" >> "${dir}/verified"\n[ ! -f "${dir}/reject" ]\n`);
    chmodSync(join(dir, tool), 0o755);
  }
  return dir;
}

function install(dir: string, args: string[], env: Record<string, string> = {}, script = SCRIPT) {
  return Bun.spawnSync(["sh", script, ...args], {
    env: { PATH: `${dir}:${process.env.PATH}`, HOME: dir, KIWI_INSTALL: join(dir, "bin"), ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
}

const BARE_TOOLS = ["basename", "chmod", "cp", "cut", "dirname", "grep", "mkdir", "mktemp", "mv", "rm", "sha256sum", "tail", "uname"];

function bare(dir: string, args: string[], env: Record<string, string> = {}) {
  const toolbin = join(dir, "toolbin");
  mkdirSync(toolbin);
  for (const tool of BARE_TOOLS) {
    const at = Bun.which(tool);
    if (!at) return null;
    symlinkSync(at, join(toolbin, tool));
  }
  return Bun.spawnSync(["/bin/sh", SCRIPT, ...args], {
    env: { PATH: `${dir}:${toolbin}`, HOME: dir, KIWI_INSTALL: join(dir, "bin"), ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
}

describe("the installer", () => {
  test("with `join CODE --relay URL`, installs and then runs exactly that join", () => {
    const dir = sandbox();
    try {
      const r = install(dir, ["join", "mc2-abc", "--relay", "http://localhost:8787"]);
      expect(r.exitCode).toBe(0);
      expect(readFileSync(join(dir, "ran"), "utf8").trim()).toBe("ran: cleanup --quiet\nran: join mc2-abc --relay http://localhost:8787");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("with no arguments, installs, cleans up what older installs left, and runs nothing else", () => {
    const dir = sandbox();
    try {
      const r = install(dir, []);
      expect(r.exitCode).toBe(0);
      expect(readFileSync(join(dir, "ran"), "utf8").trim()).toBe("ran: cleanup --quiet");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("with `login`, installs and then runs kiwi login", () => {
    const dir = sandbox();
    try {
      const r = install(dir, ["login"]);
      expect(r.exitCode).toBe(0);
      expect(readFileSync(join(dir, "ran"), "utf8").trim()).toBe("ran: cleanup --quiet\nran: login");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("anything but join or login is refused before downloading", () => {
    const dir = sandbox();
    try {
      const r = install(dir, ["close", "--yes"]);
      expect(r.exitCode).toBe(1);
      expect(r.stderr.toString()).toContain("only runs `kiwi join` or `kiwi login`");
      expect(() => readFileSync(join(dir, "bin", "kiwi"))).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

const LINE = 'export PATH="$HOME/bin:$PATH"';

describe("the installer's PATH step", () => {
  const withSandbox = (fn: (dir: string) => void) => {
    const dir = sandbox();
    try {
      fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const bashrc = process.platform === "darwin" ? ".bash_profile" : ".bashrc";

  test("adds one marked line to the shell's profile, once", () =>
    withSandbox((dir) => {
      writeFileSync(join(dir, ".zshrc"), "alias ll='ls -l'"); // no trailing newline
      const r = install(dir, [], { SHELL: "/bin/zsh" });
      expect(r.exitCode).toBe(0);
      expect(r.stdout.toString()).toContain(`Added ${join(dir, "bin")} to your PATH in ${join(dir, ".zshrc")}`);
      expect(readFileSync(join(dir, ".zshrc"), "utf8")).toBe(`alias ll='ls -l'\n\n# Added by the kiwi installer: puts the kiwi CLI on your PATH.\n${LINE}\n`);
      expect(install(dir, [], { SHELL: "/bin/zsh" }).stdout.toString()).toContain("already puts");
      expect(readFileSync(join(dir, ".zshrc"), "utf8").split(LINE).length).toBe(2);
    }));

  test("bash, fish and any other shell get their own profile", () =>
    withSandbox((dir) => {
      install(dir, [], { SHELL: "/usr/bin/bash" });
      expect(readFileSync(join(dir, bashrc), "utf8")).toContain(LINE);
      install(dir, [], { SHELL: "/usr/local/bin/fish" });
      expect(readFileSync(join(dir, ".config", "fish", "conf.d", "kiwi.fish"), "utf8")).toContain('fish_add_path -g "$HOME/bin"');
      install(dir, [], { SHELL: "/bin/ksh" });
      expect(readFileSync(join(dir, ".profile"), "utf8")).toContain(LINE);
    }));

  test("a profile that already names the folder, however it's spelled, is left alone", () =>
    withSandbox((dir) => {
      writeFileSync(join(dir, ".zshrc"), "export PATH=~/bin:$PATH\n");
      install(dir, [], { SHELL: "/bin/zsh" });
      expect(readFileSync(join(dir, ".zshrc"), "utf8")).toBe("export PATH=~/bin:$PATH\n");
    }));

  test("KIWI_NO_MODIFY_PATH prints the line and writes nothing", () =>
    withSandbox((dir) => {
      const r = install(dir, [], { SHELL: "/bin/zsh", KIWI_NO_MODIFY_PATH: "1" });
      expect(r.exitCode).toBe(0);
      expect(r.stdout.toString()).toContain(LINE);
      expect(existsSync(join(dir, ".zshrc"))).toBe(false);
    }));

  test("already on PATH: nothing to do", () =>
    withSandbox((dir) => {
      const r = install(dir, [], { SHELL: "/bin/zsh", PATH: `${join(dir, "bin")}:${dir}:${process.env.PATH}` });
      expect(r.exitCode).toBe(0);
      expect(existsSync(join(dir, ".zshrc"))).toBe(false);
    }));

  test("a profile it can't write doesn't fail the install, and the join still runs", () =>
    withSandbox((dir) => {
      mkdirSync(join(dir, ".zshrc")); // a folder where the file should be
      const r = install(dir, ["join", "mc2-abc"], { SHELL: "/bin/zsh" });
      expect(r.exitCode).toBe(0);
      expect(r.stdout.toString()).toContain("Couldn't write");
      expect(readFileSync(join(dir, "ran"), "utf8").trim()).toBe("ran: cleanup --quiet\nran: join mc2-abc");
    }));
});

describe("the installer's download", () => {
  const fetched = (dir: string) =>
    readFileSync(join(dir, "fetched"), "utf8")
      .trim()
      .split("\n")
      .filter((u) => !u.endsWith("SHA256SUMS") && !u.endsWith("SHA256SUMS.minisig"));
  const installs = (dir: string) => {
    const r = install(dir, []);
    expect(r.exitCode).toBe(0);
    expect(readFileSync(join(dir, "bin", "kiwi"), "utf8")).toBe(readFileSync(join(dir, "fake-kiwi"), "utf8"));
  };

  test("takes the release's .xz when xz is installed, checks it and unpacks it", () => {
    const dir = sandbox(["gz", "xz"]);
    try {
      installs(dir);
      expect(fetched(dir)).toEqual([expect.stringMatching(/\/kiwi-[a-z]+-[a-z0-9]+\.xz$/)]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("takes the .gz when the release has no .xz", () => {
    const dir = sandbox(["gz"]);
    try {
      installs(dir);
      expect(fetched(dir)).toEqual([expect.stringMatching(/\/kiwi-[a-z]+-[a-z0-9]+\.gz$/)]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an older release with neither takes the plain binary", () => {
    const dir = sandbox();
    try {
      installs(dir);
      expect(fetched(dir)).toEqual([expect.stringMatching(/\/kiwi-[a-z]+-[a-z0-9]+$/)]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a compressed download that doesn't match its checksum isn't installed", () => {
    const dir = sandbox(["gz"]);
    try {
      writeFileSync(join(dir, "fake-kiwi.gz"), "not what was summed");
      const r = install(dir, []);
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr.toString()).toContain("checksum doesn't match");
      expect(existsSync(join(dir, "bin", "kiwi"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("checks the release's signature with minisign when it's there, pinned key and all", () => {
    const dir = sandbox();
    try {
      const r = install(dir, []);
      expect(r.exitCode).toBe(0);
      const calls = readFileSync(join(dir, "verified"), "utf8").trim().split("\n");
      expect(calls).toHaveLength(1);
      expect(calls[0]).toContain("-m ");
      expect(calls[0]).toContain("SHA256SUMS.minisig");
      expect(calls[0]).toContain("-P RWT9dHgjaqvLBIY4");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("without minisign, a self-contained python3 check of the same signature runs", () => {
    const dir = sandbox();
    try {
      rmSync(join(dir, "minisign"));
      const r = install(dir, []);
      expect(r.exitCode).toBe(0);
      const calls = readFileSync(join(dir, "verified"), "utf8").trim().split("\n");
      expect(calls).toHaveLength(1);
      expect(calls[0]).toContain("minisign-verify.py");
      expect(calls[0]).toContain("SHA256SUMS");
      expect(calls[0]).toContain("SHA256SUMS.minisig");
      expect(calls[0]).toContain("RWT9dHgjaqvLBIY4");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a signature that doesn't verify isn't installed", () => {
    const dir = sandbox();
    try {
      writeFileSync(join(dir, "reject"), "");
      const r = install(dir, []);
      expect(r.exitCode).not.toBe(0);
      expect(existsSync(join(dir, "bin", "kiwi"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a release without SHA256SUMS.minisig isn't installed", () => {
    const dir = sandbox();
    try {
      rmSync(join(dir, "minisig"));
      const r = install(dir, []);
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr.toString()).toContain("no SHA256SUMS.minisig");
      expect(existsSync(join(dir, "bin", "kiwi"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("with no way to check the signature, the install stops and says how to go on", () => {
    if (process.platform !== "linux") return;
    const dir = sandbox();
    try {
      rmSync(join(dir, "minisign"));
      rmSync(join(dir, "python3"));
      const r = bare(dir, []);
      expect(r?.exitCode).toBe(1);
      expect(r?.stderr.toString()).toContain("install minisign or python3");
      expect(existsSync(join(dir, "bin", "kiwi"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("KIWI_UNVERIFIED_INSTALL=1 installs on the checksum alone, saying so", () => {
    if (process.platform !== "linux") return;
    const dir = sandbox();
    try {
      rmSync(join(dir, "minisign"));
      rmSync(join(dir, "python3"));
      const r = bare(dir, [], { KIWI_UNVERIFIED_INSTALL: "1" });
      expect(r?.exitCode).toBe(0);
      expect(r?.stderr.toString()).toContain("checksum alone");
      expect(readFileSync(join(dir, "bin", "kiwi"), "utf8")).toBe(readFileSync(join(dir, "fake-kiwi"), "utf8"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the installer's build", () => {
  const picked = (os: string, arch: string, translated: string | null) => {
    const dir = sandbox();
    try {
      writeFileSync(join(dir, "uname"), `#!/bin/sh\ncase "$1" in -s) echo ${os};; -m) echo ${arch};; esac\n`);
      writeFileSync(join(dir, "sysctl"), translated === null ? `#!/bin/sh\necho "sysctl: unknown oid '$2'" >&2\nexit 1\n` : `#!/bin/sh\n[ "$2" = sysctl.proc_translated ] && echo ${translated}\n`);
      chmodSync(join(dir, "uname"), 0o755);
      chmodSync(join(dir, "sysctl"), 0o755);
      expect(install(dir, []).exitCode).toBe(0);
      const urls = readFileSync(join(dir, "fetched"), "utf8").trim().split("\n");
      return urls.filter((u) => !u.endsWith("SHA256SUMS") && !u.endsWith("SHA256SUMS.minisig")).map((u) => u.slice(u.lastIndexOf("/") + 1));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  test("a Mac shell under Rosetta still gets the Apple Silicon build", () => {
    expect(picked("Darwin", "x86_64", "1")).toEqual(["kiwi-darwin-arm64"]);
  });

  test("an Intel Mac, a Mac on arm64 and Linux get their own", () => {
    expect(picked("Darwin", "x86_64", "0")).toEqual(["kiwi-darwin-x64"]);
    expect(picked("Darwin", "x86_64", null)).toEqual(["kiwi-darwin-x64"]);
    expect(picked("Darwin", "arm64", "0")).toEqual(["kiwi-darwin-arm64"]);
    expect(picked("Linux", "x86_64", "1")).toEqual(["kiwi-linux-x64"]);
    expect(picked("Linux", "aarch64", null)).toEqual(["kiwi-linux-arm64"]);
  });
});

test("site/install is the same script as site/install.sh", () => {
  const sh = readFileSync(SCRIPT, "utf8");
  expect(readFileSync(join(import.meta.dir, "..", "site", "install"), "utf8")).toBe(sh);
});

describe("the Add an agent line", () => {
  test("names the relay unless it's the public one", () => {
    expect(kiwiJoin("https://channels.kiwiinit.com", "mc2-x")).toBe("join mc2-x");
    expect(kiwiJoin("http://localhost:8787", "mc2-x")).toBe("join mc2-x --relay http://localhost:8787");
    expect(joinCommand("https://relay.example.org", "mc2-x")).toBe("curl -fsSL https://relay.example.org/install | sh -s -- join mc2-x --relay https://relay.example.org");
  });
});
