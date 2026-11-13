import { useEffect, useState } from "react"
import type {} from "./room-members-api.ts"
import { createRoot } from "react-dom/client"
import "~/styles/tokens.css"
import "~/styles/base.css"
import "~/styles/shell.css"
import { useDemo } from "./provider.tsx"
import type { Channel } from "../model.ts"
import { ChannelSettings } from "../modals/channel-settings.tsx"
import { AppContext, startNav } from "../nav.ts"

const saved: string[][] = []

function Page() {
  const demo = useDemo("full", "kiwi")
  const [channel, setChannel] = useState<Channel>(() => {
    const c = demo.channel
    if (!c) throw new Error("missing demo channel")
    return {
      ...c,
      people: [
        ...c.people.filter((p) => ["jow", "maya", "atlas", "win", "pixel"].includes(p.name)),
        { name: "maya-phone", kind: "human", owner: false, you: false, seatOf: "maya", presence: "online", lastSeen: Date.now(), joined: Date.now(), messages: 0 },
      ],
      rooms: [{ id: "probe", name: "launch-plan", unread: 0, mentions: 0, members: ["jow", "maya-phone", "atlas", "scout"] }],
    }
  })
  const [fail, setFail] = useState(false)
  useEffect(() => {
    window.roomCheck = {
      saved,
      update: (members) => setChannel((c) => ({ ...c, rooms: c.rooms.map((r) => ({ ...r, members })) })),
      leave: (name, left) => setChannel((c) => ({ ...c, people: c.people.map((p) => (p.name === name ? { ...p, left } : p)) })),
      fail: setFail,
    }
  }, [])
  const app = {
    ...demo,
    channel,
    actions: {
      ...demo.actions,
      setRoomMembers: async (_code: string, _id: string, members: string[]) => {
        saved.push(members)
        if (fail || members.some((name) => !channel.people.some((p) => p.name === name && !p.left))) return false
        setChannel((c) => ({ ...c, rooms: c.rooms.map((r) => ({ ...r, members: ["jow", ...members] })) }))
        return true
      },
    },
  }
  return (
    <AppContext.Provider value={{ app, nav: startNav("kiwi"), go: () => {}, toast: () => {} }}>
      <ChannelSettings channel={channel} tab="rooms" onClose={() => {}} />
    </AppContext.Provider>
  )
}

const root = document.getElementById("root")
if (!root) throw new Error("missing root")
createRoot(root).render(<Page />)
