import React, { useEffect, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ArrowLeft, FileUp, FolderOpen, RefreshCw } from "lucide-react-native";
import { useProjectRepository, type OpenedDesign } from "../hooks/useProjectRepository";
import { IconCommandButton } from "./CommandSurface";
import { ConfirmActionDialog } from "./ProjectCatalogDialog";
import { CATALOG_IMPORT_MAX_BYTES, previewCatalogImport, type CatalogImportPreview } from "./catalogArchivePayload";

export function CatalogArchiveImport({ fieldMapId, onOpenDesign, onClose }: {
  fieldMapId: string | null;
  onOpenDesign: (opened: OpenedDesign) => void;
  onClose: () => void;
}): React.JSX.Element {
  const repository = useProjectRepository();
  const [candidate, setCandidate] = useState<CatalogImportPreview | null>(null);
  const [filename, setFilename] = useState("");
  const [name, setName] = useState("");
  const [association, setAssociation] = useState("");
  const [reviewRevision, setReviewRevision] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const mounted = useRef(true);
  const operation = useRef(0);
  const busyRef = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current++; }; }, []);
  const desktop = Platform.OS === "web";
  const field = repository.catalog.fieldMaps.find(item => item.id === association);
  const stale = reviewRevision !== null && reviewRevision !== repository.catalogRevision;
  const upgradeNeeded = candidate?.kind === "field" && repository.workspaceVersion === "cplayout-workspace-v1";
  const kindLabel = candidate?.kind === "draft" ? "Design draft" : candidate?.kind === "field" ? "Field design" : "Complete design";
  const hasUnfinishedReview = candidate !== null || filename !== "" || name !== "" || association !== "";
  function closeImport(): void {
    if (busyRef.current || !mounted.current) return;
    // Retire file-reader and transaction callbacks before the parent can unmount this review.
    operation.current++;
    setConfirmClose(false);
    onClose();
  }
  function requestClose(): void {
    if (busyRef.current || !mounted.current) return;
    if (hasUnfinishedReview) setConfirmClose(true);
    else closeImport();
  }
  function fieldLabel(id: string): string {
    const item = repository.catalog.fieldMaps.find(value => value.id === id);
    const project = repository.catalog.projects.find(value => value.id === item?.projectId);
    const customer = repository.catalog.clients.find(value => value.id === project?.clientId);
    return [customer?.displayName, project?.name, item?.name].filter(Boolean).join(" → ");
  }
  function chooseField(id: string): void {
    setAssociation(id);
    setReviewRevision(repository.catalogRevision);
    setMessage(null);
  }
  async function run(action: (isCurrent: () => boolean) => Promise<void>): Promise<void> {
    if (busyRef.current || !mounted.current) return;
    const sequence = ++operation.current;
    const isCurrent = () => mounted.current && sequence === operation.current;
    busyRef.current = true; setBusy(true); setMessage(null);
    try { await action(isCurrent); }
    catch (error) { if (isCurrent()) setMessage(error instanceof Error ? error.message : String(error)); }
    finally { busyRef.current = false; if (isCurrent()) setBusy(false); }
  }
  async function pick(isCurrent: () => boolean): Promise<void> {
    let file: { name: string; bytes: Uint8Array } | null;
    try { file = await pickDesignFile(); }
    catch (error) { if (isCurrent()) { setCandidate(null); setFilename(""); } throw error; }
    if (!file || !isCurrent()) return;
    // Retire the previous candidate before validation: a failed replacement cannot import an older file by mistake.
    setCandidate(null); setFilename(file.name);
    const next = previewCatalogImport(file.bytes, file.name);
    if (!isCurrent()) return;
    setCandidate(next); setName(`${next.name} copy`);
    setReviewRevision(repository.catalogRevision);
  }
  async function importCopy(isCurrent: () => boolean): Promise<void> {
    if (!candidate || !field || reviewRevision === null || stale || upgradeNeeded) throw new Error("Review a valid file and select its destination field before importing.");
    if (!name.trim()) throw new Error("Enter a name for the imported copy.");
    const opened = await repository.importDesignDocument({ fieldMapId: field.id, document: candidate.document, name: name.trim(),
      ...(candidate.originalProjectDocument === undefined ? {} : { originalProjectDocument: candidate.originalProjectDocument }) }, reviewRevision, { isCurrent });
    if (isCurrent()) onOpenDesign(opened);
  }
  return <SafeAreaView style={styles.root} testID="catalog-archive-import"><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
    <View style={styles.header}><View style={styles.grow}><Text style={styles.title}>Import a design</Text>
      <Text style={styles.meta}>Choose a CPLayout JSON or ZIP, review it, then save a new copy in a field.</Text></View>
      <IconCommandButton id="import-back" label="Back" icon={<ArrowLeft />} showLabel disabled={busy} onPress={requestClose} testID="catalog-import-back" />
    </View>
    {!desktop && <Text accessibilityRole="alert" style={styles.notice}>Open CPLayout in the desktop browser to import design copies. This operation is unavailable in this native runtime.</Text>}
    <View style={styles.card}>
      <Text style={styles.heading}>1. Choose a design file</Text>
      <Text style={styles.meta}>Supported: complete designs, design drafts, and field designs exported by CPLayout as JSON or ZIP. Layout targets and sessions use Import in Layout.</Text>
      <IconCommandButton id="import-choose" label={filename ? "Choose another file" : "Choose JSON or ZIP"} icon={<FileUp />} showLabel disabled={!desktop || busy}
        onPress={() => run(pick)} testID="catalog-import-choose" />
      {filename && <Text selectable style={styles.meta} testID="catalog-import-filename">{filename}</Text>}
    </View>
    {candidate && <View style={styles.card} testID="catalog-import-preview">
      <Text style={styles.heading}>{kindLabel}: {candidate.name}</Text>
      <Text style={styles.meta}>{candidate.boundaryVertices} boundary vertices · {candidate.machineCount} machines · {candidate.observationCount} saved observations</Text>
      <Text style={styles.meta}>Coordinate system: {candidate.projectCrs ?? "Not supplied in this draft"}</Text>
      <Text style={styles.meta}>The copy keeps the source geometry and recorded evidence. Import does not calculate, complete a draft, or verify field accuracy.</Text>
      {candidate.originalProjectDocument !== undefined && <Text style={styles.meta}>The original single-pivot design is retained with this field design.</Text>}
      <Text style={styles.label}>Name for the copy (required)</Text>
      <TextInput value={name} onChangeText={setName} editable={!busy} accessibilityLabel="Imported design name" style={styles.input} testID="catalog-import-name" />
    </View>}
    <View style={styles.card}>
      <Text style={styles.heading}>2. Select the destination field</Text>
      <Text style={styles.meta}>Customer → Project → Field</Text>
      {desktop ? React.createElement("select", {
        value: association, disabled: busy, "aria-label": "Destination field", "data-testid": "catalog-import-field",
        onChange: (event: React.ChangeEvent<HTMLSelectElement>) => chooseField(event.target.value),
        style: { width: "100%", minWidth: 0, minHeight: 44, padding: 10, fontSize: 15, borderRadius: 6, border: "1px solid #aabaaa", color: "#173428", background: "white" },
      }, React.createElement("option", { value: "" }, "Select a field…"), ...repository.catalog.fieldMaps.map(item =>
        React.createElement("option", { key: item.id, value: item.id }, `${fieldLabel(item.id)}${item.id === fieldMapId ? " (current field)" : ""}`)))
        : repository.catalog.fieldMaps.map(item => <Pressable key={item.id} accessibilityRole="radio" accessibilityState={{ checked: association === item.id }} disabled={busy}
          onPress={() => chooseField(item.id)} style={styles.fieldChoice}><Text style={styles.label}>{fieldLabel(item.id)}</Text></Pressable>)}
      {!repository.catalog.fieldMaps.length && <Text style={styles.notice}>Create a customer, project, and field from Start, then return here to import the design.</Text>}
      {field && <Text style={styles.meta} testID="catalog-import-destination">New copy will be saved in {fieldLabel(field.id)}.</Text>}
      <IconCommandButton id="import-refresh" label="Refresh fields" icon={<RefreshCw />} showLabel disabled={busy} onPress={() => run(async () => { await repository.refreshProjects(); })} testID="catalog-import-refresh" />
      {stale && <View style={styles.noticeBox}><Text style={styles.meta}>Saved work changed during this review. Confirm the destination field again before importing.</Text>
        <IconCommandButton id="import-review-destination" label="Use this destination" icon={<FolderOpen />} showLabel disabled={busy || !field}
          onPress={() => chooseField(association)} testID="catalog-import-review-destination" /></View>}
    </View>
    {upgradeNeeded && <View style={styles.card} testID="catalog-import-upgrade">
      <Text style={styles.heading}>Enable field design storage</Text>
      <Text style={styles.meta}>This workspace needs an explicit storage upgrade before importing a field design. It retains the exact previous workspace for recovery. Older CPLayout readers cannot open the upgraded workspace.</Text>
      <IconCommandButton id="import-upgrade" label="Upgrade workspace" icon={<FolderOpen />} showLabel disabled={busy || !desktop || repository.catalogRevision === null}
        onPress={() => run(async isCurrent => {
          if (repository.catalogRevision === null) throw new Error("Refresh fields before upgrading.");
          const revision = await repository.upgradeLayoutWorkspace(repository.catalogRevision);
          if (isCurrent()) setReviewRevision(revision);
        })} testID="catalog-import-upgrade-confirm" />
    </View>}
    {(message || repository.storageError) && <Text accessibilityRole="alert" style={[styles.notice, styles.error]} testID="catalog-import-error">{message ?? repository.storageError}</Text>}
    <View style={styles.toolbar}><IconCommandButton id="import-copy" label={busy ? "Working" : "Import copy"} icon={<FileUp />} showLabel
      disabled={!desktop || busy || !candidate || !field || !name.trim() || reviewRevision === null || stale || upgradeNeeded}
      onPress={() => run(importCopy)} testID="catalog-import-copy" /></View>
  </ScrollView>
    <ConfirmActionDialog visible={confirmClose} title="Discard this import review?"
      message="The selected file, copy name, and destination will be cleared. No design has been imported; your source file stays unchanged."
      confirmLabel="Discard import review" onCancel={() => setConfirmClose(false)} onConfirm={closeImport} testID="catalog-import-discard" />
  </SafeAreaView>;
}

