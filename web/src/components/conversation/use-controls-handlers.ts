import { personaScopes } from "@kiwi/core/personality.ts"
import { describeScopes, SCOPES, wireScopes } from "@kiwi/core/scopes.ts"
import { forgetChannel, loadMember, renameChannel, type ChannelHandle, type StoredMember } from "@/lib/channel"
import { secrets } from "@/lib/secrets"
import type { ControlsProps } from "../controls"

type Handlers = Pick<
  ControlsProps,
  | "onApprove"
  | "onScopes"
  | "onPersona"
  | "onPin"
  | "onNickname"
  | "onDeny"
  | "onCheck"
  | "onRemove"
  | "onHold"
  | "onCharter"
  | "onRepos"
  | "onVoice"
  | "onRename"
  | "onCloseChannel"
  | "onLeaveChannel"
>

export function useControlsHandlers({
  live,
  member,
  onGone,
}: {
  live: Pick<ChannelHandle, "ch" | "send" | "isOwner" | "refreshRequests" | "refreshRoster">
  member: StoredMember
  onGone: () => void
}): Handlers {
  const { ch, send, isOwner, refreshRequests, refreshRoster } = live
  const hold = isOwner
    ? async (on: boolean, note?: string) => {
        const ev = { op: "hold.set" as const, on, ...(note ? { note } : {}) }
        const since = await send(on ? `on hold${note ? `: ${note}` : ""}` : "hold lifted", { kind: "event", ev })
        await ch.setHold({ on, ...(note ? { note } : {}), since })
      }
    : undefined

  return {
    onApprove: async (r, scopes, persona) => {
      const as = persona ? { persona } : wireScopes(scopes) ? { scopes } : undefined
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
      const seq = await send(`set what ${m.name} may do: ${wire ? describeScopes(wire) : "full"}`, { kind: "event", ev: { op: "scope.set", member: m.name, pk: m.pk, scopes: wire } })
      await ch.updateScopes(m, scopes, seq)
      await refreshRoster()
    },
    onPin: (p) => ch.pinPersona(p),
    onPersona: async (m, persona) => {
      const scopes = persona ? personaScopes(persona) : [...SCOPES]
      const wire = wireScopes(scopes)
      const seq = await send(persona ? `made ${m.name} ${persona.name}` : `took ${m.name}'s personality away`, { kind: "event", ev: { op: "scope.set", member: m.name, pk: m.pk, scopes: wire } })
      await ch.updatePersona(m, persona, seq)
      await refreshRoster()
    },
    onNickname: async (m, nickname) => {
      await ch.updateNickname(m, nickname)
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
          const since = await send(repos.length ? `repos: ${repos.join(", ")}` : "cleared the channel's repos", { kind: "event", ev: { op: "repos.set", repos } })
          await ch.setRepos({ list: repos, since })
          await ch.setGithubRepos(repos).catch(() => {})
        }
      : undefined,
    onVoice: isOwner
      ? async (on) => {
          await send(on ? "allowed voice in the channel" : "turned voice off for the channel", { kind: "event", ev: { op: "voice.set", on } })
        }
      : undefined,
    onRename: isOwner
      ? async (name) => {
          await ch.setTitle(name)
          const stored = loadMember(member.code)
          if (stored) void renameChannel(stored.code, name.trim().slice(0, 80))
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
  }
}
