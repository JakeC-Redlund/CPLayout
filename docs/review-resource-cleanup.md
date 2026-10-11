# Review resource cleanup

## Map Tab Lifetime

The owner explicitly requires unused map tabs to close, including between
source-only implementation passes. Inventory the dedicated Edge window, preserve
relevant unsaved map state, close the exact owned map tab, then stop its recorded
app server. Run cleanup after successful and failed QA; verify tab inventory and
launcher status afterward. Do not retain a map merely because an earlier review
used it. An active questionnaire has a separate lifetime and may remain available
for human answers without keeping a map or app server alive. Unknown tabs and
listeners must not be closed by title/port guesses.

On 2026-09-27 the resumption inventory found no map tab and no launcher-owned app
server. Only the pending S01-S02 hub/questionnaire and unrelated extension tab
were present in the dedicated Edge profile. No closure action was needed;
questionnaire revision 7 had no answers and was not treated as completion.

## Recorded Ownership

The local review workflow records a durable `review-resource-lease-<id>.json` for each server start in its session directory. The lease names the creating owner, whether the server was created or reused, its loopback URL, its PID and Linux process start identity, and any automation-owned browser context and tab IDs. It does not contain the admin token or review answers. The review server keeps its own runtime lock and token separate from the lease.

The launcher can stop one recorded UI server without disturbing another:

```sh
npm run ui:test:status
npm run ui:test:stop -- --mode ui-test --port 19006
```

`npm run ui:test:stop` without selectors retains its existing all-recorded-server behavior. New static servers launch with Node and the `tsx` import in one recorded process. A selected stop sends SIGTERM only after the recorded PID, process start identity, checkout working directory, command, and port match the live process. Legacy `npx` launches can leave a detached child after the wrapper exits; their group recovery also checks every live group member's checkout directory, exact static script and port arguments, start order, and static health before signalling the group. It records `stopRequestedAt`, then waits for both process exit and listener release. It removes launcher state only after both checks pass. An invalid, mismatched, timed-out, or occupied record remains on disk for inspection, and the command exits with an error. A port or PID by itself never grants permission to signal a process. A dead process with a free listener can be reconciled as stopped without sending a signal.

For questionnaire sessions, `tools/reviewResourceLease.cjs` supplies `createLease`, `readLease`, `requestStop`, `verifyCleanup`, `completeCleanup`, and `recoverLease`. `createLease` uses exclusive creation. Updates retain the lease with a revision and status. `verifyCleanup` checks process exit and loopback listener release before recording `verified-stopped`; direct `completeCleanup` requires both observations supplied by a trusted caller. If owned browser IDs are present, an adapter must confirm their closure before `verified-stopped` or `intentionally-retained` is recorded. `intentionally-retained` requires a reason. `failed` and `unknown` preserve ownership and evidence for recovery. Recovery checks the start identity, working directory, and command token before signalling a created process. Reused servers are retained. Browser cleanup callbacks receive only IDs recorded as automation owned; unrelated contexts and tabs are outside their scope.

After a crash, run recovery against the session lease through a trusted local caller with `recoverLease(file, adapters)`. The helper does not trust a port or PID alone, does not delete the lease, and reports `failed` if process identity differs or if exit and listener release cannot both be established. The caller must keep the review server's admin token and any browser control credentials outside the browser page. Review answers, evidence images, receipts, logs, and the lease stay in the session directory after shutdown.

Source tests cover successful and timed-out cleanup, reused resources, identity mismatch, owned browser ID selection, and preservation of an unrelated live listener. These tests establish local behavior of the helper and launcher, not Windows Edge tab closure or cross-host runtime proof.

## Legacy Questionnaire Sessions

For an old review runtime that has no `leasePath` property, use
`npm run review:session -- stop DIR --legacy` only after preserving its answers
and closing its obsolete owned tabs. The command validates the Linux process
start identity, executable, exact server command, session directory and port
before sending shutdown, then requires process exit, listener release and lock
directory removal. Malformed modern leases cannot fall back to this path.
Success is explicitly server-only; browser closure requires its own evidence.

The completed V01-V04 session on port 42763 was retired on 2026-09-27: retained
receipt revision 25 matched the live answers, a legacy archive was byte-compared,
the exact hub was archived/closed in visible Edge with the map preserved, and
the legacy CLI subsequently reported all three server shutdown observations.
Evidence is in `reports/visual-layout-review/20260927-centered-tools-01/`.
