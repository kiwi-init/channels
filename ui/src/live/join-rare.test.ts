import { expect, mock, test } from "bun:test"

import * as auth from "@kiwi/app/auth.ts"
import * as join from "@kiwi/channel/join.ts"
import * as channelOps from "@kiwi/channel/channel-ops.ts"
import type { StoredMember } from "@kiwi/channel/store.ts"

const member: StoredMember = { code: "mc2-new", identity: { name: "jow", pk: "pk" }, access: {} as StoredMember["access"], at: 0 }
let iconAsked = 0

mock.module("@kiwi/app/auth.ts", () => ({ ...auth, tokenForCreate: async () => null }))
mock.module("@kiwi/channel/join.ts", () => ({ ...join, createChannel: async () => member }))
mock.module("@kiwi/channel/channel-ops.ts", () => ({
  ...channelOps,
  linkOf: () => ({
    setIcon: () => {
      iconAsked++
      return new Promise(() => {})
    },
  }),
}))

const { newChannel } = await import("~/live/join-rare")

test("a new channel opens as soon as the relay made it, while its icon is still on its way", async () => {
  const opened = await Promise.race([newChannel("Kiwi"), new Promise<null>((ok) => setTimeout(() => ok(null), 1000))])
  expect(opened).toBe("mc2-new")
  expect(iconAsked).toBe(1)
})
