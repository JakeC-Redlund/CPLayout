# Native Backup Artifacts

Android-only Expo module for app-private backup and prepared-receipt files.
`getBackupArtifactsModule()` performs a lazy raw lookup; it does not create a
session or access files. Unsupported platforms return `null`. Project-store owns
the protocol checks, session facade, receipt codec, SQL handle ownership, and
upgrade orchestration. Do not add a second copy of that facade here.

The app dependency enables Expo autolinking. Operations require Android API 27+
and use only the app-private artifact directory. Session release and module
teardown preserve backup evidence; they do not delete attempt directories.
No permission or network service is required.

`tests/java/ArtifactSessionRegistryTest.java` and `ReceiptHexTransportTest.java`
are standalone JVM tests with `main` entrypoints. Compile them with the matching
production classes using `javac --release 8`, then run each qualified class under
`local.cplayout.storage`. `NativeArtifactServiceTest.java` requires the Android
runtime and app-UID filesystem access; compiling against `android.jar` is not a
test pass. The project-store native-workspace suite tests the TypeScript adapter
using simulated bridges, not this native implementation.

The Android suite takes a fresh absolute app-private directory as its first
argument. Optional `prepare` and `reopen` phases must use the same separate
retained directory in different processes. Reconcile all named cases, terminal
counts and exit codes; the hardlink case can explicitly skip if Android denies
fixture creation. Keep that skip unverified. Bind compiled source and executed
DEX hashes and independently compare retained database/receipt hashes across
phases. The schema-7 fixture uses Android framework SQLite, not Expo SQLite.
The [2026-09-27 runtime record](../../docs/evidence/native-artifacts-20260927/README.md)
contains the observed scope and remaining exclusions.

Autolinking and compilation do not establish device durability, process-interrupt
recovery, iOS support, or receiver accuracy. See
[native integration gates](../../docs/native-workspace-integration.md).
