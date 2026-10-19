export const CHECK_EVERY_MS = 30_000;
const FIRST_RETRY_MS = 5_000;
const MAX_RETRY_MS = 5 * 60_000;

export interface KeeperDeps {
  hello: () => Promise<boolean>;
  start: () => Promise<boolean>;
  log: (line: string) => void;
  stopped: () => boolean;
  wait: (ms: number) => Promise<void>;
}

export const retryAfter = (failures: number): number => Math.min(FIRST_RETRY_MS * 2 ** Math.max(0, failures - 1), MAX_RETRY_MS);

export async function keepAlive(d: KeeperDeps): Promise<void> {
  let failures = 0;
  while (!d.stopped()) {
    await d.wait(failures ? retryAfter(failures) : CHECK_EVERY_MS);
    if (d.stopped()) return;
    if (await d.hello()) {
      failures = 0;
      continue;
    }
    const up = await d.start();
    failures = up ? 0 : failures + 1;
    d.log(up ? "the daemon wasn't answering; started it again" : `the daemon wasn't answering and didn't start (try ${failures}); trying again in ${retryAfter(failures) / 1000}s`);
  }
}
