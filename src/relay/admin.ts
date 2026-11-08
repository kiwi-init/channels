import { accountUser } from "./account.ts";
import { BadRequest, Forbidden, NotFound } from "./failures.ts";
import type { HumanAuth } from "./human.ts";
import { corsPreflight, withCors } from "./mailbox.ts";
import { limitOf, PLANS, type Person, type PersonRow, type Plan } from "./people.ts";
import { upgradeFor, type RelayPolicy } from "./policy.ts";
import { errorResponse } from "./room/http.ts";

export interface PeopleAdmin {
  people(): Promise<PersonRow[]>;
  summary(user: string): Promise<PersonRow>;
  set(user: string, change: Partial<Person>): Promise<PersonRow>;
}

const PATH = /^\/v1\/admin\/people(?:\/(github_\d+))?$/;
const USAGE_PATH = "/v1/me/usage";

interface Usage {
  plan: Plan;
  blocked: boolean;
  used: number;
  limit: number | null;
  channels: number;
  resetsAt: number;
  upgradeUrl: string | null;
}

const nextUtcMidnight = (now: number) => {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
};
const NOT_ADMIN = "only this relay's admins can see and change people";

export const isAdminPath = (pathname: string): boolean => pathname === USAGE_PATH || PATH.test(pathname);

const refuse = (err: unknown): Response => withCors(errorResponse(err));

function changeOf(text: string): Partial<Person> | null {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    // Not JSON: the caller answers 400.
    return null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const { plan, blocked } = body as { plan?: unknown; blocked?: unknown };
  if (plan !== undefined && !PLANS.includes(plan as Plan)) return null;
  if (blocked !== undefined && typeof blocked !== "boolean") return null;
  if (plan === undefined && blocked === undefined) return null;
  return { ...(plan !== undefined ? { plan: plan as Plan } : {}), ...(blocked !== undefined ? { blocked } : {}) };
}

export async function onAdminHttp(req: Request, human: HumanAuth | null, policy: RelayPolicy, store: PeopleAdmin, now = Date.now()): Promise<Response | null> {
  const path = new URL(req.url).pathname;
  const m = PATH.exec(path);
  if (!m && path !== USAGE_PATH) return null;
  if (req.method === "OPTIONS") return corsPreflight();
  const user = await accountUser(req, human);
  if (user instanceof Response) return user;
  if (!m) {
    if (req.method !== "GET") return refuse(new NotFound({ message: "not found" }));
    const row = await store.summary(user);
    const free = policy.personMessagesPerDay;
    const admin = policy.admins.includes(user.toLowerCase());
    const limit = free ? limitOf(row.plan, { free, paid: policy.paidMessagesPerDay, admin }) : null;
    const usage: Usage = {
      plan: admin ? "unlimited" : row.plan,
      blocked: row.blocked,
      used: row.used,
      limit,
      channels: row.channels,
      resetsAt: nextUtcMidnight(now),
      upgradeUrl: upgradeFor(policy.upgradeUrl, user),
    };
    return withCors(Response.json(usage));
  }
  if (!policy.admins.includes(user.toLowerCase())) return refuse(new Forbidden({ message: NOT_ADMIN }));
  const who = m[1];
  if (req.method === "GET" && !who) return withCors(Response.json({ people: await store.people() }));
  if (req.method === "PUT" && who) {
    const change = changeOf(await req.text());
    if (!change) return refuse(new BadRequest({ message: `a change takes {plan: ${PLANS.join(" | ")}} and/or {blocked: true | false}` }));
    return withCors(Response.json(await store.set(who, change)));
  }
  return refuse(new NotFound({ message: "not found" }));
}
