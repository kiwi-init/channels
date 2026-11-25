import type { MeaningAsk, MeaningHit, MeaningResult, SetTypesafeKey, TypesafeKey } from "./bridge.ts";
import { mutate, store } from "./store.ts";

const JEV = "https://api.typesafe.ai/v1/systemone";
const ASK_MS = 8_000;
const GROUP = 8;
const MOST = 160;
const QUERY = 200;
const LABEL = 80;
const TEXT = 600;
const KEY = /^[\x21-\x7e]{8,200}$/;

type Reply = { status: number; body: unknown } | null;
export type Ask = (body: object, key: string) => Promise<Reply>;

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

async function askJev(body: object, key: string): Promise<Reply> {
  try {
    const res = await fetch(JEV, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ASK_MS),
    });
    return { status: res.status, body: res.ok ? await res.json() : null };
  } catch {
    // Offline or slow: that group of messages gets no scores.
    return null;
  }
}

const refused = (r: Reply): boolean => r?.status === 401 || r?.status === 403;

export async function searchMeaning(raw: unknown, via: Ask = askJev): Promise<MeaningResult> {
  const ask = meaningAsk(raw);
  if (!ask) throw new Error(`a search by meaning names a query and up to ${MOST} messages, each with an id, who wrote it, where and its text`);
  const key = store.typesafe?.key;
  if (!key) return { failed: "no-key" };
  const groups: MeaningAsk["items"][] = [];
  for (let i = 0; i < ask.items.length; i += GROUP) groups.push(ask.items.slice(i, i + GROUP));
  const replies = await Promise.all(groups.map((g) => via(meaningRequest(ask.query, g), key)));
  if (replies.some(refused)) return { failed: "key-refused" };
  if (groups.length && replies.every((r) => r?.status !== 200)) return { failed: "unreachable" };
  return { hits: replies.flatMap((r, i) => meaningScores(groups[i]!, r?.status === 200 ? r.body : null)).sort((a, b) => b.p - a.p) };
}

export function typesafeKey(): TypesafeKey {
  const key = store.typesafe?.key;
  return key ? { set: true, ends: key.slice(-4) } : { set: false, ends: null };
}

export async function setTypesafeKey(raw: unknown, via: Ask = askJev): Promise<SetTypesafeKey> {
  if (raw === null) {
    mutate((s) => {
      delete s.typesafe;
    });
    return { ok: true, key: typesafeKey() };
  }
  const key = typeof raw === "string" ? raw.trim() : "";
  if (!KEY.test(key)) return { ok: false, why: "malformed" };
  const tried = await via(meaningRequest("a test search", [{ id: 0, from: "Channels", where: "a test", text: "a test message" }]), key);
  if (refused(tried)) return { ok: false, why: "refused" };
  if (tried?.status !== 200) return { ok: false, why: "unreachable" };
  mutate((s) => {
    s.typesafe = { key };
  });
  return { ok: true, key: typesafeKey() };
}
