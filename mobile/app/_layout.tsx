import "../src/platform/install"
import { Stack } from "expo-router"
import { StatusBar } from "expo-status-bar"

import { createEngine, EngineProvider, type Services } from "../src/lib/EngineProvider"
import { secrets } from "../src/lib/keychain"
import { history, sql } from "../src/lib/sqlite"
import { useInter } from "../src/ui/fonts"
import { Toaster } from "../src/ui/Toast"

const services: Services = { engine: createEngine(secrets), history, sql }

export default function Layout() {
  const ready = useInter()
  if (!ready) return null
  return (
    <EngineProvider services={services}>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }} />
      <Toaster />
    </EngineProvider>
  )
}
