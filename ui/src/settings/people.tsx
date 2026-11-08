import { useState } from "react"

import { cx } from "~/kit/bits"
import { MoreButton, type MenuGroups } from "~/kit/menu-open"
import { announce } from "~/kit/toasts"
import { ago } from "~/kit/time"
import type { AdminPerson, PersonPlan } from "~/model"
import { useApp } from "~/nav"
import { Group, Row } from "~/settings/controls"
import { Page } from "~/settings/sections"

const PLAN_NAMES: Record<PersonPlan, string> = { free: "Free", paid: "Paid", unlimited: "Unlimited" }
const PLANS: readonly PersonPlan[] = ["free", "paid", "unlimited"]

const plural = (n: number, one: string) => `${n.toLocaleString()} ${one}${n === 1 ? "" : "s"}`

function active(at: number): string {
  const a = ago(at)
  if (a === "now") return "active now"
  return /^\d+[mhd]$/.test(a) ? `active ${a} ago` : `active ${a}`
}

export function PeopleSection({ people }: { people: AdminPerson[] }) {
  const { app } = useApp()
  const [list, setList] = useState(people)
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
  const menu = (p: AdminPerson, name: string): MenuGroups => [
    PLANS.filter((plan) => plan !== p.plan).map((plan) => ({ label: `Move to ${PLAN_NAMES[plan]}`, run: () => change(p, { plan }) })),
    [
      p.blocked
        ? { label: "Unblock", run: () => change(p, { blocked: false }) }
        : {
            label: "Block",
            run: () => change(p, { blocked: true }),
            confirm: { title: `Block ${name}?`, sub: "They can't create channels or post in the ones they own until you unblock them.", yes: "Block" },
          },
    ],
  ]
  return (
    <Page title="People" lede="Everyone who owns a channel on this relay.">
      <Group>
        {list.map((p) => {
          const name = p.login ? `@${p.login}` : "Someone without a login yet"
          return (
            <Row key={p.user} label={name} hint={<span className="set-mono">{`${plural(p.used, "message")} today · ${active(p.seen)}`}</span>}>
              <span className={cx("set-value", p.blocked && "is-blocked")}>{p.blocked ? "Blocked" : PLAN_NAMES[p.plan]}</span>
              <MoreButton label={name} groups={() => menu(p, name)} />
            </Row>
          )
        })}
      </Group>
    </Page>
  )
}
