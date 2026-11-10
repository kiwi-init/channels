import { useEffect, useState } from "react"

export const LATE_MS = 400

export function useLate(waiting: boolean, ms: number = LATE_MS): boolean {
  const [late, setLate] = useState(false)
  useEffect(() => {
    if (!waiting) return
    const timer = setTimeout(() => setLate(true), ms)
    return () => {
      clearTimeout(timer)
      setLate(false)
    }
  }, [waiting, ms])
  return waiting && late
}
