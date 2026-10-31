import { handBackText, heldBy } from "@kiwi/core/handback.ts"
import { NAME_RE, nameKey, type JoinRequest, type Member as RosterMember } from "@kiwi/core/membership.ts"
import { personaOf, personaScopes, type Persona } from "@kiwi/core/personality.ts"
import { pinned } from "@kiwi/core/pin.ts"
import { describeScopes, SCOPES, wireScopes, type Scope } from "@kiwi/core/scopes.ts"
import { secrets } from "@kiwi/secrets/secrets.ts"
import { announce } from "~/kit/toasts"
import { newMemberPowers, newMemberScopes } from "~/live/defaults"
import { event, memberOf, need, owner, personalities, setup } from "~/live/run"
import { openedRun, type Run } from "~/live/store"
import type { JoinChoice, Powers } from "~/model"
import { BRANCH_PREFIX_RE, POWERS, ROOM_ID_RE, type Power } from "@kiwi/core/protocol.ts"
import { newRoomId } from "@kiwi/core/state.ts"
import { cleanRoomName, roomProblem, roomsAfter } from "@kiwi/app/rooms.ts"

const POWER_WORDS: Record<Power, string> = { addsAgents: "add agents", answersDecisions: "answer decisions", managesAgents: "manage agents" }

function agentManager(code: string, name: string): { run: Run; m: RosterMember } {
  const run = need(code)
  const m = memberOf(run, name)
  if (run.isOwner) return { run, m }
  const me = run.roster.find((r) => r.active && r.name === run.me)
  if (!me?.managesAgents || m.kind !== "agent" || m.owner || m.name === run.me) throw new Error("only the owner, or a person who manages agents, changes an agent's role or personality")
  return { run, m }
}

async function personaFor(r: JoinRequest, choice: JoinChoice): Promise<Persona | null> {
  if (r.kind === "human" || choice.persona === null) return null
  const all = personalities()
  if (choice.persona !== undefined) {
    const p = all.find((x) => x.id === choice.persona)
    if (!p) throw new Error("that personality isn't on this computer")
    return personaOf(p)
  }
  if (!r.pin) return null
  const pin = await pinned(r.pin, all)
  if (!pin) throw new Error(`${r.name} was invited as ${r.pin.name}, which isn't on this computer anymore`)
  return pin
}

export async function letIn(run: Run, r: JoinRequest, choice: JoinChoice): Promise<string> {
  const name = choice.as?.trim() || r.name
  if (name !== r.name) {
    if (!NAME_RE.test(name)) throw new Error(`${name} can't be a name: letters, digits, . _ - only`)
    if (run.roster.some((m) => m.active && m.pk !== r.pk && nameKey(m.name) === nameKey(name))) throw new Error(`${name} is taken here too`)
  }
  const persona = await personaFor(r, choice)
  const scopes = choice.readOnly === undefined ? newMemberScopes(run.roomId) : choice.readOnly ? [] : [...SCOPES]
  const powers = r.kind === "human" ? (choice.powers ?? newMemberPowers(run.roomId)) : null
  const granted = powers
    ? { ...(powers.addsAgents ? { addsAgents: true } : {}), ...(powers.answersDecisions ? { answersDecisions: true } : {}), ...(powers.managesAgents ? { managesAgents: true } : {}) }
    : {}
  const as = persona ? { persona } : { ...(wireScopes(scopes) ? { scopes } : {}), ...granted }
  try {
    await run.ch.approve(name === r.name ? r : { ...r, name }, as, { person: secrets().person?.pk })
  } catch (err) {
    const joined = (await run.ch.members().catch(() => [])).find((m) => m.active && !m.unverified && m.pk === r.pk)
    if (!joined) throw err
  } finally {
    await Promise.all([run.refreshRequests(), run.refreshRoster()])
  }
  return persona ? `${r.display || name} joined as ${persona.name}` : `${r.display || name} joined`
}

