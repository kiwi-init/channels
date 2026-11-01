// `kiwi doctor` looks at this computer and prints a fix for each problem.
// It does not change anything. The checks are Effects that return their
// findings, so tests can read them; printing is separate.

import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { spawn } from "node:child_process";
import { lookup } from "node:dns/promises";
import { accessSync, constants, existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join, sep } from "node:path";
import { DEFAULT_RELAY, loadConfig } from "../config.ts";
import { EXTRA_HARNESSES, extraInstalled, hooksInstalled } from "../hooks.ts";
import { loadMachine, type MachineFile } from "../machine.ts";
import { VERSION } from "../version.ts";

/** One check. `how` is the plain fix, and only a problem has one. */
export type Finding = { ok: true; what: string } | { ok: false; what: string; how: string };

/** What `kiwi version` prints, or null if that binary can't say. */
function binVersion(bin: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(bin, ["version"], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve(null);
    }, 5_000);
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const line = out.trim().split("\n")[0];
      resolve(code === 0 && line ? line : null);
    });
  });
}

/** The same file as this process: a dev checkout running itself must not spawn. */
function sameBinary(bin: string): boolean {
  try {
    return realpathSync(bin) === realpathSync(process.execPath);
  } catch {
    return false;
  }
}

const checkInstall = Effect.fn("Doctor.install")(function* () {
  const found: Finding[] = [{ ok: true, what: `version  ${VERSION}` }];
  const bin = Bun.which("kiwi");
  if (!bin) {
    found.push({
      ok: false,
      what: "`kiwi` is not on PATH.",
      how: `Add this to your shell profile: export PATH="${join(homedir(), ".kiwi", "bin")}:$PATH"`,
    });
    return found;
  }
  found.push({ ok: true, what: `PATH     ${bin}` });
  if (sameBinary(bin)) return found;
  const reported = yield* Effect.promise(() => binVersion(bin));
  if (reported === null) found.push({ ok: false, what: "the kiwi on PATH did not print a version.", how: "Reinstall kiwi so `kiwi version` works." });
  else if (reported !== VERSION) found.push({ ok: false, what: `the kiwi on PATH is ${reported}; this command is ${VERSION}.`, how: "Reinstall so the shell and this checkout are the same version." });
  return found;
});

const PATH_MARKS = ["# Added by the Channels app", "# Added by the kiwi installer"];

function kiwisOnPath(pathVar: string): { path: string; real: string }[] {
  const seen = new Set<string>();
  const out: { path: string; real: string }[] = [];
  for (const dir of pathVar.split(delimiter)) {
    if (!dir || !isAbsolute(dir)) continue;
    const bin = join(dir, "kiwi");
    try {
      accessSync(bin, constants.X_OK);
      const real = realpathSync(bin);
      if (seen.has(real)) continue;
      seen.add(real);
      out.push({ path: bin, real });
    } catch {
      // No runnable kiwi in this PATH folder.
    }
  }
  return out;
}

function markedProfiles(home: string, env: Record<string, string | undefined>): string[] {
  const zsh = env["ZDOTDIR"] || home;
  const files = [join(zsh, ".zshrc"), join(zsh, ".zprofile"), join(home, ".bash_profile"), join(home, ".bashrc"), join(home, ".profile"), join(home, ".config", "fish", "config.fish")];
  return files.filter((f) => {
    try {
      const text = readFileSync(f, "utf8");
      return PATH_MARKS.some((m) => text.includes(m));
    } catch {
      // No such profile.
      return false;
    }
  });
}

const tilde = (p: string, home: string) => (p === home || p.startsWith(home + sep) ? `~${p.slice(home.length)}` : p);

/** An older kiwi ahead of Homebrew's on PATH (a leftover ~/.kiwi/bin/kiwi and its PATH line): a shell runs the old one. */
export const checkShadowed = Effect.fn("Doctor.shadowed")(function* (pathVar: string = process.env.PATH ?? "", home: string = homedir(), env: Record<string, string | undefined> = process.env) {
  const bins = kiwisOnPath(pathVar);
  const brewAt = bins.findIndex((b) => b.real.includes(`${sep}Cellar${sep}kiwi${sep}`));
  if (brewAt <= 0) return null;
  const first = bins[0]!;
  const [old, brew] = yield* Effect.promise(() => Promise.all([binVersion(first.path), binVersion(bins[brewAt]!.path)]));
  const shown = tilde(first.path, home);
  const lines = markedProfiles(home, env).map((f) => tilde(f, home));
  const finding: Finding = {
    ok: false,
    what: `${shown}${old ? ` (${old})` : ""} comes before Homebrew's kiwi${brew ? ` (${brew})` : ""} on PATH, so a shell runs the old one.`,
    how: `Remove it: rm ${shown}${lines.length ? `, and delete the marked PATH lines in ${lines.join(", ")} (each "# Added by …" line and the export under it)` : ""}, then open a new terminal. Your keys and seats in ~/.kiwi stay as they are.`,
  };
  return finding;
});

/** What a step that couldn't finish said, in words. */
const why = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Ask the relay who it is. Sign-in is on only when it says so: a relay
 * without WorkOS has no computer links, and `kiwi setup` cannot succeed there.
 * A relay that doesn't answer is reported here, before any link advice.
 */
