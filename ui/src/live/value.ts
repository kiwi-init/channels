export type Listener = () => void

export function store<T>(initial: T) {
  let value = initial
  const listeners = new Set<Listener>()
  return {
    get: () => value,
    set: (next: T) => {
      value = next
      for (const l of listeners) l()
    },
    subscribe: (l: Listener) => {
      listeners.add(l)
      return () => void listeners.delete(l)
    },
  }
}
