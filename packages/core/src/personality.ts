import type { Scope } from "./scopes.ts";

export const ROLES = ["builder", "reviewer", "bug-hunter", "explorer", "releaser", "lead"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  builder: "Builder",
  reviewer: "Reviewer",
  "bug-hunter": "Bug hunter",
  explorer: "Explorer",
  releaser: "Releaser",
  lead: "Lead",
};

export const CAPABILITIES = ["write", "tasks", "prs", "merge", "review", "release", "assign", "notes"] as const;
export type Capability = (typeof CAPABILITIES)[number];

const CAPABILITY_LABEL: Record<Capability, string> = {
  write: "write and ask",
  tasks: "work tasks",
  prs: "open pull requests",
  merge: "merge on green",
  review: "review others' rounds",
  release: "release",
  assign: "assign work",
  notes: "set notes",
};

export const MAX_NAME = 40;
export const MAX_AREAS = 20;
export const MAX_AREA = 100;
export const MAX_INSTRUCTIONS = 2000;

export interface Personality {
  id: string;
  name: string;
  glyph: string;
  role: Role;
  capabilities: Capability[];
  areas: string[];
  instructions: string;
}

export type Persona = Omit<Personality, "id" | "glyph">;

const text = (x: unknown, max: number): string | null => (typeof x === "string" && x.length <= max && !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(x) ? x : null);

export function cleanPersona(x: unknown): Persona | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const p = x as Record<string, unknown>;
  const name = text(p.name, MAX_NAME)?.trim();
  const instructions = text(p.instructions, MAX_INSTRUCTIONS);
  if (!name || instructions === null || !(ROLES as readonly unknown[]).includes(p.role)) return null;
  if (!Array.isArray(p.capabilities) || !p.capabilities.every((c) => (CAPABILITIES as readonly unknown[]).includes(c))) return null;
  if (!Array.isArray(p.areas) || p.areas.length > MAX_AREAS || !p.areas.every((a) => !!text(a, MAX_AREA)?.trim())) return null;
  return {
    name,
    role: p.role as Role,
    capabilities: CAPABILITIES.filter((c) => (p.capabilities as unknown[]).includes(c)),
    areas: [...new Set((p.areas as string[]).map((a) => a.trim()))],
    instructions,
  };
}

export function personaOf(p: Personality): Persona {
  return { name: p.name, role: p.role, capabilities: p.capabilities, areas: p.areas, instructions: p.instructions };
}

export function personaScopes(p: Pick<Persona, "capabilities">): Scope[] {
  const has = (c: Capability) => p.capabilities.includes(c);
  return [...(has("write") ? (["post", "ask"] as const) : []), ...(has("tasks") ? (["tasks"] as const) : []), ...(has("notes") ? (["facts"] as const) : [])];
}

const UNSAFE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;
const oneLine = (s: string) =>
  s
    .replace(UNSAFE, " ")
    .replace(/[\s\u2028\u2029]+/g, " ")
    .trim();

export function personaLines(p: Persona): string[] {
  const may = p.capabilities.map((c) => CAPABILITY_LABEL[c]);
  const told = p.instructions
    .replace(/\r\n?|[\u2028\u2029]/g, "\n")
    .replace(UNSAFE, "")
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n  │ ")
    .trim();
  return [
    `You join as ${oneLine(personaLabel(p) ?? "")}.${may.length ? ` You may ${may.join(", ")}.` : " You may only read."}${p.areas.length ? ` You work in ${p.areas.map(oneLine).join(", ")}.` : ""}`,
    ...(told ? [`Your instructions: ${told}`] : []),
  ];
}

export function capabilityLine(p: Pick<Persona, "capabilities">): string {
  return p.capabilities.length ? p.capabilities.map((c) => CAPABILITY_LABEL[c]).join(" · ") : "reads only";
}

export function carriedPersona(lead: boolean, role: string | undefined, about: string | undefined, scopes: readonly Scope[]): Persona | undefined {
  const name = role?.replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
  if (!lead && !name && !about?.trim()) return undefined;
  const capabilities = CAPABILITIES.filter(
    (c) => (c === "write" && scopes.includes("post")) || (c === "tasks" && scopes.includes("tasks")) || (c === "notes" && scopes.includes("facts")) || (c === "assign" && lead),
  );
  return { name: lead ? "Lead" : name || "Member", role: lead ? "lead" : "builder", capabilities, areas: [], instructions: (about ?? "").slice(0, MAX_INSTRUCTIONS) };
}

function personaLabel(p: Pick<Persona, "name" | "role"> | undefined): string | undefined {
  if (!p) return undefined;
  return p.name === ROLE_LABEL[p.role] ? p.name : `${p.name} (${ROLE_LABEL[p.role]})`;
}

export function personaAnswers(p: Pick<Persona, "name" | "role"> | undefined, role: string): boolean {
  const r = role.trim().toLowerCase();
  return !!p && !!r && (p.role === r || p.name.toLowerCase() === r);
}
