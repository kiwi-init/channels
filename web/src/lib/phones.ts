import { bridge, type LinkAskView, type PhoneView } from "./secrets"

export type { LinkAskView }

class LinkingNeedsApp extends Error {
  constructor() {
    super("Linking a phone needs the Kiwi desktop app.")
  }
}

export interface Linking {
  code: string
  next: (signal: AbortSignal) => Promise<LinkAskView | null>
  answer: (accept: boolean) => Promise<PhoneView | null>
  cancel: () => Promise<void>
}

export async function beginLinking(): Promise<Linking> {
  const b = bridge()
  if (!b) throw new LinkingNeedsApp()
  const { code } = await b.linkBegin()
  return {
    code,
    next: async (signal) => {
      while (!signal.aborted) {
        const ask = await b.linkPoll()
        if (ask) return ask
        await new Promise((r) => setTimeout(r, 1500))
      }
      return null
    },
    answer: (accept) => b.linkAnswer(accept),
    cancel: () => b.linkCancel(),
  }
}
