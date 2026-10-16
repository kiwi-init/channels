import { useLocalSearchParams, useRouter } from "expo-router"

import { useEngine } from "../../src/lib/EngineProvider"
import { Join } from "../../src/screens/Join"

export default function JoinLink() {
  const router = useRouter()
  const { code } = useLocalSearchParams<{ code: string }>()
  return <Join engine={useEngine()} initialCode={code} onJoined={(joined) => router.replace({ pathname: "/channel/[code]", params: { code: joined } })} />
}
