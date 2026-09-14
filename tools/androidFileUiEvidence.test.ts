import assert from "node:assert/strict";
import test from "node:test";
import { collectOsFileUiEvidence, type OsFileUiIo } from "./verify_android_native";
import {
  attemptUiTap,
  findNode,
  findPickerFileNode,
  hasBlockingAndroidUi,
  isDocumentsPickerXml,
  isExpectedProjectLoaded,
  isFilesUiReady,
  isProjectCatalogUi,
  isShareSheetXml,
  parseAndroidUiXml,
  pickerAttemptEvidence,
  readConfirmedUiDump,
} from "./androidFileUiEvidence";

const app = "local.centerpivot.layout";
const filename = "cplayout-android-native-proof-import.center-pivot.zip";
const projectName = "CPLayout Android Documents Picker Proof";
const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
function node(packageName: string, id: string, text = "", children = "", extra: Record<string, string> = {}): string {
  const attrs = { package: packageName, "resource-id": id, text, enabled: "true", bounds: "[0,0][1080,2400]", ...extra };
  return `<node ${Object.entries(attrs).map(([key, value]) => `${key}="${escape(value)}"`).join(" ")}>${children}</node>`;
}
const hierarchy = (children: string) => `<?xml version="1.0" encoding="UTF-8"?><hierarchy rotation="0">${children}</hierarchy>`;
function share(packageName = "android"): string {
  return hierarchy(node(packageName, `${packageName}:id/resolver_drawer`, "",
    node(packageName, `${packageName}:id/resolver_list`)));
}
// Reduced from all five android-share-sheet-20260605 captures; no host files required.
function historicalSamsungShare(): string {
  const pkg = "com.android.intentresolver";
  return hierarchy(node(pkg, "", "",
    node(pkg, "com.android.intentresolver:id/sem_chooser_frame_root", "",
      node(pkg, "android:id/contentPanel", "",
        node(pkg, "android:id/chooser_header", "", "", { class: "android.widget.RelativeLayout", bounds: "[550,660][1450,777]" })
        + node(pkg, "android:id/profile_pager", "",
          node(pkg, "com.android.intentresolver:id/sem_chooser_recycler_ranked_app", "", "", { class: "android.widget.GridView", bounds: "[550,961][1450,1128]" }),
          { class: "androidx.viewpager.widget.ViewPager", bounds: "[550,777][1450,1128]" }),
        { class: "android.widget.ScrollView", bounds: "[0,0][2000,1128]" }),
      { class: "android.widget.FrameLayout", bounds: "[0,0][2000,1128]" }),
    { class: "android.widget.FrameLayout", bounds: "[0,0][2000,1200]" }));
}
function picker(packageName = "com.android.documentsui", extra: Record<string, string> = {}, label = filename): string {
  return hierarchy(node(packageName, `${packageName}:id/content`, "",
    node(packageName, `${packageName}:id/toolbar`, "Downloads")
    + node(packageName, `${packageName}:id/dir_list`, "",
      node(packageName, "android:id/title", label, "", { bounds: "[20,300][1000,400]", ...extra }))));
}
function files(additional = ""): string {
  return hierarchy(node(app, "files-view", "", additional
    + node(app, "files-action-import-zip", "Import ZIP")
    + node(app, "files-action-export-zip", "Export ZIP")));
}

// Recorded 20260914-072834073Z ANR identities/text, reduced to the relevant nodes.
const recordedAnr = hierarchy(node("android", "android:id/parentPanel", "",
  node("android", "android:id/alertTitle", "System UI isn't responding", "", { bounds: "[137,1029][943,1103]" })
  + node("android", "android:id/aerr_close", "Close app", "", { bounds: "[71,1144][1009,1276]" })
  + node("android", "android:id/aerr_wait", "Wait", "", { bounds: "[71,1276][1009,1408]" })));

test("recorded ANR is blocked, never a share sheet or picker", () => {
  for (const xml of [recordedAnr]) {
    assert.equal(hasBlockingAndroidUi(xml), true);
    assert.equal(isShareSheetXml(xml), false);
    assert.equal(isDocumentsPickerXml(xml), false);
    assert.equal(findNode(xml, [{ attr: "text", value: "Wait", mode: "equals" }], "android"), null);
  }
});

test("only the observed historical chooser profile is accepted; generic synthetic profiles are unsupported", () => {
  assert.equal(isShareSheetXml(historicalSamsungShare()), true);
  for (const pkg of ["android", "com.android.intentresolver", "com.google.android.intentresolver"]) assert.equal(isShareSheetXml(share(pkg)), false);
  for (const pkg of [app, "com.android.systemui", "example.intentresolver", "android.fake"]) assert.equal(isShareSheetXml(share(pkg)), false);
  assert.equal(isShareSheetXml(hierarchy(node("android", "android:id/content", "Share"))), false);
  assert.equal(isShareSheetXml(share().replace("resolver_list", "unrecognized")), false);
});

