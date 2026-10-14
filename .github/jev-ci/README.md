# jev-ci

CI's `plan` job decides which checks a pull request can break, and only those run.

1. **Rules.** A job whose files didn't change is skipped. A release bump (only version
   numbers) skips everything. A change to `ci.yml` runs the jobs whose definition changed.
   Config and dependency files run the jobs that list them under `always`. Static checks
   (types, lint) run whenever their files change.
2. **Cache.** Every job that passes saves an empty Actions cache entry named after its input
   hash: its files plus its own CI definition. The same inputs later skip the job.
3. **Jev.** For what's left, one [TypeSafe](https://docs.typesafe.ai) request per changed
   file asks, for each job that file reaches, "could this change make the job fail?". A
   job runs when the combined chance is at or above `threshold`.

Pushes to main run everything. If planning fails or Jev is unreachable, everything runs.
`ci-ok` passes when every job the plan ran passed and the rest were skipped; it's the one
check to require. The plan and each job's result go in a comment on the pull request.

Jobs, their files and what they check: [`.github/jev-ci.yml`](../jev-ci.yml). Set `mode:
shadow` there to run every job while the plan still says which ones Jev would skip.

See what CI will run for your branch (needs `TYPESAFE_API_KEY` for the Jev part):

    bun run ci:plan
