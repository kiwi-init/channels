import {
  GENERAL_ROOM,
  MAX_CHARTER,
  MAX_NICKNAME,
  MAX_ROOMS,
  MAX_TAGS,
  PROOF_MAX,
  TASK_TITLE_MAX_LENGTH,
  type Event,
  hasLanding,
  type KeptEvidence,
  type Landing,
  type Message,
  type Power,
  powerChange,
} from "../protocol.ts";
import { free, take } from "./leases.ts";
import { unnamedTasks } from "./compact.ts";
import { leadCheckpointKeyRefusal } from "./lead.ts";
import { addRelease, applyGithub, dropRelease, prKey, repoKey, type GithubPr, type GithubState } from "./github.ts";
import { branchLinks, prLinks, prOfTask } from "../prs.ts";
import { recordedRuns } from "../review-check.ts";
import { approvedAt, sameHead } from "../stage.ts";
import { reposOf } from "./repos.ts";
import { trustedAt } from "./times.ts";
import { runPin } from "../checks.ts";
import { advance, artifactWords, editSteps, hasOpenSteps, landedRefusal, observedRefusal, reseedThen, say, see, seeAnswered, seedSteps, seeThenSteps, stepEditRefusal } from "./landing-steps.ts";
import { landedStepRefusal, stepById, stepsOfThen, stepText, thenChanged, type StepSpec } from "../steps.ts";
import { omit } from "../omit.ts";
import { inlineText } from "../membership.ts";
import { readScopes, SCOPES, type Scope } from "../scopes.ts";
import { cleanPersona } from "../personality.ts";
import { isPerson, ownSeat, sponsorsAgent } from "./people.ts";
import { roomName } from "./rooms.ts";
import {
  currentState,
  landerOf,
  landingRefusal,
  landingReopens,
  newRun,
  openRound,
  reviewClaimRefusal,
  reviewMoveRefusal,
  reviewerTitle,
  reviewWaysOut,
  revisedOut,
  runRefusal,
  taskId,
  verdictRefusal,
  worked,
} from "./tasks.ts";
import { addResetRefusal, clearOnCard, markReset, resetRefusal } from "./reset.ts";
import type { Charter, Compact, Fact, FoldMember, Hold, Lease, Nickname, PersonaLead, Room, SecretRoom, Task } from "./types.ts";
import { dmPair, inRoom, leaveSeal, rootOf, selfOnly, type RoomMember } from "../room-rules.ts";

const trustOnly = (what: string): string => `only the owner, or a person they fully trust, ${what}`;

const managesAgent = (holds: boolean, by: FoldMember, target: FoldMember | undefined): boolean =>
  holds && !by.owner && by.kind === "human" && !!target && target.kind === "agent" && !target.owner && target.name !== by.name;

export interface FoldCtx {
  members: Map<string, FoldMember>;
  signed: ReadonlySet<string>;
  personaLead: Map<string, PersonaLead>;
  held: (pk: string, power: Power) => boolean;
  trusted: (pk: string, member: FoldMember) => boolean;
  powers: Map<string, Partial<Record<Power, boolean>>>;
  leads: (member: FoldMember) => boolean;
  keysByName: Map<string, Set<string>>;
  scopesByKey: Map<string, Scope[]>;
  scopeSets: Map<string, { seq: number; scopes: Scope[] }>;
  roleSets: Map<string, { seq: number; role: string | null; about?: string | null }>;
  gone: Map<string, number>;
  nicknames: Map<string, Nickname>;
  setRole: (target: FoldMember, role: string | null, about: string | null | undefined) => void;
  tasks: Map<number, Task>;
  facts: Map<string, Fact>;
  docs: Map<string, string>;
  leases: Map<string, Lease>;
  rooms: Map<string, Room>;
  secret: Map<string, SecretRoom>;
  roomsSince: number;
  nameTaken: (name: string, except?: string) => boolean;
  charter: Charter | null;
  repos: string[];
  github: GithubState;
  hold: Hold | null;
  githubWrite: number | null;
  branchPrefix: string | null;
  quietMs: number;
  reviewReset: boolean;
  landing: Landing | null;
  landingSteps: StepSpec[] | null;
  passedAsks: Map<number, string>;
  compact: Compact | null;
  compactProposal: Compact | null;
}

function approvalHoldsAgain(t: Task, head: string, mark: { seq: number; by: string; at: number }): void {
  const last = t.rounds.at(-1);
  if (t.state !== "review" || last?.result.kind !== "approved" || last.stale === undefined || !approvedAt(last, head)) return;
  last.stale = undefined;
  t.state = "landing";
  t.approvedBy = last.result.by;
  t.notes.push({ seq: mark.seq, by: mark.by, ts: mark.at, text: `head ${head.slice(0, 7)} is the approved code: the approval holds again` });
  t.updatedAt = mark.at;
  advance(t, mark);
}

function headMoved(t: Task, pr: GithubPr & { sha: string }, mark: { seq: number; by: string; at: number }): void {
  const last = t.rounds.at(-1);
  if (last?.result.kind !== "approved" || !last.at) return;
  if (approvedAt(last, pr.sha)) return approvalHoldsAgain(t, pr.sha, mark);
  if (t.state !== "landing") return;
  last.stale = mark.seq;
  t.state = "review";
  t.approvedBy = undefined;
  t.notes.push({ seq: mark.seq, by: mark.by, ts: mark.at, text: `new head ${pr.sha.slice(0, 7)} on ${pr.repo}#${pr.number} after the approval: back to review` });
  t.updatedAt = mark.at;
}

