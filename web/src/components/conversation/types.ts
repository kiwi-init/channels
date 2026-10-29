import type { Place } from "@kiwi/app/threads.ts"

export type Here = Exclude<Place, { kind: "task" }>

export type Side = { kind: "thread"; root: number } | { kind: "info" } | { kind: "tasks"; task: number } | null

export type { Unread } from "@kiwi/core/standup.ts"
