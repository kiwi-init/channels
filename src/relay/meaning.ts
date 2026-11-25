import { accountUser } from "./account.ts";
import { BadRequest, NotFound, Refused, TooMany } from "./failures.ts";
import type { HumanAuth } from "./human.ts";
import { corsPreflight, withCors } from "./mailbox.ts";
import { errorResponse } from "./room/http.ts";

export interface MeaningAsk {
  query: string;
  items: { id: number; from: string; where: string; text: string }[];
}

export interface MeaningHit {
  id: number;
  p: number;
}

export interface MeaningRoutes {
  key: string | undefined;
  allow(user: string): Promise<boolean>;
  ask?: (body: object, key: string) => Promise<unknown>;
}

const MEANING_PATH = "/v1/meaning";
export const MEANING_ASKS_PER_MINUTE = 20;
const JEV = "https://api.typesafe.ai/v1/systemone";
const ASK_MS = 8_000;
const GROUP = 8;
const MOST = 160;
const QUERY = 200;
const LABEL = 80;
const TEXT = 600;
const MOST_BYTES = 256 * 1024;

const said = (v: unknown, most: number): v is string => typeof v === "string" && v.trim() !== "" && v.length <= most;

const isItem = (v: unknown): v is MeaningAsk["items"][number] => {
  const m = v as Record<string, unknown>;
  return !!m && Number.isSafeInteger(m.id) && said(m.from, LABEL) && said(m.where, LABEL) && said(m.text, TEXT);
};

export function meaningAsk(raw: unknown): MeaningAsk | null {
  const a = raw as Record<string, unknown>;
  if (!a || !said(a.query, QUERY) || !Array.isArray(a.items) || a.items.length > MOST || !a.items.every(isItem)) return null;
  if (new Set(a.items.map((m) => m.id)).size !== a.items.length) return null;
  return { query: a.query.trim(), items: a.items.map(({ id, from, where, text }) => ({ id, from, where, text })) };
}

const question = (at: number) => ({
  type: "noul",
  instructions: `Is the message \`messages[${at}]\` something the person searching for \`query\` would want to find?`,
  criteria: {
    true: "The message is about what the query asks for, even in different words.",
    false: "The message is about something else, or only shares a word with the query.",
  },
});

export function meaningRequest(query: string, items: MeaningAsk["items"]): object {
  return {
    model: "jev-latest",
    state: { query, messages: items.map(({ from, where, text }) => ({ from, where, text })) },
    questions: Object.fromEntries(items.map((_, at) => [`m${at}`, question(at)])),
  };
}

export function meaningScores(items: MeaningAsk["items"], reply: unknown): MeaningHit[] {
  const answers = ((reply as { answers?: unknown })?.answers ?? {}) as Record<string, { noul?: unknown }>;
  return items.flatMap((m, at) => {
    const p = answers[`m${at}`]?.noul;
    return typeof p === "number" && Number.isFinite(p) ? [{ id: m.id, p }] : [];
  });
}

async function askJev(body: object, key: string): Promise<unknown> {
  try {
    const res = await fetch(JEV, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ASK_MS),
    });
    return res.ok ? await res.json() : null;
  } catch {
    // Slow or refused: that group of messages gets no scores.
    return null;
  }
}

export async function scoreMeaning(ask: MeaningAsk, key: string, via: (body: object, key: string) => Promise<unknown> = askJev): Promise<MeaningHit[] | null> {
  const groups: MeaningAsk["items"][] = [];
  for (let i = 0; i < ask.items.length; i += GROUP) groups.push(ask.items.slice(i, i + GROUP));
  const replies = await Promise.all(groups.map((g) => via(meaningRequest(ask.query, g), key)));
  if (groups.length && replies.every((r) => r === null)) return null;
  return replies.flatMap((r, i) => meaningScores(groups[i]!, r)).sort((a, b) => b.p - a.p);
}

const refuse = (err: unknown): Response => withCors(errorResponse(err));

export async function onMeaningHttp(req: Request, human: HumanAuth | null, routes: MeaningRoutes): Promise<Response | null> {
  if (new URL(req.url).pathname !== MEANING_PATH) return null;
  if (req.method === "OPTIONS") return corsPreflight();
  if (!routes.key) return refuse(new NotFound({ message: "search by meaning is off on this relay" }));
  if (req.method === "GET") return withCors(Response.json({ on: true }));
  if (req.method !== "POST") return refuse(new NotFound({ message: "not found" }));
  const user = await accountUser(req, human);
  if (user instanceof Response) return user;
  if (!(await routes.allow(user))) return refuse(new TooMany({ message: "too many searches by meaning; try again in a minute", retryAfter: 60 }));
  const text = await req.text();
  if (text.length > MOST_BYTES) return refuse(new BadRequest({ message: "a search by meaning is too big" }));
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    // Not JSON: answered as a bad ask below.
    raw = null;
  }
  const ask = meaningAsk(raw);
  if (!ask) return refuse(new BadRequest({ message: `a search by meaning names a query and up to ${MOST} messages, each with an id, who wrote it, where and its text` }));
  const hits = await scoreMeaning(ask, routes.key, routes.ask);
  if (!hits) return refuse(new Refused({ status: 502, message: "Jev didn't answer; try again", tag: "Internal" }));
  return withCors(Response.json({ hits }));
}
