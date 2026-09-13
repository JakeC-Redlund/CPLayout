# GitHub Parent Repository Migration

Review and execution date: 2026-09-12

The transfer record below describes the migration checkpoint. A live refresh on 2026-09-13 reconfirmed `JakeC-Redlund`, administrator access, public visibility, `main` as default, both destination remotes, and zero local/hosted divergence before the quality packet. No transfer or repository creation remains pending. Subsequent audited development publication is covered by [mapping-rtk-quality-program.md](mapping-rtk-quality-program.md) and Git history; the original OIDs below are recovery provenance, not a claim that they remain the latest development commit.

## Single-Main Development Publication

The owner's subsequent **commit + push + sync** instruction explicitly authorized consolidation to one clean, current `main`, including investigation and merging of any unique development. This separately authorizes removal of already-merged branch names after preservation and live tip checks; it does not authorize repository deletion, discarded uncommitted work, force-push, history rewriting, credential exposure or paid-service changes.

On 2026-09-13 the destination, active `JakeC-Redlund` account and administrator access were reverified. The repository remained public with default `main`, no branch protection/rulesets, no Actions workflows/secrets and no PRs. Those settings were inventoried, not changed. Fresh fetch and ancestry checks found:

| Development branch | Preserved tip | Commits unique to the branch |
| --- | --- | --- |
| `codex/android-map-hud-parity` | `b3ea6919a56b176109591f945a96e7b94a90c8be` | 0 |
| `codex/complete-roadmap-next` | `e9fddc2782a1f4ffda310447a1c50304ed4020ff` | 0 |
| `codex/cplayout-agent-specialists` | `bb1002c8b41dff953b2930eaa784fa9b2c3c61b3` | 0 |

All three tips were already ancestors of `81dee50d7594a2c082defbada63abb7e065f7869`; their development was already integrated, so no redundant merge was created. The 111-path reviewed source packet was committed as `30cd9714759c12ff13506607c2373784677f00dc` and normally pushed to `main`. After rechecking exact live tips and their ancestry, an atomic non-forced push removed the three hosted branch names, and `git branch -d` removed their local counterparts. Their commits remain in `main` and in the verified rollback bundle.

The duplicate temporary remote `jake-parent` was removed. `origin` alone points to `https://github.com/JakeC-Redlund/CPLayout.git`, and local `main` tracks `origin/main`. The one-local/one-hosted-branch, matching-OID and clean-worktree checks passed at the source commit before this documentation-only follow-up. Use Git history and a fresh `git ls-remote` check for the final tip; do not confuse a recorded source-validation OID with an assertion that documentation will never advance.

The complete publication recovery directory is `/home/cyber/cplayout-main-sync-20260913-uFNiVG/`, retained locally and not uploaded. It includes a verified all-ref bundle, the pre-publication index and binary diffs, all 112 original dirty/untracked file copies/hashes, branch inventory and exact-tree validation records. The unrelated scratch note is preserved at `local-notes/resume.txt` there, not committed. The two pre-existing tracked visual-review changes were separately inspected, included and validated. No ignore rule or skip-worktree flag was added to manufacture a clean status.

Full source/workspace validation passed against all 477 indexed files. The existing 26-case browser checkpoint was verified source/asset-identical, not rerun as a full suite. Five high audit findings and the documented native, relay, physical GNSS and strict 3D-accuracy gates remain unresolved. Publication is not release or field qualification.

## Authorization and Destination

The owner requested migration planning, an explicit permission record, and initialization of `JakeC-Redlund/CPLayout`, then instructed the agent to implement the plan. This is execution authorization for the named repository migration and ordinary fetch/push verification after live account checks. That migration authorization alone did not authorize deletion, destructive reset, force-push, credential exposure, or paid-service changes. The later, narrowly scoped merged-branch cleanup authorization is recorded above.

The destination is **JakeC-Redlund/CPLayout**. It is the parent development monorepo for the existing npm workspaces, not a newly invented submodule hierarchy. No `.gitmodules` or additional repository remotes were found. Other repositories require an explicit inventory and ownership check before migration; none were inferred or transferred.

## Executed Path

The active `JakeC-Redlund` login initially had only read access to `cyberpivots/CPLayout`. A live read-only check using the already-stored `cyberpivots` login confirmed source administrator access. Therefore the preferred metadata-preserving transfer was available, superseding the planning-time fresh-repository fallback.

1. Re-read `AGENTS.md`; inspect current branch, HEAD, remotes, and dirty status.
2. Confirm `JakeC-Redlund/CPLayout` was absent.
3. Create and verify a complete `git bundle --all` plus copies/hashes of all 63 pre-existing modified/untracked paths outside the workspace mount.
4. Record source repository ID, hosted branch, visibility, Actions, secrets, and branch protection.
5. Submit the authorized transfer through GitHub's repository transfer endpoint with the source-admin login. No token value was written to artifacts or displayed.
6. Verify the destination resolves with the same repository ID and JakeC-Redlund administrator rights; verify the old repository URL resolves to the destination.
7. Add `jake-parent`, fetch transferred refs, verify hosted `main` is an ancestor of local `main`, and push the existing committed `main` with a normal fast-forward push.
8. Verify `git ls-remote`, then change `origin` to the destination and fetch it.

