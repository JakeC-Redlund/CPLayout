# Android Artifact Service Evidence

Observed 2026-09-27 against base `96ba2e90aed79efae0b44ab7190a53a2bd677700`
plus the preserved, uncommitted native integration. Claim class: native/device,
limited to directly executed Java artifact service/backend/registry/codec tests.
No release or publication claim is made.

## Observations

- Android 16/API 36, x86_64, fingerprint
  `google/sdk_gphone64_x86_64/emu64xa:16/BE2A.250530.026.F3/13894323:userdebug/dev-keys`.
- Package `local.centerpivot.layout`; UID 10216; SELinux enforcing;
  execution domain `u:r:runas_app:s0:c216,c256,c512,c768`.
- Full debug APK build succeeded (411 tasks); installed APK bytes matched.
  The APK supplied an app-private UID host. It did not supply the executed Java
  test DEX, which was separately compiled from the five hashed files below.
- [Service transcript](service-tests.txt): 54 pass, zero fail, one skip out of
  55 named cases. The only skip is hardlink fixture creation denied by Android.
- [Prepare](prepare.txt) PID 4005 and [reopen](reopen.txt) PID 4023 both exited
  zero in separate invocations. Retained database and receipt hashes were
  independently checked before and after reopening and did not change.
- Source hashes matched before/after compilation and execution. The copied
  device DEX and installed APK were read back and checked against host hashes.
- Emulator shutdown returned success, its process exited zero, and the final
  `adb devices -l` showed no device. Fixtures, AVD, staging DEX and host logs
  remain retained; no app data was cleared.

## Method

Compile the four production Java files and `NativeArtifactServiceTest.java`
with `javac --release 8 -Xlint:all` against API-36 `android.jar`, jar the classes,
and convert with `d8 --min-api 27 --lib <android.jar> --output <tests.dex.jar>`.
Compilation passed with five existing broad AutoCloseable exception warnings.
See the official [D8 reference](https://developer.android.com/tools/d8).

All ADB calls targeted the dedicated `emulator-5580` and verified its AVD identity.
The DEX was copied into a fresh directory owned by the installed package and set
read-only before execution. Each invocation used this shape:

```sh
adb -s emulator-5580 shell run-as local.centerpivot.layout env CLASSPATH=<private-tests.dex.jar> /system/bin/app_process /system/bin local.cplayout.storage.NativeArtifactServiceTest <fresh-root> [prepare|reopen]
```

The suite root and the retained prepare/reopen root were separate. The collector
required exit zero, 55 unique outcomes, matching runtime UID/fingerprint, and no
skip except the explicitly identified hardlink case. Independent host SHA-256
checks used raw `adb exec-out run-as ... cat` bytes, not service-reported digests.
The retained local packet is identified as `runtime-ppS1ZI`, compiled from
`compile-6O9uh7`; it includes all command arguments, stdout/stderr, exits and
timestamps. These local identifiers are not portable artifact URLs.

## SHA-256 Bindings

| Artifact | SHA-256 |
| --- | --- |
| NativeArtifactService.java | `dc600fcd03263d3853acbd786ecdf5649a6329b4d40fc101d508b71b56674b60` |
| ArtifactSessionRegistry.java | `5ee75af1355e6173bdbf9a0b32a63af1a4eae397b1ef61888a1248c046d627a4` |
| AndroidArtifactBackend.java | `750fcd889ea67c5ecd2953042e4faedd30f369ec628759b74e0d51795736d6b0` |
| ReceiptHexTransport.java | `9d11991a58358f6bcc8f392ca039f2694a1bf24044088ac5fff8045baa11b06b` |
| NativeArtifactServiceTest.java | `c0887c630efb7ffb5372ccd1485b637c5c1c1d03c277122c5ee13cdc84892748` |
| Executed DEX JAR | `45455752036dde83ee02662718b224af725770007fc3316c3aa668de4543cb46` |
| Installed APK host | `a097cdcaa942562f080db2c0eceb09251ccfb24f5fab857ad5611010aed6e5f7` |
| service-tests.txt | `3c7cee378d6cafbbbf7e5e903c815542e1f40fdba17675f4afe0a73f4b315c6c` |
| prepare.txt | `be3abb31a50d2501806a710b5735b211949a139bd0dd10c0b3697e382ed114bd` |
| reopen.txt | `951ba57a2e1aa5a074970a60220aba1ee8c1ce9b704a0e404ef813305924bcfb` |
| Retained database | `7c41f5cd353d31f53c4bfe58f6a6c407555d347ca7bf2a8b03424039644ead6d` |
| Retained receipt | `54565182c011e9a9025af9945c231368b5966e8acd51e78471f016a56c100659` |

## Exclusions

This uses a synthetic schema-7 Android-framework SQLite fixture, not project
schema v11/v12. It does not invoke the Expo/Kotlin-to-JS bridge, custom Expo SQLite
JNI ownership paths, production startup/migration, ZIP sharing or app lifecycle.
Normal process exit is not crash/power-loss recovery. `runas_app` is not proof of
behavior under the normal app SELinux domain. Hardlink handling, ARM devices,
iOS, native map rendering, hardware connections and less-than-0.10 m measured
3D field accuracy remain unverified by this packet.
