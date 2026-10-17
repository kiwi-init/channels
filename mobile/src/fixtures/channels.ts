import type { ChannelIcon } from "@mc/protocol.ts"

import type { ChannelRowView, RowNewsView } from "../ui/ChannelList"

export const NOW = Date.UTC(2026, 9, 16, 15, 0, 0)

const minutes = (n: number) => NOW - n * 60_000
const days = (n: number) => NOW - n * 86_400_000

export const fixtureRows: ChannelRowView[] = [
  { code: "c-dev", room: "r-dev", title: "channels-dev", state: "member", agents: 0, ts: minutes(3), recent: { from: "kiwi-sh", text: "T600 is yours, start after T500", byCoordinator: true } },
  { code: "c-ops", room: "r-ops", title: "Ops", state: "member", agents: 0, ts: minutes(50), recent: { from: "merge-bus", text: "bus is green, three landed" } },
  { code: "c-design", room: "r-design", title: "Design", state: "member", agents: 0, ts: days(1), recent: { from: "claude-3", text: "annotator is in review" } },
  { code: "c-quiet", room: "r-quiet", title: "Quiet", state: "member", agents: 0, ts: days(9), recent: null },
  { code: "c-wait", room: "r-wait", title: "Friends", state: "pending", agents: 0, ts: days(2), recent: null },
  { code: "c-agents", room: "r-agents", title: "Home lab", state: "agents", agents: 2, ts: days(3), recent: null },
  { code: "c-one", room: "r-one", title: "Side project", state: "agents", agents: 1, ts: days(3), recent: null },
]

export const fixtureNews: RowNewsView[] = [
  { fresh: true, needs: 0 },
  { fresh: false, needs: 2 },
  { fresh: true, needs: 1 },
  { fresh: false, needs: 0 },
  { fresh: false, needs: 0 },
  { fresh: false, needs: 0 },
  { fresh: false, needs: 0 },
]

export const fixtureIcons: ReadonlyMap<string, ChannelIcon> = new Map<string, ChannelIcon>([["r-ops", { kind: "emoji", emoji: "🛠" }]])
