# Android Native Runtime Verification

Use this checklist before reporting native SQLite, native ZIP sharing, or native file picking as production-verified. Android is the first target because the project already exports an Android bundle with Expo SQLite, FileSystem, and Sharing configured.

## Required Setup

- Build a native app or development client. Expo Go is not sufficient for validating config-plugin native modules.
- From the repo root, use `npm run android` for the local Android development-build path; it delegates to `expo run:android` in `apps/mobile`.
- Record device/emulator model, Android version, app build type, package version, and date.
- Start from a clean install when validating migrations from scratch; repeat once with an existing install when validating upgrade migrations.

## Repo Harness

- `npm run check:android-tools` detects `adb`, connected devices/emulators, whether `local.centerpivot.layout` is installed, and basic package/log evidence.
- `npm run verify:android-native` writes a timestamped JSON report under `reports/android-native-verification/` and fails until a built app plus completed checklist evidence are available.
- `npm run verify:android-native -- --report <report.json>` validates a completed report. Incomplete reports fail and must not be used to claim native runtime verification.
- `npm run verify:android-layout` remains the narrow normal-workspace Android layout proof. It captures one screenshot, UIAutomator XML, MapLibre logcat evidence, PNG metrics, and writes `reports/android-layout/latest.json`.
- `npm run review:android-app` runs the broader advisory Android app-review loop. It launches the installed package or dev-client URL unless `--no-launch` is supplied, drives the selected Android routes with ADB/UIAutomator, captures screenshots/XML/OCR/CV/logcat evidence for each scenario, and writes a timestamped report plus `reports/android-app-review/latest.json`. Supported options are `--serial`, `--dev-client-url`, `--wait-ms`, `--scenarios`, `--output-dir`, and `--no-launch`.
- `EXPO_PUBLIC_CPLAYOUT_ANDROID_NATIVE_PROOF=1 npm run start -w @cplayout/mobile -- --dev-client --port 8082 --clear` serves a proof-only Android development-client bundle. With that server running, `npm run verify:android-native -- --collect --dev-client-url "exp+center-pivot-layout://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8082" --wait-ms 30000` launches the app, collects the in-app SQLite/archive proof marker from logcat, drives Files ZIP export/import through Android UIAutomator, captures share-sheet/DocumentsUI screenshots/XML, and writes a completed or failed report.
- Use `--serial <adb-serial>` when more than one device/emulator is visible. The report passes only when both in-app schema/archive evidence and OS share-sheet/DocumentsUI picker evidence are present.
- `EXPO_PUBLIC_CPLAYOUT_NATIVE_MAPLIBRE_PROOF=1 npm run android` builds a development app with the native MapLibre tile-template proof panel enabled; after install, `npm run verify:native-maplibre` starts the local proof tile server, runs `adb reverse`, captures a device screenshot, computes pixel metrics, and writes `reports/native-maplibre/latest.json`.
- For Expo development-client runs, start Metro with the same proof environment and pass the dev-client URL to the proof runner with `--dev-client-url` or `CPLAYOUT_EXPO_DEV_CLIENT_URL`. Redirect Metro logs during automation so ANSI progress output does not flood WSL sessions.
- Use `docs/android-native-verification-report-template.json` as the checked-in report shape. The observed evidence arrays start empty; fill them only from device SQL/query evidence. Runtime reports are intentionally ignored by Git unless a specific report is promoted intentionally.
- Generated Android layout/app-review reports are local evidence artifacts. Promote only curated summaries with hashes under `docs/evidence/` when a claim must survive report cleanup.

Historical Android proof note, 2026-06-03: Samsung SM-P613 (`R52W20BK7XH`, Android 14/API 34) passed `npm run verify:android-native -- --report reports/android-native-verification/android-native-verification-20260603T034817Z.json` for Expo SQLite save/relaunch/list/load/delete, native share-sheet ZIP export, Android DocumentsUI ZIP import, and schema migration evidence through schema v8. That report is historical evidence only and does not satisfy the current schema v11 native runtime gate.

Historical Android proof note, 2026-06-05: `reports/android-native-verification/android-native-verification-20260605-134229571Z.json` validates on Samsung SM-P613 (`R52W20BK7XH`, Android 14/API 34) for SQLite schema v10, migrations 1-10, map-package imagery provenance columns, retired review-table absence, native share-sheet ZIP export, and Android DocumentsUI ZIP import. That report is artifact-specific historical evidence after the schema v11 migration and must not be used as current native SQLite/ZIP proof.

Current Android proof status, 2026-06-11: no completed schema v11 Android SQLite/ZIP report is checked in or assumed current. Locally generated incomplete templates under `reports/android-native-verification/` are blocker evidence only; use a completed schema v11 report path with `npm run verify:android-native -- --report <completed-v11-report.json>` before native SQLite or ZIP sharing are reported as current for a new build/device.

