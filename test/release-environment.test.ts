import { expect, test } from "bun:test";

interface Job {
  uses?: string;
  environment?: string;
  secrets?: unknown;
}

const WORKFLOWS = [".github/workflows/release.yml", ".github/workflows/release-build.yml", ".github/workflows/ci.yml"];
const REHEARSAL = "${{ (!inputs.rehearsal || github.ref == 'refs/heads/main') && 'release' || '' }}";

const jobsOf = async (file: string) => Object.entries((Bun.YAML.parse(await Bun.file(file).text()) as { jobs: Record<string, Job> }).jobs);
const named = (job: Job) => [...new Set([...JSON.stringify(job).matchAll(/secrets\.((?:MAC|APPLE|CLOUDFLARE)_[A-Z0-9_]+)/g)].map((m) => m[1]))];

test("every job that reads a signing or deploy secret runs in the release environment, limited to main and v* tags", async () => {
  const reading: string[] = [];
  for (const file of WORKFLOWS)
    for (const [id, job] of await jobsOf(file)) {
      if (!named(job).length) continue;
      reading.push(`${file}:${id}`);
      expect({ file, id, environment: job.environment }).toEqual({ file, id, environment: file.endsWith("release-build.yml") ? REHEARSAL : "release" });
    }
  expect(reading).toEqual([".github/workflows/release.yml:deploy-relay", ".github/workflows/release-build.yml:desktop-mac-eb"]);
});

test("no caller hands a signing secret to the build by name: a PR's or a branch's rehearsal gets none", async () => {
  for (const file of WORKFLOWS) for (const [id, job] of await jobsOf(file)) if (job.uses) expect({ file, id, named: named(job) }).toEqual({ file, id, named: [] });
  const rehearsal = Object.fromEntries(await jobsOf(".github/workflows/ci.yml"))["release-rehearsal"];
  expect(rehearsal?.uses).toBe("./.github/workflows/release-build.yml");
  expect(rehearsal?.secrets).toBeUndefined();
});
