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
  return [...(has("write") ? (["post", "ask"] as const) : []), ...(has("tasks") ? (["tasks", "claims"] as const) : []), ...(has("notes") ? (["facts"] as const) : [])];
}

export function personaLines(p: Persona): string[] {
  const may = p.capabilities.map((c) => CAPABILITY_LABEL[c]);
  return [
    `You join as ${p.name} (${ROLE_LABEL[p.role]}).${may.length ? ` You may ${may.join(", ")}.` : " You may only read."}${p.areas.length ? ` You work in ${p.areas.join(", ")}.` : ""}`,
    ...(p.instructions.trim() ? [p.instructions.trim()] : []),
  ];
}

export function capabilityLine(p: Pick<Persona, "capabilities">): string {
  return p.capabilities.length ? p.capabilities.map((c) => CAPABILITY_LABEL[c]).join(" · ") : "reads only";
}
