const PRESS_EVERY_MS = 50
const PRESS_FOR_MS = 5000

export function refuseCopies(): void {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: () => Promise.reject(new DOMException("Write permission denied.", "NotAllowedError")) },
  })
}

export function pressCopyOnceReady(): () => void {
  const started = Date.now()
  const timer = setInterval(() => {
    const copy = document.querySelector<HTMLButtonElement>(".invite-box .icon-btn:not(:disabled)")
    if (copy) copy.click()
    if (copy || Date.now() - started > PRESS_FOR_MS) clearInterval(timer)
  }, PRESS_EVERY_MS)
  return () => clearInterval(timer)
}
