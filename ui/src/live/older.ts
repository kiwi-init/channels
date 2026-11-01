import { GENERAL_ROOM } from "@kiwi/core/protocol.ts"
import type { ChannelState } from "@kiwi/core/state.ts"
import type { IndexHit } from "../../../desktop/src/search-types.ts"
import { need } from "~/live/run"
import type { OlderHit, OlderSearch, Where } from "~/model"

const LIMIT = 200
const SPAN = 40

export function openRooms(state: Pick<ChannelState, "rooms">, me: string): string[] {
  const rooms = [...state.rooms.values()].filter((r) => !r.members || r.members.some((m) => m.name === me)).map((r) => r.id)
  return rooms.includes(GENERAL_ROOM) ? rooms : [GENERAL_ROOM, ...rooms]
}

export function whereOfRoom(state: Pick<ChannelState, "rooms">, me: string, room: string): Where {
  const r = state.rooms.get(room)
  const others = r?.dm ? (r.members ?? []).map((m) => m.name).filter((n) => n !== me) : []
  return others.length === 1 ? { kind: "dm", with: others[0]! } : { kind: "room", room }
}

const asOlder = (state: Pick<ChannelState, "rooms">, me: string, h: IndexHit): OlderHit => ({ seq: h.seq, from: h.from, text: h.text, at: h.at, where: whereOfRoom(state, me, h.room) })

export async function searchOlder(code: string, query: string, before: number): Promise<OlderSearch> {
  const run = need(code)
  const head = run.messages.at(-1)?.seq ?? 0
  const found = await run.ch.searchHistory({ query, rooms: openRooms(run.state, run.me), limit: LIMIT, head }).catch(() => null)
  if (!found) return { state: "none", hits: [] }
  return { state: found.state, hits: found.hits.filter((h) => h.seq < before).map((h) => asOlder(run.state, run.me, h)) }
}

export async function olderAround(code: string, seq: number): Promise<OlderHit[] | null> {
  const run = need(code)
  const hits = await run.ch.historyAround({ seq, rooms: openRooms(run.state, run.me), span: SPAN }).catch(() => null)
  return hits ? hits.map((h) => asOlder(run.state, run.me, h)) : null
}