function keptRefusal(task: Task, kept: KeptEvidence, from: string, lead: boolean): string | null {
  const id = taskId(task.id);
  const last = task.rounds.at(-1);
  if (from !== task.owner && !lead) return `only ${task.owner ?? "its owner"} or the lead records that ${id}'s approval holds at a new head`;
  if (last?.result.kind !== "approved" || !last.at) return `${id} has no approval pinned to a commit`;
  if (!sameHead(last.at, kept.approved)) return `${id} is approved at ${last.at.slice(0, 7)}, not at ${kept.approved.slice(0, 7)}`;
  return null;
}

function keepApproval(c: FoldCtx, task: Task, kept: KeptEvidence, mark: { seq: number; by: string; at: number; rts?: number }): void {
  const last = task.rounds.at(-1);
  if (!last) return;
  if (!last.kept?.some((k) => k.head === kept.head)) {
    last.kept = [...(last.kept ?? []), { ...kept, seq: mark.seq, by: mark.by, ...(mark.rts !== undefined ? { rts: mark.rts } : {}) }];
    const words = kept.how === "same-tree" ? "the same tree as" : `a clean merge of ${kept.ref} into`;
    task.notes.push({ seq: mark.seq, by: mark.by, ts: mark.at, text: `${kept.head.slice(0, 7)} is ${words} the approved ${kept.approved.slice(0, 7)}: the approval holds` });
    task.updatedAt = mark.at;
  }
  const pr = prOfTask(c.github, c.branchPrefix, task);
  if (pr?.sha && pr.state === "open") approvalHoldsAgain(task, pr.sha, mark);
}

function membersOnly(c: FoldCtx, member: FoldMember, m: Message, ev: { members: RoomMember[]; dm?: true; self?: true }, known: Room | undefined): string | null {
  const trusted = member.owner || c.trusted(m.pk ?? "", member);
  if (ev.dm && !dmPair(ev, member.name, c.members)) return "a direct message's room is between exactly two people";
  if (ev.self && !selfOnly(ev, member.name, c.members)) return "a person's own room holds only that person's devices";
  if (!ev.dm && !ev.self && !trusted) return trustOnly("makes members-only rooms");
  if (known?.dm && !ev.dm) return "a direct message's room stays one";
  if (known?.self && !ev.self) return "a person's own room stays theirs";
  if (known && !known.dm && ev.dm) return "a room can't become a direct message";
  if (known && !known.self && ev.self) return "a room can't become a person's own";
  if (known?.members && (known.dm || known.self) && !inRoom(known as { members: RoomMember[] }, member.name, m.pk)) return "only its members change a direct message or a person's own room";
  if (!inRoom(ev, member.name, m.pk)) return "whoever changes a members-only room stays in it";
  return null;
}

const departed = (c: FoldCtx, name: string): boolean => {
  const owner = c.members.get(name);
  return !!owner && !owner.owner && c.gone.has(owner.pk);
};

const runsOf = (runs: number[]): { runs?: number[] } => (runs.length ? { runs } : {});

function runsAtHead(c: FoldCtx, t: Task, at: string | undefined): number[] {
  const repo = at ? prOfTask(c.github, c.branchPrefix, t)?.repo : undefined;
  return repo && at ? recordedRuns(c.github, repo, at) : [];
}

