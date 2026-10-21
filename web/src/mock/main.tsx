import { ArrowLeft01Icon, Search01Icon } from "@hugeicons/core-free-icons"
import { StrictMode, useEffect, useState, type CSSProperties, type ReactNode } from "react"
import { createRoot } from "react-dom/client"

import "../index.css"
import { tasksAwaitingPeople } from "@kiwi/core/state.ts"
import { ChannelSidebar } from "@/components/conversation/channel-sidebar"
import { ChannelIconTile } from "@/components/channel-icon"
import { Dispatch } from "@/components/delegate/dispatch"
import { HandOff } from "@/components/delegate/hand-off"
import { Bottlenecks } from "@/components/delegate/bottlenecks"
import { Icon } from "@/components/icon"
import { Harnesses, IconButton } from "@/components/kit"
import { Rail } from "@/components/sidebar"
import { asksFor } from "@/lib/asks"
import { reviewsFor } from "@/lib/task-actions"
import { TABS, viewCounts, type Tab } from "@/lib/views"
import { cx } from "@/lib/utils"
import { NOW, seed, type Seeded } from "./seed"

const params = new URLSearchParams(location.search)
const direction = params.get("d") ?? "a"
const theme = params.get("theme")
if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme

const ROWS = [
  { code: "c1", room: "r1", title: "channels-dev", recent: null, ts: NOW, state: "member" as const, owner: true, agents: 7 },
  { code: "c2", room: "r2", title: "kiwi-site", recent: null, ts: NOW - 3_600_000, state: "member" as const, owner: true, agents: 2 },
  { code: "c3", room: "r3", title: "onemouse", recent: null, ts: NOW - 86_400_000, state: "member" as const, owner: true, agents: 3 },
]
const NEWS = [
  { open: true, fresh: false, count: 0, needs: 1 },
  { open: false, fresh: true, count: 2, needs: 0 },
  { open: false, fresh: false, count: 0, needs: 0 },
]

function Head({ heading, status, tab }: { heading: string; status: string; tab: Tab }) {
  return (
    <header className="absolute inset-x-0 top-0 z-20 bg-canvas">
      <div className="relative flex h-(--chrome-h) items-center gap-1 px-2 sm:gap-3 sm:px-3 md:px-6">
        <IconButton label="Channels" round className="size-9 text-ink md:hidden">
          <Icon icon={ArrowLeft01Icon} size={20} />
        </IconButton>
        <span className="shrink-0 rounded-full sm:hidden">
          <ChannelIconTile icon={null} title="channels-dev" size={28} />
        </span>
        <span className="hidden min-w-0 truncate text-left text-title sm:block">
          <span className="md:hidden">{heading}</span>
          <span className="hidden md:inline">channels-dev</span>
        </span>
        <span className="hidden min-w-0 truncate text-meta text-ink-3 lg:block">{status}</span>
        <span className="flex-1" />
        <IconButton label="Search" round className="size-9 text-ink md:hidden">
          <Icon icon={Search01Icon} size={18} />
        </IconButton>
        <nav aria-label="Views of the channel" className="flex items-center gap-1 md:hidden">
          {TABS.map(([t, label]) => (
            <span
              key={t}
              className={cx(
                "relative flex h-9 items-center rounded-row px-2 text-ui sm:px-2.5",
                tab === t ? "font-semibold text-ink after:absolute after:inset-x-2 after:bottom-0.5 after:h-0.5 after:rounded-full after:bg-accent" : "text-ink-2"
              )}
            >
              {label}
            </span>
          ))}
        </nav>
      </div>
    </header>
  )
}

function Shell({ s, tab, children }: { s: Seeded; tab: Tab; children: ReactNode }) {
  const { state, agents } = s
  const { decisions, escalations, questions } = asksFor(state.openAsks, "jow")
  const needs = decisions.length + escalations.length + questions.length + reviewsFor(state.tasks.values(), "jow", true).length
  const counts = viewCounts(state, NOW, needs, tasksAwaitingPeople(state))
  const working = agents.filter((a) => a.load.current.length).length
  const noop = () => {}
  return (
    <div className="flex h-svh overflow-clip">
      <Rail rows={ROWS} news={NEWS} active="c1" onSelect={noop} onNew={noop} onComputers={noop} onSettings={noop} />
      <main className="relative flex min-w-0 flex-1 overflow-clip bg-canvas md:bg-rail">
        <div className="flex h-full min-w-0 flex-1">
          <ChannelSidebar
            title="channels-dev"
            icon={null}
            people="7 agents · 1 person"
            onTitle={noop}
            search={null}
            onSearch={noop}
            onAgents={noop}
            view={tab === "tasks" ? "everything" : null}
            counts={counts}
            onView={noop}
            agents={agents}
            onMessage={noop}
            onOpenTask={noop}
            conversations={[
              { key: "main", label: "# general", unread: 3, forMe: false, withMe: true },
              { key: "dm:jow:merry-llama", label: "merry-llama", unread: 0, forMe: false, withMe: true },
            ]}
            current={null}
            onConversation={noop}
          />
          <div className="relative flex min-w-0 flex-1 md:sheet">
            <div className="relative flex min-w-0 flex-1 flex-col bg-canvas" style={{ "--head": "52px" } as CSSProperties}>
              <Head heading={tab === "tasks" ? "Everything" : "Agents"} status={`${working} working · 2 merged today · ${needs} needs you`} tab={tab} />
              <div className="absolute inset-0 overflow-y-auto pt-[calc(var(--head)+8px)]">
                <div className={cx("mx-auto w-full px-2 md:px-4", tab === "tasks" && "max-w-[960px]")}>{children}</div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

function Mock() {
  const [s, setS] = useState<Seeded | null>(null)
  useEffect(() => {
    void seed().then(setS)
  }, [])
  if (!s) return null
  return (
    <Harnesses.Provider value={new Map(s.agents.map((a) => [a.name, a.model === "gpt-5-codex" ? "codex" : "claude-code"]))}>
      <Views s={s} />
    </Harnesses.Provider>
  )
}

function Views({ s }: { s: Seeded }) {
  const nameOf = (n: string) => n
  const drag = params.get("drag") === "1"
  if (direction === "b")
    return (
      <Shell s={s} tab="tasks">
        <HandOff state={s.state} agents={s.agents} now={NOW} nameOf={nameOf} choosing={params.get("choose") === "1" ? s.ids.t1705! : null} />
      </Shell>
    )
  if (direction === "c")
    return (
      <Shell s={s} tab="agents">
        <Bottlenecks state={s.state} agents={s.agents} now={NOW} nameOf={nameOf} />
      </Shell>
    )
  return (
    <Shell s={s} tab="agents">
      <Dispatch
        state={s.state}
        agents={s.agents}
        now={NOW}
        nameOf={nameOf}
        mode={params.get("mode") === "hold" ? "hold" : "auto"}
        {...(drag ? { demo: { dragging: s.ids.t1711!, over: "keen-pelican" } } : {})}
      />
    </Shell>
  )
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Mock />
  </StrictMode>
)
