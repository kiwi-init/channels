import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react"

import { createEngine, type Engine } from "./engine"
import type { HistoryDb, Sql } from "./history"

export interface Services {
  engine: Engine
  history: HistoryDb
  sql: Sql | null
}

const Context = createContext<Services | null>(null)

export function EngineProvider({ services, children }: { services: Services; children: ReactNode }) {
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    let live = true
    void services.engine.load().finally(() => live && setLoaded(true))
    return () => {
      live = false
    }
  }, [services])
  if (!loaded) return null
  return <Context.Provider value={services}>{children}</Context.Provider>
}

export function useServices(): Services {
  const services = useContext(Context)
  if (!services) throw new Error("no EngineProvider above this screen")
  return services
}

export function useEngine(): Engine {
  return useServices().engine
}

export function useSeats(): { joined: ReturnType<Engine["joined"]>; waiting: ReturnType<Engine["waiting"]> } {
  const engine = useEngine()
  const version = useSyncExternalStore(
    (listener) => engine.subscribe(listener),
    () => engine.seats()
  )
  return useMemo(() => ({ joined: version.filter((seat) => !!seat.access), waiting: version.filter((seat) => !seat.access) }), [version])
}

export function usePerson(): ReturnType<Engine["person"]> {
  const engine = useEngine()
  useSyncExternalStore(
    (listener) => engine.subscribe(listener),
    () => engine.person()
  )
  return engine.person()
}

export { createEngine }
