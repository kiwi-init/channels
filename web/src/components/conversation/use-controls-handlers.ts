import { personaScopes } from "@kiwi/core/personality.ts"
import { handBackText, heldBy } from "@kiwi/core/handback.ts"
import { newRoomId } from "@kiwi/core/state.ts"
import type { Room } from "@kiwi/core/state/types.ts"
import { describeScopes, SCOPES, wireScopes } from "@kiwi/core/scopes.ts"
import { forgetChannel, loadMember, renameChannel, type ChannelHandle, type StoredMember } from "@/lib/channel"
import { cleanRoomName, roomProblem, roomsAfter } from "@/lib/rooms"
import { secrets } from "@/lib/secrets"
import type { ControlsProps } from "../controls"

type Handlers = Pick<
  ControlsProps,
  | "onApprove"
  | "onScopes"
  | "onPersona"
  | "onPin"
  | "onNickname"
  | "onColor"
  | "onPowers"
  | "onDeny"
  | "onCheck"
  | "onRemove"
  | "onHold"
  | "onCharter"
  | "onRepos"
  | "onGithubWrite"
  | "onBranchPrefix"
  | "onMakeRoom"
  | "onRenameRoom"
  | "onRename"
  | "onIcon"
  | "onCloseChannel"
  | "onLeaveChannel"
  | "exportLog"
>

