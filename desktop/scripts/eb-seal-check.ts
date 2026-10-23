import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { sealApp } from "./eb-seal.ts";

const desktop = path.resolve(import.meta.dirname, "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "eb-seal-check-"));

const MAIN = `#include <stdio.h>
#include <stddef.h>
int kiwi_seal_check(char *why, size_t why_len);
int main(void) {
  char why[1024] = "";
  if (kiwi_seal_check(why, sizeof why) != 0) {
    fprintf(stderr, "%s\\n", why);
    return 1;
  }
  return 0;
}
`;

const PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>probe</string>
<key>CFBundleIdentifier</key><string>com.kiwiinit.channels.seal-probe</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>
`;

interface Case {
  what: string;
  change: (contents: string) => void;
  starts: boolean;
  says?: string;
}

const CASES: Case[] = [
  { what: "the sealed app as built", change: () => {}, starts: true },
  { what: "a ticket stapled into Contents/CodeResources after sealing", change: (c) => fs.writeFileSync(path.join(c, "CodeResources"), "ticket"), starts: true },
  {
    what: "a sealed file named CodeResources elsewhere, changed",
    change: (c) => fs.writeFileSync(path.join(c, "MacOS", "CodeResources"), "changed"),
    starts: false,
    says: "MacOS/CodeResources was changed",
  },
  { what: "a sealed file changed", change: (c) => fs.writeFileSync(path.join(c, "Resources", "app.js"), "changed"), starts: false, says: "Resources/app.js was changed" },
  { what: "a file nobody sealed", change: (c) => fs.writeFileSync(path.join(c, "Resources", "extra.js"), "extra"), starts: false },
];

function bundle(name: string): string {
  const contents = path.join(tmp, `${name}.app`, "Contents");
  fs.mkdirSync(path.join(contents, "MacOS"), { recursive: true });
  fs.mkdirSync(path.join(contents, "Resources"), { recursive: true });
  fs.writeFileSync(path.join(contents, "Info.plist"), PLIST);
  fs.copyFileSync(path.join(tmp, "probe"), path.join(contents, "MacOS", "probe"));
  fs.writeFileSync(path.join(contents, "MacOS", "CodeResources"), "a sealed file that only shares the ticket's name");
  fs.writeFileSync(path.join(contents, "Resources", "app.js"), "app");
  sealApp(path.dirname(contents));
  return contents;
}

try {
  fs.writeFileSync(path.join(tmp, "main.c"), MAIN);
  execFileSync(
    "clang",
    [
      "-O2",
      "-Wall",
      "-Wextra",
      "-Werror",
      "-mmacosx-version-min=12.0",
      "-framework",
      "CoreFoundation",
      "-framework",
      "Security",
      "-o",
      path.join(tmp, "probe"),
      path.join(tmp, "main.c"),
      path.join(desktop, "native", "macos", "kiwi-keys.c"),
    ],
    { stdio: "inherit" },
  );
  let wrong = 0;
  CASES.forEach((c, i) => {
    const contents = bundle(`case${i}`);
    c.change(contents);
    const run = spawnSync(path.join(contents, "MacOS", "probe"), [], { encoding: "utf8" });
    const started = run.status === 0;
    const said = (run.stderr ?? "").trim();
    const right = started === c.starts && (!c.says || said.includes(c.says));
    console.log(`${right ? "ok  " : "WRONG"} ${c.what}: ${started ? "starts" : `refused (${said})`}`);
    if (!right) wrong++;
  });
  process.exitCode = wrong ? 1 : 0;
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
