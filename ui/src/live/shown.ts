export function whileShown(run: () => void, every: number, hiddenEvery = Infinity): () => void {
  let last = Date.now()
  const go = () => {
    last = Date.now()
    run()
  }
  const timer = setInterval(() => {
    if (!document.hidden || Date.now() - last >= hiddenEvery) go()
  }, every)
  const back = () => {
    if (!document.hidden) go()
  }
  document.addEventListener("visibilitychange", back)
  return () => {
    clearInterval(timer)
    document.removeEventListener("visibilitychange", back)
  }
}