async function scopesFor(run: Run, name: string, scopes: Scope[]): Promise<void> {
  const m = memberOf(run, name)
  const wire = wireScopes(scopes)
  const seq = await event(run, `set what ${m.name} may do: ${wire ? describeScopes(wire) : "full"}`, { op: "scope.set", member: m.name, pk: m.pk, scopes: wire, keepLead: true })
  await run.ch.updateScopes(m, scopes, seq)
  await run.refreshRoster()
}

export async function setRole(code: string, name: string, role: string | null): Promise<void> {
  const { run } = agentManager(code, name)
  await event(run, role ? `made ${name} ${role}` : `cleared ${name}'s role`, { op: "role.set", member: name, role })
}

export async function removeMember(code: string, name: string): Promise<void> {
  const run = owner(code)
  const m = memberOf(run, name)
  const held = heldBy(run.state, name)
  const lead = run.state.lead && run.state.lead !== name ? [run.state.lead] : undefined
  if (held.length) await run.send(handBackText(run.state, name, "removed", held), lead ? { to: lead } : {})
  await run.ch.remove(m.pk)
  await run.refreshRoster()
  announce(`Removed ${m.display || name}`)
}

export async function setPersona(code: string, name: string, id: string | null): Promise<void> {
  const { run, m } = agentManager(code, name)
  const p = id === null ? null : personalities().find((x) => x.id === id)
  if (p === undefined) throw new Error("that personality isn't on this computer")
  const persona = p ? personaOf(p) : null
  const wire = wireScopes(persona ? personaScopes(persona) : [...SCOPES])
  const seq = await event(run, persona ? `made ${m.name} ${persona.name}` : `took ${m.name}'s personality away`, {
    op: "scope.set",
    member: m.name,
    pk: m.pk,
    scopes: wire,
    lead: persona?.role === "lead",
    wasLead: m.persona?.role === "lead",
    ...(run.isOwner ? {} : { persona }),
  })
  if (!run.isOwner) return
  await run.ch.updatePersona(m, persona, seq)
  await run.refreshRoster()
}

export const setReadOnly = (code: string, name: string, on: boolean): Promise<void> => scopesFor(owner(code), name, on ? [] : [...SCOPES])

export async function setNickname(code: string, name: string, nickname: string | null): Promise<void> {
  const run = owner(code)
  await run.ch.updateNickname(memberOf(run, name), nickname?.trim() || null)
  await run.refreshRoster()
}

export async function setPowers(code: string, name: string, powers: Partial<Powers>): Promise<void> {
  const run = owner(code)
  const m = memberOf(run, name)
  for (const power of POWERS) {
    const on = powers[power]
    if (on === undefined || on === !!m[power]) continue
    await event(run, `${on ? "gave" : "took"} ${name} ${on ? "" : "back "}the power to ${POWER_WORDS[power]}`, { op: "power.set", member: name, pk: m.pk, power, on, was: !!m[power] })
  }
  await run.ch.updatePowers(m, {
    addsAgents: powers.addsAgents ?? !!m.addsAgents,
    answersDecisions: powers.answersDecisions ?? !!m.answersDecisions,
    managesAgents: powers.managesAgents ?? !!m.managesAgents,
  })
  await run.refreshRoster()
}

async function setRepos(run: Run, repos: string[]): Promise<void> {
  if (run.isOwner) await run.ch.setGithubRepos(repos)
  const since = await event(run, repos.length ? `repos: ${repos.join(", ")}` : "cleared the channel's repos", { op: "repos.set", repos })
  if (run.isOwner) await run.ch.setRepos({ list: repos, since })
}

export async function setGithubWrite(code: string, on: boolean): Promise<void> {
  await event(owner(code), on ? "turned on Write to GitHub" : "turned off Write to GitHub", { op: "github.write.set", on })
}

