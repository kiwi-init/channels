import { createContext, useContext } from "react"

import type { JoinRequest, Member as RosterMember } from "@kiwi/core/membership.ts"
import type { Persona, Personality } from "@kiwi/core/personality.ts"
import type { ChannelIcon } from "@kiwi/core/protocol.ts"
import type { Scope } from "@kiwi/core/scopes.ts"
import type { ChannelState } from "@kiwi/core/state.ts"
import type { LogExport } from "@/lib/log-export"

export type Confirm =
  | { kind: "approve"; req: JoinRequest }
  | { kind: "remove"; member: RosterMember }
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
  /** An agent's one status (agent-strip.tsx agentNow), so details says what the sidebar and Agents tab say. */
  statusOf?: (name: string) => { text: string; busy: boolean } | undefined
  state: ChannelState
  now: number
  onApprove: (r: JoinRequest, scopes?: Scope[], persona?: Persona) => Promise<void>
  onDeny: (r: JoinRequest) => Promise<void>
  onCheck: (r: JoinRequest) => Promise<void>
  onRemove: (m: RosterMember) => Promise<void>
  onScopes?: (m: RosterMember, scopes: Scope[]) => Promise<void>
  onPersona?: (m: RosterMember, persona: Persona | null) => Promise<void>
  onPin?: (p: Personality) => Promise<string>
  onNickname?: (m: RosterMember, nickname: string | null) => Promise<void>
  onCloseChannel: () => Promise<void>
  onLeaveChannel: () => Promise<void>
  exportLog: () => Promise<LogExport>
  onRename?: (name: string) => Promise<void>
  onIcon?: (icon: ChannelIcon | null) => Promise<void>
  onHold?: (on: boolean, note?: string) => Promise<void>
  onCharter?: (text: string | null) => Promise<void>
  onRepos?: (repos: string[]) => Promise<void>
  onVoice?: (on: boolean) => Promise<void>
  onGithubWrite?: (on: boolean) => Promise<void>
  onBranchPrefix?: (prefix: string | null) => Promise<void>
  title?: string
  roomId?: string
}

export interface Api {
  p: ControlsProps
  busy: boolean
  run: (fn: () => Promise<void>, done: string) => Promise<void>
  ask: (c: Confirm) => void
  editScopes: (m: RosterMember) => void
  editPersona: (m: RosterMember) => void
  editNickname: (m: RosterMember) => void
  lastSeenOf: (name: string) => number | null
  onlineNow: (name: string) => boolean
  openDialog: (d: "rename" | "charter" | "branch") => void
}

export const Ctx = createContext<Api | null>(null)

export const useControls = () => useContext(Ctx)!