## Android App Review Loop

Run this loop when reviewing Android tablet app workflow, route structure, drawer/HUD safety, Files controls, Settings, Help, and optional native MapLibre proof routing:

```sh
npm run review:android-app -- --serial R52W20BK7XH --dev-client-url "exp+center-pivot-layout://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8082" --wait-ms 30000
```

The default scenarios are `map-workspace`, `map-drawers-open`, `map-drawers-closed`, `files-route`, `settings-route`, and `help-route`. Add `native-maplibre-proof` only when the installed build and Metro/dev-client server were both started with `EXPO_PUBLIC_CPLAYOUT_NATIVE_MAPLIBRE_PROOF=1`.

The app-review report fails on blank or near-uniform screenshots, missing required UIAutomator route anchors, MapLibre `resourceURL` errors, or clickable controls overlapping Android system bars. It warns on dense edge/clutter metrics, duplicated labels, clipped OCR/text evidence, small touch targets, and overlapping click targets. UIAutomator XML is the primary source for labels, bounds, clickability, and route anchors; Tesseract OCR and OpenCV screenshot metrics are corroborating advisory evidence only.

This loop does not satisfy Android native SQLite/ZIP proof, schema-v11 migrations, Android share-sheet/DocumentsUI proof, raw PMTiles/MBTiles rendering, iOS behavior, or production geometry correctness. Screenshots, XML, OCR, and CV evidence cannot populate or mutate canonical projected/local `XY`.

## SQLite Project Store

1. Open the app and navigate to `Files`.
2. Confirm the backend panel reports `Expo SQLite`, runtime `native`, and schema version `v11`.
3. Save the sample project.
4. Close and relaunch the app.
5. Refresh the project list and open the saved project.
6. Confirm project name, CRS, unit system, field boundary point count, obstacle count, survey point count, and settings match the saved project.
7. Delete the saved project, refresh, and confirm it is removed from the active list.

## ZIP Export And Import

1. Save the current project locally.
2. Export a ZIP package through the native share sheet.
3. Record the exported filename, byte size, and SHA-256 hash if available.
4. Import the same ZIP package through the app picker.
5. Confirm the imported project opens and is saved back to SQLite.
6. Confirm `manifest.json` and `project.json` are present and that `manifest.projectId` and `manifest.projectCrs` match `project.json`.
7. Fill `osFileUi` with Android resolver/share-sheet and DocumentsUI picker evidence: `shareSheetOpened`, `shareSheetScreenshotPath`, `shareSheetXmlPath`, `documentsPickerOpened`, `documentsPickerScreenshotPath`, `documentsPickerXmlPath`, pushed ZIP path, selected filename, and selected byte count.

## Migration Evidence

- `schema_migrations` contains ids `1` through `11`.
- `PRAGMA user_version` returns `11`.
- `map_packages` has the tile metadata columns from migrations `3`, `8`, and `9`: `tile_content_type`, `tile_scheme`, `tilejson_url`, `tile_url_templates_json`, `vector_overlay_json`, `imagery_provenance_json`, `checksum_sha256`, and `install_status`.
- The v10 migration has removed retired review tables: `layout_evidence`, `model_recommendations`, and `layout_decisions` are absent after migration, and the current v11 migration is present in `schema_migrations`.
- Fill `sqlite.absentTables` in the report with exactly the retired review tables confirmed absent by SQL evidence: `layout_evidence`, `model_recommendations`, and `layout_decisions`.
- Geometry rows and vertices are populated after save.

## Native MapLibre Vector Tile Template Proof

1. Build/install the native development app with `EXPO_PUBLIC_CPLAYOUT_NATIVE_MAPLIBRE_PROOF=1 npm run android`.
2. Confirm `adb devices -l` shows the target device/emulator in `device` state.
3. Start the Expo dev server with the proof environment, for example `EXPO_PUBLIC_CPLAYOUT_NATIVE_MAPLIBRE_PROOF=1 npm run start -w @cplayout/mobile -- --dev-client --port 8082 --clear`.
4. Run `npm run verify:native-maplibre -- --dev-client-url "exp+center-pivot-layout://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8082" --wait-ms 20000`.
5. Validate that `reports/native-maplibre/latest.json` has `status: "pass"`, `tileSource.tileSourceKind: "tilejson_or_template"`, `tileSource.tileContentType: "vector"`, `tileSource.sourceComponent: "VectorSource"`, source layers for roads, borders, labels, and places, a local `127.0.0.1` `.pbf` tile URL template, `tileServer.tileRequests` greater than zero, screenshot SHA-256, positive dimensions, nonblank pixel ratio, and gray variance.
6. If `tileServer.tileRequests` remains zero, first verify the app was built or served with `EXPO_PUBLIC_CPLAYOUT_NATIVE_MAPLIBRE_PROOF=1`; that proof route must render before the default Android aerial workbench.
7. Confirm the app screenshot shows nonblank rendered map content from the vector fixture and not only a launched app shell.
8. Do not treat this as raw PMTiles/MBTiles native rendering proof; it proves the generated vector TileJSON/template adapter path only.