export function useControlsHandlers({
  live,
  member,
  onGone,
  rooms,
}: {
  live: Pick<ChannelHandle, "ch" | "send" | "isOwner" | "refreshRequests" | "refreshRoster" | "foldFrom" | "state">
  member: StoredMember
  onGone: () => void
  rooms: () => ReadonlyMap<string, Room>
}): Handlers {
  const { ch, send, isOwner, refreshRequests, refreshRoster, foldFrom, state } = live
  const hold = isOwner
    ? async (on: boolean, note?: string) => {
        const ev = { op: "hold.set" as const, on, ...(note ? { note } : {}) }
        const since = await send(on ? `on hold${note ? `: ${note}` : ""}` : "hold lifted", { kind: "event", ev })
        await ch.setHold({ on, ...(note ? { note } : {}), since })
      }
    : undefined

  const folded = async (room: { id: string; name: string }): Promise<void> => {
    for (const end = Date.now() + 10_000; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) if (rooms().get(room.id)?.name === room.name) return
    throw new Error(`#${room.name} was sent, but it hasn't come back from the relay yet, so the room list wasn't updated: reopen the channel and look again`)
  }

  return {
    onApprove: async (r, scopes, persona, powers) => {
      const granted = r.kind === "human" ? { ...(powers?.addsAgents ? { addsAgents: true } : {}), ...(powers?.answersDecisions ? { answersDecisions: true } : {}) } : {}
      const as = persona ? { persona } : { ...(wireScopes(scopes) ? { scopes } : {}), ...granted }
      try {
        await ch.approve(r, as, { person: secrets().person?.pk })
      } catch (err) {
        const joined = (await ch.members().catch(() => [])).find((m) => m.active && !m.unverified && m.pk === r.pk)
        if (!joined) throw err
        if (String(wireScopes(joined.later?.scopes ?? joined.scopes)) !== String(wireScopes(scopes)))
          throw new Error(`${r.name} already joined with other permissions: change them from its menu`, { cause: err })
      } finally {
        await Promise.all([refreshRequests(), refreshRoster()])
      }
    },
    onScopes: async (m, scopes) => {
      const wire = wireScopes(scopes)
      const seq = await send(`set what ${m.name} may do: ${wire ? describeScopes(wire) : "full"}`, {
        kind: "event",
        ev: { op: "scope.set", member: m.name, pk: m.pk, scopes: wire, keepLead: true },
      })
      await ch.updateScopes(m, scopes, seq)
      await refreshRoster()
    },
    onPin: (p) => ch.pinPersona(p),
    onPersona: async (m, persona) => {
      const scopes = persona ? personaScopes(persona) : [...SCOPES]
      const wire = wireScopes(scopes)
      const seq = await send(persona ? `made ${m.name} ${persona.name}` : `took ${m.name}'s personality away`, {
        kind: "event",
        ev: { op: "scope.set", member: m.name, pk: m.pk, scopes: wire, lead: persona?.role === "lead", wasLead: m.persona?.role === "lead" },
      })
      await ch.updatePersona(m, persona, seq)
      await refreshRoster()
    },
    onNickname: async (m, nickname) => {
      await ch.updateNickname(m, nickname)
      await refreshRoster()
    },
    onColor: async (m, color) => {
      await send(color ? `${m.name}'s colour is ${color}` : `cleared ${m.name}'s colour`, { kind: "event", ev: { op: "color.set", member: m.name, color } })
    },
    onPowers: async (m, powers) => {
      await ch.updatePowers(m, powers)
      await refreshRoster()
    },
    onDeny: async (r) => {
      await ch.deny(r.id)
      await refreshRequests()
    },
    onCheck: async (r) => {
      await ch.checkRequest(r)
      await refreshRequests()
    },
    onRemove: async (m) => {
      const held = heldBy(state, m.name)
      const lead = state.lead && state.lead !== m.name ? [state.lead] : undefined
      if (held.length) await send(handBackText(state, m.name, "removed", held), lead ? { to: lead } : {})
      await ch.remove(m.pk)
      await refreshRoster()
    },
    onHold: hold,
    onCharter: isOwner
      ? async (text) => {
          const since = await send(text ? `charter: ${text}` : "cleared the charter", { kind: "event", ev: { op: "charter.set", text } })
          await ch.setCharter({ text, since })
        }
      : undefined,
    onRepos: isOwner
      ? async (repos) => {
          await ch.setGithubRepos(repos)
          const since = await send(repos.length ? `repos: ${repos.join(", ")}` : "cleared the channel's repos", { kind: "event", ev: { op: "repos.set", repos } })
          await ch.setRepos({ list: repos, since })
        }
      : undefined,
    onGithubWrite: isOwner
      ? async (on) => {
          await send(on ? "turned on Write to GitHub" : "turned off Write to GitHub", { kind: "event", ev: { op: "github.write.set", on } })
        }
      : undefined,
    onBranchPrefix: isOwner
      ? async (prefix) => {
          await send(prefix ? `branch prefix: ${prefix}` : "cleared the branch prefix", { kind: "event", ev: { op: "branch.prefix.set", prefix } })
        }
      : undefined,
    onMakeRoom: isOwner
      ? async (typed) => {
          const problem = roomProblem(rooms().values(), typed)
          if (problem) throw new Error(problem)
          const room = { id: newRoomId(), name: cleanRoomName(typed) }
          const since = await send(`made the room #${room.name}`, { kind: "event", ev: { op: "room.create", ...room } })
          await folded(room)
          await ch.setRooms({ list: roomsAfter(rooms().values(), room), since })
          return room.id
        }
      : undefined,
    onRenameRoom: isOwner
      ? async (id, typed) => {
          const problem = roomProblem(rooms().values(), typed, id)
          if (problem) throw new Error(problem)
          const room = { id, name: cleanRoomName(typed) }
          const since = await send(`renamed a room to #${room.name}`, { kind: "event", ev: { op: "room.rename", ...room } })
          await folded(room)
          await ch.setRooms({ list: roomsAfter(rooms().values(), room), since })
        }
      : undefined,
    onRename: isOwner
      ? async (name) => {
          await ch.setTitle(name)
          const stored = loadMember(member.code)
          if (stored) void renameChannel(stored.code, name.trim().slice(0, 80))
        }
      : undefined,
    onIcon: isOwner
      ? async (icon) => {
          await ch.setIcon(icon)
        }
      : undefined,
    onCloseChannel: async () => {
      await ch.close()
      forgetChannel(member.code)
      onGone()
    },
    onLeaveChannel: async () => {
      await ch.leave()
      forgetChannel(member.code)
      onGone()
    },
    exportLog: async () => {
      const [{ checkedState, logExport }, history] = await Promise.all([import("@/lib/log-export"), ch.history(0)])
      return { log: logExport(history), state: await checkedState(history, foldFrom, () => ch.snapshot().catch(() => null), state) }
    },
  }
}