export async function setBranchPrefix(code: string, typed: string | null): Promise<void> {
  const prefix = typed?.trim() || null
  if (prefix && !BRANCH_PREFIX_RE.test(prefix)) throw new Error("a branch prefix is up to 32 letters, digits, dots, dashes, underscores or slashes")
  await event(setup(code), prefix ? `branch prefix: ${prefix}` : "cleared the branch prefix", { op: "branch.prefix.set", prefix })
}

export async function setGoal(code: string, goal: string): Promise<void> {
  const run = setup(code)
  const text = goal.trim() || null
  const since = await event(run, text ? `charter: ${text}` : "cleared the charter", { op: "charter.set", text })
  if (run.isOwner) await run.ch.setCharter({ text, since })
}

export async function setHold(code: string, on: boolean, note?: string): Promise<void> {
  const run = owner(code)
  const ev = { op: "hold.set" as const, on, ...(note ? { note } : {}) }
  const since = await event(run, on ? `on hold${note ? `: ${note}` : ""}` : "hold lifted", ev)
  await run.ch.setHold({ on, ...(note ? { note } : {}), since })
}

export const addRepo = (code: string, repo: string): Promise<void> => setRepos(setup(code), [...new Set([...setup(code).state.repos, repo.trim()])])

export const removeRepo = (code: string, repo: string): Promise<void> =>
  setRepos(
    setup(code),
    setup(code).state.repos.filter((r) => r !== repo)
  )

async function roomFolded(run: () => Run | null, room: { id: string; name: string }): Promise<void> {
  for (const end = Date.now() + 10_000; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) if (run()?.state.rooms.get(room.id)?.name === room.name) return
  throw new Error(`#${room.name} was sent but hasn't come back from the relay yet: look again in a moment`)
}

export async function addRoom(code: string, typed: string): Promise<string> {
  const run = setup(code)
  const problem = roomProblem(run.state.rooms.values(), typed)
  if (problem) throw new Error(problem)
  const name = cleanRoomName(typed)
  const slug = name.toLowerCase()
  const room = { id: ROOM_ID_RE.test(slug) && !run.state.rooms.has(slug) ? slug : newRoomId(), name }
  const since = await event(run, `made the room #${room.name}`, { op: "room.create", ...room })
  await roomFolded(() => openedRun(code), room)
  if (run.isOwner) await run.ch.setRooms({ list: roomsAfter(openedRun(code)?.state.rooms.values() ?? run.state.rooms.values(), room), since })
  return room.id
}

export async function renameRoom(code: string, id: string, typed: string): Promise<void> {
  const run = setup(code)
  if (!run.state.rooms.has(id)) throw new Error("that room isn't in this channel")
  const problem = roomProblem(run.state.rooms.values(), typed, id)
  if (problem) throw new Error(problem)
  const room = { id, name: cleanRoomName(typed) }
  const since = await event(run, `renamed a room to #${room.name}`, { op: "room.rename", ...room })
  await roomFolded(() => openedRun(code), room)
  if (run.isOwner) await run.ch.setRooms({ list: roomsAfter(openedRun(code)?.state.rooms.values() ?? run.state.rooms.values(), room), since })
}

export async function answerJoin(code: string, id: string, yes: boolean, choice?: JoinChoice): Promise<void> {
  const run = owner(code)
  const r = run.requests.find((x) => x.id === id)
  if (!r) throw new Error("that request is gone")
  if (!yes) {
    await run.ch.deny(r.id)
    await run.refreshRequests()
    return announce(`Turned ${r.display || r.name} away`)
  }
  if (r.check === "unchecked") {
    await run.ch.checkRequest(r)
    await run.refreshRequests()
    return announce(`Asked ${r.display || r.name} for its code: compare it, then let it in`)
  }
  if (r.check !== "ready" || !r.code) return announce(`Waiting for ${r.display || r.name}'s code`)
  announce(await letIn(run, r, choice ?? {}))
}
