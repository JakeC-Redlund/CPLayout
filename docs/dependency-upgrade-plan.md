# Dependency Inventory and Upgrade Plan

Last reviewed: 2026-09-27 UTC
Status: active package and toolchain decision record

## SDK 55 Patch and Required CI: 2026-09-27

The mobile workspace now declares Expo `~55.0.31`, development client `~55.0.40`, FileSystem `~55.0.26`, Sharing `~55.0.24`, Splash Screen `~55.0.25`, and SQLite `~55.0.20`. Project-store declares the same FileSystem, Sharing, and SQLite versions. These are the six versions requested by `CI=1 npx expo install --check` before the change; that command now reports `Dependencies are up to date`. React Native remains 0.83.10 and there is no SDK major upgrade.

`npm install --workspaces --include-workspace-root --no-audit --fund=false` regenerated the lockfile and installed the graph. The diff changes 33 package versions and adds `agent-cli-detector` through the updated Expo CLI. Besides the six direct packages, the changed entries are SDK 55 Expo CLI, config, prebuild, Metro configuration, modules, dev menu and asset patches, with compatible Babel/web/build helper patches selected by npm. No direct dependency, paid service, cloud endpoint, API key, or project data format was added. `npm ls expo expo-dev-client expo-file-system expo-sharing expo-splash-screen expo-sqlite --all` shows one deduplicated installed version of each across the two workspaces. `npm audit --audit-level=moderate` reports zero vulnerabilities. The package install ran the repository's existing `postinstall` UUID patch; npm also warned that the existing `esbuild` install script is not covered by `allowScripts`.

The new [required CI workflow](../.github/workflows/cplayout-required.yml) runs on pull requests and pushes to the verified default branch, `main`, with read-only repository permission and SHA-pinned checkout/setup-node actions. Superseded runs on the same PR or branch are canceled, and each job has a time limit. Its source job uses Node 24 and `npm ci`, checks changed-file whitespace over the event's base and head SHAs, then checks Expo compatibility, context-map freshness, skills, the aggregate validator, and audit. Three separate jobs run the complete Playwright Chromium suite with file-level `--shard=1/3`, `2/3`, and `3/3`, each using `CPLAYOUT_WEB_PROOF_PORT=19006` and the repository's leased `proof:web` command on its own runner. No report or screenshot artifacts are uploaded. A hosted browser failure therefore requires a local rerun with `CPLAYOUT_WEB_PROOF_PORT=19006 npm run proof:web -- --shard=N/3`; inspect the local `reports/continuous-improvement/playwright-results/` and `reports/continuous-improvement/playwright-html/` outputs. Keep hosted uploads disabled until fixture contents, rights, and retention are independently reviewed. The terminal `cplayout-required` job uses `always()` and fails unless source and all three web shards succeed; branch protection must select that job name for enforcement. This source packet does not attest a hosted run; record that separately from local proof.

Local acceptance gates for this packet are the Expo check, package deduplication, `npm run context-map:check`, `npm run validate:skills`, `npm run validate`, `npm audit --audit-level=moderate`, `git diff --check`, and full browser proof. After a clean `npm ci`, the Expo check, deduplication, aggregate validation, context-map and skill checks, audit (zero reported vulnerabilities), and whitespace checks passed locally on 2026-09-27. Full `CPLAYOUT_WEB_PROOF_PORT=19187 npm run proof:web` exited 0 with 704 passed, 10 skipped and 0 failed in 27.7 minutes; the proof port was released. Earlier context-map and skills failures occurred during concurrent edits and are superseded by the final integrated checks. `CI=1 npx expo-doctor` separately passed 19/20 checks and exited 1 on the existing native-folder/app-config synchronization warning; this packet does not run Prebuild or claim that gap closed. The source and browser CI jobs are separate runners, so neither shares a web build lease or proof port with another job. Native Android/iOS SQLite, ZIP sharing, and development-client behavior still require rebuilt device or emulator evidence under [native verification](android-native-verification.md). Rollback requires restoring only this packet's two manifests and lockfile from its reviewed before-state, reinstalling with `npm ci`, and repeating these gates; preserve unrelated workspace changes.

