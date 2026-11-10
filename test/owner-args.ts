const VALUED = new Set(["--as", "--role", "--about", "--name", "-c"]);
const SWITCHES = new Set(["--open", "--yes", "--json"]);

export function ownerArgs(argv: readonly string[]): { opt: Record<string, string | true>; args: string[] } {
  const opt: Record<string, string | true> = {};
  const args: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (SWITCHES.has(a)) opt[a.slice(2)] = true;
    else if (VALUED.has(a)) opt[a.replace(/^-+/, "")] = argv[++i]!;
    else args.push(a);
  }
  return { opt, args };
}
