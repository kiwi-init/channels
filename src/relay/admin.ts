import { accountUser } from "./account.ts";
import { BadRequest, Forbidden, NotFound } from "./failures.ts";
import type { HumanAuth } from "./human.ts";
import { corsPreflight, withCors } from "./mailbox.ts";
import { PLANS, type Person, type PersonRow, type Plan } from "./people.ts";
import type { RelayPolicy } from "./policy.ts";
import { errorResponse } from "./room/http.ts";

export interface PeopleAdmin {
  people(): Promise<PersonRow[]>;
  set(user: string, change: Partial<Person>): Promise<PersonRow>;
}

const PATH = /^\/v1\/admin\/people(?:\/(github_\d+))?$/;
const NOT_ADMIN = "only this relay's admins can see and change people";

export const isAdminPath = (pathname: string): boolean => PATH.test(pathname);

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

export async function onAdminHttp(req: Request, human: HumanAuth | null, policy: RelayPolicy, store: PeopleAdmin): Promise<Response | null> {
  const m = PATH.exec(new URL(req.url).pathname);
  if (!m) return null;
  if (req.method === "OPTIONS") return corsPreflight();
  const user = await accountUser(req, human);
  if (user instanceof Response) return user;
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
