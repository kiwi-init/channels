export interface FailureBox {
  type: "error";
  message: string;
  detail: string;
}

export interface FailureDeps {
  log(err: Error): void;
  say(line: string): void;
  box(box: FailureBox): Promise<unknown>;
  quit(code: number): void;
  logFile(): string;
}

interface FailureAsk {
  code?: number;
  closing?: boolean;
  cause?: unknown;
}

const sentence = (why: string): string => {
  const text = why.trim().replace(/[.;:,\s]+$/, "");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
};

export const failureBox = (why: string, log: string, closing = false): FailureBox => ({
  type: "error",
  message: closing ? "Channels had to close" : "Channels couldn't start",
  detail: `${sentence(why)}\n\nOpen Channels again. If it keeps failing, the details are in ${log}`,
});

export interface Failing {
  releaseFirst(release: () => void): void;
  fail(why: string, ask?: FailureAsk): Promise<void>;
}

export function failing(deps: FailureDeps): Failing {
  let release: () => void = () => {};
  let said = false;
  return {
    releaseFirst: (fn) => void (release = fn),
    fail: async (why, ask = {}) => {
      if (said) return;
      said = true;
      const code = ask.code ?? 1;
      deps.log(new Error(why, ask.cause === undefined ? undefined : { cause: ask.cause }));
      deps.say(`Channels: ${why}`);
      try {
        release();
        await deps.box(failureBox(why, deps.logFile(), ask.closing));
      } catch (e) {
        // The box couldn't show or the lock couldn't be let go: main.log has the reason, and the app still quits.
        deps.log(e instanceof Error ? e : new Error(String(e)));
      }
      deps.quit(code);
    },
  };
}

export function heldWithin(waits: readonly number[], load: () => void, onRefused: (seen: () => void) => void, onLate: (waited: number) => void): Promise<boolean> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let done = false;
    const end = (held: boolean): void => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      resolve(held);
    };
    const attempt = (i: number): void => {
      const wait = waits[i];
      if (wait === undefined) return end(false);
      timer = setTimeout(() => {
        onLate(wait);
        attempt(i + 1);
      }, wait);
      load();
    };
    onRefused(() => end(true));
    attempt(0);
  });
}
