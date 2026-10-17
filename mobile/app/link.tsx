import { useRouter } from "expo-router"

import { useEngine } from "../src/lib/EngineProvider"
import { LinkPhone } from "../src/screens/LinkPhone"

export default function Link() {
  const router = useRouter()
  return <LinkPhone engine={useEngine()} onLinked={() => router.replace("/")} onCancel={() => router.back()} />
}
