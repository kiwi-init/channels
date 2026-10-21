import { StrictMode, useState, type CSSProperties, type ReactNode } from "react"
import { createRoot } from "react-dom/client"

import "../index.css"
import { tasksAwaitingPeople } from "@kiwi/core/state.ts"
import { AgentLanes } from "@/components/agent-lanes"
import { StuckChains, TreeCanvas, TreeOutline } from "@/components/agent-tree"
import { ChannelSidebar } from "@/components/conversation/channel-sidebar"
import { Header } from "@/components/conversation/header"
import { Harnesses, Tabs } from "@/components/kit"
import { TasksView } from "@/components/tasks-view"
import { Ctx, type Api } from "@/components/controls/context"
import { useHeight } from "@/hooks/use-height"
import { chains, lineage } from "@/lib/tree"
import { cx } from "@/lib/utils"
import { viewCounts, type Tab } from "@/lib/views"
import { agents, channel, MESSAGES, NOW } from "./fixture"

type Direction = "list" | "request" | "tree" | "stuck" | "both" | "agents"

const params = new URLSearchParams(location.search)
const direction = (params.get("d") ?? "tree") as Direction
const theme = params.get("theme")
if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme

const state = channel()
const team = agents(state)
const roots = lineage(state, MESSAGES, NOW)
const stuck = chains(roots)
const asks = MESSAGES.filter((m) => m.esc)
const waiting = tasksAwaitingPeople(state)

const harnesses = new Map([...state.members.values()].flatMap((m) => (m.runs ? [[m.name, m.runs.harness] as const] : [])))

const nothing = async () => {}
const controls: Api = {
  p: {
    code: "mock",
    myKey: "pk-jow",
    isOwner: true,
    roster: [],
    requests: [],
    online: new Map(),
    state,
    now: NOW,
    onApprove: nothing,
    onDeny: nothing,
    onCheck: nothing,
    onRemove: nothing,
    onCloseChannel: nothing,
    onLeaveChannel: nothing,
    exportLog: () => Promise.reject(new Error("mock")),
  },
  busy: false,
  run: nothing,
  ask: () => {},
  editScopes: () => {},
  editPersona: () => {},
  editNickname: () => {},
  lastSeenOf: () => null,
  onlineNow: () => true,
  openDialog: () => {},
}

function Toolbar({ value }: { value: Direction }) {
  const [v, setV] = useState(value)
  return (
    <div className="flex items-center justify-between gap-3 px-3 pt-3">
      <p className="text-meta text-ink-3 max-md:hidden">Group the board</p>
      <div className="w-full md:w-72 md:shrink-0">
        <Tabs
          value={v}
          stretch
          label="Group the board"
          onChange={setV}
          options={[
            { value: "list", label: "By state" },
            { value: "request", label: "By request" },
            { value: "tree", label: "Tree" },
          ]}
        />
      </div>
    </div>
  )
}

function Body() {
  const board = (needs: ReactNode) => <TasksView state={state} now={NOW} view="everything" agents={team} needs={needs} open={null} onOpen={() => {}} />
  switch (direction) {
    case "tree":
      return (
        <>
          <Toolbar value="tree" />
          <TreeCanvas roots={roots} state={state} />
        </>
      )
    case "request":
      return (
        <>
          <Toolbar value="request" />
          <TreeOutline roots={roots} state={state} />
        </>
      )
    case "stuck":
      return board(<StuckChains chains={stuck} state={state} asks={asks} />)
    case "both":
      return (
        <>
          <div className="px-3">
            <StuckChains chains={stuck} state={state} asks={asks} />
          </div>
          <Toolbar value="request" />
          <TreeOutline roots={roots} state={state} />
        </>
      )
    case "agents":
      return <AgentLanes agents={team} state={state} messages={MESSAGES} now={NOW} nameOf={(n) => state.members.get(n)?.display ?? n} onOpenTask={() => {}} />
    case "list":
      return board(null)
  }
}

function Mock() {
  const [headRef, headH] = useHeight()
  const [search, setSearch] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>(direction === "agents" ? "agents" : "tasks")
  const wide = direction === "tree" || direction === "agents"
  return (
    <div className="flex h-svh overflow-clip">
      <main className="relative flex min-w-0 flex-1 overflow-clip bg-canvas md:bg-rail">
        <div className="hidden w-20 shrink-0 md:block" />
        <div className="flex h-full min-w-0 flex-1">
          <ChannelSidebar
            title="channels-dev"
            icon={null}
            people="6 agents · 1 person"
            onTitle={() => {}}
            search={search}
            onSearch={setSearch}
            onAgents={() => {}}
            view={tab === "tasks" ? "everything" : null}
            counts={viewCounts(state, NOW, 2, waiting)}
            onView={() => {}}
            agents={team}
            onMessage={() => {}}
            onOpenTask={() => {}}
            conversations={[{ key: "main", label: "# general", unread: 0, forMe: false, withMe: false }]}
            current={null}
            onConversation={() => {}}
          />
          <div className="relative flex min-w-0 flex-1 md:sheet">
            <div className="relative flex min-w-0 flex-1 flex-col bg-canvas" style={{ "--head": `${headH}px` } as CSSProperties}>
              <Header
                headRef={headRef}
                onBack={() => {}}
                search={search}
                setSearch={setSearch}
                tab={tab}
                onTab={setTab}
                heading={tab === "agents" ? "Agents" : "Everything"}
                wideHeading="channels-dev"
                headingLabel="Details: channels-dev"
                face={{ icon: null, title: "channels-dev" }}
                status={["5 working", "2 merged today", "2 need you"]}
                onTitle={() => {}}
                searchHint="Search this channel"
              />
              <div className="absolute inset-0 overflow-y-auto pt-[calc(var(--head)+8px)]">
                <div className={cx("mx-auto w-full px-2 md:px-4", !wide && "max-w-[960px]")}>
                  <Body />
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Ctx.Provider value={controls}>
      <Harnesses.Provider value={harnesses}>
        <Mock />
      </Harnesses.Provider>
    </Ctx.Provider>
  </StrictMode>
)
