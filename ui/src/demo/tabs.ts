import type { ChannelTile } from "~/model"

const now = Date.now()
const m = (min: number) => now - min * 60_000

const BOOK = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#0b0b0c"/><path d="M7 9.5c3.200-1.200 6.400-1 9 1 2.600-2 5.800-2.200 9-1v13c-3.200-1.200-6.400-1-9 1-2.600-2-5.800-2.200-9-1z" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/><path d="M16 10.500v13" stroke="#fff" stroke-width="2"/></svg>`
)}`

const tile = (code: string, title: string, more: Partial<ChannelTile> = {}): ChannelTile => ({ code, title, state: "member", unread: 0, needsYou: 0, last: m(5), ...more })

export const TABS_3: ChannelTile[] = [tile("kiwi", "kiwi"), tile("um", "Um", { needsYou: 1 }), tile("reedy", "Reedy", { icon: BOOK })]

export const TABS_8: ChannelTile[] = [
  ...TABS_3,
  tile("landing", "landing page redesign", { unread: 4 }),
  tile("livewire", "electrobun-livewire"),
  tile("interlinked", "interlinked", { muted: true }),
  tile("notes", "kiwinotes", { needsYou: 12 }),
  tile("ops", "ops", { state: "waiting" }),
]
