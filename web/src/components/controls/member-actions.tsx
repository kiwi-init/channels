import { memberLoad, showsLoad, type Load } from "@kiwi/core/load.ts"
import type { Member as RosterMember } from "@kiwi/core/membership.ts"
import { taskId } from "@kiwi/core/state.ts"
import { memberLine, memberName } from "@/lib/format"
import { setWake, useWakeSeat } from "@/lib/wake-seats"
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
  const { p, run, ask, editScopes, editPersona, editNickname, editHandle, editColor } = useControls()
  const now = p.state.members.get(m.name)
  const seat = useWakeSeat(p.roomId, m.name)
  return (
    <Menu align="center" trigger={trigger}>
      {onMessage && (
        <>
          <MenuItem onClick={onMessage}>Message privately</MenuItem>
          <MenuSeparator />
        </>
      )}
      {m.kind !== "human" && p.onNickname && <MenuItem onClick={() => editNickname(m)}>Change nickname…</MenuItem>}
      {m.kind !== "human" && p.onHandle && <MenuItem onClick={() => editHandle(m)}>Change handle…</MenuItem>}
      {m.kind !== "human" && p.onPersona && <MenuItem onClick={() => editPersona(m)}>{now?.persona ? `Personality: ${now.persona.name}…` : "Give a personality…"}</MenuItem>}
      {m.kind !== "human" && seat && (
        <MenuItem
          onClick={() =>
            void run(
              () => setWake(seat, seat.wake === "on" ? "off" : "on"),
              seat.wake === "on" ? `Kiwi won’t wake ${memberName(m)} on new messages` : `Kiwi wakes ${memberName(m)} when a message for it arrives`
            )
          }
        >
          {seat.wake === "on" ? "Stop waking it on new messages" : "Wake it on new messages"}
        </MenuItem>
      )}
      {p.onScopes && (
        <MenuItem onClick={() => editScopes(m)}>
          {now && scopesLine(now.scopes) === "read only" ? "Let them write…" : now && scopesLine(now.scopes) ? "Let them do everything…" : "Make read-only…"}
        </MenuItem>
      )}
      {m.kind === "human" && p.onColor && <MenuItem onClick={() => editColor(m)}>{now?.color ? `Colour: ${now.color}…` : "Give a colour…"}</MenuItem>}
      {m.kind === "human" && p.onPowers && (
        <>
          <MenuItem onClick={() => void run(() => p.onPowers!(m, { addsAgents: !m.addsAgents }), m.addsAgents ? `${memberName(m)}’s agents wait for you now` : `${memberName(m)} can add agents`)}>
            {m.addsAgents ? "Stop them adding agents" : "Let them add agents"}
          </MenuItem>
          <MenuItem
            onClick={() =>
              void run(() => p.onPowers!(m, { answersDecisions: !m.answersDecisions }), m.answersDecisions ? `${memberName(m)} no longer answers decisions` : `${memberName(m)} can answer decisions`)
            }
          >
            {m.answersDecisions ? "Stop them answering decisions" : "Let them answer decisions"}
          </MenuItem>
        </>
      )}
      <MenuSeparator />
      <MenuItem tone="danger" onClick={() => ask({ kind: "remove", member: m })}>
        Remove from channel…
      </MenuItem>
    </Menu>
  )
}

export function memberDetail(p: ControlsProps, m: RosterMember): string {
  const status = m.kind !== "human" ? p.statusOf?.(m.name) : undefined
  if (status) return status.text
  const load = memberLoad(p.state, m.name)
  const now = p.state.members.get(m.name)
  if (showsLoad(m, load) && load.level !== "free") return LEVEL[load.level]
  if (p.state.lead === m.name) return "Lead"
  const runs = now?.runs ?? m.runs
  return runs ? `${memberLine(now ?? m)} · ${runs.model}` : memberLine(now ?? m)
}
