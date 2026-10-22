import { useEffect, useState } from "react"

const SLOW_MS = 1000

export function useLater(on: boolean, ms = SLOW_MS): boolean {
  const [was, setWas] = useState(on)
  const [late, setLate] = useState(false)
  if (was !== on) {
    setWas(on)
    setLate(false)
  }
  useEffect(() => {
    if (!on) return
    const t = setTimeout(() => setLate(true), ms)
    return () => clearTimeout(t)
  }, [on, ms])
  return on && late
}