## Verified Transfer State

| Item | Result |
| --- | --- |
| Repository | `https://github.com/JakeC-Redlund/CPLayout` |
| Repository ID | `1244045935`, unchanged by transfer |
| Default branch | `main` |
| Local and published committed HEAD | `81dee50d7594a2c082defbada63abb7e065f7869` |
| Previous hosted main | `b9d385d49b527348637fe94a8bb98dad8e30918a`; fast-forwarded by two existing commits |
| Visibility | Public, inherited from the transferred source. Private initialization applied only to the unused fresh-repository fallback. |
| Active destination permission | Administrator |
| `origin`, `jake-parent` | `https://github.com/JakeC-Redlund/CPLayout.git` |
| Source URL | Redirects to the same transferred repository |
| Actions workflows / repository Actions secrets | Zero before and after transfer |
| Pages | Not enabled |
| Main protection | Not protected before or after transfer; a future protection policy is a separate configuration action |
| Issues / PRs | No open or closed issues or PRs returned by the post-transfer inventory; repository identity is preserved |
| Refactor at transfer checkpoint | Local worktree changes, not included in the committed-main push |

The hosted-main push contained the two existing launcher/workflow commits, not the dirty worktree. Source authorship and history are preserved. No new repository named `cplayout-development` or `CPLayout-next` was created.

The owner subsequently confirmed transfer acceptance in the conversation. A fresh destination check after that confirmation again returned `JakeC-Redlund/CPLayout` with administrator permission; no further transfer action is pending.

That closure checkpoint again confirmed the active login was `JakeC-Redlund`, repository ID `1244045935`, public visibility, administrator access, and matching local/hosted committed main at `81dee50d7594a2c082defbada63abb7e065f7869`. The refactor had not yet been included in a new commit or push. Later development publication must be verified separately; this historical table is not a latest-HEAD assertion.

## Recovery and Dirty Ownership

Local-only recovery directory: `/home/cyber/cplayout-mapping-recovery-20260912-EmIbXe/`.

- `repository.bundle`: verified complete history and nine local/remote refs at preflight.
- `manifest.json`: original HEAD, branch, remotes, dirty status, per-file SHA-256, and scope classification.
- `worktree.patch` and `worktree/`: binary tracked diff plus copies of pre-existing modified/untracked files, including unpublished work.

The bundle alone does not contain uncommitted files; retain the entire recovery directory. It is outside `/mnt/h` and is not uploaded to GitHub. Restore individual reviewed files or clone the bundle into a separate recovery directory. Never reset the shared checkout to perform recovery.

For future publication, review the diff against that snapshot, stage only audited changes, and create reviewable development commits/branches. Existing RTK, core, geometry, evidence, package, and governance work must retain its provenance. Do not commit the entire dirty tree merely to make it clean.

The closure review packet uses `mapping-review-*/` inside the recovery directory: before/after copies, hashes, and `mapping-refactor.patch` scoped to 24 task paths. Its baseline is the pre-existing worktree snapshot for integration files and preflight HEAD for previously clean files. The `git apply --check --reverse -p2` verification is read-only; it does not restore, stage, commit, or publish files. All 50 pre-existing files outside the 13 integration paths remain unchanged.

## Fallback and Future Migration Procedure

Fresh initialization is only for a verified unavailable transfer, with the target name still absent and no pending transfer. Use `gh repo create JakeC-Redlund/CPLayout --private --source=. --remote=jake-parent`, then push the audited committed main. This path preserves Git history but does not migrate issues, PRs, releases, settings, or redirects; inventory those separately.

Creating a fresh destination while a transfer is pending would block the transfer and is prohibited by this plan. Do not recreate the old source name after transfer because that can remove GitHub's redirect. Future transfer acceptance must occur within GitHub's one-day invitation window. No invitation remained necessary once destination ownership was verified in this execution.

## Acceptance Checks

Use `gh repo view JakeC-Redlund/CPLayout`, `git remote -v`, `git ls-remote origin refs/heads/main`, and GitHub's repository/branch/Actions APIs. Check repository identity, default branch, permissions, issue/PR continuity, branch protection, redirects, Actions/secrets, and local/hosted OIDs separately. Transfer completion does not prove application correctness or native runtime readiness.

## Sources

- [GitHub repository transfers](https://docs.github.com/en/repositories/creating-and-managing-repositories/transferring-a-repository): prerequisites, acceptance, metadata continuity, and redirects.
- [GitHub transfer API](https://docs.github.com/en/rest/repos/repos#transfer-a-repository): execution endpoint.
- [GitHub CLI repository creation](https://cli.github.com/manual/gh_repo_create): unused fresh-parent fallback.
