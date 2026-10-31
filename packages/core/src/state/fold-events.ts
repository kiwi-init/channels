import { GENERAL_ROOM, MAX_CHARTER, MAX_ROOMS, MAX_TAGS, PROOF_MAX, TASK_TITLE_MAX_LENGTH, type Event, type Message, type Power, powerChange } from "../protocol.ts";
import { free, take } from "./leases.ts";
import { unnamedTasks } from "./compact.ts";
import { leadCheckpointKeyRefusal } from "./lead.ts";
import { addRelease, applyGithub, repoKey, type GithubState } from "./github.ts";
import { reposOf } from "./repos.ts";
import { omit } from "../omit.ts";
import { readScopes, SCOPES, type Scope } from "../scopes.ts";
import { cleanPersona } from "../personality.ts";
import { isPerson } from "./people.ts";
import { roomName } from "./rooms.ts";
import { currentState, openRound, reviewClaimRefusal, reviewMoveRefusal, revisedOut, taskId, verdictRefusal, worked } from "./tasks.ts";
import type { Charter, Compact, Fact, FoldMember, Hold, Lease, PersonaLead, Room, SecretRoom, Task } from "./types.ts";
import { inRoom } from "../private-room.ts";

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
  setRole: (target: FoldMember, role: string | null, about: string | null | undefined) => void;
  tasks: Map<number, Task>;
  facts: Map<string, Fact>;
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
  compact: Compact | null;
  compactProposal: Compact | null;
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
      else if (rooms.size >= MAX_ROOMS) reject(`a channel holds at most ${MAX_ROOMS} rooms`);
      else rooms.set(ev.id, { id: ev.id, name, createdBy: m.from, at });
      break;
    }

    case "room.seal": {
      const known = c.secret.get(ev.id);
      const opened = m.opened;
      if (!member.owner && !c.trusted(m.pk ?? "", member)) reject(trustOnly("makes private rooms"));
      else if (known?.meta && !inRoom(known.meta, member.name, m.pk)) reject("only someone in a private room changes it");
      else if (known && ev.n < known.n) reject("that private room has moved to a newer key");
      else if (!known && (ev.id === GENERAL_ROOM || rooms.has(ev.id))) reject(`there's already a room ${ev.id}`);
      else if (opened && !inRoom(opened, member.name, m.pk)) reject("whoever changes a private room stays in it");
      else {
        c.secret.set(ev.id, { n: ev.n, seal: { id: ev.id, n: ev.n, keys: ev.keys, meta: ev.meta }, ...(opened ? { meta: opened } : {}) });
        if (opened) rooms.set(ev.id, { ...(rooms.get(ev.id) ?? { id: ev.id, createdBy: m.from, at }), name: opened.name, members: opened.members });
        else rooms.delete(ev.id);
      }
      break;
    }

    case "room.msg":
      reject("a private room's message this app couldn't open");
      break;

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
        reject(trustOnly("sets the charter"));
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
      applyGithub(c.github, ev.items, m.seq);
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
      addRelease(c.github, { repo: ev.repo, tag: ev.tag, at: ev.at, shas: ev.shas, prs: ev.prs, seq: m.seq });
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
      else if (ev.member !== m.from && !member.owner) reject("only that person or the owner sets a colour");
      else if (!isPerson(target)) reject("agents wear their person's colour; they don't have their own");
      else {
        const holder = ev.color && [...members.values()].find((x) => x.active && x.name !== target.name && isPerson(x) && x.color === ev.color);
        if (holder) reject(`${ev.color} is ${holder.name}'s colour`);
        else target.color = ev.color ?? undefined;
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

    case "task.add":
      tasks.set(m.seq, {
        id: m.seq,
        title: String(ev.title).slice(0, TASK_TITLE_MAX_LENGTH),
        detail: ev.detail,
        state: "todo",
        owner: ev.owner || undefined,
        createdBy: m.from,
        createdAt: at,
        updatedAt: at,
        notes: [],
        ...(ev.review?.trim() ? { review: ev.review.trim() } : {}),
        ...(ev.issue ? { issue: { repo: ev.issue.repo, number: ev.issue.number } } : {}),
        ...(ev.from !== undefined && tasks.has(ev.from) ? { from: ev.from } : {}),
        workedBy: ev.owner ? [ev.owner] : [],
        rounds: [],
        ...(m.re?.length ? { source: m.re[0] } : {}),
      });
      break;

    case "card": {
      const card = omit(ev, "op");
      member.card = { ...card, ...(card.tools ? { tools: normTags(card.tools) } : {}), at };
      break;
    }

    case "task.claim": {
      const task = tasks.get(ev.task);
      if (!task) reject(`no task ${taskId(ev.task)}`);
      else if (task.state === "done") reject(`${taskId(task.id)} is already done`);
      else if (task.owner && task.owner !== m.from) reject(`${taskId(task.id)} is owned by ${task.owner}`);
      else {
        task.owner = m.from;
        if (task.state === "todo") task.state = "doing";
        task.updatedAt = at;
        worked(task, m.from);
      }
      break;
    }

    case "task.first": {
      const task = tasks.get(ev.task);
      if (!task) reject(`no task ${taskId(ev.task)}`);
      else if (task.state === "done") reject(`${taskId(task.id)} is already done`);
      else if (!task.owner) reject(`${taskId(task.id)} has no owner to go first for`);
      else task.first = m.seq;
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
      const review = ev.review === undefined ? task.review : ev.review?.trim() || undefined;
      const owner = ev.owner === undefined ? task.owner : ev.owner || undefined;
      const mayFinish = !review || isPerson(member) || (review === "*" ? m.from !== owner && !task.workedBy.includes(m.from) : m.from === review);
      if (ev.state === "done" && task.state !== "done" && !mayFinish) {
        reject(`${taskId(task.id)} needs review by ${review === "*" ? "someone who hasn't worked on it" : review} before it's done (send it for review)`);
        break;
      }
      const open = openRound(task);
      const verdictWrong = ev.verdict ? verdictRefusal(task, ev.verdict, ev, mayFinish, open) : null;
      if (verdictWrong) {
        reject(verdictWrong);
        break;
      }
      const cancel = ev.state === "cancelled" && task.state !== "done";
      const state =
        ev.state === "cancelled" ? (cancel && (mayFinish || (ev.round !== undefined && revisedOut(task, m.from, open) === ev.round)) ? "done" : undefined) : ev.state && currentState(ev.state);
      if (open && state && state !== "review")
        open.result =
          ev.verdict && mayFinish
            ? { kind: ev.verdict, by: m.from, seq: m.seq, ts: at }
            : state === "done" && !cancel
              ? { kind: "approved", by: m.from, seq: m.seq, ts: at }
              : { kind: "withdrawn", seq: m.seq };
      if (state === "review") {
        if (open) open.result = { kind: "withdrawn", seq: m.seq };
        task.rounds.push({
          n: (task.rounds.at(-1)?.n ?? 0) + 1,
          ...(ev.at ? { at: ev.at.trim() } : {}),
          ...(ev.summary ? { summary: ev.summary.trim() } : {}),
          by: m.from,
          seq: m.seq,
          ts: at,
          result: { kind: "open" },
        });
      }
      const note = ev.note || (ev.state === "blocked" ? "blocked" : ev.state === "cancelled" ? "cancelled" : undefined);
      if (ev.review !== undefined) task.review = review;
      if (ev.state === "done" && task.state !== "done" && task.review) task.approvedBy = m.from;
      if (state && state !== "done") task.approvedBy = undefined;
      if (state === "done" && task.state !== "done") task.cancelled = ev.state === "cancelled" || undefined;
      if (state && state !== "done") task.cancelled = undefined;
      if (state === "done" && task.state !== "done") task.closedSeq = m.seq;
      if (state && state !== "done") task.closedSeq = undefined;
      if (ev.owner !== undefined) {
        const next = ev.owner || undefined;
        if (task.owner && next !== task.owner) task.handedOff = { seq: m.seq, from: task.owner };
        if (next !== task.owner) task.first = undefined;
        task.owner = next;
      }
      if (ev.owner) worked(task, ev.owner);
      if (state && state !== "done" && (m.from === task.owner || state === "review")) worked(task, m.from);
      if (state) task.state = state;
      if (ev.title) task.title = ev.title.slice(0, TASK_TITLE_MAX_LENGTH);
      if (note)
        task.notes.push({
          seq: m.seq,
          by: m.from,
          ts: at,
          text: note,
          ...(ev.checkpoint && ev.note ? { checkpoint: true as const } : {}),
          ...(ev.owner && ev.owner !== m.from && ev.note ? { assign: true as const } : {}),
        });
      if (ev.proof && !task.proof?.some((p) => p.url === ev.proof!.url) && (task.proof?.length ?? 0) < PROOF_MAX)
        task.proof = [...(task.proof ?? []), { seq: m.seq, by: m.from, ts: at, url: ev.proof.url, ...(ev.proof.label ? { label: ev.proof.label } : {}) }];
      if (ev.areas?.length) task.areas = [...new Set(ev.areas)];
      if (ev.owner === null && task.state === "doing") task.state = "todo";
      task.updatedAt = at;
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
