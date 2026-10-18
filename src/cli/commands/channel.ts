import * as Effect from "effect/Effect";
import { mkdirSync, writeFileSync } from "node:fs";
import { join as joinPath } from "node:path";
import { home, Keystore, updateConfig } from "../../config.ts";
import { describeMember } from "@kiwi/core/membership.ts";
import { daemonSeat, type DaemonSeat } from "../../daemon.ts";
import { isWakeVia, wakeKey, wakeWords } from "@kiwi/core/wake.ts";
import { ago, holdLine, formatRooms, formatStatus, presenceWords, statusJson } from "@kiwi/core/format.ts";
import { describeScopes, presetOf } from "@kiwi/core/scopes.ts";
import { bindDirectory, seatsFor } from "../../hooks.ts";
import { args, opt } from "../args.ts";
import { agentName, type Command, die, noteRead, out, seatHere, session } from "../context.ts";
import { ADMIN_GONE } from "./admin.ts";

export const channelCommands: Record<string, Command> = {
  members: () =>
    Effect.gen(function* () {
      const s = yield* session();
      yield* s.members(true);
      const { state } = yield* s.state();
      for (const m of yield* s.members()) {
        if (m.kind === "computer") continue;
        const scopes = m.active ? state.members.get(m.name)?.scopes : undefined;
        const may = scopes && presetOf(scopes) !== "full" ? ` · may: ${describeScopes(scopes)}` : "";
        out(`${describeMember(m)}${m.name === s.me ? " (you)" : ""}${m.role ? ` — ${m.role}` : ""}${may}${m.active ? "" : "  (left)"}`);
      }
    }),

  rooms: () =>
    Effect.gen(function* () {
      const s = yield* session();
      out(formatRooms((yield* s.state()).state));
    }),

  leave: () =>
    Effect.gen(function* () {
      const s = yield* session();
      if (s.identity.pk === s.cfg.ownerPk) return yield* die("this key owns the channel; close it from the Channels app");
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
      if (!bindDirectory(process.cwd(), seatHere(alias, name, false))) return yield* die("won't bind your home folder or the filesystem root; cd into a project first");
      out(`kiwi in ${process.cwd()} now acts as ${name} in "${alias}"`);
    }),

  wake: () =>
    Effect.gen(function* () {
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
        return out(turn === "off" ? `Kiwi won't wake ${s.me} in "${s.alias}"; read with \`kiwi listen --now\`` : `Kiwi wakes ${s.me} in "${s.alias}" when a message for it arrives`);
      }
      if (turn !== undefined) return yield* die("usage: kiwi wake [on|off]");
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
          { client: p.client, role: p.role, ...(p.reach ? { reach: p.reach } : {}), ...(p.readAt === undefined ? {} : { readAt: p.readAt }), ...(isWakeVia(p.wake) ? { wake: p.wake } : {}) },
        ]),
      );
      const snap = { alias: s.alias, me: s.me, state, online: on, unread: yield* s.unreadCount(state, messages) };
      out(opt.json ? JSON.stringify(statusJson(snap)) : formatStatus(snap));
      yield* noteRead(s);
    }),

  who: () =>
    Effect.gen(function* () {
      const s = yield* session();
      const [online, { state }] = yield* Effect.all([s.who(), s.state()], { concurrency: "unbounded" });
      const away = [...state.members.values()].filter((m) => m.active && !online.has(m.name));
      if (!online.size && !away.length) return out("nobody else is in this channel");
      for (const [name, p] of online) {
        const role = state.members.get(name)?.persona?.name;
        out(`${name}${role ? ` — ${role}` : ""} · ${presenceWords(p)}`);
      }
      for (const m of away) out(`${m.name}${m.persona ? ` — ${m.persona?.name}` : ""} · last seen ${ago(m.lastSeen)}`);
    }),

  charter: () =>
    Effect.gen(function* () {
      const s = yield* session();
      if (args.length > 1 || opt.clear) return yield* die(ADMIN_GONE);
      const { state } = yield* s.state();
      out(state.charter ? state.charter.text : "no charter (the owner sets one in the Channels app)");
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
  const how = w.path.kind === "hooks" ? `wakes via ${wakeWords("hooks")}` : w.path.kind === "command" ? `wakes via ${wakeWords(w.path.via)}` : `can't be woken: ${w.path.why}`;
  const last = w.last ? ` · last wake ${ago(w.last.at)} via ${wakeWords(w.last.via)}, ${w.last.unread} unread, ${w.last.ok ? "ok" : "failed"}` : "";
  return `wake ${w.on ? "on" : "off"} · ${how}${last}`;
}
