import { useLocalSearchParams, useRouter } from "expo-router"

import { ChannelScreen } from "../../src/screens/ChannelScreen"

export default function ChannelRoute() {
  const router = useRouter()
  const { code } = useLocalSearchParams<{ code: string }>()
  return <ChannelScreen code={code} onBack={() => router.back()} />
}
