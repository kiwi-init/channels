import { Redirect, useLocalSearchParams, useRouter } from "expo-router"

import { useEngine, usePerson } from "../../src/lib/EngineProvider"
import { holdJoin } from "../../src/lib/pendingJoin"
import { Join } from "../../src/screens/Join"

export default function JoinLink() {
  const router = useRouter()
  const engine = useEngine()
  const person = usePerson()
  const { code } = useLocalSearchParams<{ code: string }>()
  if (!person) {
    holdJoin(code)
    return <Redirect href="/" />
  }
  return <Join engine={engine} initialCode={code} onJoined={(joined) => router.replace({ pathname: "/channel/[code]", params: { code: joined } })} />
}
