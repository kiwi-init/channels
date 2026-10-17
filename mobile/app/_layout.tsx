import "../src/platform/install"
import type { ReactNode } from "react"
import { Stack } from "expo-router"
import { StatusBar } from "expo-status-bar"

import { deviceAuth } from "../src/lib/deviceAuth"
import { createEngine, EngineProvider, usePerson, type Services } from "../src/lib/EngineProvider"
import { secrets } from "../src/lib/keychain"
import { history, sql } from "../src/lib/sqlite"
import { useInter } from "../src/ui/fonts"
import { AppLock } from "../src/ui/AppLock"
import { Toaster } from "../src/ui/Toast"

const services: Services = { engine: createEngine(secrets), history, sql }

function Gate({ children }: { children: ReactNode }) {
  return (
    <AppLock enabled={!!usePerson()} auth={deviceAuth}>
      {children}
    </AppLock>
  )
}

export default function Layout() {
  const ready = useInter()
  if (!ready) return null
  return (
    <EngineProvider services={services}>
      <StatusBar style="auto" />
      <Gate>
        <Stack screenOptions={{ headerShown: false }} />
      </Gate>
      <Toaster />
    </EngineProvider>
  )
}
