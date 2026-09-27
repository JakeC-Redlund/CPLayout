# Web build lease recovery

`export:web`, `proof:web`, and the repo-owned static UI launcher share
`.cplayout-local/web-build-lease`. The lease protects `apps/mobile/dist` from
concurrent exports. A dead wrapper PID does **not** prove its Expo or Playwright
children have stopped, so the launcher never reclaims a stale lease automatically.

The reviewed build path runs from **WSL/Linux**. Other POSIX hosts are not blocked
by this guard but have not been verified in this run. Native Windows
`export:web`, `proof:web`, and `ui:test:start` exit before taking a lease or
starting a build. Open the workspace in WSL, such as `/mnt/h/cplayout`, and
rerun the same npm command there. `recover --confirm-idle` remains available
for leases left by older runs, after the audit below.

## Inspect before recovery

1. Save or read `owner.json` in the lease directory and, if present, the
   `.reaping/owner.json` marker. Record `pid`, `activeRun.pid`,
   `activeRun.processGroup`, command, and timestamps. Missing or invalid metadata
   is uncertainty, not evidence that the build is idle.
2. Inventory relevant processes and descendants, including processes launched
   by other Codex sessions. On Linux/WSL, use
   `ps -eo pid,ppid,pgid,stat,args` and inspect the recorded PID and process
   group along with `expo export`, `playwright`, `webBuildLease`, and `npm` jobs.
   On Windows PowerShell, inspect `Get-CimInstance Win32_Process | Select-Object
   ProcessId,ParentProcessId,Name,CommandLine`. Check the current command line
   and repository path before deciding a PID belongs to this build.
3. Check `npm run ui:test:status` for repo-owned servers. A listener on the proof
   port is not a build lease owner. Never kill an unknown listener or another
   session's process to clear the lease. Wait for active work to finish. If
   ownership or descendant activity cannot be determined, leave the lease in
   place and report the blocked build.
4. Only after confirming that **no** web export, proof, or child build remains,
   run `npx tsx tools/webBuildLease.ts recover --confirm-idle`. The flag is an
   operator assertion, not an automated proof. Recovery rejects a recorded live
   owner or child and a recent/live `.reaping` marker. Recheck the process
   inventory and lease directory before starting another build.

Node's child `close` event does not establish that every descendant of an `npm`
wrapper exited. The native Windows build path is therefore blocked at entry,
not treated as a failed build with a newly retained lease. For an older Windows
run, a successful export message alone is not evidence that descendants ended;
use the process audit above. See the [Node child-process documentation](https://nodejs.org/api/child_process.html)
for the `close` event and platform-specific detached-process behavior.
