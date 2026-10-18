import { createContext, useContext } from "react"

import type { JoinRequest, Member as RosterMember } from "@kiwi/core/membership.ts"
import type { Persona } from "@kiwi/core/personality.ts"
import type { Event } from "@kiwi/core/protocol.ts"
import type { Scope } from "@kiwi/core/scopes.ts"
import type { ChannelState } from "@kiwi/core/state.ts"

export type Confirm =
  | { kind: "approve"; req: JoinRequest }
  | { kind: "remove"; member: RosterMember }
  | { kind: "role"; member: RosterMember }
  | { kind: "scopes"; member: RosterMember }
  | { kind: "persona"; member: RosterMember }
  | { kind: "nickname"; member: RosterMember }
  | { kind: "close" }
  | { kind: "leave" }
  | null

export interface ControlsProps {
  code: string
  myKey: string
  isOwner: boolean
  roster: RosterMember[]
  requests: JoinRequest[]
  online: Map<string, unknown>
  state: ChannelState
  now: number
  onApprove: (r: JoinRequest, scopes?: Scope[], persona?: Persona) => Promise<void>
  onDeny: (r: JoinRequest) => Promise<void>
  onCheck: (r: JoinRequest) => Promise<void>
  onRemove: (m: RosterMember) => Promise<void>
  onScopes?: (m: RosterMember, scopes: Scope[]) => Promise<void>
  onPersona?: (m: RosterMember, persona: Persona | null) => Promise<void>
  onRole: (ev: Extract<Event, { op: "role.set" | "role.refuse" }>) => Promise<void>
  onNickname?: (m: RosterMember, nickname: string | null) => Promise<void>
  onCloseChannel: () => Promise<void>
  onLeaveChannel: () => Promise<void>
  onRename?: (name: string) => Promise<void>
  onHold?: (on: boolean, note?: string) => Promise<void>
  onCharter?: (text: string | null) => Promise<void>
  onRepos?: (repos: string[]) => Promise<void>
  onVoice?: (on: boolean) => Promise<void>
  title?: string
  roomId?: string
}

export interface Api {
  p: ControlsProps
  busy: boolean
  run: (fn: () => Promise<void>, done: string) => Promise<void>
  ask: (c: Confirm) => void
  openRequests: () => void
  openInvite: () => void
  setLead: (m: RosterMember, on: boolean) => Promise<void>
  setRole: (ev: Extract<Event, { op: "role.set" | "role.refuse" }>) => Promise<void>
  editRole: (m: RosterMember) => void
  editScopes: (m: RosterMember) => void
  editPersona: (m: RosterMember) => void
  editNickname: (m: RosterMember) => void
  lastSeenOf: (name: string) => number | null
  onlineNow: (name: string) => boolean
  openDialog: (d: "rename" | "charter" | "repos") => void
}

export const Ctx = createContext<Api | null>(null)

export const useControls = () => useContext(Ctx)!
