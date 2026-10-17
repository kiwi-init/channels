import type { Place } from "@/lib/threads"

export type Here = Exclude<Place, { kind: "task" }>

export type Side = { kind: "thread"; root: number } | { kind: "info" } | { kind: "tasks"; task: number | null; via?: "overview" } | null

export type Unread = { n: number; forMe: boolean }
