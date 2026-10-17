import { useRouter } from "expo-router"

import { useEngine, usePerson, useSeats } from "../src/lib/EngineProvider"
import { ChannelList } from "../src/screens/ChannelList"
import { FirstRun } from "../src/screens/FirstRun"

export default function Home() {
  const router = useRouter()
  const engine = useEngine()
  const person = usePerson()
  const { joined, waiting } = useSeats()
  if (!person) return <FirstRun onContinue={async (name) => void (await engine.createPerson(name))} onLink={() => router.push("/link")} />
  return (
    <ChannelList
      joined={joined}
      waiting={waiting}
      onOpen={(code) => router.push({ pathname: "/channel/[code]", params: { code } })}
      onOpenWaiting={(code) => router.push({ pathname: "/join/[code]", params: { code } })}
      onJoin={() => router.push("/join")}
    />
  )
}
