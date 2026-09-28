# Native Workspace Integration

## Current Scope

The repository contains the pure TypeScript native workspace storage, protected
upgrade, retained-backup verification, legacy-access ownership, and startup
composition. They are not yet the application's default native repository.
`projectRepository.native.ts` and the Android proof runtime still use the legacy
backend. Browser persistence is unchanged except for the optional pure
`describeWorkspace` contract shared with the native adapter.
Native composition lives in `src/nativeWorkspaceAccess.ts`, not the general
package entry. This keeps Expo/React Native type declarations out of browser and
command-line consumers; the native bootstrap can import that dedicated entry.

`createNativeWorkspaceStartup` accepts explicit existing-file intents:

- `open` performs a verified non-migrating workspace read before returning a
  repository. It does not initialize missing workspace records.
- `upgrade` uses one legacy owner, drains admitted work, closes the old handle,
  performs the protected upgrade, consumes its same-session permit, and performs
  a verified read before returning a repository.

Concurrent starts share one promise. Failed startup cannot retry or fall back to
the legacy auto-migrator. A later backend recovery failure is reflected in startup
state and prevents reopening through that startup object. Canonical geometry
remains projected/local XY; persistence does not promote imagery or GNSS display
coordinates into project geometry.

### Existing-File Inspection

`inspectNativeWorkspaceSource`, exported through `nativeWorkspaceAccess.ts`,
provides a non-migrating routing observation before the eventual startup
dispatcher. It uses the existing native source lease, a private query-only
connection and a main-schema read that pins a deferred transaction. It captures
adapter constructors before yielding, checks ownership around reads, and returns
only after rollback, ownership verification and successful close.

Versions 11 and 12 produce `legacy_candidate` and `workspace_candidate`;
other integer versions produce `unsupported`. These are not schema validation,
admission permits or repository access. Reopening must independently verify the
source and every applicable admission condition. No database handle escapes.
Query, ownership, transaction or close failure prevents any routing result and
preserves the primary and cleanup errors. No stock opener, migration, file
creation or failure-text classification is attempted.

The installed patch cannot yet distinguish confirmed leaf absence from missing
parents, access failures and unsafe identities through a typed native result.
Thus inspection failure does not mean "new installation." A future native probe
must verify the parent before reporting absence. Exclusive creation remains a
separate native capability and integration gate, not check-then-open logic.

