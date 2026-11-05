export function sendsInTurn(): <T>(run: () => Promise<T>) => Promise<T> {
  let last: Promise<unknown> = Promise.resolve();
  return <T>(run: () => Promise<T>): Promise<T> => {
    const next = last.then(run, run);
    last = next.catch(() => undefined);
    return next;
  };
}
