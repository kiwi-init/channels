import { memberLoad, showsLoad, type Load } from "@kiwi/core/load.ts"
import type { Member as RosterMember } from "@kiwi/core/membership.ts"
import { taskId } from "@kiwi/core/state.ts"
import { memberLine } from "@/lib/format"
import { scopesLine } from "../scopes"
import { Menu, MenuItem, MenuSeparator } from "../ui/menu"
import { useControls, type ControlsProps } from "./context"

const LEVEL = { free: "Free", busy: "Busy", overloaded: "Overloaded" } as const

export function loadDetail(l: Load): string {
  const lines = [
    ...l.current.map((t) => `Doing ${taskId(t.id)} ${t.title}`),
    ...l.queued.map((t) => `Queued ${taskId(t.id)} ${t.title}`),
    ...l.waiting.map((t) => `In review ${taskId(t.id)} ${t.title}`),
  ]
  return lines.length ? lines.join("\n") : "Nothing assigned"
}

export function MemberActions({ m, trigger, onMessage }: { m: RosterMember; trigger: Parameters<typeof Menu>[0]["trigger"]; onMessage?: () => void }) {
  const { p, ask, editRole, editScopes, editPersona, editNickname, setLead } = useControls()
  const now = p.state.members.get(m.name)
  return (
    <Menu align="center" trigger={trigger}>
      {onMessage && (
        <>
          <MenuItem onClick={onMessage}>Message privately</MenuItem>
          <MenuSeparator />
        </>
      )}
      {m.kind !== "human" && p.onNickname && <MenuItem onClick={() => editNickname(m)}>Change nickname…</MenuItem>}
      {m.kind !== "human" && p.onPersona && <MenuItem onClick={() => editPersona(m)}>{now?.persona ? `Personality: ${now.persona.name}…` : "Give a personality…"}</MenuItem>}
      <MenuItem onClick={() => editRole(m)}>Set role…</MenuItem>
      {p.state.lead === m.name ? (
        <MenuItem onClick={() => void setLead(m, false)}>No longer lead</MenuItem>
      ) : (
        m.kind !== "human" && <MenuItem onClick={() => void setLead(m, true)}>Make lead</MenuItem>
      )}
      {p.onScopes && (
        <MenuItem onClick={() => editScopes(m)}>
          {now && scopesLine(now.scopes) === "read only" ? "Let them write…" : now && scopesLine(now.scopes) ? "Let them do everything…" : "Make read-only…"}
        </MenuItem>
      )}
      <MenuSeparator />
      <MenuItem tone="danger" onClick={() => ask({ kind: "remove", member: m })}>
        Remove from channel…
      </MenuItem>
    </Menu>
  )
}

export function memberDetail(p: ControlsProps, m: RosterMember): string {
  const load = memberLoad(p.state, m.name)
  const now = p.state.members.get(m.name)
  if (showsLoad(m, load) && load.level !== "free") return LEVEL[load.level]
  if (p.state.lead === m.name) return "Lead"
  const runs = now?.runs ?? m.runs
  return runs ? `${memberLine(now ?? m)} · ${runs.model}` : memberLine(now ?? m)
}
