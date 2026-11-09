// What a relay allows, from its configuration: who may create channels (a
// private beta), and how much each person and channel may use. Shared by the
// Cloudflare and Bun relays, so both behave the same.
//
// Everything is off unless configured, except the safety caps a public
// service can't do without (see SAFETY_*). The public relay turns the rest on
// in wrangler.jsonc.
//
// The relay runs with its policy as a service, Policy, read once from the
// adapter's settings (policyFrom).

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { profileOf } from "./human.ts";

/** Stored ciphertext per channel when nothing else is configured: generous, but not unbounded. */
export const SAFETY_BYTES_PER_CHANNEL = 1024 ** 3;

export interface RelayPolicy {
  /** Who may create channels: user ids, emails, "@domain" or "github:<login>". Null: anyone signed in. */
  betaUsers: string[] | null;
  /** Where people not on the list can ask for access. */
  waitlistUrl: string | null;
  /** Channels one person may own at once. */
  channelsPerOwner: number | null;
  /** Active members (people and agents) per channel. */
  membersPerChannel: number | null;
  /** Messages stored per channel per UTC day. */
  messagesPerDay: number | null;
  personMessagesPerDay: number | null;
  paidMessagesPerDay: number | null;
  upgradeUrl: string | null;
  billingUrl: string | null;
  admins: string[];
  /** Ciphertext bytes a channel may hold across its retained messages. */
  bytesPerChannel: number;
  /** Delete a channel after this many days with no new message and nobody connected. */
  expireAfterDays: number | null;
  pageKey: string | null;
}

export interface RoomPolicy extends RelayPolicy {
  noRateLimits?: boolean;
}

/** The policy when nothing is configured: today's behavior plus the byte safety cap. */
export const OPEN_POLICY: RelayPolicy = {
  betaUsers: null,
  waitlistUrl: null,
  channelsPerOwner: null,
  membersPerChannel: null,
  messagesPerDay: null,
  personMessagesPerDay: null,
  paidMessagesPerDay: null,
  upgradeUrl: null,
  billingUrl: null,
  admins: [],
  bytesPerChannel: SAFETY_BYTES_PER_CHANNEL,
  expireAfterDays: null,
  pageKey: null,
};

/** What this relay allows, as the room and its routes see it. */
export class Policy extends Context.Service<Policy, RoomPolicy>()("kiwi/relay/Policy") {}

const positive = (v: string | undefined): number | null => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) && n > 0 ? n : null;
};

export const pageSecret = (v: string | undefined): string | null => (v && v.trim().length >= 32 ? v.trim() : null);

/**
 * Read the policy from environment-style settings (Worker vars, or the Bun
 * relay's environment). Unknown or empty values mean "not configured".
 */
export function policyFrom(env: Record<string, string | undefined>): RelayPolicy {
  const list = (env.KIWI_BETA_USERS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return {
    betaUsers: list.length ? list : null,
    waitlistUrl: env.KIWI_BETA_WAITLIST_URL?.trim() || null,
    channelsPerOwner: positive(env.KIWI_QUOTA_CHANNELS_PER_OWNER),
    membersPerChannel: positive(env.KIWI_QUOTA_MEMBERS_PER_CHANNEL),
    messagesPerDay: positive(env.KIWI_QUOTA_MESSAGES_PER_DAY),
    personMessagesPerDay: positive(env.KIWI_QUOTA_PERSON_MESSAGES_PER_DAY),
    paidMessagesPerDay: positive(env.KIWI_QUOTA_PAID_MESSAGES_PER_DAY),
    upgradeUrl: env.KIWI_UPGRADE_URL?.trim() || null,
    billingUrl: env.KIWI_BILLING_URL?.trim() || null,
    admins: (env.KIWI_ADMINS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    bytesPerChannel: positive(env.KIWI_QUOTA_BYTES_PER_CHANNEL) ?? SAFETY_BYTES_PER_CHANNEL,
    expireAfterDays: positive(env.KIWI_EXPIRE_AFTER_DAYS),
    pageKey: pageSecret(env.KIWI_PAGE_KEY),
  };
}

/**
 * Whether a signed-in person may create channels during the beta: listed by
 * user id, by email, by the "@domain" of their email, or by "github:<login>" (looked up from sign-in).
 */
export const inBeta = Effect.fn("Policy.inBeta")(function* (user: string) {
  const policy = yield* Policy;
  if (!policy.betaUsers) return true;
  const list = new Set(policy.betaUsers);
  if (list.has(user.toLowerCase())) return true;
  const profile = yield* profileOf(user);
  if (profile?.login && list.has(`github:${profile.login.toLowerCase()}`)) return true;
  const email = profile?.email?.toLowerCase();
  if (!email) return false;
  return list.has(email) || list.has(`@${email.split("@")[1]}`);
});

/** The message for someone not in the beta. */
export function betaMessage(policy: RelayPolicy): string {
  return `Channels is in private beta, so creating channels is invite-only for now${policy.waitlistUrl ? `. Join the waitlist at ${policy.waitlistUrl}` : ""}. You can still join channels you're invited to.`;
}

export const BLOCKED_CREATE = "your account is blocked on this relay, so you can't create channels";

export function upgradeFor(url: string | null, user: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    u.searchParams.set("client_reference_id", user);
    return u.toString();
  } catch {
    // Not a URL the relay can add to: shown as it was set.
    return url;
  }
}
