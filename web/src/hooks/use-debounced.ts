import { useEffect, useState } from "react"

export function useDebounced<T>(value: T, ms: number, now: (value: T) => boolean = () => false): T {
  const [settled, setSettled] = useState(value)
  const immediate = now(value)
  if (immediate && !Object.is(settled, value)) setSettled(value)
  useEffect(() => {
    if (immediate) return
    const t = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(t)
  }, [value, ms, immediate])
  return immediate ? value : settled
}