const checkRelay = Effect.fn("Doctor.relay")(function* (relay: string) {
  type Check = { finding: Finding; signIn: boolean };
  let host: string;
  try {
    host = new URL(relay).hostname;
  } catch {
    return { finding: { ok: false, what: `${relay} is not a URL.`, how: "Set KIWI_RELAY to the relay's https address." }, signIn: false } satisfies Check;
  }
  if (Exit.isFailure(yield* Effect.exit(Effect.tryPromise(() => lookup(host))))) {
    return { finding: { ok: false, what: `DNS for ${host} did not resolve.`, how: "Check the name, or the network, then run kiwi doctor again." }, signIn: false } satisfies Check;
  }
  const asked = Effect.gen(function* () {
    const res = yield* Effect.tryPromise({ try: () => fetch(new URL("/v1/config", relay), { signal: AbortSignal.timeout(8_000) }), catch: (err) => err });
    if (!res.ok) {
      return {
        finding: { ok: false, what: `${relay}/v1/config returned ${res.status}.`, how: "The relay is up but not answering. Check that Kiwi is the thing listening there." },
        signIn: false,
      } satisfies Check;
    }
    const body = (yield* Effect.tryPromise({ try: () => res.json(), catch: (err) => err })) as { workosClientId?: unknown };
    if (!body || typeof body !== "object" || !("workosClientId" in body)) {
      return { finding: { ok: false, what: `${relay}/v1/config answered, but not as a Kiwi relay.`, how: "Point KIWI_RELAY at your Kiwi relay." }, signIn: false } satisfies Check;
    }
    const signIn = typeof body.workosClientId === "string" && body.workosClientId.length > 0;
    return { finding: { ok: true, what: `relay    ${relay}  /v1/config answered` }, signIn } satisfies Check;
  });
  return yield* asked.pipe(
    Effect.catch((err) =>
      Effect.succeed({
        finding: { ok: false, what: `could not reach ${relay} (${why(err)}).`, how: "Start the relay, or fix KIWI_RELAY, then run kiwi doctor again." },
        signIn: false,
      } satisfies Check),
    ),
  );
});

/** Whether this computer is one of its person's devices (kiwi login). Never a failure: agents still join by approval. */
function checkPaired(): Finding {
  let m: (MachineFile & { cert?: { name?: string } }) | null;
  try {
    m = loadMachine() as (MachineFile & { cert?: { name?: string } }) | null;
  } catch (err) {
    return { ok: false, what: "This computer's key file can't be read.", how: err instanceof Error ? err.message : String(err) };
  }
  const name = m?.cert?.name ?? m?.device?.person.name;
  if (m?.cert || m?.device) return { ok: true, what: `login    one of ${name ?? "your"}'s devices (${m.label}): your app can start agents here` };
  return { ok: true, what: "login    no: agents here ask to join and wait for the owner (kiwi login adds this computer to your devices)" };
}

function checkHooks(): Finding {
  const dir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
  if (!existsSync(dir)) return { ok: true, what: "hooks    Claude Code is not installed here" };
  let installed: boolean;
  try {
    installed = hooksInstalled();
  } catch {
    return { ok: false, what: "Claude Code's settings.json could not be read.", how: "Fix ~/.claude/settings.json, then run kiwi hooks install." };
  }
  let also: string[];
  try {
    also = EXTRA_HARNESSES.filter((h) => extraInstalled(h));
  } catch {
    also = [];
  }
  if (installed) return { ok: true, what: `hooks    Claude Code hooks are installed${also.length ? ` (${also.join(", ")} too)` : ""}` };
  // The person said no during setup. That is a choice, not a broken install.
  if (loadConfig().claudeHooks === "off") return { ok: true, what: "hooks    skipped at setup (kiwi hooks install adds them)" };
  return { ok: false, what: "Claude Code hooks are not installed.", how: "Run kiwi hooks install." };
}

/** Every check, relay before link. A link check exists only when the relay requires sign-in. */
export const checks = Effect.fn("Doctor.checks")(function* () {
  const machineRelay = (() => {
    try {
      return loadMachine()?.relay;
    } catch {
      // checkPaired reports the unreadable key file; the relay falls back to the default here.
      return undefined;
    }
  })();
  const relay = (process.env.KIWI_RELAY ?? machineRelay ?? DEFAULT_RELAY).replace(/\/+$/, "");
  const found = yield* checkInstall();
  const shadowed = yield* checkShadowed();
  if (shadowed) found.push(shadowed);
  const relayCheck = yield* checkRelay(relay);
  found.push(relayCheck.finding);
  found.push(checkPaired());
  found.push(checkHooks());
  return found;
});

/** checks, as a Promise. */
export function doctorChecks(): Promise<Finding[]> {
  return Effect.runPromise(checks());
}

/** Print findings the way the command shows them. */
export function printFindings(findings: Finding[]): void {
  for (const f of findings) {
    if (f.ok) process.stdout.write(`ok   ${f.what}\n`);
    else process.stdout.write(`fix  ${f.what}\n     ${f.how}\n`);
  }
}

/** Check the install, this computer's link, the relay, and Claude Code hooks. Its value is the exit code: 1 when something needs fixing. */
export const doctor = Effect.fn("Doctor.run")(function* () {
  const findings = yield* checks();
  printFindings(findings);
  return findings.some((f) => !f.ok) ? 1 : 0;
});