test("app Share, Downloads and arbitrary ZIP labels are not system evidence", () => {
  for (const label of ["Share", "Quick Share", "Downloads", "Recent", "Open from", "proof.zip", filename]) {
    for (const pkg of [app, "android", "com.google.android.documentsui"]) {
      const xml = hierarchy(node(pkg, `${pkg}:id/content`, label));
      assert.equal(isShareSheetXml(xml), false);
      assert.equal(isDocumentsPickerXml(xml), false);
    }
  }
});

test("supported picker profiles require package and both stable identities", () => {
  for (const pkg of ["com.android.documentsui", "com.google.android.documentsui"]) {
    assert.equal(isDocumentsPickerXml(picker(pkg)), true);
    assert.ok(findPickerFileNode(picker(pkg), filename));
  }
  for (const pkg of [app, "android", "example.documentsui", "com.android.documentsui.fake"]) assert.equal(isDocumentsPickerXml(picker(pkg)), false);
  assert.equal(isDocumentsPickerXml(picker().replace("dir_list", "unrecognized")), false);
  assert.equal(isDocumentsPickerXml(picker().replace("toolbar", "unrecognized")), false);
});

test("foreign overlays and app lookalikes invalidate otherwise matching identities", () => {
  for (const xml of [historicalSamsungShare(), picker()]) {
    const overlay = xml.replace("</hierarchy>", `${node(app, "overlay", "Share")}</hierarchy>`);
    assert.equal(isShareSheetXml(overlay), false);
    assert.equal(isDocumentsPickerXml(overlay), false);
    const anrOverlay = xml.replace("</hierarchy>", `${node("android", "android:id/aerr_wait", "Wait")}</hierarchy>`);
    assert.equal(isShareSheetXml(anrOverlay), false);
    assert.equal(isDocumentsPickerXml(anrOverlay), false);
  }
  assert.equal(isDocumentsPickerXml(picker().replaceAll('package="com.android.documentsui"', `package="${app}"`)), false);
  assert.equal(isShareSheetXml(share().replaceAll('package="android"', `package="${app}"`)), false);
});

test("normal SystemUI bar subtrees are allowed beside or inside the expected root", () => {
  const bar = node("com.android.systemui", "com.android.systemui:id/status_bar", "",
    node("com.android.systemui", "com.android.systemui:id/clock", "12:00", "", { bounds: "[0,0][100,80]" }),
    { bounds: "[0,0][1080,80]" });
  const navigation = node("com.android.systemui", "com.android.systemui:id/navigation_bar", "", "", { bounds: "[0,1120][1080,1200]" });
  for (const [xml, predicate] of [[historicalSamsungShare(), isShareSheetXml], [picker(), isDocumentsPickerXml]] as const) {
    assert.equal(predicate(xml.replace("</hierarchy>", `${bar}${navigation}</hierarchy>`)), true);
    assert.equal(predicate(xml.replace("</node></hierarchy>", `${bar}${navigation}</node></hierarchy>`)), true);
  }
});

test("expected-package identities cannot be smuggled below a SystemUI bar", () => {
  const inner = (xml: string) => xml.slice(xml.indexOf('<hierarchy rotation="0">') + '<hierarchy rotation="0">'.length, -"</hierarchy>".length);
  for (const [xml, pkg, predicate] of [
    [historicalSamsungShare(), "com.android.intentresolver", isShareSheetXml],
    [picker(), "com.android.documentsui", isDocumentsPickerXml],
  ] as const) {
    const mixedBar = node("com.android.systemui", "com.android.systemui:id/status_bar", "", inner(xml), { bounds: "[0,0][2000,2400]" });
    assert.equal(predicate(hierarchy(node(pkg, "root") + mixedBar)), false);
    assert.equal(predicate(hierarchy(node(pkg, "root", "", mixedBar, { bounds: "[0,0][2000,2400]" }))), false);
    const foreignBar = node("com.android.systemui", "com.android.systemui:id/navigation_bar", "", node("untrusted.overlay", "label"));
    assert.equal(predicate(xml.replace("</hierarchy>", `${foreignBar}</hierarchy>`)), false);
    assert.equal(predicate(xml.replace("</node></hierarchy>", `${foreignBar}</node></hierarchy>`)), false);
  }
  const mixedGeneric = hierarchy(node("android", "root") + node("com.android.systemui", "com.android.systemui:id/status_bar", "", inner(share())));
  assert.equal(findNode(mixedGeneric, [{ attr: "resource-id", value: "android:id/resolver_list", mode: "equals" }], "android"), null);
});

