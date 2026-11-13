import { fromB64url } from "@kiwi/core/crypto.ts"
import { restoreThread } from "@kiwi/core/doc/blocks.ts"
import type { ChannelLink } from "@kiwi/channel/channel-ops.ts"
import type { DocVersion } from "~/model"
import { appCan } from "~/live/app-can"
import type { PipeIn } from "@kiwi/core/doc/held-pipe.ts"
import type { DocEvent } from "../../../../desktop/src/bridge.ts"
import { withLiveDoc } from "~/chat/doc/live"

type OpenThreadDoc = (th: string, on: (e: DocEvent) => void) => PipeIn

const WAIT_MS = 15_000
const LINGER_MS = 5_000

export async function versionsOf(link: ChannelLink, th: string): Promise<DocVersion[]> {
  return (await appCan("docVersions")) ? link.docVersions(th) : []
}

export async function restoreOf(link: ChannelLink, thread: string, th: string, upto: number): Promise<boolean> {
  if (!(await appCan("docVersionState"))) return false
  const state = await link.docVersionState(thread, th, upto)
  return state ? restoreVersion((at, on) => link.doc(thread, at, on), th, fromB64url(state)) : false
}

function restoreVersion(open: OpenThreadDoc, th: string, version: Uint8Array): Promise<boolean> {
  return withLiveDoc(
    (at, on) => open(at ?? th, on),
    th,
    { wait: WAIT_MS, linger: LINGER_MS },
    (doc) => restoreThread(doc, version)
  )
}
