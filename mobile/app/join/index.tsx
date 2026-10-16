import { useRouter } from "expo-router"

import { useEngine } from "../../src/lib/EngineProvider"
import { Join } from "../../src/screens/Join"

export default function JoinPaste() {
  const router = useRouter()
  return <Join engine={useEngine()} onJoined={(code) => router.replace({ pathname: "/channel/[code]", params: { code } })} />
}
