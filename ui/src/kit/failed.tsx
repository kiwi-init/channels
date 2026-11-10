import "~/i18n/en/kit-later"
import "~/styles/failed.css"

import type { Key } from "~/i18n/en"
import { t } from "~/i18n/i18n"
import { cx } from "~/kit/bits"
import { announce } from "~/kit/toasts"

export class Plain extends Error {}

export type Why = "plain" | "offline" | "signin" | "denied" | "gone" | "missing" | "busy" | "update" | "other"

export interface Failure {
  said: string
  raw: string | null
}

const TAGS: Readonly<Record<string, Why>> = {
  SignInRequired: "signin",
  Unauthorized: "denied",
  NotOwner: "denied",
  Forbidden: "denied",
  Denied: "denied",
  ReadOnly: "denied",
  NotMember: "gone",
  Removed: "gone",
  ChannelGone: "gone",
  NotFound: "missing",
  TooMany: "busy",
  UpdateRequired: "update",
}

const NEXT: Record<Exclude<Why, "plain">, Key> = {
  offline: "kit.failed.offline",
  signin: "kit.failed.signin",
  denied: "kit.failed.denied",
  gone: "kit.failed.gone",
  missing: "kit.failed.missing",
  busy: "kit.failed.busy",
  update: "kit.failed.update",
  other: "kit.failed.other",
}

const NETWORK = /failed to fetch|fetch failed|load failed|network ?error|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|couldn't reach|unreachable/i

export const rawOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

function tagOf(err: unknown): unknown {
  if (typeof err !== "object" || err === null) return undefined
  if ("tag" in err && err.tag) return err.tag
  return "_tag" in err ? err._tag : undefined
}

function whyOf(err: unknown): Why {
  if (err instanceof Plain) return "plain"
  const tag = tagOf(err)
  const known = typeof tag === "string" ? TAGS[tag] : undefined
  if (known) return known
  return NETWORK.test(rawOf(err)) || (typeof navigator !== "undefined" && navigator.onLine === false) ? "offline" : "other"
}

export function plainly<T>(run: () => T): T {
  try {
    return run()
  } catch (err) {
    // These checks throw sentences written for people, so they are shown as they are.
    throw err instanceof Error ? new Plain(err.message) : err
  }
}

const sentence = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1) + (/[A-Za-z\d)]$/.test(text) ? "." : "")

export function failure(what: string, err: unknown, says: Partial<Record<Why, string>> = {}): Failure {
  console.error(what, err)
  const why = whyOf(err)
  const next = says[why] ?? (why === "plain" ? sentence(rawOf(err)) : t(NEXT[why]))
  return { said: t("kit.failed.line", { what, next }), raw: why === "plain" ? null : rawOf(err) }
}

export const failedToast = (what: string, err: unknown, says?: Partial<Record<Why, string>>): void => announce(failure(what, err, says).said, "error")

export function Details({ raw }: { raw: string }) {
  return (
    <details className="failed-details">
      <summary>{t("kit.failed.details")}</summary>
      <code>{raw}</code>
    </details>
  )
}

export function Failed({ failure, className }: { failure: Failure; className?: string }) {
  return (
    <div className={cx("failed", className)} role="alert">
      <p>{failure.said}</p>
      {failure.raw && <Details raw={failure.raw} />}
    </div>
  )
}
