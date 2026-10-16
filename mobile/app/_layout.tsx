import "../src/platform/install"
import { Stack } from "expo-router"
import { StatusBar } from "expo-status-bar"

import { useInter } from "../src/ui/fonts"
import { Toaster } from "../src/ui/Toast"

export default function Layout() {
  const ready = useInter()
  if (!ready) return null
  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }} />
      <Toaster />
    </>
  )
}