This is **not physically read-only access**: the native lease opens SQLite
read/write and the engine may perform [journal recovery](https://www.sqlite.org/lockingv3.html#dealing_with_hot_journals).
`query_only` restricts SQL data
changes, not all filesystem effects. The bounded tests use clean synthetic Node
SQLite fixtures, not Android recovery behavior. The inspection module is not yet
wired into the application's default repository or Android proof runtime.

Inspection checkpoint, 2026-09-27: complexity/reasoning xhigh, independent
high-effort read-only database review, coordinator-only writes. Review found no
implementation defect and identified cleanup-test gaps; four added cases cover
failed close before release, successful-but-ineffective rollback, failed cleanup
status inspection, and wrapper failure combined with native close failure.

`npm run validate` passed, including 346 native-workspace tests with zero
failures/skips and ten ownership-installer tests. Project-store typecheck was
repeated successfully after the final test-only additions, which preceded native
test bundling in the aggregate run. The final native runner reported no input
drift and retained `cplayout-native-workspace-Tl2rXf/result.json` with its transcript
under the host temporary directory. The earlier focused run passed 342 cases
before those additions. Audit found zero vulnerabilities; context-map, skill and
patch-integrity checks passed. This is source/Node SQLite evidence with simulated
bridges, not new native execution. No browser rebuild or new browser-proof run
was performed; the separate human Edge review remains open and pending.

## Validation

Run `npm run validate` and `npm audit`. On Node 24 or newer on a POSIX host,
aggregate validation includes the native workspace suite. Use WSL on Windows.
The temporary directory must have an ASCII path compatible with the native path
grammar used by the fixtures (for example, `TMPDIR=/tmp`). On older supported
development Node versions or native Windows, the aggregate suite prints an
explicit skip; such a run does not establish its acceptance.
Run `npm run test:native-workspace -w @cplayout/project-store` to require the suite
rather than permit a skip; this command fails on unsupported hosts.

The runner uses real Node SQLite and simulated Expo/native bridges. It bundles
canonical checkout sources into a fresh temporary evidence directory so fixture
databases do not accumulate in source folders. It records input/executable hashes
and rejects drift across bundling and execution, including the external parser.
Test evidence and its `tests.log` transcript are retained with the printed
`result.json` path.
These checks do not prove Android/JNI file ownership, native backup behavior, or
physical field accuracy.

## Remaining Integration Gates

The Android build now includes `@cplayout/backup-artifacts` and the reviewed
ten-file Expo SQLite ownership patch. The root postinstall checks the pinned
package versions and all reviewed baseline hashes before applying it; modified
or partial installations are refused. `npm run patch:sqlite-ownership -- --check`
requires the complete patched state without writing. SQLite is pinned to 55.0.20
and its Android module is explicitly built from source so Expo cannot substitute
the stock prebuilt artifact. The package lookup opens no files; project-store
remains the sole session-facade owner. No application database is migrated by
installation.

The supported ownership profile uses stock SQLite. LibSQL, SQLCipher,
sqlite-vec and custom build flags do not advertise its capabilities. ATTACH,
VACUUM/VACUUM INTO and dynamic extension loading are intentionally unsupported.
The handle registry is process-local; it is not a cross-process lock or a
filesystem sandbox against other native libraries or same-UID code.

### Build Checkpoint: 2026-09-27

- Full source validation passed, including 308 native-workspace tests and 10
  installer tests; the audit reported zero vulnerabilities. Context-map and
  skills validation passed.
- Expo dependency compatibility and autolinking verification passed.
- The integrated Java registry passed 1,223 assertions and the receipt codec
  passed 38 assertions on the JVM, not an Android filesystem.
- Both library targets below built successfully after renaming the backup
  module's private registry to avoid an inherited Expo `Module.registry` member.
  That Kotlin-only correction followed the source-validation snapshot; no
  TypeScript changed afterward.

From `apps/mobile/android`:

```sh
./gradlew :expo-sqlite:assembleDebug :cplayout-backup-artifacts:assembleDebug --no-daemon --max-workers=2 -PreactNativeArchitectures=x86_64 --console=plain
```

This checks Kotlin/Java and SQLite JNI/C++ library compilation for x86_64.
It is not an application APK build, module invocation, ARM build, Android device
test, or migration/durability proof. Existing upstream Gradle deprecation warnings
remain; the separate Android Java test-source compile reported five broad
AutoCloseable exception warnings.

### Android Java Runtime Checkpoint: 2026-09-27

The full x86_64 debug APK subsequently built with `NODE_ENV=development` and
`:app:assembleDebug` using the same Gradle flags above. Its installed bytes matched
the build APK. This establishes an installed app-UID host, not that its Expo
bridge or patched SQLite JNI was invoked.

The separately compiled and hashed Android Java service tests ran with Android
16/API 36, SELinux enforcing, UID 10216, and the `runas_app` domain. Of 55 cases,
54 passed, zero failed, and one was skipped because Android denied creation of
the hardlink fixture. Hardlink rejection remains unverified in this environment.
The tightened suite covers fresh-destination receipt size limits, actual UTF-8
codec round trips, independent digest checks, precise identity/sidecar rejection
reasons, and copy/inspection/cleanup flush failures.

Separate `app_process` invocations prepared and reopened a schema-7 synthetic
SQLite fixture. Both exited successfully; queried data and independently hashed
retained database/receipt bytes were unchanged. This is orderly cross-process
reopening, not app restart, v11/v12 migration, crash recovery or power-loss proof.
The app was not launched and the normal project database was not opened.
See the [scoped evidence record](evidence/native-artifacts-20260927/README.md).

The owned emulator was stopped and no Android device remained attached. Test
fixtures, staging DEX files, AVD data and host logs were preserved. Patch integrity,
tracked diff whitespace and a fresh dependency audit passed; the audit found zero
vulnerabilities. Full TypeScript validation was not rerun in this Java-test/docs
pass; the earlier aggregate checkpoint remains the source-validation evidence.

### Next Gates

1. Exercise the ownership patch and backup-artifact module through the real
   Android app's Expo/JS bridge. APK compilation and standalone Java service tests
   now have evidence; neither invokes the patched SQLite JNI ownership path.
   Stock Expo SQLite does not advertise the custom source-lease capabilities
   required by these adapters. Autolinking is not execution proof.
2. Introduce a native startup dispatcher with one canonical source identity and
   one `createLegacyAccess` instance. Replace the default repository and the raw
   Android proof opener together. Do not reuse `openProjectDatabaseAsync` as its
   opener: that legacy helper caches handles and runs migrations.
3. Distinguish missing, legacy, admitted, unsupported, and unreadable sources using
   non-migrating inspection. The existing-file inspector now supplies version
   candidates, not admission or a missing-file verdict. Complete typed native
   absence/error reporting and the dispatcher. Missing-file creation requires a
   separate race-safe ownership path; an arbitrary open failure is never
   permission to create a file.
4. Keep v11 upgrade explicit. Cold v12 access must leave the legacy opener unused
   and validate schema, receipts, retained backup, and the legacy write fence.
   Version numbers alone do not authorize access.
5. Gate the existing Android proof's writes before the first mutation. V12 writes
   require revision-bearing workspace commands; its native ZIP flags remain false.
6. Finish recovery interaction, fresh installation, native ZIP, and iOS integration,
   then run the device checklists. Preserve retained source/backup/receipt evidence
   on rollback; running a v11 writer on an admitted v12 database is not rollback.

Hardware operation and less-than-0.10 m measured 3D accuracy, including elevation,
remain unverified for the specified NavSpark, ESP32, XBee, and relay equipment.
Receiver specifications or these storage tests cannot establish that field result.

## Native Module Sources

Reviewed 2026-09-27: [Expo autolinking](https://docs.expo.dev/modules/autolinking/)
documents recursive dependency discovery and module configuration;
[Expo Modules setup](https://docs.expo.dev/modules/get-started/) describes native
module integration. [Precompiled modules](https://docs.expo.dev/guides/prebuilt-expo-modules/)
documents the `buildFromSource` opt-out needed for patched native sources.
Discovery is not compilation or device proof. Keep the work
offline-first and free of paid services, keys, or cloud dependencies.

Inspection sources checked 2026-09-27: [SQLite transactions](https://www.sqlite.org/lang_transaction.html)
explains why a deferred transaction needs its first database read to establish a
snapshot; [query_only](https://www.sqlite.org/pragma.html#pragma_query_only)
does not make a connection completely read-only. The
[SQLite opening contract](https://www.sqlite.org/c3ref/open.html) states that
`SQLITE_OPEN_EXCLUSIVE` is not exclusive file creation. These sources support the
inspection boundary, not Android execution proof.
