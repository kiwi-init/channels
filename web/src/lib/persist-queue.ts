/**
 * One persist at a time. The snapshot is already visible; this only orders the
 * writes so two overlapping saveChannels can't last-write-wins on disk.
 * A failed job does not block the next.
 */
export function persistQueue(): (job: () => Promise<void>) => Promise<void> {
  let tail: Promise<void> = Promise.resolve()
  return (job) => {
    const run = tail.then(job, job)
    tail = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }
}