test("historical Samsung identities require their observed package, classes and common panel ancestry", () => {
  const xml = historicalSamsungShare();
  for (const pkg of [app, "android", "com.google.android.intentresolver", "com.android.systemui"]) {
    assert.equal(isShareSheetXml(xml.replaceAll('package="com.android.intentresolver"', `package="${pkg}"`)), false);
  }
  for (const id of ["sem_chooser_frame_root", "chooser_header", "sem_chooser_recycler_ranked_app", "contentPanel"]) {
    assert.equal(isShareSheetXml(xml.replace(id, "unrecognized")), false);
  }
  assert.equal(isShareSheetXml(xml.replace('class="android.widget.GridView"', 'class="android.widget.TextView"')), false);
  const misplacedHeader = xml.replace("android:id/chooser_header", "unrecognized").replace("</hierarchy>",
    `${node("com.android.intentresolver", "android:id/chooser_header", "", "", { class: "android.widget.RelativeLayout" })}</hierarchy>`);
  assert.equal(isShareSheetXml(misplacedHeader), false);
});

test("UI XML depth is explicitly bounded to 128 nodes", () => {
  const nested = (depth: number) => {
    let xml = "";
    for (let index = 0; index < depth; index += 1) xml = node(app, "", "", xml);
    return hierarchy(xml);
  };
  assert.equal(parseAndroidUiXml(nested(128))?.length, 128);
  for (const depth of [129, 1024]) {
    assert.equal(parseAndroidUiXml(nested(depth)), null);
    assert.equal(isShareSheetXml(nested(depth)), false);
    assert.equal(isDocumentsPickerXml(nested(depth)), false);
  }
});

function collectorHarness(options: { existing?: "initial" | "after-navigation"; outcome?: "loaded" | "noop" | "cancel" | "failed-command" } = {}) {
  const breadcrumb = node(app, "workspace-breadcrumb-current", `CPLayout / ${projectName}`);
  let xml = files(options.existing === "initial" ? breadcrumb : node(app, "workspace-breadcrumb-current", "CPLayout / Another Project"));
  let projectBeforePicker = xml;
  const events: string[] = [];
  const captures: { label: string; xml: string }[] = [];
  const evidence = {
    shareSheetOpened: false, shareSheetEvidence: "", shareSheetScreenshotPath: "", shareSheetXmlPath: "",
    documentsPickerOpened: false, documentsPickerEvidence: "", documentsPickerScreenshotPath: "", documentsPickerXmlPath: "",
    pushedZipPath: "", selectedZipFilename: "", selectedZipBytes: 0,
  };
  const io: OsFileUiIo = {
    createZip: () => ({ filename, projectName, localPath: "synthetic-fixture.zip", bytes: 24078 }),
    pushZip: () => { events.push("push"); },
    bootstrap: async () => { events.push("bootstrap"); },
    navigateToFiles: async () => {
      events.push("navigate");
      if (options.existing === "after-navigation") xml = files(breadcrumb);
    },
    readUi: () => { events.push("read"); return xml; },
    captureUi: (capturedXml, label) => {
      events.push(`capture:${label}`);
      captures.push({ label, xml: capturedXml });
      return { xmlPath: `${label}.xml`, screenshotPath: `${label}.png` };
    },
    tapAction: async (matchers) => {
      const id = matchers[0].value;
      events.push(id);
      if (id === "files-action-import-zip") {
        projectBeforePicker = xml;
        xml = picker();
      }
      else if (id === "files-action-export-zip") xml = historicalSamsungShare();
      else assert.fail(`Unexpected action: ${id}`);
    },
    sendTap: () => {
      events.push("file-tap");
      if (options.outcome === "failed-command") return false;
      if (options.outcome === "cancel") xml = files(node(app, "files-status", "No project package selected."));
      else if (options.outcome === "noop") xml = projectBeforePicker;
      else xml = files(breadcrumb);
      return true;
    },
    waitForUi: async (predicate) => {
      if (!predicate(xml)) throw new Error("Stub UI did not reach the required state.");
      return xml;
    },
  };
  const run = () => collectOsFileUiEvidence({
    adbPath: "no-device-commands-allowed", serial: "synthetic", packageName: app,
    outputDirectory: "unused-stub-output", generatedAt: "2026-09-14T00:00:00.000Z", evidence,
  }, io);
  return { run, events, captures, evidence };
}

