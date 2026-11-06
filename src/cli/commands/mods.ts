import * as Effect from "effect/Effect";
import { watch } from "node:fs";
import { homedir } from "node:os";
import { home } from "../../config/paths.ts";
import { addMod, devRound, listMods, modsDir, nudgeApp, removeMod, startDev, updateMods, type DevStart, type ModInfo } from "../../mods.ts";
import { args, opt } from "../args.ts";
import { type Command, die, out, Quit } from "../context.ts";

const USAGE = "usage: kiwi mod add <repo>[#ref] · kiwi mod update [name] [--yes] · kiwi mod list [--json] · kiwi mod remove <name> [--force] · kiwi mod dev <name>";

const tilde = (p: string): string => (p.startsWith(homedir()) ? `~${p.slice(homedir().length)}` : p);

const asks = (needs: readonly string[]): string => (needs.length ? `it asks for ${needs.join(", ")}` : "it asks for no permissions");

function line(m: ModInfo): string[] {
  const where = m.link ? `a link to ${tilde(m.link)}` : m.source ? `${m.source} @ ${m.commit ?? "?"}` : "a local folder";
  const head = `${m.name} ${m.version ?? ""}`.trim();
  if (m.problem) return [`${head} · ${where} · can't load: ${m.problem}`];
  return [`${head} · ${where}${m.changed ? " · has changes of its own" : ""}`, `  ${asks(m.needs)}`];
}

const clock = (): string => new Date().toTimeString().slice(0, 8);

const size = (bytes: number): string => (bytes < 1000 ? `${bytes} B` : `${Math.round(bytes / 1000)} KB`);

function watchDev(start: DevStart, name: string): void {
  let last: string | null = null;
  let needs: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> | null = null;
  let again = false;
  const round = async (): Promise<void> => {
    const r = await devRound(start.dir, name);
    const key = r.ok ? `${r.hash} ${r.manifest.version} ${r.manifest.needs.join(" ")}` : `x${r.why}`;
    if (key === last) return;
    const first = last === null;
    last = key;
    if (!r.ok) return out(`${clock()} can't load: ${r.why}`);
    out(`${clock()} ${first ? "built" : "rebuilt"} ${name} ${r.manifest.version}, ${size(r.bytes)}${first ? "" : "; Channels reloads it"}`);
    const asks = r.manifest.needs.join(", ");
    if (asks !== needs)
      out(`  ${needs === null ? (asks ? `it asks for ${asks}` : "it asks for no permissions") : `it now asks for ${asks || "nothing"}`}; Channels shows any it doesn't have for you to approve`);
    needs = asks;
    nudgeApp(start.at);
  };
  const go = (): void => {
    if (running) {
      again = true;
      return;
    }
    running = round().finally(() => {
      running = null;
      if (again) {
        again = false;
        go();
      }
    });
  };
  go();
  watch(start.dir, { recursive: true }, (_, file) => {
    const f = String(file ?? "");
    if (f === ".git" || f.startsWith(".git/") || f.startsWith("node_modules/") || f.includes("/node_modules/")) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(go, 150);
  });
}

const run = <A>(f: () => A) => Effect.try({ try: f, catch: (err) => new Quit({ message: err instanceof Error ? err.message : String(err), code: 1 }) });

export const modCommands: Record<string, Command> = {
  mod: () =>
    Effect.gen(function* () {
      const sub = args[1] ?? "list";
      const at = home();
      if (sub === "list") {
        const mods = yield* run(() => listMods(at));
        if (opt.json) return out(JSON.stringify(mods));
        if (!mods.length) return out(`no mods in ${tilde(modsDir(at))} (kiwi mod add github.com/owner/repo)`);
        for (const m of mods) for (const l of line(m)) out(l);
        return;
      }
      if (sub === "add") {
        const from = args[2];
        if (!from || args[3]) return yield* die("usage: kiwi mod add <repo>[#ref], like github.com/owner/repo, github.com/owner/repo#v1.2.0 or github.com/kiwi-init/mods/anatomy");
        const added = yield* run(() => addMod(at, from));
        out(`added ${added.manifest.name} ${added.manifest.version} from ${added.source.shown} @ ${added.commit.slice(0, 7)}`);
        out(`${asks(added.manifest.needs)}; Channels shows these for you to approve before it runs the mod`);
        return;
      }
      if (sub === "update") {
        if (args[3]) return yield* die("usage: kiwi mod update [name] [--yes]");
        const r = yield* run(() => updateMods(at, args[2] ?? null, !!opt.yes));
        for (const c of r.changes) {
          out(`${c.name} ${c.from ?? "?"} → ${c.to} (${c.commits} new commit${c.commits === 1 ? "" : "s"})${c.applied ? "" : ": not taken"}`);
          if (c.added.length) out(`  now also asks for ${c.added.join(", ")}`);
          if (c.dropped.length) out(`  no longer asks for ${c.dropped.join(", ")}`);
          if (c.added.length && c.applied) out("  Channels asks you to approve the new ones before it runs the mod again");
        }
        for (const s of r.skipped) out(`${s.name}: ${s.why}`);
        if (r.current.length) out(`up to date: ${r.current.join(", ")}`);
        if (!r.changes.length && !r.skipped.length && !r.current.length) out(`no mods in ${tilde(modsDir(at))}`);
        const held = r.changes.filter((c) => !c.applied).map((c) => c.name);
        if (held.length) return yield* die(`not taken: ${held.join(", ")} ask${held.length === 1 ? "s" : ""} for more; kiwi mod update ${held.length === 1 ? held[0] : "NAME"} --yes takes it`);
        return;
      }
      if (sub === "remove") {
        const name = args[2];
        if (!name || args[3]) return yield* die("usage: kiwi mod remove <name> [--force]");
        const r = yield* run(() => removeMod(at, name, !!opt.force));
        return out(r.link ? `removed the link ${name}; ${tilde(r.link)} stays` : `removed ${name}`);
      }
      if (sub === "dev") {
        const name = args[2];
        if (!name || args[3]) return yield* die("usage: kiwi mod dev <name>: create a mod, link this folder's mod, or open one, and rebuild it on each save");
        const start = yield* run(() => startDev(at, name, process.cwd()));
        if (start.how === "created") out(`created ${tilde(start.at)} with mod.json and index.tsx`);
        else if (start.how === "linked") out(`linked ${tilde(start.at)} to ${tilde(start.dir)}`);
        else out(`opened ${tilde(start.at)}${start.dir === start.at ? "" : `, a link to ${tilde(start.dir)}`}`);
        if (process.platform === "linux") out("Channels doesn't run mods on Linux yet; kiwi mod dev still checks and builds it on each save");
        out("each save checks and rebuilds it; ctrl-c stops");
        watchDev(start, name);
        return yield* Effect.never;
      }
      return yield* die(USAGE, 2);
    }),
};
