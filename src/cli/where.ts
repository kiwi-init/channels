import { parseTaskId } from "@kiwi/core/state.ts";

export interface Where {
  main?: true;
  room?: string;
  task?: number;
  dm?: string;
  re?: number[];
  to?: string[];
}

export function parseWhere(raw: string | undefined): Where | string {
  if (raw === undefined) return {};
  const words = raw
    .split(",")
    .map((w) => w.trim())
    .filter(Boolean);
  const where: Where = {};
  const places: string[] = [];
  for (const w of words) {
    const task = /^T\d+$/i.test(w) ? parseTaskId(w) : null;
    const reply = /^#\d+$/.exec(w);
    if (w.toLowerCase() === "#general" || w.toLowerCase() === "#main") {
      where.main = true;
      places.push(w);
    } else if (reply) {
      where.re = [...(where.re ?? []), Number(w.slice(1))];
      places.push(w);
    } else if (w.startsWith("#") && w.length > 1) {
      where.room = w.slice(1);
      places.push(w);
    } else if (task !== null) {
      where.task = task;
      places.push(w);
    } else if (w.startsWith("@") && w.length > 1) {
      where.dm = w.slice(1);
      places.push(w);
    } else where.to = [...(where.to ?? []), w];
  }
  if (places.length > 1) return `--to names one place (${places.join(" and ")} are two): #general, #room, T7, @name or #123`;
  if (where.dm && where.to?.length) return `@${where.dm} is a direct thread with them alone; leave out ${where.to.join(", ")}`;
  return where;
}