export function applyEvent(c: FoldCtx, m: Message, ev: Event, member: FoldMember, at: number, reject: (why: string) => void): void {
  const { members, keysByName, scopesByKey, scopeSets, roleSets, setRole, tasks, facts, rooms, roomsSince, nameTaken } = c;
  switch (ev.op) {
    case "hello": {
      if (member.owner) {
        if (ev.role !== undefined) member.role = ev.role || undefined;
        if (ev.about !== undefined) member.about = ev.about || undefined;
      }
      break;
    }

    case "room.create": {
      if (ev.members) {
        const kept = membersOnly(c, member, m, { members: ev.members, ...(ev.dm ? { dm: ev.dm } : {}), ...(ev.self ? { self: ev.self } : {}) }, undefined);
        if (kept) reject(kept);
        else if (ev.id === GENERAL_ROOM || rooms.has(ev.id) || c.secret.has(ev.id)) reject(`there's already a room ${ev.id}`);
        else
          rooms.set(ev.id, {
            id: ev.id,
            name: ev.dm || ev.self ? "" : (roomName(ev.name) ?? ""),
            createdBy: m.from,
            at,
            members: ev.members,
            ...(ev.dm ? { dm: true as const } : {}),
            ...(ev.self ? { self: true as const } : {}),
          });
        break;
      }
      if (!member.owner && !c.trusted(m.pk ?? "", member)) {
        reject(trustOnly("makes rooms"));
        break;
      }
      const known = rooms.get(ev.id);
      if (known && m.seq <= roomsSince) {
        if (!known.createdBy) Object.assign(known, { createdBy: m.from, at });
        break;
      }
      const name = roomName(ev.name);
      if (ev.id === GENERAL_ROOM || known) reject(`there's already a room ${ev.id}`);
      else if (!name) reject("a room needs a name");
      else if (nameTaken(name)) reject(`a room is already called ${name}`);
      else if ([...rooms.values()].filter((r) => !r.members).length >= MAX_ROOMS) reject(`a channel holds at most ${MAX_ROOMS} rooms`);
      else rooms.set(ev.id, { id: ev.id, name, createdBy: m.from, at });
      break;
    }

    case "room.members": {
      const known = rooms.get(ev.id);
      if (ev.id === GENERAL_ROOM || (known && !known.members)) {
        reject("a room everyone is sent can't become members-only");
        break;
      }
      const kept = membersOnly(c, member, m, ev, known);
      if (kept) reject(kept);
      else
        rooms.set(ev.id, {
          ...(known ?? { id: ev.id, name: ev.dm || ev.self ? "" : (roomName(ev.name) ?? ""), createdBy: m.from, at }),
          members: ev.members,
          ...(ev.dm ? { dm: true as const } : {}),
          ...(ev.self ? { self: true as const } : {}),
        });
      break;
    }

    case "member.gone": {
      if (!member.owner && m.pk !== ev.pk && !sponsorsAgent(members, m.from, ev.member) && !ownSeat(members, m.from, ev.member))
        reject("only the owner, the key itself, or the person it belongs to says a key is gone");
      else if (!c.keysByName.get(ev.member)?.has(ev.pk)) reject(`that key isn't one of ${ev.member}'s`);
      else if (!c.gone.has(ev.pk)) c.gone.set(ev.pk, m.seq);
      break;
    }

    case "member.back": {
      if (!member.owner) reject("only the owner lets a removed key back in");
      else if (!c.keysByName.get(ev.member)?.has(ev.pk)) reject(`that key isn't one of ${ev.member}'s`);
      else c.gone.delete(ev.pk);
      break;
    }

    case "room.seal": {
      const known = c.secret.get(ev.id);
      const opened = m.opened;
      const trusted = member.owner || c.trusted(m.pk ?? "", member);
      const wasDm = known?.meta?.dm === true;
      if (!trusted && !opened && !known?.meta) {
        if (ev.id !== GENERAL_ROOM && !rooms.has(ev.id))
          c.secret.set(ev.id, { n: known ? known.n : ev.n, seals: [...(known?.seals ?? []), { id: ev.id, n: ev.n, keys: ev.keys, meta: ev.meta, ...(ev.proof ? { proof: ev.proof } : {}) }] });
        break;
      }
      const isDm = opened?.dm === true;
      const isSelf = opened?.self === true;
      const wasSelf = known?.meta?.self === true;
      if (isDm && opened && !dmPair(opened, member.name, c.members)) reject("a direct message's room is between exactly two people");
      else if (isSelf && opened && !selfOnly(opened, member.name, c.members)) reject("a person's own room holds only that person's devices");
      else if (!trusted && !isDm && !isSelf && !((wasDm || wasSelf) && !opened && m.proven) && !(opened && m.proven && leaveSeal(known, opened, ev.n, c.members)))
        reject(trustOnly("makes members-only rooms"));
      else if (wasDm && opened && !isDm) reject("a direct message's room stays one");
      else if (wasSelf && opened && !isSelf) reject("a person's own room stays theirs");
      else if (isDm && known?.meta && !wasDm) reject("a room can't become a direct message");
      else if (isSelf && known?.meta && !wasSelf) reject("a room can't become a person's own");
      else if (m.proven === false || (known?.meta && !m.proven)) reject("that change to a members-only room doesn't hold the room's key");
      else if (!known && (ev.id === GENERAL_ROOM || rooms.has(ev.id))) reject(`there's already a room ${ev.id}`);
      else if (opened && !inRoom(opened, member.name, m.pk)) reject("whoever changes a members-only room stays in it");
      else {
        const seals = [...(known?.seals ?? []), { id: ev.id, n: ev.n, keys: ev.keys, meta: ev.meta, ...(ev.proof ? { proof: ev.proof } : {}) }];
        const n = m.proven || !known ? ev.n : known.n;
        const meta = opened ?? (!m.proven ? known?.meta : undefined);
        const leaving = known?.leaving?.filter((who) => meta?.members.some((x) => rootOf(x.name, c.members) === who));
        c.secret.set(ev.id, { n, seals, ...(meta ? { meta } : {}), ...(leaving?.length ? { leaving } : {}) });
        if (opened)
          rooms.set(ev.id, {
            ...(rooms.get(ev.id) ?? { id: ev.id, createdBy: m.from, at }),
            name: opened.name,
            members: opened.members,
            ...(opened.dm ? { dm: true as const } : {}),
            ...(opened.self ? { self: true as const } : {}),
          });
        else if (m.proven) rooms.delete(ev.id);
      }
      break;
    }

    case "room.msg":
      reject("a members-only room's sealed message this app couldn't open");
      break;

    case "room.leave": {
      const room = rooms.get(ev.id);
      const who = rootOf(m.from, c.members);
      if (!room?.members || !room.members.some((x) => rootOf(x.name, c.members) === who)) reject("a person leaves a members-only room they're in");
      else if (room.dm || room.self) reject("a direct message or a person's own room has nobody to leave to");
      else room.members = room.members.filter((x) => rootOf(x.name, c.members) !== who);
      break;
    }

    case "room.rename": {
      if (!member.owner && !c.trusted(m.pk ?? "", member)) {
        reject(trustOnly("names rooms"));
        break;
      }
      const room = rooms.get(ev.id);
      const name = roomName(ev.name);
      if (!room) reject(`no room ${ev.id}`);
      else if (m.seq <= roomsSince) break;
      else if (!name) reject("a room needs a name");
      else if (nameTaken(name, room.id)) reject(`a room is already called ${name}`);
      else room.name = name;
      break;
    }

    case "mode.set":
      break;

    case "charter.set": {
      if (!member.owner && !c.trusted(m.pk ?? "", member)) {
        reject(trustOnly("sets the channel's goal"));
        break;
      }
      const text = ev.text?.trim().slice(0, MAX_CHARTER);
      c.charter = text ? { text, by: m.from, at } : null;
      break;
    }

    case "compact.propose":
    case "compact": {
      const since = c.compact?.through ?? 0;
      const missing = unnamedTasks(ev.summary, tasks.values());
      if (ev.op === "compact" && !member.owner) reject("only the owner compacts the history");
      else if (ev.through >= m.seq || ev.through <= since) reject(`a compact folds history after #${since} and before itself`);
      else if (missing.length) reject(`the summary leaves out open ${missing.map((id) => `T${id}`).join(", ")}`);
      else if (ev.op === "compact.propose") c.compactProposal = { summary: ev.summary, through: ev.through, by: m.from, at, seq: m.seq };
      else {
        c.compact = { summary: ev.summary, through: ev.through, by: m.from, at, seq: m.seq };
        c.compactProposal = null;
        for (const t of tasks.values()) if (t.state === "done") t.archived = true;
      }
      break;
    }

    case "github": {
      if (!member.owner) {
        reject("only the owner's app posts GitHub's news");
        break;
      }
      const heads = new Map([...c.github.prs].map(([key, pr]) => [key, pr.sha]));
      applyGithub(c.github, ev.items, m.seq);
      for (const [key, pr] of c.github.prs) {
        if (!pr.sha || pr.state !== "open" || heads.get(key) === pr.sha) continue;
        const moved = { ...pr, sha: pr.sha };
        for (const t of tasks.values()) {
          const linked = branchLinks(pr, c.branchPrefix, t) || !!t.proof?.some((p) => prLinks(p.url).some((l) => prKey(l.repo, l.number) === key));
          if (linked) headMoved(t, moved, { seq: m.seq, by: m.from, at });
        }
      }
      break;
    }

    case "github.rules": {
      if (!member.owner) {
        reject("only the owner's app posts a repo's merge rules");
        break;
      }
      c.github.rules.set(repoKey(ev.repo), { repo: ev.repo, branch: ev.branch, required: [...new Set(ev.required)], merge: [...new Set(ev.merge)], seq: m.seq });
      break;
    }

    case "github.release": {
      if (!member.owner) {
        reject("only the owner's app posts a repo's releases");
        break;
      }
      if (ev.gone) dropRelease(c.github, ev.repo, ev.tag);
      else addRelease(c.github, { repo: ev.repo, tag: ev.tag, at: ev.at, shas: ev.shas, prs: ev.prs, seq: m.seq });
      break;
    }

    case "repos.set": {
      if (!member.owner && !c.trusted(m.pk ?? "", member)) {
        reject(trustOnly("sets the channel's repos"));
        break;
      }
      c.repos = reposOf(ev.repos);
      break;
    }

    case "hold.set": {
      if (!member.owner) {
        reject("only the owner puts the channel on hold");
        break;
      }
      c.hold = ev.on ? { ...(ev.note?.trim() ? { note: ev.note.trim().slice(0, 500) } : {}), by: m.from, at } : null;
      break;
    }

    case "voice.set":
      if (!member.owner) reject("only the owner allows voice in the channel");
      break;

    case "github.write.set": {
      if (!member.owner) {
        reject("only the owner lets Kiwi write to GitHub");
        break;
      }
      c.githubWrite = ev.on ? (c.githubWrite ?? m.seq) : null;
      break;
    }

    case "branch.prefix.set": {
      if (!member.owner && !c.trusted(m.pk ?? "", member)) {
        reject(trustOnly("sets the branch prefix"));
        break;
      }
      c.branchPrefix = ev.prefix;
      break;
    }

    case "quiet.set": {
      if (!member.owner && !c.trusted(m.pk ?? "", member)) {
        reject(trustOnly("sets how long a task may stay quiet"));
        break;
      }
      c.quietMs = ev.minutes * 60_000;
      break;
    }

    case "merges.set":
      break;

    case "review.reset.set": {
      if (!member.owner) {
        reject("only the owner turns the fresh-session rule for reviewers on or off");
        break;
      }
      c.reviewReset = ev.on;
      if (!ev.on) for (const x of members.values()) if (x.reset?.kind === "needs") x.reset = undefined;
      break;
    }

    case "review.reset.waive": {
      const target = members.get(ev.member);
      if (!target?.active) reject(`no member named ${ev.member}`);
      else if (!member.owner) reject("only the owner waives the fresh-session rule for a reviewer");
      else if (ev.waived) target.reset = { kind: "waived" };
      else if (target.reset?.kind === "waived") target.reset = undefined;
      break;
    }

    case "landing.set": {
      if (!member.owner && !c.trusted(m.pk ?? "", member)) {
        reject(trustOnly("sets how tasks land"));
        break;
      }
      c.landing = ev.then;
      c.landingSteps = ev.steps ?? null;
      break;
    }

    case "role.set":
    case "role.refuse": {
      const target = members.get(ev.member);
      if (!member.owner && !managesAgent(c.held(m.pk ?? "", "managesAgents"), member, target)) {
        reject("only the owner, or a person who manages agents, decides an agent's role");
        break;
      }
      if (!target) {
        reject(`no member named ${ev.member}`);
        break;
      }
      if (ev.op === "role.set") {
        setRole(target, ev.role, ev.about);
        roleSets.set(target.name, { seq: m.seq, role: ev.role, ...(ev.about !== undefined ? { about: ev.about } : {}) });
      }
      break;
    }

    case "scope.set": {
      if (!member.owner && !managesAgent(c.held(m.pk ?? "", "managesAgents"), member, members.get(ev.member))) {
        reject("only the owner, or a person who manages agents, sets what an agent may do");
        break;
      }
      if (!keysByName.get(ev.member)?.has(ev.pk)) {
        reject(members.has(ev.member) ? `that key isn't ${ev.member}'s` : `no member named ${ev.member}`);
        break;
      }
      if (members.get(ev.member)?.owner) {
        reject("the owner may do everything");
        break;
      }
      const scopes = ev.scopes === null ? [...SCOPES] : (readScopes(ev.scopes) ?? []);
      scopesByKey.set(ev.pk, scopes);
      scopeSets.set(ev.pk, { seq: m.seq, scopes, ...(ev.persona !== undefined ? { persona: ev.persona === null ? null : cleanPersona(ev.persona) } : {}) });
      if (ev.lead !== undefined) c.personaLead.set(ev.member, ev.lead);
      else if (!ev.keepLead) c.personaLead.set(ev.member, "roster");
      break;
    }

    case "power.set": {
      const target = members.get(ev.member);
      if (!member.owner) reject("only the owner gives or takes a power");
      else if (!target || !keysByName.get(ev.member)?.has(ev.pk)) reject(target ? `that key isn't ${ev.member}'s` : `no member named ${ev.member}`);
      else if (target.owner || target.kind !== "human") reject("only a person holds a power");
      else {
        const { power, on } = powerChange(ev);
        c.powers.set(ev.pk, { ...c.powers.get(ev.pk), [power]: on });
        members.set(ev.member, on ? { ...target, [power]: true } : omit(target, power));
      }
      break;
    }

    case "seat.reclaim":
      if (!member.owner) reject("only the owner moves a seat to a new key");
      else if (!members.has(ev.member)) reject(`no member named ${ev.member}`);
      break;

    case "color.set": {
      const target = members.get(ev.member);
      if (!target?.active) reject(`no member named ${ev.member}`);
      else if (!isPerson(target)) {
        if (!member.owner && !managesAgent(c.held(m.pk ?? "", "managesAgents"), member, target)) reject("only the owner, or a person who manages agents, sets an agent's colour");
        else target.color = ev.color ?? undefined;
      } else if (ev.member !== m.from && !member.owner) reject("only that person or the owner sets a colour");
      else {
        const holder = ev.color && [...members.values()].find((x) => x.active && x.name !== target.name && isPerson(x) && x.color === ev.color);
        if (holder) reject(`${ev.color} is ${holder.name}'s colour`);
        else target.color = ev.color ?? undefined;
      }
      break;
    }

    case "nickname.set": {
      const target = members.get(ev.member);
      if (!member.owner && !managesAgent(c.held(m.pk ?? "", "managesAgents"), member, target)) reject("only the owner, or a person who manages agents, names an agent");
      else if (!target || !keysByName.get(ev.member)?.has(ev.pk)) reject(target ? `that key isn't ${ev.member}'s` : `no member named ${ev.member}`);
      else if (isPerson(target)) reject("only an agent's nickname is changed this way");
      else {
        const nickname = inlineText(ev.nickname ?? "", MAX_NICKNAME) || null;
        c.nicknames.set(ev.pk, { seq: m.seq, nickname });
        if (target.pk === ev.pk) target.display = nickname ?? undefined;
      }
      break;
    }

    case "picture.set": {
      const target = members.get(ev.member);
      if (!target?.active) reject(`no member named ${ev.member}`);
      else if (ev.member !== m.from) reject("only that person sets their picture");
      else if (!isPerson(target)) reject("agents wear their character; they don't have a picture");
      else target.picture = ev.picture ?? undefined;
      break;
    }

    case "task.add": {
      const addWrong = addResetRefusal(members, ev.review);
      if (addWrong) {
        reject(addWrong);
        break;
      }
      const then = ev.steps ? undefined : (ev.then ?? (c.landingSteps ? undefined : (c.landing ?? undefined)));
      const added: Task = {
        id: m.seq,
        title: String(ev.title).slice(0, TASK_TITLE_MAX_LENGTH),
        detail: ev.detail,
        state: "todo",
        owner: ev.owner || undefined,
        createdBy: m.from,
        createdAt: at,
        ...(m.rts !== undefined ? { createdRts: m.rts } : {}),
        updatedAt: at,
        notes: [],
        ...(ev.review?.trim() ? { review: ev.review.trim() } : {}),
        ...(ev.issue ? { issue: { repo: ev.issue.repo, number: ev.issue.number } } : {}),
        ...(ev.from !== undefined && tasks.has(ev.from) ? { from: ev.from } : {}),
        workedBy: ev.owner ? [ev.owner] : [],
        rounds: [],
        ...(m.re?.length ? { source: m.re[0] } : {}),
        ...(ev.lander?.trim() ? { lander: ev.lander.trim() } : {}),
      };
      if (ev.steps) seedSteps(added, ev.steps);
      else if (then && hasLanding(then)) seedSteps(added, stepsOfThen(then), "then");
      else if (ev.then === undefined && c.landingSteps) seedSteps(added, c.landingSteps);
      seeAnswered(added, c.passedAsks, { seq: m.seq, by: m.from, at });
      tasks.set(m.seq, added);
      break;
    }

    case "card": {
      const card = omit(ev, "op");
      member.card = { ...card, ...(card.tools ? { tools: normTags(card.tools) } : {}), at };
      clearOnCard(member, card.session);
      break;
    }

    case "task.claim": {
      const task = tasks.get(ev.task);
      if (!task) reject(`no task ${taskId(ev.task)}`);
      else if (task.state === "done") reject(`${taskId(task.id)} is already done`);
      else if (task.state === "landing") reject(`${taskId(task.id)} is approved: its lander lands it`);
      else if (task.owner && task.owner !== m.from && !departed(c, task.owner)) reject(`${taskId(task.id)} is owned by ${task.owner}`);
      else {
        task.owner = m.from;
        if (task.state === "todo") task.state = "doing";
        task.updatedAt = at;
        worked(task, m.from);
      }
      break;
    }

    case "task.delete": {
      const task = tasks.get(ev.task);
      if (!task) reject(`no task ${taskId(ev.task)}`);
      else if (!isPerson(member) && !c.leads(member)) reject(`only a person or the lead deletes ${taskId(task.id)}`);
      else tasks.delete(task.id);
      break;
    }

    case "task.nudge":
    case "task.wake":
      break;

    case "task.first": {
      const task = tasks.get(ev.task);
      if (!task) reject(`no task ${taskId(ev.task)}`);
      else if (task.state === "done") reject(`${taskId(task.id)} is already done`);
      else if (!task.owner) reject(`${taskId(task.id)} has no owner to go first for`);
      else task.first = m.seq;
      break;
    }

    case "task.landed": {
      const task = tasks.get(ev.task);
      if (!task) {
        reject(`no task ${taskId(ev.task)}`);
        break;
      }
      const mark = { seq: m.seq, by: m.from, at };
      if ("step" in ev) {
        const step = stepById(task, ev.step);
        const wrong = step && ev.artifact ? null : landedStepRefusal(task, ev.step);
        if (wrong || !step) {
          reject(wrong ?? `${taskId(task.id)} has no step ${ev.step}`);
          break;
        }
        if (step.progress.kind === "ended") break;
        const trusted = isPerson(member) || c.leads(member);
        const mover = step.by ?? landerOf(task);
        if (!trusted && m.from !== mover) {
          reject(`only ${mover ?? "its lander"}, the lead or a person ends step ${stepText(step)} of ${taskId(task.id)}`);
          break;
        }
        if (ev.artifact) {
          const unseen = observedRefusal({ github: c.github, prOf: (t) => prOfTask(c.github, c.branchPrefix, t) }, task, step, ev.artifact);
          if (unseen) reject(unseen);
          else see(task, step, mark, artifactWords(ev.artifact), ev.artifact.kind === "pr" ? prOfTask(c.github, c.branchPrefix, task)?.mergedAt : undefined);
          break;
        }
        if (task.state !== "landing") {
          reject(`${taskId(task.id)} isn't approved and landing: it's ${task.state}`);
          break;
        }
        say(task, step, mark, { ...(ev.link ? { link: ev.link } : {}), ...(ev.note ? { note: ev.note.trim() } : {}) });
        break;
      }
      if (task.state === "done") break;
      const lander = landerOf(task);
      const why =
        !member.owner && !c.leads(member) && m.from !== lander
          ? `only the owner's app, the lead or ${lander ?? "its lander"} lands ${taskId(task.id)}`
          : landedRefusal({ github: c.github, prOf: (t) => prOfTask(c.github, c.branchPrefix, t) }, task, ev.artifact);
      if (why) {
        reject(why);
        break;
      }
      task.updatedAt = at;
      task.notes.push({ seq: m.seq, by: m.from, ts: at, text: `landed: ${artifactWords(ev.artifact)}` });
      seeThenSteps(task, mark, artifactWords(ev.artifact));
      advance(task, mark);
      break;
    }

    case "task.steps": {
      const task = tasks.get(ev.task);
      if (!task) {
        reject(`no task ${taskId(ev.task)}`);
        break;
      }
      const refused = stepEditRefusal(task, ev.edit, { name: m.from, person: isPerson(member), lead: c.leads(member) });
      if (refused) reject(refused);
      else {
        editSteps(task, ev.edit, { seq: m.seq, by: m.from, at });
        seeAnswered(task, c.passedAsks, { seq: m.seq, by: m.from, at });
      }
      break;
    }

    case "task.update": {
      const task = tasks.get(ev.task);
      if (!task) {
        reject(`no task ${taskId(ev.task)}`);
        break;
      }
      const lead = c.leads(member);
      const reviewRefused = ev.claim ? reviewClaimRefusal(task, m.from, ev.review) : reviewMoveRefusal(task, { name: m.from, person: isPerson(member), lead }, ev.review);
      if (reviewRefused) {
        reject(reviewRefused);
        break;
      }
      if (ev.detail !== undefined && !isPerson(member) && !lead) {
        reject(`only a person or the lead rewrites ${taskId(task.id)}'s body`);
        break;
      }
      const review = ev.review === undefined ? task.review : ev.review?.trim() || undefined;
      const owner = ev.owner === undefined ? task.owner : ev.owner || undefined;
      const mayFinish = !review || isPerson(member) || (review === "*" ? m.from !== owner && !task.workedBy.includes(m.from) : m.from === review);
      if (ev.state === "done" && ev.close === undefined && task.state !== "done" && !mayFinish) {
        const open = openRound(task);
        reject(`${taskId(task.id)} needs review by ${reviewerTitle(review)} before it's done${open ? `: ${reviewWaysOut(task.id, review, open.n)}` : " (send it for review)"}`);
        break;
      }
      const landingWrong = landingRefusal(task, ev, { person: isPerson(member), lead });
      if (landingWrong) {
        reject(landingWrong);
        break;
      }
      const open = openRound(task);
      const verdictWrong = ev.verdict ? verdictRefusal(task, ev.verdict, ev, mayFinish, open) : null;
      if (verdictWrong) {
        reject(verdictWrong);
        break;
      }
      const keptWrong = ev.kept ? keptRefusal(task, ev.kept, m.from, lead) : null;
      if (keptWrong) {
        reject(keptWrong);
        break;
      }
      const runWrong = runRefusal(ev.run, trustedAt(m));
      if (runWrong) {
        reject(runWrong);
        break;
      }
      if (ev.state === "landing" && !mayFinish) {
        reject(`${taskId(task.id)} needs review by ${reviewerTitle(review)} before it lands`);
        break;
      }
      const reopens = landingReopens(task, ev);
      const cancel = ev.state === "cancelled" && task.state !== "done";
      const lands = ev.verdict === "approved" && hasOpenSteps(task);
      const asked =
        ev.state === "cancelled" ? (cancel && (mayFinish || lead || (ev.round !== undefined && revisedOut(task, m.from, open) === ev.round)) ? "done" : undefined) : ev.state && currentState(ev.state);
      const state = reopens ? "review" : lands && asked === "done" ? "landing" : asked;
      const judging = !!ev.verdict || (!!review && !!open && !cancel && ev.close === undefined && (state === "done" || state === "landing"));
      const resetWrong = resetRefusal(members, task, { ...ev, judging }, m.from, review, state);
      if (resetWrong) {
        reject(resetWrong);
        break;
      }
      const happened = trustedAt(m);
      const rts = happened !== undefined ? { rts: happened } : {};
      if (open && state && state !== "review")
        open.result =
          ev.verdict && mayFinish
            ? { kind: ev.verdict, by: m.from, seq: m.seq, ts: at, ...rts, ...(ev.verdict === "approved" ? runsOf(ev.runs ?? runsAtHead(c, task, open.at)) : {}) }
            : state === "done" && !cancel && ev.close === undefined
              ? { kind: "approved", by: m.from, seq: m.seq, ts: at, ...rts }
              : { kind: "withdrawn", seq: m.seq };
      const judge = review ? mayFinish : isPerson(member) || lead;
      if (!open && lands && state === "landing" && judge) {
        const linked = prOfTask(c.github, c.branchPrefix, task);
        const head = ev.at?.trim() || (linked?.state === "open" ? linked.sha : undefined);
        task.rounds.push({
          n: (task.rounds.at(-1)?.n ?? 0) + 1,
          ...(head ? { at: head } : {}),
          by: m.from,
          seq: m.seq,
          ts: at,
          ...rts,
          result: { kind: "approved", by: m.from, seq: m.seq, ts: at, ...rts, ...(head ? runsOf(ev.runs ?? runsAtHead(c, task, head)) : {}) },
        });
      }
      if (state === "review") {
        if (open) open.result = { kind: "withdrawn", seq: m.seq };
        const head = reopens ? (ev.run && newRun(task, ev.run) ? runPin(ev.run.id) : task.rounds.at(-1)?.at) : ev.at?.trim();
        task.rounds.push({
          n: (task.rounds.at(-1)?.n ?? 0) + 1,
          ...(head ? { at: head } : {}),
          ...(ev.summary ? { summary: ev.summary.trim() } : {}),
          by: m.from,
          seq: m.seq,
          ts: at,
          ...rts,
          result: { kind: "open" },
        });
      }
      const note = ev.note || ev.close?.trim() || (ev.state === "blocked" ? "blocked" : ev.state === "cancelled" ? "cancelled" : reopens ? "changed how it lands: back to review" : undefined);
      const settled = (s: string) => s === "done" || s === "landing";
      if (ev.review !== undefined) task.review = review;
      if (ev.then !== undefined && thenChanged(task, ev.then)) reseedThen(task, ev.then);
      if (ev.lander !== undefined) task.lander = ev.lander?.trim() || undefined;
      if (ev.verdict === "approved" && state && settled(state) && task.review) task.approvedBy = m.from;
      if (ev.state === "done" && ev.verdict === undefined && ev.close === undefined && task.state !== "done" && task.review) task.approvedBy = m.from;
      if (state && !settled(state)) task.approvedBy = undefined;
      if (state === "done" && task.state !== "done") task.cancelled = ev.state === "cancelled" || undefined;
      if (state && state !== "done") task.cancelled = undefined;
      if (state === "done" && task.state !== "done") task.closedWith = ev.close?.trim() || undefined;
      if (state && state !== "done") task.closedWith = undefined;
      if (state === "done" && task.state !== "done") task.closedSeq = m.seq;
      if (state && state !== "done") task.closedSeq = undefined;
      if (ev.owner !== undefined) {
        const next = ev.owner || undefined;
        if (task.owner && next !== task.owner) task.handedOff = { seq: m.seq, from: task.owner };
        if (next !== task.owner) task.first = undefined;
        task.owner = next;
      }
      if (ev.owner) worked(task, ev.owner);
      if (state && !settled(state) && (m.from === task.owner || state === "review")) worked(task, m.from);
      if (state) task.state = state;
      if (ev.title) task.title = ev.title.slice(0, TASK_TITLE_MAX_LENGTH);
      if (ev.detail !== undefined) task.detail = ev.detail.trim() || undefined;
      if (note)
        task.notes.push({
          seq: m.seq,
          by: m.from,
          ts: at,
          text: note,
          ...(ev.checkpoint && ev.note ? { checkpoint: true as const } : {}),
          ...(ev.owner && ev.owner !== m.from && ev.note ? { assign: true as const } : {}),
        });
      if (ev.proof && !task.proof?.some((p) => p.url === ev.proof!.url) && (task.proof?.length ?? 0) < PROOF_MAX) {
        task.proof = [...(task.proof ?? []), { seq: m.seq, by: m.from, ts: at, url: ev.proof.url, ...(ev.proof.label ? { label: ev.proof.label } : {}) }];
        for (const l of prLinks(ev.proof.url)) {
          const pr = c.github.prs.get(prKey(l.repo, l.number));
          if (pr?.sha && pr.state === "open") headMoved(task, { ...pr, sha: pr.sha }, { seq: m.seq, by: m.from, at });
        }
      }
      if (ev.kept) keepApproval(c, task, ev.kept, { seq: m.seq, by: m.from, at, ...rts });
      if (ev.run && task.run?.id !== ev.run.id) task.run = { id: ev.run.id, seq: m.seq, by: m.from };
      if (ev.areas?.length) task.areas = [...new Set(ev.areas)];
      if (ev.owner === null && task.state === "doing") task.state = "todo";
      task.updatedAt = at;
      if (task.state === "landing") advance(task, { seq: m.seq, by: m.from, at });
      if (judging && mayFinish) markReset(c.reviewReset, member, m.seq);
      break;
    }

    case "claim":
    case "release":
      break;

    case "fact.set": {
      const refused = leadCheckpointKeyRefusal(ev.key, m.from, ev.ttl);
      if (refused) {
        reject(refused);
        break;
      }
      const ttl = ev.ttl === undefined ? undefined : Math.min(Math.max(Number(ev.ttl) || 0, 60), 30 * 24 * 3600) * 1000;
      facts.set(ev.key, { key: ev.key, value: ev.value, by: m.from, ts: at, seq: m.seq, ...(ttl ? { expires: at + ttl } : {}) });
      break;
    }

    case "doc.open": {
      if (!c.docs.has(ev.thread)) c.docs.set(ev.thread, ev.th);
      break;
    }

    case "fact.del": {
      const refused = leadCheckpointKeyRefusal(ev.key, m.from, undefined);
      if (refused) reject(refused);
      else facts.delete(ev.key);
      break;
    }

    case "lease.take": {
      let lease = c.leases.get(ev.name);
      if (!lease) c.leases.set(ev.name, (lease = { name: ev.name, since: at, until: at, queue: [] }));
      take(lease, m.from, ev.ttl * 1000, at, ev.note);
      break;
    }

    case "lease.free": {
      const lease = c.leases.get(ev.name);
      if (!lease || !free(lease, m.from, at, isPerson(member))) reject(`${m.from} neither holds nor waits for ${ev.name}`);
      else if (!lease.holder && !lease.queue.length) c.leases.delete(ev.name);
      break;
    }
  }
}

function normTags(tags: readonly string[] | undefined): string[] {
  return [...new Set((tags ?? []).map((t) => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, MAX_TAGS);
}
