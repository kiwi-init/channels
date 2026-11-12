const FRAMES = 8;

export interface Observers {
  late: string[];
  ran: string[];
}

export interface PageError {
  message: string;
  stack?: string;
  after: string;
  observers?: Observers;
}

function frames(message: string, stack: string | undefined): string[] {
  return (stack ?? "")
    .split("\n")
    .map((l) => l.replace(/https?:\/\/[^/\s)]+\//g, "").trim())
    .filter((l) => l && !l.includes(message.trim()))
    .slice(0, FRAMES);
}

export function observerLines(seen: Observers): string[] {
  return [
    ...(seen.late.length ? ["changed size after its observer last ran:", ...seen.late.map((l) => `  ${l}`)] : ["no watched element had changed size when the error came"]),
    ...(seen.ran.length ? ["resize observers that ran just before:", ...seen.ran.map((l) => `  ${l}`)] : ["no resize observer ran just before"]),
  ];
}

export function describePageError(e: PageError): string {
  const stack = frames(e.message, e.stack);
  return [
    e.message.trim(),
    e.after ? `after: ${e.after}` : "before anything was printed",
    ...(stack.length ? ["stack:", ...stack.map((l) => `  ${l}`)] : ["stack: the engine gave none"]),
    ...(e.observers ? observerLines(e.observers) : []),
  ].join("\n    ");
}
