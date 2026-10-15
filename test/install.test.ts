// The installer behind the dashboard's "Add an agent" line: `curl …/install | sh -s -- join CODE --relay URL`
// installs kiwi, then runs `kiwi join CODE --relay URL` with every argument as given, and nothing else.
// Downloads are stubbed: a fake `curl` hands back a script standing in for kiwi, and its checksum.

import { describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { joinCommand, kiwiJoin } from "../web/src/lib/join-line.ts"

const SCRIPT = join(import.meta.dir, "..", "site", "install.sh")

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "kiwi-install-"))
  const fake = `#!/bin/sh\nif [ "$1" = --version ]; then echo 9.9.9; exit 0; fi\necho "ran: $*" >> "${dir}/ran"\n`
  writeFileSync(join(dir, "fake-kiwi"), fake)
  const sum = createHash("sha256").update(fake).digest("hex")
  // curl -fsSL URL -o FILE: the binary for any asset, SHA256SUMS naming that asset.
  writeFileSync(
    join(dir, "curl"),
    `#!/bin/sh\nurl=""; out=""\nwhile [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2;; -*) shift;; *) url="$1"; shift;; esac; done\n` +
      `case "$url" in *SHA256SUMS) for a in kiwi-darwin-arm64 kiwi-darwin-x64 kiwi-linux-x64 kiwi-linux-arm64; do echo "${sum}  $a"; done > "$out";; *) cp "${dir}/fake-kiwi" "$out";; esac\n`,
  )
  chmodSync(join(dir, "curl"), 0o755)
  return dir
}

function install(dir: string, args: string[], env: Record<string, string> = {}, script = SCRIPT) {
  return Bun.spawnSync(["sh", script, ...args], {
    env: { PATH: `${dir}:${process.env.PATH}`, HOME: dir, KIWI_INSTALL: join(dir, "bin"), ...env },
    stdout: "pipe",
    stderr: "pipe",
  })
}

