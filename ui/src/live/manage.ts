import "~/i18n/en/live-later"
import { handBackText, heldBy } from "@kiwi/core/handback.ts"
import { NAME_RE, nameKey, type JoinRequest, type Member as RosterMember } from "@kiwi/core/membership.ts"
import { personaOf, personaScopes, type Persona } from "@kiwi/core/personality.ts"
import { pinned } from "@kiwi/core/pin.ts"
import { describeScopes, SCOPES, wireScopes, type Scope } from "@kiwi/core/scopes.ts"
import { secrets } from "@kiwi/secrets/secrets.ts"
import { t } from "~/i18n/i18n"
import { Plain, plainly } from "~/kit/failed"
import { announce } from "~/kit/toasts"
import { newMemberPowers, newMemberScopes } from "~/live/defaults"
import { attempt, event, memberOf, need, owner, personalities, say, setup } from "~/live/run"
import { relayUrl } from "@kiwi/secrets/relay.ts"
import { bridge } from "@kiwi/secrets/secrets.ts"
import { memberName } from "@kiwi/app/format.ts"
import { removeComputer } from "@kiwi/app/computers.ts"
import { loadMember } from "@kiwi/channel/store.ts"
import { inviteLine } from "@kiwi/app/join-line.ts"
import type { Color } from "@kiwi/core/protocol.ts"
import { openedChannel, openedRun, type Run } from "~/live/store"
import type { Actions, JoinChoice, Powers } from "~/model"
import { BRANCH_PREFIX_RE, isLanding, MAX_QUIET_MINUTES, POWERS, quietMinutes, ROOM_ID_RE } from "@kiwi/core/protocol.ts"
import { newRoomId, sponsorsAgent } from "@kiwi/core/state.ts"
import { cleanRoomName, roomProblem, roomsAfter } from "@kiwi/app/rooms.ts"
import { roomProblemWords } from "~/live/room-problem"
import { SENT } from "~/sent"
import { revokedComputer } from "@kiwi/app/forgotten-computers.ts"
import { forgottenComputer } from "@kiwi/core/client/requests.ts"

function agentManager(code: string, name: string): { run: Run; m: RosterMember } {
  const run = need(code)
  const m = memberOf(run, name)
  if (run.isOwner) return { run, m }
  const me = run.state.members.get(run.me)
  if (!me?.active || !me.managesAgents || m.kind !== "agent" || m.owner || m.name === run.me) throw new Error(t("live.manage.agents.manager.only"))
  return { run, m }
}

async function personaFor(r: JoinRequest, choice: JoinChoice): Promise<Persona | null> {
  if (r.kind === "human" || choice.persona === null) return null
  const all = personalities()
  if (choice.persona !== undefined) {
    const p = all.find((x) => x.id === choice.persona)
    if (!p) throw new Error(t("live.manage.personality.missing"))
    return personaOf(p)
  }
  if (!r.pin) return null
  if ("invalid" in r.pin) throw new Error(t("live.manage.pin.failed", { name: r.name }))
  const pin = await pinned(r.pin, all)
  if (!pin) throw new Error(t("live.manage.pin.gone", { name: r.name, persona: r.pin.name }))
  return pin
}

export async function letIn(run: Run, r: JoinRequest, choice: JoinChoice): Promise<string> {
  const name = choice.as?.trim() || r.name
  if (name !== r.name) {
    if (!NAME_RE.test(name)) throw new Error(t("live.manage.bad.name", { name }))
    if (run.roster.some((m) => m.active && m.pk !== r.pk && nameKey(m.name) === nameKey(name))) throw new Error(t("live.manage.name.taken", { name }))
  }
  if (r.computer && (r.computer.revoked || revokedComputer(r.computer.person, r.computer.pk))) throw new Error(forgottenComputer(r.display || r.name, r.computer))
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
  return persona ? t("live.manage.joined.as", { name: r.display || name, persona: persona.name }) : t("live.manage.joined", { name: r.display || name })
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
  const run = need(code)
  if (!run.isOwner && !sponsorsAgent(run.state.members, run.me, name)) throw new Error(t("live.manage.remove.owner.only"))
  const m = memberOf(run, name)
  const held = heldBy(run.state, name)
  const lead = run.state.lead && run.state.lead !== name ? [run.state.lead] : undefined
  if (held.length) await run.send(handBackText(run.state, name, "removed", held), lead ? { to: lead } : {})
  if (run.isOwner) await run.ch.remove(m.pk)
  else await event(run, `removed ${name}`, { op: "member.gone", member: m.name, pk: m.pk })
  await run.refreshRoster()
  announce(t("live.manage.removed", { name: m.display || name }))
}

export async function setAgentColor(code: string, name: string, color: Color | null): Promise<void> {
  const { run } = agentManager(code, name)
  await event(run, color ? `made ${name} ${color}` : `cleared ${name}'s colour`, { op: "color.set", member: name, color })
}

