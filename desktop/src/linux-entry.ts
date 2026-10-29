import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { desktopEntry, EXECUTABLE } from "../scripts/linux-files.ts";

export const ENTRY_FILE = `${EXECUTABLE}.desktop`;
const KIWI_HANDLER = "x-scheme-handler/kiwi";
const DEFAULTS = "[Default Applications]";

export interface EntryPlace {
  appImage: string;
  appDir: string;
  dataHome: string;
  configHome: string;
  fuse: boolean;
}

export type EntryOutcome = { kind: "kept"; wrote: string[] } | { kind: "skipped"; why: string };

export function quotedExec(appImage: string): string | null {
  if (!path.isAbsolute(appImage) || /[\n\r\t\0]/.test(appImage)) return null;
  const quoted = `"${appImage.replace(/[\\"`$]/g, "\\$&")}"`;
  return quoted.replace(/%/g, "%%").replace(/\\/g, "\\\\");
}

export function entryText(appImage: string, fuse: boolean): string | null {
  const exec = quotedExec(appImage);
  if (!exec) return null;
  return desktopEntry(fuse ? exec : `env APPIMAGE_EXTRACT_AND_RUN=1 ${exec}`);
}

export function hasFusermount(pathVar: string | undefined, isExecutable: (file: string) => boolean): boolean {
  return (pathVar ?? "")
    .split(":")
    .filter((dir) => path.isAbsolute(dir))
    .some((dir) => ["fusermount3", "fusermount"].some((name) => isExecutable(path.join(dir, name))));
}

export function withKiwiDefault(text: string | null): string | null {
  const lines = (text ?? "").split("\n");
  let section = "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) section = trimmed;
    else if (section === DEFAULTS && trimmed.split("=")[0]?.trim() === KIWI_HANDLER) return null;
  }
  const at = lines.findIndex((line) => line.trim() === DEFAULTS);
  if (at >= 0) return [...lines.slice(0, at + 1), `${KIWI_HANDLER}=${ENTRY_FILE}`, ...lines.slice(at + 1)].join("\n");
  const body = text && !text.endsWith("\n") ? `${text}\n` : (text ?? "");
  return `${body}${body ? "\n" : ""}${DEFAULTS}\n${KIWI_HANDLER}=${ENTRY_FILE}\n`;
}

const STRING_ESCAPES: Record<string, string> = { s: " ", n: "\n", t: "\t", r: "\r", "\\": "\\" };

export function execArgs(value: string): string[] | null {
  const line = value.replace(/\\(.)/g, (whole, c: string) => STRING_ESCAPES[c] ?? whole);
  const args: string[] = [];
  let arg = "";
  let inArg = false;
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line.charAt(i);
    if (quoted) {
      if (c === "\\" && i + 1 < line.length && '"`$\\'.includes(line.charAt(i + 1))) arg += line.charAt(++i);
      else if (c === '"') quoted = false;
      else arg += c;
    } else if (c === '"') {
      quoted = true;
      inArg = true;
    } else if (c === " ") {
      if (inArg) args.push(arg);
      arg = "";
      inArg = false;
    } else {
      arg += c;
      inArg = true;
    }
  }
  if (quoted) return null;
  if (inArg) args.push(arg);
  return args.map((a) => a.replace(/%%/g, "%"));
}

export function launchedFile(args: string[]): string | null {
  const rest = args[0] === "env" ? args.slice(1) : args;
  return rest.find((a) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(a)) ?? null;
}

const isMissing = (e: unknown): boolean => e instanceof Error && "code" in e && e.code === "ENOENT";

const readIfThere = (file: string): Buffer | null => {
  try {
    return fs.readFileSync(file);
  } catch (e) {
    // Only a file that isn't there is written afresh; one that can't be read is never replaced.
    if (isMissing(e)) return null;
    throw e;
  }
};

function writeIfChanged(file: string, bytes: Buffer, wrote: string[]): void {
  const now = readIfThere(file);
  if (now && now.equals(bytes)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, bytes);
  fs.renameSync(tmp, file);
  wrote.push(file);
}

function otherEntryFor(applications: string, appImage: string): string | null {
  let names: string[];
  try {
    names = fs.readdirSync(applications);
  } catch {
    // No applications folder yet: nothing else integrated this AppImage.
    return null;
  }
  for (const name of names) {
    if (name === ENTRY_FILE || !name.endsWith(".desktop")) continue;
    let text: string;
    try {
      text = fs.readFileSync(path.join(applications, name), "utf8");
    } catch {
      // An entry nobody can read starts nothing for us to defer to.
      continue;
    }
    const starts = (line: string): boolean => {
      const args = line.startsWith("Exec=") ? execArgs(line.slice("Exec=".length).trimEnd()) : null;
      return !!args && launchedFile(args) === appImage;
    };
    if (text.split("\n").some(starts)) return name;
  }
  return null;
}

export function keepEntry(place: EntryPlace): EntryOutcome {
  const text = entryText(place.appImage, place.fuse);
  if (!text) return { kind: "skipped", why: `the AppImage's path ${JSON.stringify(place.appImage)} can't go in a desktop entry` };
  const applications = path.join(place.dataHome, "applications");
  const other = otherEntryFor(applications, place.appImage);
  if (other) return { kind: "skipped", why: `${other} already starts this AppImage` };
  const wrote: string[] = [];
  const icons = path.join(place.appDir, "usr", "share", "icons", "hicolor");
  let sizes: string[] = [];
  try {
    sizes = fs.readdirSync(icons).filter((size) => /^\d+x\d+$/.test(size));
  } catch {
    // An AppImage without hicolor icons still gets its entry.
  }
  for (const size of sizes) {
    const icon = readIfThere(path.join(icons, size, "apps", `${EXECUTABLE}.png`));
    if (icon) writeIfChanged(path.join(place.dataHome, "icons", "hicolor", size, "apps", `${EXECUTABLE}.png`), icon, wrote);
  }
  writeIfChanged(path.join(applications, ENTRY_FILE), Buffer.from(text), wrote);
  const mimeapps = path.join(place.configHome, "mimeapps.list");
  const added = withKiwiDefault(readIfThere(mimeapps)?.toString("utf8") ?? null);
  if (added !== null) writeIfChanged(mimeapps, Buffer.from(added), wrote);
  return { kind: "kept", wrote };
}

const executable = (file: string): boolean => {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    // Not there or not runnable: this name isn't a fusermount to use.
    return false;
  }
};

const xdgDir = (value: string | undefined, fallback: string): string => (value && path.isAbsolute(value) ? value : fallback);

export function keepLinuxEntry(appImage: string, env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): EntryOutcome {
  const appDir = env["APPDIR"];
  if (!appDir || !path.isAbsolute(appDir)) return { kind: "skipped", why: "the AppImage runtime set no APPDIR" };
  return keepEntry({
    appImage,
    appDir,
    dataHome: xdgDir(env["XDG_DATA_HOME"], path.join(home, ".local", "share")),
    configHome: xdgDir(env["XDG_CONFIG_HOME"], path.join(home, ".config")),
    fuse: hasFusermount(env["PATH"], executable),
  });
}