Primary sources: [Expo CLI package version validation](https://docs.expo.dev/more/expo-cli/#version-validation), [Playwright file-level sharding](https://playwright.dev/docs/test-sharding), [Playwright CI installation](https://playwright.dev/docs/ci), [GitHub Actions SHA pinning](https://docs.github.com/en/actions/reference/security/secure-use), and [required check behavior](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks).

All older sections below are dated historical snapshots. Their former "current" audit counts, lockfile hashes, package versions, and acceptance claims apply only to the dates and code states they name; use the SDK 55 packet above and a fresh run for this checkout.

## Audit Refresh: 2026-09-26

During draft-editor integration, `npm audit --json --ignore-scripts --fetch-retries=0 --fetch-timeout=30000` exits 0 with zero findings at every severity and 735 dependency entries. Lockfile SHA-256 remains `16205a29da1aa9d5c8c050fa84c0906396a07767341b62d3a710971df6e08a03`. This verifies the current advisory result, not absence of all security defects or native compatibility. No installation, upgrade, forced fix or lockfile mutation was performed in this continuation. The historical five-high objective is retained as history; it is not the current audit count. Raw coordinator result: `/tmp/cplayout-draft-audit-current.json`.

## Coherent Metro Patch: 2026-09-14

The five remaining high affected package names are resolved in the installed shared checkout. Root `npm audit --json` reports **zero findings** after the reviewed patch. The earlier five names represented dependency paths to two image-size advisories, not five independent CVEs. This dated result supersedes historical counts below; it does not establish native or field acceptance.

The isolated candidate at `/home/cyber/cplayout-metro-security-20260914-K1O2Fp/` updates `@expo/metro` 55.1.1 to 55.1.2, the fourteen Metro packages and `ob1` from 0.83.7 to 0.83.8, and removes `image-size` and `queue`. Exactly 18 dependency lock locations change. All 51 incoming dependency edges were independently checked; Expo 55.0.28 and React Native 0.83.10 already permit this coherent patch cohort. There is no Expo/RN major change, persistent override, new direct dependency, paid service, credential, or cloud requirement. Updated packages declare MIT, no installation scripts, and Node >=20.19.4. The root engine minimum is corrected separately to `>=20.19.4 <25`; validation used Node 24.14.1, not every permitted Node version.

The rejected earlier A resolver experiment established duplicate/remaining vulnerable packages and unrelated lock churn, not an Expo/Metro API incompatibility. This retry used a fresh copy of the accepted B graph. A no-save lock-only install made no lock change. The successful isolated procedure temporarily added exact root pins for the wrapper and fourteen Metro packages with `npm install --save-exact --package-lock-only --ignore-scripts --audit=false`, then removed those temporary root declarations with `npm uninstall --package-lock-only --ignore-scripts --audit=false`. Temporarily pinning/removing the original `acorn@8.16.0` and `terser@5.48.0` removed two unrelated resolver updates. The final manifest was byte-identical to the before-state. This procedure is not permission to perform an unreviewed update or dedupe in the shared tree.

Acceptance before integration:

- Clean `npm ci --ignore-scripts --audit=false` installed 691 packages, followed only by the existing `node tools/patch_xcode_uuid_dependency.cjs` helper. Installed dependency-tree validation, root and production audits, aggregate `npm run validate`, and the web export passed.
- Eighteen selected Chromium cases passed with zero skips, retries, flaky cases or failures: `maplibre-runtime.spec.ts` and `workflow-safety.spec.ts`, across desktop/tablet/mobile. Launcher URL: `http://127.0.0.1:19009`. The exported JavaScript hash `bd8c5d868ec8ce774c8f5c6a40706476387bbca05ea947be81a75e537d4e2259` matches the preceding source checkpoint byte-for-byte. Offline vector pixels, pan behavior and mobile/desktop screenshots were checked. This is selected browser acceptance of the dependency packet, not the complete suite for subsequent refactoring.
- Independent review checked exact npm registry integrity, license/engine/lifecycle metadata, all incoming version ranges and removal of image-size. The wrapper's GitHub compare URL returned 404, so registry/package evidence is retained without claiming an independently verified wrapper source comparison.

Shared installation first encountered `EACCES` while renaming Metro on the mounted filesystem. That attempt failed and is retained as such. After the backup completed and competing root checks stopped, the same bounded install succeeded: 16 changes, two removals, no additional dependency changes. `npm ls --all --json`, root audit and the new `tools/metroDependency.test.ts` passed. That test checks the installed cohort, consumer resolution and actual Expo Metro configuration. Complete integrated source/browser acceptance follows the CRS, recovery and transport changes in [full refactor execution](full-refactor-execution.md).

Rollback: preserve `.cplayout-local/metro-security-before-20260914-vQ8UsS/`. Its before lock hash is `e6616c2b40c6d7d3fc67195632f2db4fc147523eaec5a8dd9f8ed7b730c46e6d`. The preferred old-package archive is `reviewed-before-packages.tar`, hash `40f08d660a61413aef7b79b9c1fc80dd26a4729a57d0d7a27f7bb92f589f44ee`, copied from the frozen prior Linux graph and version-checked. The first root archive overlapped the failed installation attempt and is not the preferred verified before-state. Restore only this reviewed dependency packet with installation/build processes stopped; do not replace unrelated dirty files with HEAD. Candidate lock hash was `b7b57d1a48a32c3ae4b857fcbb61353dbf09a2de985ea34793a31a0e6bc8b643`; after the root engine correction it is `f4dd483340ecf99c9f5f34cb02574356b47a082fe695e12163b179d049be5c1b`.

Primary sources: [Metro 0.83.8 release](https://github.com/react/metro/releases/tag/v0.83.8), [exact upstream patch comparison](https://github.com/react/metro/compare/v0.83.7...v0.83.8), [image-size advisory 1](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr), [image-size advisory 2](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq), and exact npm registry manifests retained in `evidence/registry-footprint.json`. Metro vendors its image parsers in this patch instead of depending on image-size. No forced audit repair was used.

## Browser MapLibre Security Packet: 2026-09-13

Status: implementation applied and baseline browser acceptance passed. Later mapping and dependency changes require their own final acceptance. This packet supersedes the browser-renderer deferral and audit counts below; other upgrade packets remain separate.

- Pinned `maplibre-gl` 6.9.0 exactly in map-adapters with `npm install --workspace @cplayout/map-adapters --save-exact maplibre-gl@6.9.0 --ignore-scripts`, after a dry run and a 13-file before-state checkpoint at `/home/cyber/cplayout-maplibre6-20260913-jaZm8p/`. Rollback must use that checkpoint, not HEAD, which predates unrelated dependency work.
- Upstream metadata reports BSD-3-Clause, Node >=16.14 and npm >=8.1. The lockfile changed one workspace declaration and 16 renderer dependency entries: four added, four removed, eight changed. Added/updated licenses are MIT, ISC, BSD-2-Clause, BSD-3-Clause or MIT/Apache-2.0. No changed entry declares an install script. Expo, React Native, native MapLibre and project-store versions did not change.
- Browser imports use the v6 namespace/named exports. A shared web runtime configures same-origin, versioned workers and the existing local stylesheet. `prestart`, `preweb` and `preexport:web` copy the installed worker, its shared ESM sibling, and upstream license into generated public assets with byte/hash manifests. No CDN, key, paid API or cloud backend is added. `.mjs` uses JavaScript MIME in the repository static server.
- SDK 55 leaves `import.meta` in classic web bundles by default. The first candidate exported successfully but failed classic-script parsing with `Cannot use 'import.meta' outside a module`. The web-only Expo Babel transform now handles it; native Babel behavior is unchanged. The worker modules themselves remain untransformed upstream ESM.
- New checks cover deterministic asset preparation, missing-sibling rejection, served hashes/MIME, offline vector-overlay pixels and pan behavior, and consecutive unsafe attribution attributes. Existing SVG fallback and the full browser suite remain acceptance gates. WebGL2 is required by v6; the SVG fallback remains the non-WebGL editing surface.
- Root audit after installation: **12 affected packages, 2 low and 10 high, zero critical**. The critical MapLibre advisory is no longer reported. This is not an all-clear: Expo/Metro/build-tool and transitive XML findings remain queued. The workspace install's smaller audit count is not the root result.

Evidence: `reports/continuous-improvement/maplibre6-quality-20260913/`. Source and browser acceptance results must be recorded after the final export; successful installation/typecheck alone is not rendering proof. Custom subpath hosting, other browser engines and native/device rendering remain separately unverified.

The final source validator passed after shortening v6 network-error notices and constraining their mobile/tablet layout. The six focused Chromium cases passed again. The authoritative candidate manifest is `ui-export-manifest.json` (JavaScript SHA256 `47679ad2bdd08e78dfb8ee82e1ca84b0f5744ad809ba023115843ef0522c19a8`); the older `export-manifest.json` describes an intermediate build. An earlier full-proof attempt was interrupted during export and then failed server startup; it is not a pass. The full 312-case suite finished with 311 passes, one intentional compact-mobile vertex-drag skip, zero failures and zero flaky cases. `full-browser-final-results.json` and `baseline-acceptance.json` record this result; all 177 source hashes and seven served asset hashes/MIME types were rechecked before the next source packet. This baseline does not validate later changes.

Independent read-only QA confirmed the lockfile scope, local worker/shared/license byte equality, web Babel transformation, root/nested path construction and JavaScript MIME. QA identified remaining boundaries: the attribution regression imports the installed upstream ESM in a synthetic page, so it does not by itself prove the sanitizer through Metro's exported application; subpath hosting and real PMTiles requests are untested; and asynchronous missing-worker failures need a dedicated regression and SVG recovery. Asset preparation checks the fixed reviewed worker/shared/license set, not arbitrary future module graphs. These findings require disposition, not inferred acceptance from installation or pixel checks.

Primary sources: [MapLibre sanitizer advisory](https://github.com/maplibre/maplibre-gl-js/security/advisories/GHSA-jrc7-96c5-q579), [v6 migration](https://maplibre.org/maplibre-gl-js/docs/guides/v5-to-v6-migration-guide/), [ESM worker installation](https://maplibre.org/maplibre-gl-js/docs/#installation), and [Expo's SDK 55 import.meta guidance](https://github.com/expo/expo/issues/30323). The installed Expo preset and runtime were also inspected before configuring the web-only transform.

## Compatible Transitive Security Packet: 2026-09-13

The reviewed B packet is installed in the shared checkout and aggregate source validation passed; combined browser reconciliation remains pending. Its lock SHA256 is `e6616c2b40c6d7d3fc67195632f2db4fc147523eaec5a8dd9f8ed7b730c46e6d`; its before-state is `f36fc7f7ae970291bc8413a8314a977685a9a486120773b82aaec7b5dcd96dfb`. Recovery and detailed old/new entries are retained under `/home/cyber/cplayout-security-maintenance-20260913-kYPy/`. Later test-script registrations were preserved.

The isolated command was `npm update @xmldom/xmldom brace-expansion js-yaml shell-quote ws @babel/core esbuild --workspaces --include-workspace-root --save=false --package-lock-only --ignore-scripts`. It updates only the reviewed transitive families and their necessary helper/platform entries: XML 0.8.15/0.9.12, brace-expansion 1.1.18/5.0.9, YAML 3.15.2/4.3.2, shell-quote 1.10.0, ws 7.5.13, Babel 7.29.7 and esbuild 0.28.2. All 44 changed lock locations were reviewed, including three removed duplicates and one identical-version ws relocation. All changed/added licenses are MIT. No direct dependency, override, Expo/RN/native version, library family, paid service, credential or cloud requirement changes.

Independent `npm ci --ignore-scripts`, the existing UUID metadata helper, tools/workspace typechecks, 49 workspace test files, ten non-server root tests and focused installed dependency checks passed. Esbuild's installed platform binary worked without its lifecycle script. Root and production audits each report five high affected package names, down from twelve; none of the seven targeted families remains.

Coordinator installation also passed: 693 packages installed with lifecycle scripts disabled, followed only by `node tools/patch_xcode_uuid_dependency.cjs`. The lock and all eight recorded manifests matched their expected hashes; esbuild 0.28.2 transformed a TypeScript probe without its lifecycle script. `npm ls --all --json` passed. Fresh root `npm audit --json` returned the expected nonzero vulnerability status with **five high, zero critical and no other severities**. Ignored evidence is under `reports/continuous-improvement/mapping-quality-20260913/security-B-*`. Aggregate validation and browser proof remain separate gates.

The previous lock, manifests, web export and all three installed dependency directories are preserved under `.cplayout-local/security-B-install-20260913-mG3QkC/`; its external pointer is in the publication recovery directory. Rollback restores that exact graph with no install/build process running, never HEAD or an unrelated dirty manifest. The earlier preview was stopped with ownership verification and port-release confirmation before installation.

After all source packets were integrated, coordinator `npm run validate` passed through every tools/workspace typecheck and test command. `npm run validate:skills`, generated-context freshness, and whitespace checks also passed. The exact installed graph was used for the fresh web export at `http://127.0.0.1:19006`; all ten served asset hashes/MIME types matched the export. The 348-case browser run found a late camera-fit defect after 201 passes and was interrupted for a focused renderer correction. Its failure/interruption records remain under `reports/continuous-improvement/mapping-quality-20260913/final-B/`. The corrected camera and RTK clock-fixture sources subsequently passed aggregate validation in an exact-index Linux clone. Interrupted full runs and the pending repeated browser reconciliation are documented in [mapping-rtk-quality-program.md](mapping-rtk-quality-program.md); they must not be summarized as a single passing full suite. The dependency lock is unchanged by these follow-ups. This is not native, field or performance acceptance.

The separate Metro A experiment is rejected: updating the Expo wrapper to 55.1.2 retained Metro 0.83.7 and image-size while adding nested 0.83.8 copies. A broader dedupe also changed unrelated packages and was rejected. Do not integrate either lock or repeat a forced repair. B deliberately starts from the original graph, not A. Its five remaining affected names are `@expo/metro`, `metro`, `metro-config`, `metro-transform-worker` and `image-size`; this is not five independent CVEs or a clean audit. Expo still reports the same six SDK 55 patch suggestions listed below.

Sources: [xmldom 0.8.15 release](https://github.com/xmldom/xmldom/releases/tag/0.8.15), [Babel advisory](https://github.com/babel/babel/security/advisories/GHSA-4x5r-pxfx-6jf8), [esbuild advisory](https://github.com/evanw/esbuild/security/advisories/GHSA-g7r4-m6w7-qqqr), and [Metro 0.83.8 release](https://github.com/react/metro/releases/tag/v0.83.8). Exact registry versions, integrity, licenses, engines and lifecycle metadata are retained in `evidence/B-footprint.json`; no lifecycle execution or field/native claim follows from metadata review.

## Mapping Refactor Review: 2026-09-12

The mapping refactor uses existing dependencies; its controller and view model need no new runtime package. This live review supersedes package availability and audit counts in the historical sections below. Availability alone does not establish compatibility.

| Packet | Installed at preflight | Candidate | Decision and acceptance |
| --- | --- | --- | --- |
| XML security | `@xmldom/xmldom` 0.9.10 | 0.9.12 patch | Applied exactly in core; MIT, Node >=14.6. KML/XML/document/archive tests and exact lockfile comparison passed. Transitive copies remain. |
| Browser MapLibre | 5.24.0 | 6.9.0 major | Critical audit finding; separate migration. Review Map/Marker/events/sources/PMTiles APIs, sanitization and attribution; run browser proof and SVG fallback. |
| Expo SDK 55 | Expo 55.0.28 | 55.0.31 patch | Live Expo check fails with six compatible patch recommendations. Use Expo installs; inspect native configuration and rebuild development clients. |
| Native MapLibre | 11.2.1 | 11.3.10 minor | Separate native packet. Align both workspaces; rebuild and prove Android/iOS lifecycle, vector/raster, attribution, and local sources. |
| PMTiles | 4.4.1 | 4.5.0 minor | Test protocol registration, range requests, and local archives; no native archive claim. |
| proj4 | 2.20.8 | 2.22.0 minor | Coordinate fixtures, negative CRS cases, round-trip tolerance and persisted XY stability. |
| zod | 4.4.3 | 4.6.2 minor | Align core/project-store; malformed document/archive round trips; separate from schema migrations. |
| Icons / SVG | 1.16.0 / 15.15.3 | 1.45.0 minor / 15.15.5 patch | Visual/native packet; Expo selection for SVG; align mobile/map-adapters. |

Expo also recommends development client 55.0.40, FileSystem 55.0.26, Sharing 55.0.24, Splash Screen 55.0.25, and SQLite 55.0.20. React 19.2.0 and React Native 0.83.10 remain on the current SDK line. Do not combine Expo/RN majors, MapLibre majors, storage migrations, GNSS native modules, or first local tile adapters.

### Installation and Rollback

Run each packet from a separate reviewed branch/checkpoint. Preserve that packet's existing manifests and lockfile; the current checkout already has dependency edits, so HEAD is not a valid rollback source for those files. Compare against the packet before-state and reinstall the restored graph if rollback is needed.

These are independent candidate commands, not one combined upgrade:

```sh
# XML security packet, root
npm install --workspace @cplayout/core --save-exact @xmldom/xmldom@0.9.12

# Browser renderer packet, separate branch
npm install --workspace @cplayout/map-adapters --save-exact maplibre-gl@6.9.0

# SDK 55 patch packet, from apps/mobile
npx expo install expo@~55.0.31 expo-dev-client@~55.0.40 expo-file-system@~55.0.26 expo-sharing@~55.0.24 expo-splash-screen@~55.0.25 expo-sqlite@~55.0.20
npx expo install --check

# Native renderer packet, separate from SDK changes
npm install --workspace @cplayout/mobile --workspace @cplayout/map-adapters --save-exact @maplibre/maplibre-react-native@11.3.10
```

Align project-store's shared Expo declarations to Expo-selected versions and inspect `npm ls` for duplicates. Preserve manual native-folder configuration. Install each pure helper candidate only in its declaring workspace(s), with focused tests. Icons and SVG require visual/native checks even though they are small version increments.

Before any new package/tool installation, record purpose, upstream license, transitive/native footprint, offline/no-cost behavior, absence of hidden keys and paid/cloud requirements, supported Node/Expo/RN versions, exact command, rollback/removal procedure, and acceptance evidence. Existing TypeScript, npm, GitHub CLI, Playwright, and repository launchers suffice for this refactor. GDAL/RTKLIB/CV tools remain separately specified offline companion tools.

Each completed packet requires focused tests, `npm run validate`, `git diff --check`, and `npm audit`. Rendering/package changes require `npm run proof:web`. Native changes require rebuilt device/emulator reports. Review a Playwright version before installing its matching Chromium binary. Record unavailable host/device tools rather than inferring runtime readiness.

### Current Audit and Sources

Preflight `npm audit` on 2026-09-12 reports **13 affected packages: 2 low, 10 high, 1 critical**. MapLibre's critical sanitizer bypass affects versions through 6.4.0; npm proposes 6.9.0 as a breaking fix. XML findings warrant the first narrow patch packet. Transitive findings include Babel, brace-expansion, esbuild, image-size, js-yaml, shell-quote, ws, and Metro paths. Forced breaking remediation is neither authorized nor used. Refresh counts after every packet.

- [xmldom 0.9.12 release](https://github.com/xmldom/xmldom/releases/tag/0.9.12); license/engine/integrity checked with `npm view @xmldom/xmldom@0.9.12 version license engines dist.integrity --json`.
- [MapLibre security advisory](https://github.com/maplibre/maplibre-gl-js/security/advisories/GHSA-jrc7-96c5-q579) and [releases](https://github.com/maplibre/maplibre-gl-js/releases).
- [Expo install CLI](https://docs.expo.dev/more/expo-cli/#install); local `npx --no-install expo install --check` failed with the six SDK 55 patch recommendations above.
- [MapLibre RN Expo setup](https://maplibre.org/maplibre-react-native/docs/setup/expo/) and [style sources](https://maplibre.org/maplibre-style-spec/sources/).
- [PMTiles protocol integration](https://docs.protomaps.com/pmtiles/maplibre) and [Expo SQLite setup](https://docs.expo.dev/versions/latest/sdk/sqlite/).
- [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/) and [USGS imagery metadata](https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer?f=pjson): connected previews remain separate from offline preprocessing and package creation.

### Applied XML Packet: 2026-09-12

Installed `@xmldom/xmldom` 0.9.12 exactly in `@cplayout/core` using the documented command with `--ignore-scripts`. A dry run showed one changed package and no additions/removals. Structured lockfile comparison confirmed only the core dependency declaration and its resolved XML package entry changed; all other dependencies stayed at their previous versions.

Core import/XML/KML/document/reducer tests and project-store archive/KML ZIP/persistence tests passed after installation. The full validator passed after the final SVG follow-up and local MapLibre stylesheet import, then passed again on resume. Full browser acceptance completed with 296 passed cases, one intentional compact-mobile skip, and no failed or flaky cases; see the mapping execution record for the reconciled reports. The root audit was refreshed on 2026-09-13 UTC and confirmed the counts below. The pre-packet manifest and lockfile are retained as `pre-xml-core-package.json` and `pre-xml-package-lock.json` in the migration recovery directory.

The root audit still reports **13 affected packages: 2 low, 10 high, 1 critical**. The direct CPLayout XML path is now patched, but `plist` still resolves XML 0.9.10 and `@expo/plist` resolves 0.8.13 through native/build tooling. Those paths remain in the Expo/native upgrade queue. The workspace install's zero-advisory message was scoped and does not replace the root audit. No major renderer, Expo, native, or helper version was changed with this patch.

See [mapping implementation](mapping-refactor-plan.md) and [migration authorization/results](github-migration-plan.md). Deferred dependency packets remain unaccepted until their separate validation evidence is recorded.

## Current Decision

Keep CPLayout on the Expo SDK 55 compatibility line while RTK hardware work enters native implementation. Apply SDK-compatible patches independently; do not combine an Expo SDK major, React Native major, MapLibre native update, project-store migration, or first GNSS native module in one validation packet.

The historical inventory below was derived from workspace manifests, the lockfile, outdated-package output, Expo validation, and Expo Doctor on 2026-08-09. The dated review above supersedes its availability/check results; `package-lock.json` remains the transitive dependency record.

## Toolchain

| Surface | Selected line | State and next gate |
| --- | --- | --- |
| Node.js | 24 LTS; `.nvmrc` is `24`; engine `>=20.19.4 <25` | Tested locally as 24.14.1. Review on each Node LTS maintenance update; repeat full validation. |
| npm | 11; package manager 11.17.0; engine `>=10 <12` | Tested locally as 11.17.0. Do not change lockfile format/toolchain during a native feature packet. |
| TypeScript / tsx | TypeScript 5.9 line; tsx 4.22.4 | Keep within the current compiler line until all workspaces typecheck; evaluate TypeScript major separately. |
| Node/React/GeoJSON types | `@types/node` 24 line, `@types/react` 19.2.16, `@types/geojson` 7946 line | Node types match runtime. Type-only patches require typecheck plus browser proof when JSX declarations change. |
| Playwright | `@playwright/test` 1.60 line | Upgrade browser binaries and package together; run the entire web suite and inspect screenshots. |
| Expo CLI / Doctor | invoked through the pinned workspace with `npx` | 2026-09-27 `CI=1 npx expo install --check` passes after six SDK 55 patches. Current Doctor passes 19/20 and exits 1 on the known native-folder/app-config synchronization gap; no native Prebuild is implied. |

Tracked non-npm validation/runtime tools are Git, Python 3 for repository validators and the local ML companion, Playwright Chromium, Android SDK/ADB/JDK/Gradle for Android reports, PowerShell and Google Earth Pro for targeted KML/KMZ proof, and platform browsers. Their availability is host-specific; a source or compile result does not substitute for the applicable runtime report.

## Direct Runtime Packages

The internal workspace packages are `@cplayout/core`, `@cplayout/geometry`, `@cplayout/gnss`, `@cplayout/map-adapters`, `@cplayout/project-store`, and `@cplayout/mobile`. They resolve locally through npm workspaces and are versioned as one repository.

| Responsibility | Direct external packages | Upgrade policy |
| --- | --- | --- |
| Expo/native shell | `expo`, `expo-dev-client`, `expo-file-system`, `expo-sharing`, `expo-splash-screen`, `expo-sqlite`, `expo-status-bar`, `@expo/metro-runtime` | SDK 55 compatible patches were aligned with `npx expo install`. Any SDK major requires an isolated prebuild/native reconciliation, development-client rebuild, and Android/iOS proof. |
| React surfaces | `react`, `react-dom`, `react-native`, `react-native-web`, `react-native-safe-area-context`, `react-native-svg` | Keep the Expo-selected React 19.2 / React Native 0.83 line. Patch only through Expo compatibility checks, then run web and native layout gates. |
| Maps and local tiles | `@maplibre/maplibre-react-native`, `maplibre-gl`, `pmtiles` | Defer MapLibre React Native 11.3.6 and maplibre-gl 6 until isolated rendering/API review. Native changes require rebuilt Android/iOS reports; raw PMTiles still requires a local protocol/adapter. |
| Coordinate and interchange core | `proj4`, `@placemarkio/tokml`, `@tmcw/togeojson`, `@xmldom/xmldom`, `zod` | Update one behavior family at a time. Run CRS/geometry, KML/KMZ, document-schema, repository, archive, and browser round trips as applicable. `proj4` 2.21 is a candidate patch, not an automatic update. |
| Geometry | `polygon-clipping` | Pin until deterministic geometry fixtures pass under a candidate update. |
| Storage/archive | `fflate` plus the Expo storage packages above | Any change requires malformed/archive-limit tests, project round trips, web persistence, and current native ZIP proof. |
| UI icons | `lucide-react-native` | Defer the available minor update to a focused visual/API pass with browser and native layout review. |

## Applied 2026-08-09

- Added Node/npm engine and package-manager declarations plus `.nvmrc`.
- Matched `@types/node` to Node 24.
- Aligned Expo SDK 55 compatible patches, including Expo 55.0.28, React Native 0.83.10, Metro Runtime 55.0.12, development client 55.0.37, FileSystem 55.0.24, Sharing 55.0.22, Splash Screen 55.0.23, and SQLite 55.0.18.
- Deduplicated Expo native modules and React Native across mobile, map adapters, and project-store workspaces.
- Kept Expo/React Native majors and MapLibre native code unchanged.

## Deferred Upgrade Queue

1. Resolve the Expo native-folder/app-config lifecycle warning before the next native release. Inspect generated diffs; do not blindly overwrite manual native configuration.
2. Triage every `npm audit` path. Prefer upstream compatible patches or narrow overrides with tests; never use unbounded forced remediation as an acceptance gate.
3. Evaluate MapLibre React Native 11.3.6 in a dedicated branch/report with vector, raster, attribution, local URL, and lifecycle proof on target devices.
4. Evaluate `proj4` 2.21 and other pure TypeScript patches with coordinate fixture parity and archive/browser regressions.
5. Treat Expo 57, React Native 0.86, maplibre-gl 6, and TypeScript 7 as separate future architecture migrations. Refresh primary documentation before scheduling them.
6. Add a native GNSS dependency only after the Android USB transport spike in `docs/rtk-gnss-integration-plan.md` selects a receiver/chipset and proves permission, read/write, detach, reconnect, license, and New Architecture compatibility.

## Historical Audit: 2026-08-09

The final 2026-08-09 audit reports 17 advisories: 2 low and 15 high. The production dependency graph reports 16: 1 low and 15 high.

- Affected transitive packages are `@babel/core`, `brace-expansion`, `esbuild`, `image-size`, `js-yaml`, `shell-quote`, and `ws` through Expo, Metro, React Native, and related tooling paths.
- npm offers ordinary remediation for all listed paths except `image-size`, but its broad repair may also re-resolve native dependencies and therefore requires manifest/lock review plus the normal validation gates.
- npm's only offered `image-size` remediation installs Expo 53.0.27, an incompatible SDK downgrade from the verified Expo 55 line. That remediation is rejected.
- No forced or unbounded audit repair was applied. Recheck Expo/Metro releases first, then test narrow compatible patches or overrides in an isolated dependency packet.

## Recurring Gate

Quarterly and before releases:

1. Run `node --version`, `npm --version`, `npm outdated --workspaces --long`, `npx expo install --check`, `npx expo-doctor`, and `npm audit`.
2. Review manifest and lockfile diffs. Reject unrequested SDK majors, paid/keyed services, hidden network dependencies, telemetry, and trial-only packages.
3. Run `npm run validate`, `npm run proof:web`, `npm run context-map:check`, `npm run validate:skills`, and `git diff --check`.
4. Rebuild and repeat the feature-specific native/device reports for every changed native dependency.

## Claims Still Unverified

- Package compatibility checks do not prove Android/iOS runtime behavior.
- No physical RTK receiver, correction stream, or GNSS native module was package-validated in this pass.
- `npm outdated` versions are availability signals, not compatibility or upgrade approval.
- Historical audit counts are not current closure evidence; use the latest dated audit and exact dependency paths before accepting a package packet.

## Duplicate-JSON Guard Packet: 2026-09-17

- Decision: add exactly `jsonc-parser@3.3.1` to `@cplayout/project-store`. Review found that native `JSON.parse` silently discards earlier duplicate members, including escaped-equivalent keys, during workspace migration. The visitor supplies decoded property names before materialization, allowing rejection without a hand-written JSON grammar.
- Primary evidence: [versioned manifest](https://raw.githubusercontent.com/microsoft/node-jsonc-parser/v3.3.1/package.json), [MIT license](https://raw.githubusercontent.com/microsoft/node-jsonc-parser/v3.3.1/LICENSE.md), and [versioned visitor API](https://raw.githubusercontent.com/microsoft/node-jsonc-parser/v3.3.1/src/main.ts), retrieved 2026-09-17 UTC. This version ships UMD and ESM JavaScript, declares no runtime dependencies, and needs no native module, key, paid service or cloud endpoint. Native Expo runtime compatibility remains unverified until device proof; web bundling and tests are acceptance gates, not substitutes.
- Install: `npm install --workspace @cplayout/project-store --save-exact jsonc-parser@3.3.1`. No SDK or MapLibre major change is part of this packet.
- Configure strict JSON: comments, trailing commas and empty content disabled; reject every visitor error and repeated decoded key. Return native `JSON.parse` output only after the visitor succeeds. Preserve original payload/backup strings.
- Validation: focused migration/envelope tests, project-store typecheck, aggregate `npm run validate`, browser Web Locks harness, Expo web export, `npm audit`, and lockfile diff review. Record actual outcomes in `docs/full-refactor-execution.md`.
- Rollback: remove this packet's manifest entry and strict-parser imports/helper as a reviewed unit, regenerate the lockfile with npm, and rerun those gates. Do not reset unrelated dirty work or activate the new store while this guard is absent.