export async function setPersona(code: string, name: string, id: string | null): Promise<void> {
  const { run, m } = agentManager(code, name)
  const p = id === null ? null : personalities().find((x) => x.id === id)
  if (p === undefined) throw new Error(t("live.manage.personality.missing"))
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
  const { run, m } = agentManager(code, name)
  const clean = nickname?.trim() || null
  await event(run, clean ? `called ${name} ${clean}` : `took ${name}'s nickname away`, { op: "nickname.set", member: m.name, pk: m.pk, nickname: clean })
  if (!run.isOwner) return
  await run.ch.updateNickname(m, clean)
  await run.refreshRoster()
}

export async function setPowers(code: string, name: string, powers: Partial<Powers>): Promise<void> {
  const run = owner(code)
  const m = memberOf(run, name)
  for (const power of POWERS) {
    const on = powers[power]
    if (on === undefined || on === !!m[power]) continue
    await event(run, `${on ? "gave" : "took"} ${name} ${on ? "" : "back "}the power to ${SENT.power[power]}`, { op: "power.set", member: name, pk: m.pk, power, on, was: !!m[power] })
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

export async function setSpecsOnly(code: string, on: boolean): Promise<void> {
  await event(owner(code), on ? "turned on Tasks only from approved specs" : "turned off Tasks only from approved specs", { op: "specs.only.set", on })
}

export function freshChannel(code: string): void {
  fresh.add(code)
}

export function takeFresh(code: string): boolean {
  return fresh.delete(code)
}

const fresh = new Set<string>()

export async function setGithubWrite(code: string, on: boolean): Promise<void> {
  await event(owner(code), on ? "turned on Write to GitHub" : "turned off Write to GitHub", { op: "github.write.set", on })
}

export async function setLanding(code: string, typed: string | null): Promise<void> {
  const then = typed?.trim() || null
  if (then !== null && !isLanding(then)) throw new Error(t("live.manage.bad.landing"))
  await event(setup(code), then && then !== "none" ? `tasks land on: ${then}` : "tasks finish on approval", { op: "landing.set", then })
}

export async function setBranchPrefix(code: string, typed: string | null): Promise<void> {
  const prefix = typed?.trim() || null
  if (prefix && !BRANCH_PREFIX_RE.test(prefix)) throw new Error(t("live.manage.bad.branch.prefix"))
  await event(setup(code), prefix ? `branch prefix: ${prefix}` : "cleared the branch prefix", { op: "branch.prefix.set", prefix })
}

export async function setQuiet(code: string, typed: string): Promise<void> {
  const minutes = Number(typed.trim())
  if (!quietMinutes(minutes)) throw new Error(t("live.manage.bad.quiet", { max: String(MAX_QUIET_MINUTES) }))
  await event(setup(code), `quiet time: ${minutes} min`, { op: "quiet.set", minutes })
}

export async function setReviewReset(code: string, on: boolean): Promise<void> {
  await event(owner(code), on ? "reviewers start a fresh session after each verdict" : "reviewers may keep one session", { op: "review.reset.set", on })
}

export async function setResetWaived(code: string, name: string, waived: boolean): Promise<void> {
  await event(owner(code), waived ? `${name} may review from one session` : `${name} starts a fresh session after each verdict`, { op: "review.reset.waive", member: name, waived })
}

export async function setGoal(code: string, goal: string): Promise<void> {
  const run = setup(code)
  const text = goal.trim() || null
  const since = await event(run, text ? `goal: ${text}` : "cleared the goal", { op: "charter.set", text })
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
  throw new Plain(t("live.manage.room.not.back", { room: room.name }))
}

const picks = (run: Run, names: readonly string[]) =>
  names.map((n) => {
    const m = memberOf(run, n)
    return { name: m.name, pk: m.pk, xpk: m.xpk }
  })

const open = (rooms: Iterable<{ id: string; name: string; members?: unknown }>) => [...rooms].filter((r) => !r.members)

const updateFirst = (err: unknown): never => {
  if (/no such call|not a call|unknown call|makeRoom|changeRoom|leaveRoom/i.test(say(err))) throw new Plain(t("live.manage.update.for.rooms"))
  throw err
}

export async function leaveRoom(code: string, id: string): Promise<void> {
  await need(code).ch.leaveRoom(id).catch(updateFirst)
}

export async function addRoom(code: string, typed: string, members?: string[]): Promise<string> {
  const run = plainly(() => setup(code))
  const problem = roomProblem(run.state.rooms.values(), typed)
  if (problem) throw new Plain(roomProblemWords(problem))
  const name = cleanRoomName(typed)
  if (members?.length) {
    const id = await run.ch
      .makeRoom(
        name,
        plainly(() => picks(run, members))
      )
      .catch(updateFirst)
    await roomFolded(() => openedRun(code), { id, name })
    return id
  }
  const slug = name.toLowerCase()
  const room = { id: ROOM_ID_RE.test(slug) && !run.state.rooms.has(slug) ? slug : newRoomId(), name }
  const since = await event(run, `made the room #${room.name}`, { op: "room.create", ...room })
  await roomFolded(() => openedRun(code), room)
  if (run.isOwner) await run.ch.setRooms({ list: roomsAfter(open(openedRun(code)?.state.rooms.values() ?? run.state.rooms.values()), room), since })
  return room.id
}

export async function renameRoom(code: string, id: string, typed: string): Promise<void> {
  const run = setup(code)
  if (!run.state.rooms.has(id)) throw new Error(t("live.manage.room.missing"))
  const problem = roomProblem(run.state.rooms.values(), typed, id)
  if (problem) throw new Error(roomProblemWords(problem))
  const room = { id, name: cleanRoomName(typed) }
  if (run.state.rooms.get(id)?.members) {
    await run.ch.changeRoom(id, { name: room.name }).catch(updateFirst)
    return roomFolded(() => openedRun(code), room)
  }
  const since = await event(run, `renamed a room to #${room.name}`, { op: "room.rename", ...room })
  await roomFolded(() => openedRun(code), room)
  if (run.isOwner) await run.ch.setRooms({ list: roomsAfter(open(openedRun(code)?.state.rooms.values() ?? run.state.rooms.values()), room), since })
}

export async function setRoomMembers(code: string, id: string, members: string[]): Promise<void> {
  const run = setup(code)
  if (!run.state.rooms.get(id)?.members) throw new Error(t("live.manage.not.members.room"))
  await run.ch.changeRoom(id, { members: picks(run, members) }).catch(updateFirst)
}

export async function answerJoin(code: string, id: string, yes: boolean, choice?: JoinChoice): Promise<void> {
  const run = owner(code)
  const r = run.requests.find((x) => x.id === id)
  if (!r) throw new Error(t("live.run.request.gone"))
  if (!yes) {
    await run.ch.deny(r.id)
    await run.refreshRequests()
    return announce(t("live.manage.turned.away", { name: r.display || r.name }))
  }
  if (r.check === "unchecked") {
    await run.ch.checkRequest(r)
    await run.refreshRequests()
    return announce(t("live.manage.asked.code", { name: r.display || r.name }))
  }
  if (r.check !== "ready" || !r.code) return announce(t("live.manage.waiting.code", { name: r.display || r.name }))
  announce(await letIn(run, r, choice ?? {}))
  if (choice?.color) await event(run, `made ${choice.as?.trim() || r.name} ${choice.color}`, { op: "color.set", member: choice.as?.trim() || r.name, color: choice.color })
}

export const exportHistory: Actions["exportHistory"] = async (code, kind) => {
  const run = plainly(() => need(code))
  const b = bridge()
  if (b && !("saveFile" in b)) throw new Plain(t("live.manage.save.needs.update"))
  const [{ checkedState, exportNote, logExport, logFileName, transcript }, history] = await Promise.all([import("@kiwi/app/log-export.ts"), run.ch.history(0)])
  const log = logExport(history)
  const state = await checkedState(history, run.foldFrom, () => run.ch.snapshot().catch(() => null), run.state)
  const at = new Date()
  const title = openedChannel(code)?.title
  const text = kind === "log" ? log.text : transcript({ title, log, state, nameOf: (from) => memberName(state.members.get(from), from), at })
  const name = logFileName(title, at, kind)
  if (b) {
    const saved = await b.saveFile(name, text)
    announce(t("live.manage.saved.downloads", { file: saved }))
  } else {
    const url = URL.createObjectURL(new Blob([text], { type: kind === "log" ? "application/jsonl" : "text/markdown" }))
    const a = document.createElement("a")
    a.href = url
    a.download = name
    a.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
  const note = exportNote(log)
  if (!note.complete) announce(note.text)
}

export const forgetComputer: Actions["forgetComputer"] = (id) =>
  attempt(t("live.manage.forget.failed"), async () => {
    if (id.startsWith("phone:")) {
      const b = bridge()
      if (!b?.forgetPhone) throw new Error(t("live.manage.forget.phone.needs.update"))
      await b.forgetPhone(Number(id.slice("phone:".length)))
      return announce(t("live.manage.forgot.phone"))
    }
    const removed = await removeComputer(id)
    announce(removed.length ? t("live.manage.forgot.removed", { names: removed.join(", ") }) : t("live.manage.forgot"))
  })

export const joinCommand: Actions["joinCommand"] = async (code, as) => {
  if (!loadMember(code)) throw new Error(t("live.run.not.in.channel"))
  const picked = as.persona ? personalities().find((p) => p.id === as.persona) : undefined
  if (as.persona && !picked) throw new Error(t("live.manage.personality.missing"))
  const pin = picked ? await owner(code).ch.pinPersona(picked) : null
  return inviteLine(relayUrl(), code, { ...(as.nick ? { nick: as.nick } : {}), persona: pin })
}