describe("the installer", () => {
  test("with `join CODE --relay URL`, installs and then runs exactly that join", () => {
    const dir = sandbox()
    try {
      const r = install(dir, ["join", "mc2-abc", "--relay", "http://localhost:8787"])
      expect(r.exitCode).toBe(0)
      expect(readFileSync(join(dir, "ran"), "utf8").trim()).toBe("ran: cleanup --quiet\nran: join mc2-abc --relay http://localhost:8787")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("with no arguments, installs, cleans up what older installs left, and runs nothing else", () => {
    const dir = sandbox()
    try {
      const r = install(dir, [])
      expect(r.exitCode).toBe(0)
      expect(readFileSync(join(dir, "ran"), "utf8").trim()).toBe("ran: cleanup --quiet")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("with `pair CODE`, installs and then runs exactly that pair", () => {
    const dir = sandbox()
    try {
      const r = install(dir, ["pair", "kp1-abc"])
      expect(r.exitCode).toBe(0)
      expect(readFileSync(join(dir, "ran"), "utf8").trim()).toBe("ran: cleanup --quiet\nran: pair kp1-abc")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("anything but join or pair is refused before downloading", () => {
    const dir = sandbox()
    try {
      const r = install(dir, ["close", "--yes"])
      expect(r.exitCode).toBe(1)
      expect(r.stderr.toString()).toContain("only runs `kiwi join` or `kiwi pair`")
      expect(() => readFileSync(join(dir, "bin", "kiwi"))).toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

const LINE = 'export PATH="$HOME/bin:$PATH"'

describe("the installer's PATH step", () => {
  const withSandbox = (fn: (dir: string) => void) => {
    const dir = sandbox()
    try {
      fn(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
  const bashrc = process.platform === "darwin" ? ".bash_profile" : ".bashrc"

  test("adds one marked line to the shell's profile, once", () =>
    withSandbox((dir) => {
      writeFileSync(join(dir, ".zshrc"), "alias ll='ls -l'") // no trailing newline
      const r = install(dir, [], { SHELL: "/bin/zsh" })
      expect(r.exitCode).toBe(0)
      expect(r.stdout.toString()).toContain(`Added ${join(dir, "bin")} to your PATH in ${join(dir, ".zshrc")}`)
      expect(readFileSync(join(dir, ".zshrc"), "utf8")).toBe(`alias ll='ls -l'\n\n# Added by the kiwi installer: puts the kiwi CLI on your PATH.\n${LINE}\n`)
      expect(install(dir, [], { SHELL: "/bin/zsh" }).stdout.toString()).toContain("already puts")
      expect(readFileSync(join(dir, ".zshrc"), "utf8").split(LINE).length).toBe(2)
    }))

  test("bash, fish and any other shell get their own profile", () =>
    withSandbox((dir) => {
      install(dir, [], { SHELL: "/usr/bin/bash" })
      expect(readFileSync(join(dir, bashrc), "utf8")).toContain(LINE)
      install(dir, [], { SHELL: "/usr/local/bin/fish" })
      expect(readFileSync(join(dir, ".config", "fish", "conf.d", "kiwi.fish"), "utf8")).toContain('fish_add_path -g "$HOME/bin"')
      install(dir, [], { SHELL: "/bin/ksh" })
      expect(readFileSync(join(dir, ".profile"), "utf8")).toContain(LINE)
    }))

  test("a profile that already names the folder, however it's spelled, is left alone", () =>
    withSandbox((dir) => {
      writeFileSync(join(dir, ".zshrc"), "export PATH=~/bin:$PATH\n")
      install(dir, [], { SHELL: "/bin/zsh" })
      expect(readFileSync(join(dir, ".zshrc"), "utf8")).toBe("export PATH=~/bin:$PATH\n")
    }))

  test("KIWI_NO_MODIFY_PATH prints the line and writes nothing", () =>
    withSandbox((dir) => {
      const r = install(dir, [], { SHELL: "/bin/zsh", KIWI_NO_MODIFY_PATH: "1" })
      expect(r.exitCode).toBe(0)
      expect(r.stdout.toString()).toContain(LINE)
      expect(existsSync(join(dir, ".zshrc"))).toBe(false)
    }))

  test("already on PATH: nothing to do", () =>
    withSandbox((dir) => {
      const r = install(dir, [], { SHELL: "/bin/zsh", PATH: `${join(dir, "bin")}:${dir}:${process.env.PATH}` })
      expect(r.exitCode).toBe(0)
      expect(existsSync(join(dir, ".zshrc"))).toBe(false)
    }))

  test("a profile it can't write doesn't fail the install, and the join still runs", () =>
    withSandbox((dir) => {
      mkdirSync(join(dir, ".zshrc")) // a folder where the file should be
      const r = install(dir, ["join", "mc2-abc"], { SHELL: "/bin/zsh" })
      expect(r.exitCode).toBe(0)
      expect(r.stdout.toString()).toContain("Couldn't write")
      expect(readFileSync(join(dir, "ran"), "utf8").trim()).toBe("ran: cleanup --quiet\nran: join mc2-abc")
    }))
})

test("site/install is the same script as site/install.sh", () => {
  const sh = readFileSync(SCRIPT, "utf8")
  expect(readFileSync(join(import.meta.dir, "..", "site", "install"), "utf8")).toBe(sh)
})

describe("the Add an agent line", () => {
  test("names the relay unless it's the public one", () => {
    expect(kiwiJoin("https://channels.kiwiinit.com", "mc2-x")).toBe("join mc2-x")
    expect(kiwiJoin("http://localhost:8787", "mc2-x")).toBe("join mc2-x --relay http://localhost:8787")
    expect(joinCommand("https://relay.example.org", "mc2-x")).toBe("curl -fsSL https://relay.example.org/install | sh -s -- join mc2-x --relay https://relay.example.org")
  })
})
