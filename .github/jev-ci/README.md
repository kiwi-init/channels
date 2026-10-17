# jev-ci

CI's `plan` job decides which checks a pull request can break, and only those run.

1. **Rules.**
   - A change to the planner itself (`.github/jev-ci/**`) runs everything.
   - `ci.yml` is compared parsed, not line by line. A job runs when its own job block
     changed, or a local action or reusable workflow it uses (`uses: ./...`), followed through
     the files it uses in turn. A change to `name`, `run-name`, `on` or `concurrency`, a
     comment or a blank line runs nothing by itself (the static checks still run, since they
     read every workflow). Workflow `permissions` run the jobs that inherit them; any other
     top-level change (`env`, `defaults`) runs every job. A job in `ci.yml` with no entry in
     `.github/jev-ci.yml` always runs, so a new job can't be skipped by accident.
   - `.github/jev-ci.yml` is compared parsed too. A change to a job's `description` or
     `name` runs nothing by itself (the plan already uses the new wording); a change to its
     other fields runs that job; a change to a setting above `jobs` runs everything.
   - A job none of whose files changed is skipped. A job's files are its `inputs` globs plus,
     with `imports_from`, every file those entry files import, followed through relative,
     `@mc/` and `@/` imports (type-only imports don't count: they don't run). That's how the
     flows jobs read only the `web/src` modules their tests import.
   - Files under a job's `always` run it. A release bump (only version numbers) skips
     everything but the jobs marked `version_bumps`. Static checks (`jev: false`: types,
     lint) run whenever their files change.
2. **Cache.** Every job that passes saves an empty Actions cache entry named after its input
   hash: its files, its job in `ci.yml` and the local actions it uses. The same inputs later
   skip the job.
3. **Jev.** For what's left, one [TypeSafe](https://docs.typesafe.ai) request per changed
   file asks, for each job that file reaches, "could this change make the job fail?". A job
   can ask its own `question` with its own `criteria`: `cli / macos` asks whether the change
   fails only on macOS, since the Linux jobs run the same tests. Code moved verbatim between
   files (a module split) is shown as `⟨N lines moved from X, unchanged⟩` and doesn't count
   toward `max_jev_lines`, nor do blank, comment and import lines. A job runs when the
   combined chance is at or above its `threshold` (or the global one).

Pushes to main run everything. If planning fails or Jev is unreachable, everything runs.
`ci-ok` passes when every job the plan ran passed and the rest were skipped; it's the one
check to require. The plan, its notes (what a workflow or config edit changed) and each
job's result go in a comment on the pull request.

Jobs, their files and what they check: [`.github/jev-ci.yml`](../jev-ci.yml). Set `mode:
shadow` there to run every job while the plan still says which ones Jev would skip. The
planner's tests: `test/jev-ci.test.ts`.

See what CI will run for your branch (needs `TYPESAFE_API_KEY` for the Jev part):

    bun run ci:plan
