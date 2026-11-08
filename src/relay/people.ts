import type { Sql } from "./room/db.ts";

export type Plan = "free" | "paid" | "unlimited";

export interface Person {
  plan: Plan;
  blocked: boolean;
}

export interface LeaseAsk {
  room: string;
  day: string;
  used: number;
  free: number;
  paid: number | null;
  admin: boolean;
}

export interface Lease {
  grant: number;
  plan: Plan;
  limit: number | null;
  remaining: number | null;
  blocked: boolean;
}

export interface PersonRow extends Person {
  user: string;
  day: string;
  used: number;
  channels: number;
  seen: number;
}

export const LEASE_BATCH = 20;

export const PLANS: readonly Plan[] = ["free", "paid", "unlimited"];

export function limitOf(plan: Plan, ask: Pick<LeaseAsk, "free" | "paid" | "admin">): number | null {
  if (plan === "unlimited" || ask.admin) return null;
  return plan === "paid" ? (ask.paid ?? ask.free) : ask.free;
}

export function grantFor(granted: number, limit: number | null): number {
  if (limit === null) return LEASE_BATCH;
  const left = limit - granted;
  return left > 0 ? Math.min(LEASE_BATCH, Math.ceil(left / 4)) : 0;
}

export class PeopleBook {
  constructor(private readonly sql: Sql) {
    sql.run("CREATE TABLE IF NOT EXISTS person_plans (user TEXT PRIMARY KEY, plan TEXT NOT NULL, blocked INTEGER NOT NULL DEFAULT 0)");
    sql.run(
      "CREATE TABLE IF NOT EXISTS person_index (user TEXT PRIMARY KEY, plan TEXT NOT NULL, blocked INTEGER NOT NULL, day TEXT NOT NULL, used INTEGER NOT NULL, channels INTEGER NOT NULL, seen INTEGER NOT NULL)",
    );
    sql.run("CREATE TABLE IF NOT EXISTS person_usage (user TEXT NOT NULL, room TEXT NOT NULL, day TEXT NOT NULL, used INTEGER NOT NULL, granted INTEGER NOT NULL, PRIMARY KEY (user, room))");
  }

  person(user: string): Person {
    const row = this.sql.all<{ plan: string; blocked: number }>("SELECT plan, blocked FROM person_plans WHERE user = ?", user)[0];
    const plan = PLANS.find((p) => p === row?.plan) ?? "free";
    return { plan, blocked: row?.blocked === 1 };
  }

  setPerson(user: string, next: Person): void {
    this.sql.run(
      "INSERT INTO person_plans (user, plan, blocked) VALUES (?, ?, ?) ON CONFLICT (user) DO UPDATE SET plan = excluded.plan, blocked = excluded.blocked",
      user,
      next.plan,
      next.blocked ? 1 : 0,
    );
  }

  usedOn(user: string, day: string): number {
    return this.sql.all<{ n: number | null }>("SELECT SUM(used) AS n FROM person_usage WHERE user = ? AND day = ?", user, day)[0]?.n ?? 0;
  }

  lease(user: string, ask: LeaseAsk): Lease {
    const work = (): Lease => {
      this.sql.run("DELETE FROM person_usage WHERE user = ? AND day <> ?", user, ask.day);
      const { plan, blocked } = this.person(user);
      const limit = limitOf(plan, ask);
      const granted = this.sql.all<{ n: number | null }>("SELECT SUM(granted) AS n FROM person_usage WHERE user = ?", user)[0]?.n ?? 0;
      const grant = blocked ? 0 : grantFor(granted, limit);
      this.sql.run(
        "INSERT INTO person_usage (user, room, day, used, granted) VALUES (?, ?, ?, ?, ?) ON CONFLICT (user, room) DO UPDATE SET used = MAX(used, excluded.used), granted = granted + excluded.granted",
        user,
        ask.room,
        ask.day,
        ask.used,
        grant,
      );
      return { grant, plan, limit, remaining: limit === null ? null : Math.max(0, limit - granted - grant), blocked };
    };
    return this.sql.transaction ? this.sql.transaction(work) : work();
  }

  summary(user: string, day: string, channels: number, seen: number): PersonRow {
    return { user, ...this.person(user), day, used: this.usedOn(user, day), channels, seen };
  }

  note(row: PersonRow): void {
    this.sql.run(
      "INSERT INTO person_index (user, plan, blocked, day, used, channels, seen) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (user) DO UPDATE SET plan = excluded.plan, blocked = excluded.blocked, day = excluded.day, used = excluded.used, channels = excluded.channels, seen = MAX(seen, excluded.seen)",
      row.user,
      row.plan,
      row.blocked ? 1 : 0,
      row.day,
      row.used,
      row.channels,
      row.seen,
    );
  }

  people(day: string): PersonRow[] {
    return this.sql
      .all<{ user: string; plan: string; blocked: number; day: string; used: number; channels: number; seen: number }>(
        "SELECT user, plan, blocked, day, used, channels, seen FROM person_index ORDER BY seen DESC",
      )
      .map((r) => ({ ...r, plan: PLANS.find((p) => p === r.plan) ?? "free", blocked: r.blocked === 1, used: r.day === day ? r.used : 0 }));
  }
}
