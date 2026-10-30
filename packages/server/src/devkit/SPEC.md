---
id: submodule-server-devkit
type: submodule-design
status: active
title: devkit — business-platform workflow tool (fork feature)
parent: module-server
depends-on: [module-contracts]
tags: [devkit, fork]
---

## Responsibility

The fork-owned bridge to the user's `devkit` CLI: task snapshots for Eagle and
PingCode, per-platform cron-scheduled background refresh, silent credential
re-login, and the workspace-scoped Jenkins build recommendation and trigger.
The panel in `apps/web` (right-rail singleton tool `devkit`) hydrates from the
host cache and receives updates through the `devkit.changed` push.

## Boundary

- **Owns:** `devkit.*` WS handlers (tasks/refresh/authStatus/settings/jenkins),
  the CLI subprocess adapter (`Bun.spawn` with `windowsHide: true`, timeouts by
  process-group kill, stdin piping for credential logins), disk cache and
  settings under `<dataDir>/devkit/` (settings `0600`), the 5-field cron parser
  and the 30s scheduler tick, and the TS mirror of devkit's
  `devkit/jenkins-build-plan/1` plan construction.
- **Public surface (`index.ts` barrel):** `devkitTasks`, `refreshDevkitTasks`,
  `devkitAuthStates`, `devkitSettingsView`, `updateDevkitSettings`,
  `devkitJenkinsRecommend`, `devkitJenkinsTrigger`, `setDevkitPublisher`,
  `startDevkitScheduler` / `stopDevkitScheduler`, plus the CLI/cron helpers used
  by tests.
- **Allowed deps:** `contracts` (types + `isValidDevkitCron`), `persistence`
  (`dataDir`), `log`, `workspaces` (`getWorkspace` — Jenkins runs in the
  worktree). Never imports `host` (publisher-injection seam), never a sibling
  feature module.
- **Forbidden:** embedding platform HTTP (the CLI owns auth/protocol/quirks —
  a TS reimplementation would drift), background fetches for Jenkins
  (recommendation is workspace-scoped and on-demand), writing credentials
  anywhere outside `<dataDir>/devkit/`.

## Decisions

- **CLI over HTTP.** devkit already owns SSO RSA login, keyring tokens,
  pagination and the strict mine-filter semantics; the CLI's `--json` output is
  the stable contract. Python startup cost (~200 ms) is invisible for a
  background refresh. The Jenkins recommend carries a 600 s budget: the CLI
  walks up to 500 jobs and reads each candidate's parameters (measured ~5 min
  on the real Jenkins instance), so the panel's first load is slow by nature —
  candidates arrive, then the user picks. A future devkit `recommend --job`
  filter would shrink this to seconds.
- **Credentials are stored in plain JSON at the user's explicit request**
  (declared non-sensitive by the fork owner; eagle tokens expire ~12 h, so
  persistence plus auto re-login is what makes "用户无感知" real). The read view
  (`DevkitSettingsView`) returns the password in plaintext — the fork's settings
  form shows stored values and locks inputs until the edit action, so a re-save
  never wipes a password the user did not retype (the original wipe bug: the form
  sent an empty password field and the update treated "" as a clear). Update
  merge semantics: a field omitted from the patch is kept; an explicit empty
  string clears. Settings updates publish on `devkit.changed` (`kind: "settings"`).
- **Hydrate-then-stream.** `devkit.tasks` answers from the disk cache
  instantly; the scheduler and manual `devkit.refresh` update it and publish
  `devkit.changed`. One refresh at a time per platform (concurrent callers
  share the promise); the push is a full snapshot, so replay is idempotent.
- **Cron.** Five fields (`分 时 日 月 周`), `*`, `*/n`, lists, ranges, DOM/DOW
  OR-rule, `0`/`7` = Sunday, `off` disables. Validated identically on both
  sides by `isValidDevkitCron` (contracts). The tick is 30 s; a missed window
  (host asleep) fires once on wake — `nextCronRunMs` is recomputed after every
  firing, never accumulated.
- **Jenkins recommend results are cached per workspace (10 min TTL) and
  deduplicated in flight** — several clients asking at once share one walk.
  The display cache never feeds the trigger: `devkitJenkinsTrigger` re-runs a
  fresh recommend (bypassing the cache) and devkit re-verifies branch/HEAD
  before POSTing.
- **Jenkins recommend/trigger share the task fetcher's silent relogin**: a
  credentials error retriggers `jenkins auth login --secret-stdin` with the stored
  settings, then one retry; a failed relogin returns `needsLogin` so the panel
  points at Settings.
- **Jenkins trigger approval.** The panel's confirm dialog is the
  out-of-terminal human approval devkit requires: the plan is built for the
  chosen candidate (TS mirror of `build_plan`, including the SHA-256
  `plan_hash` over job/branch/HEAD/params), and the full job name is passed as
  `--approve-token`. devkit re-verifies the hash, TTL, branch, HEAD and param
  definitions before POSTing — a mirror drift fails closed (trigger refused),
  never misfires. Unpushed commits are refused by devkit's own check.
- **CLI-missing degradation.** Without a `devkit` executable the snapshots
  carry `cliMissing` and the panel shows setup guidance; nothing throws.

## Later

A `更多` tab surface (doctor, network diagnostics, resolve drafts) can extend
the same module; an upstream PR that turns panels into an extension point
(Decision 21's deferral) would let this feature migrate out of the fork.
