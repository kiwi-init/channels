import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { briefText } from "../src/brief.ts";
import { ModError, startDev } from "../src/mods.ts";
import { DEFAULT_SKILLS, fetched, listSkills, skillHome, skillsIn, skillText } from "../src/skills.ts";
import { kiwiCmd } from "./owner.ts";

setDefaultTimeout(60_000);

const made: string[] = [];
const scratch = (tag: string): string => {
  const d = mkdtempSync(join(tmpdir(), `kiwi-skills-${tag}-`));
  made.push(d);
  return d;
};
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

const ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", GIT_CONFIG_NOSYSTEM: "1" };
const sh = (cwd: string, ...args: string[]): string => execFileSync("git", args, { cwd, env: ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function skillRepo(): { dir: string; first: string; second: string } {
  const dir = scratch("src");
  sh(dir, "init", "--quiet", "--initial-branch", "main");
  mkdirSync(join(dir, "kit"));
  writeFileSync(join(dir, "kit", "draw.mjs"), "export const draw = 1\n");
  writeFileSync(
    join(dir, "SKILL.md"),
    "---\nname: gauge\ndescription: draws gauges\n---\n\n# Gauge\n\nImport `kit/draw.mjs`, read [the kit](kit/), then run `node kit/draw.mjs`. Leave `../outside` and `kit/missing.mjs` alone.\n",
  );
  sh(dir, "add", "-A");
  sh(dir, "commit", "--quiet", "-m", "first");
  const first = sh(dir, "rev-parse", "HEAD");
  writeFileSync(join(dir, "SKILL.md"), "# Gauge, second\n");
  sh(dir, "commit", "--quiet", "-am", "second");
  return { dir, first, second: sh(dir, "rev-parse", "HEAD") };
}

function modWith(home: string, name: string, skills: unknown[]): void {
  const dir = join(home, "mods", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "mod.json"), JSON.stringify({ name, version: "1.0.0", shell: "^3.6", needs: [], skills }));
}

describe("skills in mods (T6868)", () => {
  test("mod.json's skills are a path inside the mod or a git source pinned to a full commit; anything else is refused", () => {
    expect(skillsIn({ name: "x" }, "x")).toEqual([]);
    expect(skillsIn({ skills: [{ name: "inner", about: " a skill ", path: "skills/inner/" }] }, "x")).toEqual([
      { name: "inner", about: "a skill", note: null, mod: "x", path: "skills/inner/", source: null, ref: null, builtin: false },
    ]);
    expect(skillsIn({ skills: [{ name: "inner", about: "a skill", note: "Send it with kiwi send.", path: "inner" }] }, "x")[0]?.note).toBe("Send it with kiwi send.");
    const why = (skills: unknown) => {
      try {
        skillsIn({ skills }, "x");
        return "accepted";
      } catch (e) {
        expect(e).toBeInstanceOf(ModError);
        return (e as Error).message;
      }
    };
    expect(why("anatomy")).toBe("mod.json's skills must be a list");
    expect(why([{ name: "Big", about: "a" }])).toBe("a skill's name must be lowercase letters, digits and dashes");
    expect(why([{ name: "a", about: "two\nlines" }])).toBe("skill a: about is one line of up to 80 characters");
    expect(why([{ name: "a", about: "x".repeat(81) }])).toBe("skill a: about is one line of up to 80 characters");
    expect(why([{ name: "a", about: "x", note: "two\nlines", path: "p" }])).toBe("skill a: note is one line of up to 300 characters");
    expect(why([{ name: "a", about: "x", path: "../up" }])).toBe("skill a: path is a folder inside the mod");
    expect(why([{ name: "a", about: "x", path: "/abs" }])).toBe("skill a: path is a folder inside the mod");
    expect(why([{ name: "a", about: "x", path: "p", source: "github.com/o/r" }])).toBe("skill a: give a path or a source, not both");
    expect(why([{ name: "a", about: "x", source: "github.com/o/r", ref: "main" }])).toBe("skill a: ref is the full 40-character commit it's pinned to");
    expect(why([{ name: "a", about: "x", source: "github.com/o/r#main", ref: "a".repeat(40) }])).toBe("skill a: put the commit in ref, not after # in the source");
    expect(why([{ name: "a", about: "x", source: "--upload-pack=x", ref: "a".repeat(40) }])).not.toBe("accepted");
  });

  test("every home has the default mods' skills, a mod's own skills join them, and a broken mod.json adds none", () => {
    const home = scratch("home");
    expect(listSkills(home)).toEqual([...DEFAULT_SKILLS]);
    expect(DEFAULT_SKILLS.find((s) => s.name === "anatomy")).toMatchObject({ source: "github.com/wheresryan22/anatomy", ref: expect.stringMatching(/^[0-9a-f]{40}$/) });
    modWith(home, "zines", [{ name: "zine", about: "folded zines", path: "skills/zine" }]);
    mkdirSync(join(home, "mods", "broken"));
    writeFileSync(join(home, "mods", "broken", "mod.json"), "{ not json");
    expect(listSkills(home).map((s) => `${s.mod}/${s.name}`)).toEqual(["anatomy/anatomy", "channels/mods", "zines/zine"]);
  });

  test("kiwi skill fetches the pinned commit once into ~/.kiwi/skills, prints SKILL.md with paths to its files, and works offline after", () => {
    const home = scratch("home");
    const src = skillRepo();
    modWith(home, "gauges", [{ name: "gauge", about: "draws gauges", source: src.dir, ref: src.first }]);
    const skill = listSkills(home).find((s) => s.name === "gauge")!;
    expect(fetched(home, skill)).toBe(false);
    const dir = skillHome(home, skill);
    expect(dir).toBe(join(home, "skills", "gauge"));
    expect(sh(dir, "rev-parse", "HEAD")).toBe(src.first);
    expect(fetched(home, skill)).toBe(true);
    const text = skillText(skill, dir);
    expect(text.startsWith(`Skill "gauge", from ${src.dir} at ${src.first.slice(0, 7)}. Its files are in ${dir}, and the paths below point there.\n\n# Gauge\n`)).toBe(true);
    expect(text).not.toContain("description: draws gauges");
    expect(text).toContain(`Import \`${join(dir, "kit/draw.mjs")}\`, read [the kit](${join(dir, "kit")}/), then run \`node ${join(dir, "kit/draw.mjs")}\``);
    expect(text).toContain("Leave `../outside` and `kit/missing.mjs` alone.");

    renameSync(src.dir, `${src.dir}-gone`);
    expect(skillText(skill, skillHome(home, skill))).toContain("# Gauge\n");
    modWith(home, "gauges", [{ name: "gauge", about: "draws gauges", source: src.dir, ref: src.second }]);
    const moved = listSkills(home).find((s) => s.name === "gauge")!;
    expect(() => skillHome(home, moved)).toThrow(`couldn't fetch the gauge skill from ${src.dir} at ${src.second.slice(0, 7)}`);
    expect(() => skillHome(home, moved)).toThrow("It needs the network once, then works offline");
    expect(sh(dir, "rev-parse", "HEAD")).toBe(src.first);

    renameSync(`${src.dir}-gone`, src.dir);
    expect(skillText(moved, skillHome(home, moved))).toContain("# Gauge, second");
    expect(readdirSync(join(home, "skills"))).toEqual(["gauge"]);
  });

  test("a skill inside a mod is read where it is, and a commit with no SKILL.md isn't a skill", () => {
    const home = scratch("home");
    modWith(home, "zines", [{ name: "zine", about: "folded zines", path: "skills/zine" }]);
    const zine = listSkills(home).find((s) => s.name === "zine")!;
    expect(() => skillHome(home, zine)).toThrow("skill zine: the zines mod has no skills/zine/SKILL.md");
    mkdirSync(join(home, "mods", "zines", "skills", "zine"), { recursive: true });
    writeFileSync(join(home, "mods", "zines", "skills", "zine", "SKILL.md"), "# Zine\n");
    expect(skillHome(home, zine)).toBe(join(home, "mods", "zines", "skills", "zine"));
    expect(existsSync(join(home, "skills"))).toBe(false);

    const bare = scratch("bare");
    sh(bare, "init", "--quiet", "--initial-branch", "main");
    writeFileSync(join(bare, "README.md"), "no skill\n");
    sh(bare, "add", "-A");
    sh(bare, "commit", "--quiet", "-m", "x");
    modWith(home, "zines", [{ name: "zine", about: "folded zines", source: bare, ref: sh(bare, "rev-parse", "HEAD") }]);
    expect(() =>
      skillHome(
        home,
        listSkills(home).find((s) => s.name === "zine")!,
      ),
    ).toThrow("has no SKILL.md, so it isn't a skill");
    expect(readdirSync(join(home, "skills"))).toEqual([]);
  });

  test("the brief names the skills and the command that prints one", () => {
    const brief = briefText({ alias: "dev", agent: "otter", mc: "kiwi", listen: "", skills: [{ name: "anatomy", about: "interactive figures" }] });
    expect(brief).toContain("Skills: anatomy (interactive figures): `kiwi skill NAME`.");
    expect(briefText({ alias: "dev", agent: "otter", mc: "kiwi", listen: "" })).not.toContain("Skills:");
  });

  test("the mods skill is built into Channels: no network, SKILL.md and the kit's types side by side, and a stale copy written again", () => {
    const home = scratch("home");
    const mods = listSkills(home).find((s) => s.name === "mods")!;
    expect(mods).toMatchObject({ builtin: true, source: null, path: null });
    expect(fetched(home, mods)).toBe(true);
    const dir = skillHome(home, mods);
    expect(dir).toBe(join(home, "skills", "mods"));
    expect(readdirSync(dir).sort()).toEqual(["SKILL.md", "kiwi-mod.d.ts"]);
    expect(readFileSync(join(dir, "kiwi-mod.d.ts"), "utf8")).toBe(readFileSync(join(import.meta.dir, "../ui/src/mods/frame/kiwi-mod.d.ts"), "utf8"));
    writeFileSync(join(dir, "SKILL.md"), "stale");
    const text = skillText(mods, skillHome(home, mods));
    expect(text.startsWith(`Skill "mods", from Channels itself. Its files are in ${dir}`)).toBe(true);
    expect(text).toContain("kiwi mod check <name>");
    expect(readFileSync(join(dir, "SKILL.md"), "utf8")).toBe(readFileSync(join(import.meta.dir, "../src/mods-skill.txt"), "utf8"));
  });

  test("every tsx example in the mods skill type-checks against the kit's types", () => {
    const blocks = [...readFileSync(join(import.meta.dir, "../src/mods-skill.txt"), "utf8").matchAll(/```tsx\n([\s\S]*?)```/g)].map((m) => m[1]!);
    expect(blocks.length).toBeGreaterThanOrEqual(5);
    const { dir } = startDev(scratch("examples"), "skill-examples", scratch("cwd"));
    symlinkSync(join(import.meta.dir, "../ui/node_modules"), join(dir, "node_modules"));
    rmSync(join(dir, "index.tsx"));
    blocks.forEach((code, i) => writeFileSync(join(dir, `example-${i}.tsx`), code));
    execFileSync(join(import.meta.dir, "../node_modules/.bin/tsrs"), ["--noEmit", "-p", dir], { stdio: ["ignore", "pipe", "pipe"] });
  });

  test("kiwi skill lists the skills and prints one", async () => {
    const home = scratch("home");
    const src = skillRepo();
    modWith(home, "gauges", [{ name: "gauge", about: "draws gauges", source: src.dir, ref: src.first }]);
    const cli = async (...args: string[]) => {
      const p = Bun.spawn(kiwiCmd(["skill", ...args]), { cwd: home, env: { ...ENV, KIWI_HOME: home, KIWI_NO_HOOKS: "1" }, stdout: "pipe", stderr: "pipe" });
      const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
      return { code: await p.exited, out, err };
    };
    const list = await cli();
    expect(list.code).toBe(0);
    expect(list.out).toContain("anatomy: interactive figures that explain how things work");
    expect(list.out).toContain(`gauge: draws gauges\n  ${src.dir} @ ${src.first.slice(0, 7)}, fetched on first use\n`);
    const shown = await cli("gauge");
    expect(shown.code).toBe(0);
    expect(shown.out).toContain(`Its files are in ${join(home, "skills", "gauge")}`);
    expect((await cli()).out).toContain(`gauge: draws gauges\n  ${src.dir} @ ${src.first.slice(0, 7)}\n`);
    const missing = await cli("nope");
    expect(missing.code).toBe(1);
    expect(missing.err).toContain("no skill named nope: kiwi skill lists them");
  });
});
