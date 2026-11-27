const READS: Readonly<Record<string, (sub: string | undefined) => boolean>> = {
  status: () => true,
  show: () => true,
  log: () => true,
  query: () => true,
  rooms: () => true,
  specs: () => true,
  claims: () => true,
  task: (sub) => sub === undefined || sub === "show" || sub === "who",
  spec: (sub) => sub === "show",
};

export function readsOnly(command: readonly string[]): boolean {
  return READS[command[0] ?? ""]?.(command[1]) ?? false;
}
