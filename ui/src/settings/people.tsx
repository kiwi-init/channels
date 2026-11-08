import { useEffect, useState } from "react"

import { Toggle } from "~/kit/form"
import { announce } from "~/kit/toasts"
import { ago } from "~/kit/time"
import type { AdminPerson, PersonPlan } from "~/model"
import { useApp } from "~/nav"
import { Group, Row, Seg } from "~/settings/controls"
import { Page } from "~/settings/sections"

const PLANS: readonly (readonly [PersonPlan, string])[] = [
  ["free", "Free"],
  ["paid", "Paid"],
  ["unlimited", "Unlimited"],
]

const plural = (n: number, one: string) => `${n.toLocaleString()} ${one}${n === 1 ? "" : "s"}`

function active(at: number): string {
  const a = ago(at)
  if (a === "now") return "active now"
  return /^\d+[mhd]$/.test(a) ? `active ${a} ago` : `active ${a}`
}

export function PeopleSection({ people }: { people: AdminPerson[] }) {
  const { app } = useApp()
  const [list, setList] = useState(people)
  useEffect(() => setList(people), [people])
  const change = (who: AdminPerson, next: { plan?: PersonPlan; blocked?: boolean }) => {
    setList((l) => l.map((p) => (p.user === who.user ? { ...p, ...next } : p)))
    app.actions.setAdminPerson(who.user, next).then(
      (got) => got && setList((l) => l.map((p) => (p.user === got.user ? got : p))),
      (err: unknown) => {
        setList((l) => l.map((p) => (p.user === who.user ? who : p)))
        announce(`Not changed: ${err instanceof Error ? err.message : "the relay refused"}`, "error")
      }
    )
  }
  return (
    <Page title="People" lede="Everyone who owns a channel on this relay. Counts reset at 00:00 UTC.">
      <Group>
        {list.map((p) => (
          <Row
            key={p.user}
            label={p.login ? `@${p.login}` : <span className="set-mono">{p.user}</span>}
            hint={<span className="set-mono">{`${plural(p.used, "message")} today · ${plural(p.channels, "channel")} · ${active(p.seen)}`}</span>}
          >
            <Seg label={`Plan for ${p.login ?? p.user}`} value={p.plan} options={PLANS} onChange={(plan) => change(p, { plan })} />
            <Toggle label={`Block ${p.login ?? p.user}`} on={p.blocked} onChange={(blocked) => change(p, { blocked })} />
          </Row>
        ))}
      </Group>
    </Page>
  )
}
