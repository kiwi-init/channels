import { EVENT_WORDS, type EventKey } from "@kiwi/core/event-words.ts"

type Events = { readonly [K in EventKey as `events.${K}`]: (typeof EVENT_WORDS)[K] }

export default Object.fromEntries(Object.entries(EVENT_WORDS).map(([key, text]) => [`events.${key}`, text])) as Events
