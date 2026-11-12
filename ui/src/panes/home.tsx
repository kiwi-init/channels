import "~/styles/panes.css"
import { useEffect, useMemo } from "react"

import { Body } from "~/chat/body"
import type { Actions, ChannelTile, HomeAsk, HomeChannel } from "~/model"
import { useAct } from "~/nav"
import { join, link, maker, type Maker } from "~/panes/page"
import { openImage } from "~/specs/comment-item"
import { onboarded } from "~/start/onboarded"
import { wrote } from "~/words"
import { t } from "~/i18n/i18n"

const NO_NAMES: ReadonlyMap<string, string> = new Map()
const NO_TASKS: ReadonlySet<number> = new Set()
const CHANNEL = "kiwi-page:channel:"

function answers(code: string, ask: HomeAsk, actions: Actions, m: Maker, open: () => void): string {
  const act = ask.act
  if (act.kind === "options") return act.options.map((o) => m.act(o.shown.replace(/[[\]\\]/g, "\\$&"), () => actions.answerQuestion(code, ask.id, o.answer))).join(" ")
  if (act.kind === "allow") return m.act(t("panes.page.allow"), () => actions.answerPermission(code, ask.id, true))
  if (act.kind === "approve-spec") return m.act(t("panes.page.approve"), () => actions.approveSpec(code, act.ask, act.v))
  if (act.kind === "approve-task") return m.act(t("panes.page.approve"), () => actions.approveTask(code, act.task, true))
  return m.act(t("panes.home.open"), open)
}

function build(tiles: readonly ChannelTile[], home: readonly HomeChannel[], actions: Actions, toNeeds: (code: string) => void): { md: string; acts: Map<string, () => void> } {
  const m = maker()
  const byCode = new Map(home.map((h) => [h.code, h]))
  const asks = tiles
    .filter((c) => c.state === "member")
    .flatMap((c) => (byCode.get(c.code)?.asks ?? []).map((ask) => join([`### ${c.title} · ${ask.what}`, ask.text, answers(c.code, ask, actions, m, () => toNeeds(c.code))])))
  const channels = tiles.map((c) => {
    const h = byCode.get(c.code)
    const facts = [
      c.state === "waiting" ? t("shell.rail.tile.waiting") : "",
      h?.doneToday ? t("panes.home.done", { count: h.doneToday }) : "",
      h?.red ? t("panes.home.red", { count: h.red }) : "",
    ].filter(Boolean)
    const agents = (h?.agents ?? []).filter((a) => a.state === "working" || a.state === "waiting").map((a) => `- **${a.nick}** ${a.doing}${a.task ? ` · ${a.task.title}` : ""}`)
    return join([`### ${link(c.title, `${CHANNEL}${c.code}`)}`, facts.join(" · "), agents.join("\n")])
  })
  return { md: join([`# ${t("shell.rail.home")}`, asks.length ? `## ${t("start.welcome.waiting.on.you")}` : "", ...asks, `## ${t("shell.rail.channels")}`, ...channels]), acts: m.acts }
}

export function HomePage({ tiles, home }: { tiles: readonly ChannelTile[]; home: readonly HomeChannel[] }) {
  const { actions, go } = useAct()
  useEffect(() => void onboarded(true), [])
  const built = useMemo(
    () =>
      build(tiles, home, actions, (code) => {
        go({ to: "channel", code })
        go({ to: "tab", tab: "needs" })
      }),
    [tiles, home, actions, go]
  )
  const text = useMemo(() => wrote(built.md), [built.md])
  const onPage = (url: string) => {
    if (url.startsWith("kiwi-do:")) return built.acts.get(url.slice("kiwi-do:".length))?.()
    if (url.startsWith(CHANNEL)) go({ to: "channel", code: url.slice(CHANNEL.length) })
  }
  return (
    <main className="main home-main">
      <div className="page is-home">
        <article className="page-text">
          <Body text={text} seq={Number.MAX_SAFE_INTEGER} names={NO_NAMES} tasks={NO_TASKS} onImage={openImage} onMessage={() => {}} onPage={onPage} />
        </article>
      </div>
    </main>
  )
}
