import type { english } from "~/i18n/en/all"
import chat from "~/i18n/en/chat"
import live from "~/i18n/en/live"
import settingsShared from "~/i18n/en/settings-shared"

export type Msg = string | Readonly<Partial<Record<Intl.LDMLPluralRule, string>> & { other: string }>

export const en = {
  ...live,
  ...settingsShared,
  ...chat,
  "settings.language": "Language",
  "settings.language.system": "System",
  "usage.today": "Messages today",
  "usage.today.label": "Messages today: {used}",
  "usage.used.today": "{used} today",
  "usage.used.of": "{used} of {limit}",
  "usage.plan.free": "Free",
  "usage.plan.paid": "Paid",
  "usage.plan.unlimited": "Unlimited",
  "usage.get.unlimited": "Get unlimited",
  "usage.get.per.day": "Get {count} a day",
  "usage.upgrade": "Upgrade",
  "usage.paid.unlimited": "The paid plan is unlimited.",
  "usage.paid.sends": { one: "The paid plan sends {count} message a day.", other: "The paid plan sends {count} messages a day." },
  "usage.relay.no.limit": "No daily limit on this relay.",
  "usage.no.limit": "No daily limit.",
  "usage.fair.use": { one: "A fair-use limit of {count} message a day.", other: "A fair-use limit of {count} messages a day." },
  "usage.per.day": { one: "{count} message a day.", other: "{count} messages a day." },
  "usage.two.sentences": "{first} {second}",
  "usage.hint": "In the channels you own, agents' included. Resets in {time}.",
  "usage.hint.fair.use": "The paid plan's fair-use limit, agents' included. Resets in {time}.",
  "usage.account": "Account",
  "usage.again.in": "Messages send again in {time}, at 00:00 UTC.",
  "usage.again": "Messages send again at 00:00 UTC.",
  "usage.ok": "OK",
  "usage.not.now": "Not now",
  "usage.channel.out": "This channel is out of messages today",
  "usage.channel.owner": "This channel's owner",
  "usage.channel.out.sub": "{who} has used today's messages, so nobody can send here for now. {again}",
  "usage.used.up": "Today's messages are used up",
  "usage.used.up.sub": "Your channels have used today's messages. {again}",
  "usage.used.up.count": { one: "Your channels sent {count} message today, agents' included: {plan}. {again}", other: "Your channels sent {count} messages today, agents' included: {plan}. {again}" },
  "usage.limit.fair.use": "the paid plan's fair-use limit",
  "usage.limit.paid": "the paid plan's daily limit",
  "usage.limit.free": "the free plan's daily limit",
} as const satisfies Record<string, Msg>

export type Key = keyof typeof english
