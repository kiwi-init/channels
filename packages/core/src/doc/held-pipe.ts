export type PipeOut = { _tag: "Update"; u: string } | { _tag: "Aware"; u: string } | { _tag: "Ready" };

export interface PipeIn {
  update(u: string): void;
  aware(state: Record<string, unknown> | null): void;
  close(): void;
}

export function heldPipe(): { pipe: PipeIn; attach: (real: PipeIn) => void } {
  let real: PipeIn | null = null;
  let closed = false;
  const queued: ((p: PipeIn) => void)[] = [];
  const via = (f: (p: PipeIn) => void): void => {
    if (closed) return;
    if (real) f(real);
    else queued.push(f);
  };
  return {
    pipe: {
      update: (u) => via((p) => p.update(u)),
      aware: (state) => via((p) => p.aware(state)),
      close: () => {
        closed = true;
        queued.length = 0;
        real?.close();
      },
    },
    attach: (p) => {
      if (closed) return p.close();
      real = p;
      for (const f of queued.splice(0)) f(p);
    },
  };
}
