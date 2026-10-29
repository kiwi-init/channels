import { changed, read, RECENT_KEY } from "./store.ts";
import { pendingWrite, writeLater } from "./write-behind.ts";

const AGENT_WORKED = "mc.agent-worked";
const AGENT_WORKED_EVENT = "mc:agent-worked";

function agentWorked(): boolean {
  try {
    return localStorage.getItem(AGENT_WORKED) === "1";
  } catch {
    return false;
  }
}

export function noteAgentWorked(): void {
  if (agentWorked()) return;
  try {
    localStorage.setItem(AGENT_WORKED, "1");
  } catch {
    return;
  }
  window.dispatchEvent(new Event(AGENT_WORKED_EVENT));
}

export interface Recent {
  from: string;
  text: string;
  ts: number;
  people: string[];
  lead?: string;
}

export function loadRecent(code: string): Recent | null {
  const held = pendingWrite(RECENT_KEY(code));
  const recent = held !== undefined ? (JSON.parse(held) as Recent) : read<Recent>(RECENT_KEY(code));
  return recent && typeof recent.ts === "number" && Number.isFinite(new Date(recent.ts).getTime()) ? recent : null;
}

export function saveRecent(code: string, r: Recent): void {
  const next = JSON.stringify(r);
  if ((pendingWrite(RECENT_KEY(code)) ?? localStorage.getItem(RECENT_KEY(code))) === next) return;
  writeLater(RECENT_KEY(code), next);
  changed();
}

export function channelTitle(c: { name?: string }, recent: Recent | null): string {
  if (c.name) return c.name;
  const p = recent?.people ?? [];
  if (!p.length) return "New channel";
  if (p.length === 1) return p[0]!;
  if (p.length <= 3) return `${p.slice(0, -1).join(", ")} & ${p[p.length - 1]}`;
  return `${p.slice(0, 2).join(", ")} & ${p.length - 2} more`;
}
