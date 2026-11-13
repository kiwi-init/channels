import { useMemo, type ReactNode } from "react"

import type { Channel } from "~/model"
import { between, nickname } from "~/names"
import { ActContext, NavContext, useAct, useNav, type Act, type Nav, type Panel } from "~/nav"
import { PaneContext, type PaneScope } from "~/panes/scope"
import { dockedNow, leafOf, MAIN, MIN_H, MIN_W, useLayout, type Doc, type Edge } from "~/panes/store"
import { docName } from "~/panes/view"
import { useTabs } from "~/shell/top-layout"
import { t } from "~/i18n/i18n"

const ops = () => import("~/panes/ops")

export const VIEW_NAMES = {
  specs: "shell.channel.specs",
  agents: "shell.channel.agents",
  github: "shell.channel.github",
  needs: "shell.channel.needs.you",
} as const

export function placeName(channel: Channel, nav: Nav): string {
  if (nav.tab !== "chat") return t(VIEW_NAMES[nav.tab])
  const where = nav.where
  if (where.kind === "room") return `# ${channel.rooms.find((r) => r.id === where.room)?.name ?? "general"}`
  if (where.kind === "dm") return `@ ${nickname(channel, where.with)}`
  return where.kind === "theirs" ? between(channel, where.between) : `T${where.task}`
}

export function roomiest(code: string): { id: string; edge: Edge } | undefined {
  const panes = [...document.querySelectorAll<HTMLElement>(`[data-panes="${code}"] > [data-pane]`)].map((el) => ({ id: el.dataset.pane ?? "", r: el.getBoundingClientRect() }))
  const best = panes.filter((p) => p.r.width >= 2 * MIN_W || p.r.height >= 2 * MIN_H).sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height)[0]
  if (!best) return undefined
  return { id: best.id, edge: best.r.width >= 2 * MIN_W && best.r.width >= best.r.height * 0.9 ? "right" : "bottom" }
}

export function panelName(channel: Channel, panel: Panel): string {
  if (panel.kind === "task") return docName(channel, { kind: "task", task: panel.task })
  if (panel.kind === "thread") return t("panes.thread")
  const item = panel.kind === "pr" ? channel.prs?.find((p) => p.repo === panel.repo && p.number === panel.number) : channel.issues?.find((i) => i.repo === panel.repo && i.number === panel.number)
  return `#${panel.number}${item ? ` ${item.title}` : ""}`
}

export function Scope({ code, id, nav, doc, shown, typing = true, children }: { code: string; id: string | null; nav: Nav; doc: Doc | null; shown: boolean; typing?: boolean; children: ReactNode }) {
  const act = useAct()
  const tabs = useTabs()
  const scoped = useMemo(
    (): Act => ({
      ...act,
      go: (go) => {
        if (go.to === "panel" && tabs) {
          const room = go.panel ? roomiest(code) : undefined
          return void ops().then((m) => m.panelGo(code, id ?? MAIN, go.panel, room))
        }
        if (id === null) return act.go(go)
        void ops().then((m) => {
          const rest = m.paneGo(code, id, go)
          if (rest) act.go(rest)
        })
      },
    }),
    [act, code, id, tabs]
  )
  const pane = useMemo(
    (): PaneScope => ({
      doc,
      show: (next) => {
        const room = roomiest(code)
        void ops().then((m) => m.showDoc(code, id, next, shown, room))
      },
      typing,
    }),
    [code, id, doc, shown, typing]
  )
  return (
    <NavContext value={nav}>
      <ActContext value={scoped}>
        <PaneContext value={pane}>{children}</PaneContext>
      </ActContext>
    </NavContext>
  )
}

export function FocusScope({ code, now, children }: { code: string; now: boolean; children: ReactNode }) {
  const layout = useLayout(code)
  const nav = useNav()
  const tabs = useTabs()
  const dock = dockedNow(layout.root)
  const shown = !dock || now
  const focus = tabs ? leafOf(layout.root, layout.focus) : null
  const leaf = focus?.nav && (shown || focus.id !== dock?.id) ? focus : null
  return (
    <Scope code={code} id={leaf?.id ?? null} nav={leaf?.nav ?? nav} doc={leaf?.doc ?? null} shown={shown}>
      {children}
    </Scope>
  )
}