test("actual collector rejects an already-present fixture before any import tap or export", async () => {
  for (const existing of ["initial", "after-navigation"] as const) {
    const harness = collectorHarness({ existing, outcome: "noop" });
    await assert.rejects(harness.run, /already present before import/);
    assert.equal(harness.events.includes("files-action-import-zip"), false);
    assert.equal(harness.events.includes("file-tap"), false);
    assert.equal(harness.events.includes("files-action-export-zip"), false);
    assert.equal(harness.evidence.shareSheetOpened, false);
    assert.equal(harness.evidence.selectedZipBytes, 0);
    assert.equal(harness.evidence.selectedZipFilename, "");
    assert.ok(harness.captures.at(-1)?.xml.includes(projectName));
  }
});

test("actual collector cannot export after a no-op, cancelled or failed file tap", async () => {
  for (const outcome of ["noop", "cancel", "failed-command"] as const) {
    const harness = collectorHarness({ outcome });
    await assert.rejects(harness.run);
    assert.ok(harness.events.includes("file-tap"));
    assert.equal(harness.events.includes("files-action-export-zip"), false);
    assert.equal(harness.evidence.shareSheetOpened, false);
    assert.equal(harness.evidence.selectedZipBytes, 0);
    assert.equal(harness.evidence.selectedZipFilename, "");
  }
});

test("actual collector requires captured absence then fresh project UI before export and still claims no receipt", async () => {
  const harness = collectorHarness();
  const evidence = await harness.run();
  const beforeImport = harness.captures.find((capture) => capture.label === "android-before-import");
  assert.ok(beforeImport && !beforeImport.xml.includes(projectName));
  assert.ok(harness.events.indexOf("capture:android-before-import") < harness.events.indexOf("files-action-import-zip"));
  assert.ok(harness.events.indexOf("capture:android-documents-picker") < harness.events.indexOf("file-tap"));
  assert.ok(harness.events.indexOf("capture:android-imported-project") < harness.events.indexOf("files-action-export-zip"));
  assert.equal(evidence.shareSheetOpened, true);
  assert.match(evidence.shareSheetEvidence, /Historical Samsung/);
  assert.equal(evidence.selectedZipBytes, 0);
  assert.equal(evidence.selectedZipFilename, "");
});

test("malformed XML, DOCTYPE and entity declarations fail closed", () => {
  for (const xml of ["", " ", "<hierarchy>", "<hierarchy><node></hierarchy>",
    share().replace('enabled="true"', 'enabled="true" enabled="false"'),
    share().replace('enabled="true"', "enabled=true"),
    share().replace("</hierarchy>", ""),
    share() + "<hierarchy/>", share() + "junk", "junk" + share(),
    share().replace("<hierarchy", '<!DOCTYPE hierarchy SYSTEM "file:///etc/passwd"><hierarchy'),
    '<!DOCTYPE hierarchy [<!ENTITY x "Share">]>' + share(),
    share().replace("<hierarchy", '<!ENTITY x "Share"><hierarchy'),
    share().replace('text=""', 'text="&unknown;"'),
    share().replace('text=""', 'text="a&b"'),
    share().replace('text=""', 'text="a<b"'),
    share().replace('text=""', 'text="&#0;"'),
  ]) {
    assert.equal(parseAndroidUiXml(xml), null, xml);
    assert.equal(isShareSheetXml(xml), false);
    assert.equal(isDocumentsPickerXml(xml), false);
  }
});

test("only an exact filename in a picker title row beneath dir_list can be tapped", () => {
  for (const label of [filename.slice(0, -4), `prefix-${filename}`, "unrelated.zip"]) assert.equal(findPickerFileNode(picker(undefined, {}, label), filename), null);
  assert.equal(findPickerFileNode(picker().replace('resource-id="android:id/title"', 'resource-id="android:id/summary"'), filename), null);
  const outsideList = picker().replace(`</hierarchy>`, `${node("com.android.documentsui", "android:id/title", filename)}</hierarchy>`)
    .replace(`text="${filename}"`, 'text="other.zip"');
  assert.equal(findPickerFileNode(outsideList, filename), null);
});

test("disabled, hidden, zero, reversed, negative and out-of-parent bounds never send taps", () => {
  const invalid: Record<string, string>[] = [
    { enabled: "false" }, { enabled: "" }, { "visible-to-user": "false" },
    ...["[0,0][0,0]", "[20,40][10,50]", "[-1,0][100,200]", "[0,0][1081,2400]", "[20,300][1000,2500]", "[0,0][1,1]junk", "[0,0][9007199254740992,20]"].map((bounds) => ({ bounds })),
  ];
  for (const extra of invalid) {
    let calls = 0;
    const result = attemptUiTap(findPickerFileNode(picker(undefined, extra), filename), () => { calls += 1; return true; });
    assert.equal(calls, 0);
    assert.deepEqual(result, { attempted: false, commandSucceeded: false });
  }
  assert.equal(findPickerFileNode(picker().replace('enabled="true"', 'enabled="false"'), filename), null);
});

