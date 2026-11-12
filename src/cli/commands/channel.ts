import * as Effect from "effect/Effect";
import { mkdirSync, writeFileSync } from "node:fs";
import { join as joinPath } from "node:path";
import { home, Keystore, loadConfig, updateConfig } from "../../config.ts";
import { openRound, taskId, type ChannelState } from "@kiwi/core/state.ts";
import { openSession } from "../../agent.ts";
import { sessionNeighbours } from "../../seats.ts";
import { daemonSeat, type DaemonSeat } from "../../daemon.ts";
import { isWakeVia, wakeKey, wakeWords } from "@kiwi/core/wake.ts";
import { ago, holdLine, formatRooms, formatStatus, statusJson } from "@kiwi/core/format.ts";
import { reviewCheckOf } from "@kiwi/core/protocol.ts";
import { bindDirectory, seatsFor } from "../../hooks.ts";
import { heldText, seatHeldAway } from "../../hold.ts";
import { setWake, wakeSeats } from "../../wake-seats.ts";
import { args, opt } from "../args.ts";
import { agentName, type Command, die, noteRead, out, seatHere, session } from "../context.ts";
import { ADMIN_GONE } from "./admin.ts";

export const channelCommands: Record<string, Command> = {
  rooms: () =>
    Effect.gen(function* () {
      const s = yield* session();
      out(formatRooms((yield* s.state()).state, s.me));
    }),

  leave: () =>
    Effect.gen(function* () {
      const s = yield* session();
      if (s.identity.pk === s.cfg.ownerPk) return yield* die("this key owns the channel; close it from the Channels app");
      const back = yield* s.handBack().pipe(
        Effect.catch((e) =>
          Effect.sync((): number[] => {
            process.stderr.write(`kiwi: couldn't hand your tasks back (${e instanceof Error ? e.message : String(e)}); the board shows them as open once you're gone\n`);
            return [];
          }),
        ),
      );
      if (back.length) out(`back on the board, the lead told: ${back.map(taskId).join(", ")}`);
      yield* s.ch.fx.leave();
      yield* (yield* Keystore).forgetMember(s.alias, s.me);
      out(`${s.me} left "${s.alias}"; its key is gone from this machine`);
    }),

  channels: () =>
    Effect.gen(function* () {
      const keys = yield* Keystore;
      const cfg = yield* keys.config;
      const here = seatsFor(process.cwd());
      for (const [alias, c] of Object.entries(cfg.channels)) {
        const agents = (yield* keys.identitiesIn(c.roomId)).filter((n) => n !== c.owner && n !== c.person);
        out(
          `${here.some((b) => b.alias === alias) ? "*" : " "} ${alias}${c.title && c.title !== alias ? ` (${c.title})` : ""}  ${agents.length ? `agents here: ${agents.join(", ")}` : "no agent keys"}  ${c.relay}`,
        );
      }
    }),

  use: () =>
    Effect.gen(function* () {
      const keys = yield* Keystore;
      const cfg = yield* keys.config;
      const alias = args[1] ?? (yield* die("usage: kiwi use <alias> --as NAME"));
      const c = cfg.channels[alias] ?? (yield* die(`unknown channel "${alias}"`));
      const name = yield* agentName(c);
      if (!(yield* keys.identitiesIn(c.roomId)).includes(name)) return yield* die(`${name} has no key in "${alias}" on this machine`);
      if (seatHeldAway(cfg, alias, name)) return yield* die(heldText(alias, name));
      if (!bindDirectory(process.cwd(), seatHere(alias, name, false))) return yield* die("won't bind your home folder or the filesystem root; cd into a project first");
      out(`kiwi in ${process.cwd()} now acts as ${name} in "${alias}"`);
    }),

  wake: () =>
    Effect.gen(function* () {
      if (args[1] === "seats" || args[1] === "seat") {
        if (args[1] === "seat") {
          const [, , room, agent, turn] = args;
          if (!room || !agent || (turn !== "on" && turn !== "off")) return yield* die("usage: kiwi wake seat ROOM_ID AGENT on|off [--json]");
          if (!setWake(room, agent, turn)) return yield* die(`no seat for ${agent} in that channel on this computer`);
        }
        const seats = wakeSeats(loadConfig());
        return out(opt.json ? JSON.stringify({ seats }) : seats.map((s) => `${s.alias}/${s.agent}: ${s.wake}`).join("\n") || "no seats on this computer");
      }
      const s = yield* session();
      const turn = args[1];
      if (turn === "on" || turn === "off") {
        const key = wakeKey(s.alias, s.me);
        updateConfig((cfg) => {
          const off = new Set(cfg.wakeOff ?? []);
          if (turn === "off") off.add(key);
          else off.delete(key);
          if (off.size) cfg.wakeOff = [...off];
          else delete cfg.wakeOff;
        });
        return out(turn === "off" ? `Kiwi won't wake ${s.me} in "${s.alias}"; read with \`kiwi join\`` : `Kiwi wakes ${s.me} in "${s.alias}" when a message for it arrives`);
      }
      if (turn === "webhook") {
        const key = wakeKey(s.alias, s.me);
        const url = args[2];
        if (url === "off") {
          updateConfig((cfg) => {
            if (cfg.wakeHooks) delete cfg.wakeHooks[key];
            if (cfg.wakeHooks && !Object.keys(cfg.wakeHooks).length) delete cfg.wakeHooks;
          });
          return out(`Kiwi no longer wakes ${s.me} in "${s.alias}" through a webhook`);
        }
        if (!url || !/^https:\/\//.test(url)) return yield* die('usage: printf %s "$AUTHORIZATION" | kiwi wake webhook https://… (or: kiwi wake webhook off)');
        const piped = process.stdin.isTTY ? "" : (yield* Effect.promise(() => Bun.stdin.text())).trim();
        updateConfig((cfg) => {
          cfg.wakeHooks = { ...cfg.wakeHooks, [key]: { url, ...(piped ? { authorization: piped } : {}) } };
        });
        return out(
          `Kiwi wakes ${s.me} in "${s.alias}" by POSTing to ${new URL(url).host}${piped ? " with the Authorization header from stdin" : " (no Authorization header: pipe one in if the webhook needs it)"}`,
        );
      }
      if (turn !== undefined) return yield* die("usage: kiwi wake [on|off|webhook URL|webhook off|seats|seat ROOM_ID AGENT on|off]");
      const seat = yield* Effect.promise(() => daemonSeat(s.alias, s.me));
      out(seat ? wakeLine(seat.wake) : `the daemon holds no seat for ${s.me} in "${s.alias}" yet`);
    }),

  status: () =>
    Effect.gen(function* () {
      const s = yield* session();
      const [{ messages, state }, online] = yield* Effect.all([s.state(), s.who()], { concurrency: "unbounded" });
      const on = new Map(
        [...online].map(([n, p]) => [
          n,
          { client: p.client, ...(p.reach ? { reach: p.reach } : {}), ...(p.readAt === undefined ? {} : { readAt: p.readAt }), ...(isWakeVia(p.wake) ? { wake: p.wake } : {}) },
        ]),
      );
      const snap = { alias: s.alias, check: reviewCheckOf(s.ch.roomId), me: s.me, state, online: on, unread: yield* s.unreadCount(state, messages) };
      const all = !!opt.all;
      out(opt.json ? JSON.stringify(statusJson(snap)) : formatStatus({ ...snap, all }));
      if (!opt.json) {
        const shared = yield* sharedElsewhere(s.alias);
        if (shared.length) out(["", "sessions this machine shares with other channels:", ...shared.map((l) => `  ${l}`)].join("\n"));
      }
      yield* noteRead(s);
    }),

  hold: () =>
    Effect.gen(function* () {
      const s = yield* session();
      if (args.length > 1) return yield* die(ADMIN_GONE);
      out(holdLine((yield* s.state()).state) ?? "not on hold");
    }),

  icon: () =>
    Effect.gen(function* () {
      const s = yield* session();
      if (args[1] || opt.image || opt.clear) return yield* die(ADMIN_GONE);
      {
        const icon = yield* s.ch.fx.icon();
        if (!icon) return out("no icon (the owner sets one in the Channels app)");
        if (icon.kind === "robot") return out(`the ${icon.robot} robot head`);
        if (icon.kind === "emoji") return out(icon.emoji);
        const dir = joinPath(home(), "downloads", s.ch.roomId);
        mkdirSync(dir, { recursive: true });
        const path = joinPath(dir, `icon.${icon.mime.split("/")[1]}`);
        writeFileSync(path, Buffer.from(icon.data, "base64"));
        return out(`an image (${icon.mime}), saved at ${path}`);
      }
    }),
};

function wakeLine(w: DaemonSeat["wake"]): string {
  const how =
    w.path.kind === "hooks" ? `wakes via ${wakeWords("hooks")}` : w.path.kind === "extension" || w.path.kind === "command" ? `wakes via ${wakeWords(w.path.via)}` : `can't be woken: ${w.path.why}`;
  const last = w.last ? ` · last wake ${ago(w.last.at)} via ${wakeWords(w.last.via)}, ${w.last.unread} unread, ${w.last.ok ? "ok" : "failed"}` : "";
  return `wake ${w.on ? "on" : "off"} · ${how}${last}`;
}

export function inFlight(state: Pick<ChannelState, "tasks">, name: string): string[] {
  return [...state.tasks.values()].flatMap((t) => {
    const round = t.state === "review" && t.review === name ? openRound(t) : undefined;
    if (round) return [`round ${round.n} of ${taskId(t.id)} to review`];
    return t.owner === name && t.state === "doing" ? [`${taskId(t.id)} in progress`] : [];
  });
}

const sharedElsewhere = (alias: string) =>
  Effect.gen(function* () {
    const cfg = loadConfig();
    const lines: string[] = [];
    for (const [seat, others] of sessionNeighbours(cfg, alias)) {
      for (const o of others) {
        const there = cfg.channels[o.alias];
        const state = there
          ? yield* openSession(o.alias, there, o.as).pipe(
              Effect.flatMap((x) => x.state()),
              Effect.map((r) => r.state),
              Effect.catchCause(() => Effect.succeed(null)),
            )
          : null;
        const work = state ? inFlight(state, o.as) : [];
        lines.push(`${seat} runs in one session with @${o.as} in "${o.alias}"${work.length ? `, which has ${work.join(", ")}: resetting the session loses that` : ""}`);
      }
    }
    return lines;
  });