## Android Free Aerial Imagery Package Proof

1. Build/install a native development client with `EXPO_PUBLIC_CPLAYOUT_NATIVE_AERIAL_REFERENCE=1`; Expo Go is not valid for this proof.
2. Confirm `adb devices -l` shows the target Samsung SM-P613 (`R52W20BK7XH`) or another recorded device/emulator in `device` state.
3. In Files, use `Import Map Package` to import a generated `cplayout-map-package-v1.zip` package that contains `manifest.json`, optional `tilejson.json`, and concrete `tiles/{z}/{x}/{y}.png` entries. The manifest URLs must be logical `app://map-packages/<id>/...` values before import.
4. Confirm the native installer extracts files under Expo FileSystem document storage, stores logical metadata in the project, and rewrites runtime source URLs to app-readable `file://` templates before MapLibre receives them.
5. Select `Auto local` or `Manual local` aerial imagery. Confirm the selected package attribution and license text are visible.
6. Capture portrait and landscape screenshots with `adb exec-out screencap -p`.
7. Record screenshot SHA-256, dimensions, nonblank pixel ratio, selected source, attribution text, device identity, Android version, app build type, and whether network was disabled for the local package run.
8. Save the project before and after pan/zoom/layer-toggle checks and confirm projected/local `XY` vertices did not change.
9. Run a separate connected-preview check for USGS TNM ImageryOnly only when network is enabled, and label it `connected-preview` rather than offline proof.
10. Do not treat this as raw PMTiles/MBTiles rendering proof; it proves generated local raster TileJSON/template packages only.

## Android Tablet Console Layout Proof

1. Run the app on the target tablet in portrait and landscape.
2. Capture app screenshots after opening a sample design on the map route.
3. Confirm the map route has no page-level scroll on tablet dimensions, left and right drawer handles remain visible, and the bottom design HUD sits above Android system navigation.
4. Record screenshot paths, device model, orientation, and whether the proof used `adb exec-out screencap`, UIAutomator bounds, or manual screenshot capture.
5. Do not report Android tablet console runtime proof until this evidence exists. Web Playwright tablet screenshots are browser proof only.

## Android RTK Receiver Proof

This checklist becomes executable only after the Android USB/Bluetooth adapter in `docs/rtk-gnss-integration-plan.md` is implemented in a rebuilt development client.

1. Record app commit/build, Android device, receiver manufacturer/model/firmware, transport/chipset, antenna model/ARP/height, source reference frame/epoch, project CRS, and correction source/delivery mode.
2. Prove the Android permission path, checksum-valid read, optional correction write, physical detach, app background/foreground, reconnect, and exactly one terminal disconnect event.
3. Confirm capture is impossible after detach, stale observation, stale correction, checksum failure, void/incoherent epoch, or unknown source CRS.
4. Occupy at least two independently known controls with repeated observations. Record the acceptance thresholds, horizontal RMS, maximum error, maximum observation/correction age, fixed/total samples, and session times.
5. Export only sanitized observation/control artifacts. Do not include caster credentials, raw correction payloads, or private receiver tokens.
6. Hash every evidence artifact and produce `cplayout-gnss-runtime-proof-v1` with the current commit.
7. Run `npm run verify:release -- --gnss-report <report.json>` from a clean worktree. A passing browser fixture or Android connection indicator is not receiver/field proof.

## Pass Criteria

Native persistence is verified only when save, relaunch, list, load, delete, export, and import all pass on device/emulator. If any step is not run, report it as unverified rather than complete.

## Primary Sources

- Expo SQLite web support is alpha and requires Metro WASM plus COOP/COEP headers: https://docs.expo.dev/versions/latest/sdk/sqlite/
- Expo Sharing has native local-file sharing behavior that does not carry to web local file URIs: https://docs.expo.dev/versions/latest/sdk/sharing/
- Expo development builds are distinct from Expo Go and are required when native libraries/config need a built app: https://docs.expo.dev/develop/development-builds/introduction/
- Android USB host mode requires device discovery, user permission, endpoint communication, and non-UI-thread transfers: https://developer.android.com/develop/connectivity/usb/host
