import { withCors } from "./mailbox.ts";
import type { Person, Plan } from "./people.ts";

export const STRIPE_PATH = "/v1/stripe/webhook";
const STRIPE_TOLERANCE_S = 300;
const MAX_BODY = 256 * 1024;
const USER = /^github_\d+$/;
const PAID_STATUSES = new Set(["active", "trialing", "past_due"]);

export interface StripeBook {
  person(user: string): Promise<Person>;
  setPlan(user: string, plan: Plan): Promise<void>;
  customer(customer: string): Promise<string | null>;
  linkCustomer(customer: string, user: string): Promise<void>;
  newer(customer: string, at: number): Promise<boolean>;
}

type Json = Record<string, unknown>;
const obj = (x: unknown): Json => (x && typeof x === "object" && !Array.isArray(x) ? (x as Json) : {});
const str = (x: unknown): string | null => (typeof x === "string" && x ? x : null);

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

export async function stripeSignature(secret: string, body: string, t: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`)));
}

function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function signedOk(secret: string, body: string, header: string | null, now: number): Promise<boolean> {
  if (!header) return false;
  const parts = header.split(",").map((p) => p.trim().split("=") as [string, string]);
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  if (!Number.isSafeInteger(t) || Math.abs(now / 1000 - t) > STRIPE_TOLERANCE_S) return false;
  const want = await stripeSignature(secret, body, t);
  return parts.some(([k, v]) => k === "v1" && !!v && same(v.toLowerCase(), want));
}

const reply = (status: number, data: Json) => withCors(Response.json(data, { status }));

async function upgrade(book: StripeBook, user: string): Promise<void> {
  if ((await book.person(user)).plan === "free") await book.setPlan(user, "paid");
}

async function downgrade(book: StripeBook, user: string): Promise<void> {
  if ((await book.person(user)).plan === "paid") await book.setPlan(user, "free");
}

async function apply(book: StripeBook, event: Json): Promise<string> {
  const data = obj(obj(event["data"])["object"]);
  const customer = str(data["customer"]);
  const at = Number.isSafeInteger(event["created"]) ? (event["created"] as number) : 0;
  const current = async () => !customer || (await book.newer(customer, at));
  switch (event["type"]) {
    case "checkout.session.completed": {
      const user = str(data["client_reference_id"]);
      if (!user || !USER.test(user)) return "no person on the session";
      if (customer) await book.linkCustomer(customer, user);
      if (data["payment_status"] === "unpaid") return "paid";
      if (!(await current())) return "stale";
      await upgrade(book, user);
      return "paid";
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const user = customer ? await book.customer(customer) : null;
      if (!user) return "unknown customer";
      if (!(await current())) return "stale";
      const paid = event["type"] === "customer.subscription.updated" && PAID_STATUSES.has(String(data["status"]));
      await (paid ? upgrade(book, user) : downgrade(book, user));
      return paid ? "paid" : "free";
    }
    default:
      return "ignored";
  }
}

export async function onStripeHttp(req: Request, secret: string | undefined, book: StripeBook, now = Date.now()): Promise<Response | null> {
  if (new URL(req.url).pathname !== STRIPE_PATH) return null;
  if (!secret) return reply(404, { error: "not found", tag: "NotFound" });
  if (req.method !== "POST") return reply(405, { error: "POST only", tag: "BadRequest" });
  const body = await req.text();
  if (body.length > MAX_BODY) return reply(413, { error: "too large", tag: "TooLarge" });
  if (!(await signedOk(secret, body, req.headers.get("stripe-signature"), now))) return reply(401, { error: "bad signature", tag: "Unauthorized" });
  let event: Json;
  try {
    event = obj(JSON.parse(body));
  } catch {
    // Stripe always sends JSON; anything else is refused so it isn't retried as if it counted.
    return reply(400, { error: "not JSON", tag: "BadRequest" });
  }
  return reply(200, { ok: true, did: await apply(book, event) });
}
