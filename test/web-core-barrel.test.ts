import { expect, test } from "bun:test";
import { Glob } from "bun";

const valuesFromBarrel = (text: string): string[] =>
  [...text.matchAll(/^import \{([^}]*)\} from "@kiwi\/core\/client\.ts"/gm)].flatMap(([, names = ""]) =>
    names
      .split(",")
      .map((n) => n.trim())
      .filter((n) => n && !n.startsWith("type ")),
  );

test("the dashboard takes values from @kiwi/core's client submodules, never the client.ts barrel, which pulls the whole Channel into the first load", async () => {
  const offenders: string[] = [];
  for (const file of new Glob("web/src/**/*.{ts,tsx}").scanSync()) {
    if (/\.test\.tsx?$/.test(file)) continue;
    for (const name of valuesFromBarrel(await Bun.file(file).text())) offenders.push(`${file}: ${name}`);
  }
  expect(offenders).toEqual([]);
});