test("tap records distinguish unavailable target, failed command and accepted command", () => {
  const target = findPickerFileNode(picker(), filename);
  assert.deepEqual(attemptUiTap(target, () => false), { attempted: true, commandSucceeded: false });
  assert.deepEqual(attemptUiTap(target, () => { throw new Error("command timeout"); }), { attempted: true, commandSucceeded: false });
  assert.deepEqual(attemptUiTap(target, (x, y) => { assert.equal(x, 510); assert.equal(y, 350); return true; }), { attempted: true, commandSucceeded: true });
});

test("host bytes, cancel, failed tap and successful tap without receipt never claim a selected file", () => {
  for (const tap of [{ attempted: false, commandSucceeded: false }, { attempted: true, commandSucceeded: false }, { attempted: true, commandSucceeded: true }]) {
    for (const hostBytes of [0, 24078, 1000000]) {
      const evidence = pickerAttemptEvidence({ filename, hostBytes, pushedZipPath: `/sdcard/Download/${filename}`, tap });
      assert.equal(evidence.selectedZipBytes, 0);
      assert.equal(evidence.selectedZipFilename, "");
      assert.match(evidence.documentsPickerEvidence, /UNKNOWN/);
      assert.ok(evidence.documentsPickerEvidence.includes(`tap command succeeded: ${tap.commandSucceeded}`));
    }
  }
});

test("empty catalog and No Project Open are not export-ready", () => {
  assert.equal(isFilesUiReady(hierarchy(node(app, "files-view", "No Project Open")), app), false);
  assert.equal(isFilesUiReady(files(node(app, "", "No Project Open")), app), false);
  assert.equal(isFilesUiReady(hierarchy(node(app, "", "Project Catalog")), app), false);
  assert.equal(isFilesUiReady(files(), app), true);
  assert.equal(isFilesUiReady(files().replace('resource-id="files-action-export-zip"', 'resource-id="other"'), app), false);
});

test("expected project must be visible in app UI, not a picker label or cancelled import", () => {
  const breadcrumb = node(app, "workspace-breadcrumb-current", `CPLayout / ${projectName}`);
  assert.equal(isExpectedProjectLoaded(files(breadcrumb), app, projectName), true);
  assert.equal(isExpectedProjectLoaded(files(node(app, "", projectName)), app, projectName), false);
  assert.equal(isExpectedProjectLoaded(files(node(app, "", `CPLayout / ${projectName}`)), app, projectName), false);
  assert.equal(isExpectedProjectLoaded(files(node(app, "", "Old Project")), app, projectName), false);
  assert.equal(isExpectedProjectLoaded(picker(undefined, {}, projectName), app, projectName), false);
  assert.equal(isExpectedProjectLoaded(files(breadcrumb + node(app, "files-status", "No project package selected.")), app, projectName), false);
  assert.equal(isProjectCatalogUi(files(node(app, "workspace-breadcrumb-current", "CPLayout / Project Catalog")), app), true);
  assert.equal(isProjectCatalogUi(files(breadcrumb), app), false);
});

test("XML entities are parsed structurally in exact text matches", () => {
  const escapedFilename = "a&b.zip";
  assert.ok(findPickerFileNode(picker(undefined, {}, escapedFilename), escapedFilename));
  assert.equal(findPickerFileNode(picker(undefined, {}, escapedFilename), "a&amp;b.zip"), null);
});

test("failed or unconfirmed dump never reads stale XML", () => {
  const remotePath = "/sdcard/unique-proof.xml";
  let reads = 0;
  for (const dump of [() => "", () => `ERROR: could not write ${remotePath}`, () => "UI hierchary dumped to: /sdcard/old.xml", () => { throw new Error("timeout"); }]) {
    assert.throws(() => readConfirmedUiDump(remotePath, dump, () => { reads += 1; return picker(); }));
  }
  assert.equal(reads, 0);
  const confirmation = () => `UI hierchary dumped to: ${remotePath}\n`;
  assert.equal(readConfirmedUiDump(remotePath, confirmation, picker), picker());
  assert.throws(() => readConfirmedUiDump(remotePath, confirmation, () => ""));
  assert.throws(() => readConfirmedUiDump(remotePath, confirmation, () => { throw new Error("read failed"); }));
});
