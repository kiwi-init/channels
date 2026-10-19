// A shell finds `kiwi` without anyone editing a profile by hand. The install scripts, `kiwi setup` and
// the desktop app all do the same thing: unless the shell's profile already names the bin folder, one
// marked line goes at its end, once. The shell is $SHELL's (zsh, bash or fish); anything else gets
// ~/.profile. Windows keeps PATH in the registry instead, so this is a no-op there.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type ShellPathOptions = {
  /** The folder to put on PATH. Default: ~/.kiwi/bin, or KIWI_INSTALL. */
  dir?: string;
  /** The comment above the added line, saying who added it. */
  mark: string;
  env?: Record<string, string | undefined>;
  home?: string;
  platform?: NodeJS.Platform;
};

/** The bin folder the install script uses: KIWI_INSTALL, else ~/.kiwi/bin. */
export function binDir(env: Record<string, string | undefined> = process.env, home = os.homedir()): string {
  return env["KIWI_INSTALL"] || path.join(home, ".kiwi", "bin");
}

/** The profile a new shell reads, and the line that puts `dir` on its PATH. Written as $HOME/… when it's under home. */
export function profileFor(o: ShellPathOptions): { file: string; line: string } {
  const env = o.env ?? process.env;
  const home = o.home ?? os.homedir();
  const platform = o.platform ?? process.platform;
  const dir = o.dir ?? binDir(env, home);
  const shown = dir === home || dir.startsWith(home + path.sep) ? `$HOME${dir.slice(home.length)}` : dir;
  const sh = path.basename(env["SHELL"] || (platform === "darwin" ? "zsh" : "bash"));
  const file =
    sh === "zsh"
      ? path.join(env["ZDOTDIR"] || home, ".zshrc")
      : sh === "bash"
        ? path.join(home, platform === "darwin" ? ".bash_profile" : ".bashrc")
        : sh === "fish"
          ? path.join(home, ".config", "fish", "conf.d", "kiwi.fish")
          : path.join(home, ".profile");
  const line = sh === "fish" ? `fish_add_path -g "${shown}"` : `export PATH="${shown}:$PATH"`;
  return { file, line };
}

/**
 * Adds the marked line to the shell's profile unless it already names the folder (as written, or as
 * $HOME/…). Returns the file it changed, or null when there was nothing to do.
 */
export function ensureOnPath(o: ShellPathOptions): string | null {
  if ((o.platform ?? process.platform) === "win32") return null;
  const home = o.home ?? os.homedir();
  const dir = o.dir ?? binDir(o.env ?? process.env, home);
  const { file, line } = profileFor({ ...o, dir });
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const rest = dir.startsWith(home + path.sep) ? dir.slice(home.length) : null;
  const named = [dir, ...(rest ? [`$HOME${rest}`, `\${HOME}${rest}`, `~${rest}`] : [])];
  if (named.some((d) => text.includes(d))) return null;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${text && !text.endsWith("\n") ? "\n" : ""}\n${o.mark}\n${line}\n`);
  return file;
}