async function pickDesignFile(): Promise<{ name: string; bytes: Uint8Array } | null> {
  if (typeof document === "undefined") throw new Error("Import design files in the desktop browser.");
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = ".json,.zip,application/json,application/zip";
    input.addEventListener("cancel", () => resolve(null), { once: true });
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      if (file.size > CATALOG_IMPORT_MAX_BYTES) { reject(new Error("Choose a CPLayout file no larger than 25 MB.")); return; }
      void file.arrayBuffer().then(buffer => resolve({ name: file.name, bytes: new Uint8Array(buffer) }), reject);
    }, { once: true });
    input.click();
  });
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#f3f5ef" }, content: { gap: 14, padding: 18, paddingBottom: 40, maxWidth: 1000, width: "100%", alignSelf: "center" },
  header: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }, grow: { flex: 1, minWidth: 180 },
  title: { color: "#173428", fontSize: 26, fontWeight: "800" }, heading: { color: "#173428", fontSize: 17, fontWeight: "700" },
  meta: { color: "#59695f", fontSize: 13, lineHeight: 20, flexShrink: 1 }, label: { color: "#254234", fontSize: 13, fontWeight: "700" },
  card: { backgroundColor: "white", borderColor: "#d5dfd3", borderWidth: 1, borderRadius: 10, padding: 16, gap: 10 },
  input: { borderColor: "#aabaaa", borderWidth: 1, borderRadius: 6, padding: 11, minHeight: 44, color: "#173428", backgroundColor: "#fff", fontSize: 15 },
  notice: { backgroundColor: "#edf3e9", color: "#254234", padding: 12, borderRadius: 7, fontSize: 13, lineHeight: 20 }, noticeBox: { backgroundColor: "#edf3e9", padding: 12, gap: 8 },
  error: { backgroundColor: "#fff0e8", color: "#883918" }, toolbar: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, fieldChoice: { padding: 12, minHeight: 44 },
});
