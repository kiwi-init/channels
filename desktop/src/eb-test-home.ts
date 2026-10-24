import path from "node:path";

export function testHomeProblem(dataDir: string, fakeHome: string | undefined): string | null {
  if (!fakeHome || !path.isAbsolute(fakeHome)) return "a test build runs only with CFFIXED_USER_HOME set to a temp home, and it isn't";
  const inside = path.relative(fakeHome, dataDir);
  if (inside === "" || inside.startsWith("..") || path.isAbsolute(inside))
    return `its data folder ${dataDir} isn't under the temp home ${fakeHome}: Bun follows HOME, so HOME must be the temp home too`;
  return null;
}
