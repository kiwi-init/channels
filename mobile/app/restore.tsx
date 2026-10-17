import { useRouter } from "expo-router"
import { Linking } from "react-native"

import { fetchAccountBackup, restoreFromBackup } from "../src/lib/account"
import { useEngine } from "../src/lib/EngineProvider"
import { relayUrl } from "../src/lib/relay"
import { signIn } from "../src/lib/signIn"
import { Restore } from "../src/screens/Restore"
import { toast } from "../src/ui/Toast"

export default function RestoreRoute() {
  const router = useRouter()
  const engine = useEngine()
  const relay = relayUrl()
  return (
    <Restore
      signIn={(on) => signIn({ relay, open: (url) => Linking.openURL(url), devName: "phone" }, on)}
      fetchBackup={(token) => fetchAccountBackup(relay, token)}
      restore={(envelope, words) => restoreFromBackup(engine, envelope, words)}
      onDone={(done) => {
        toast(`Signed in as ${done.name}. ${done.channels} ${done.channels === 1 ? "channel" : "channels"}.`)
        router.replace("/")
      }}
      onCancel={() => router.back()}
    />
  )
}
