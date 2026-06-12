import { Archive, Database, Download, FolderOpen, Map, RefreshCw, Save, Trash2, Upload } from "lucide-react-native";
import React, { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { exportScenarioGeoJson } from "@cplayout/geometry";
import {
  buildProjectArchiveBundle,
  createGoogleEarthKmz,
  exportFileAsync,
  exportProjectArchiveZip,
  exportZipFileAsync,
  importProjectArchiveZip,
  importFileAsync,
  importZipFileAsync,
  installMapPackageArchiveZipAsync,
  readGoogleEarthKmlFile,
} from "@cplayout/project-store";
import {
  exportCornerGpsMapBpf,
  exportProjectGoogleEarthKml,
  inferCornerGpsMapLegacyEvidenceKind,
  parseCornerGpsMapLegacyEvidence,
  type CornerGpsMapBpfImportPreview,
  type CornerGpsMapLegacyEvidence,
  type CornerGpsMapLegacyEvidenceKind,
  type CornerGpsMapSourceRef,
  type GoogleEarthKmlImportResult,
  type LayoutResult,
  type MapPackageManifest,
  type PivotProject,
} from "@cplayout/core";
import type { ProjectWorkspaceStatus } from "../hooks/useProjectRepository";
import { GoogleEarthImportWizard } from "./GoogleEarthImportWizard";

interface ProjectFilesPanelProps {
  dirty: boolean;
  project: PivotProject;
  result: LayoutResult;
  repository: ProjectWorkspaceStatus;
  onImportProjectedGeoJson: (geoJson: string) => string;
  onImportSurveyCsv: (csv: string) => string;
  onMapPackageImported: (manifest: MapPackageManifest, runtimeManifest: MapPackageManifest) => string;
  onPreviewGoogleEarthKml: (kmlText: string, selectedItemIds?: string[]) => GoogleEarthKmlImportResult;
  onApplyGoogleEarthKmlImport: (project: PivotProject) => void;
  onPreviewCornerGpsMapBpf: (bpfText: string, selectedItemIds?: string[], observedAt?: string, sourceRef?: CornerGpsMapSourceRef) => CornerGpsMapBpfImportPreview;
  onApplyCornerGpsMapBpfImport: (project: PivotProject) => void;
  onProjectLoaded: (project: PivotProject) => void;
  onSaveProject: () => void | Promise<void>;
  onOpenProject: (projectId: string) => void | Promise<void>;
  onDeleteProject: (projectId: string) => Promise<boolean>;
  onRefreshProjects: () => Promise<void>;
}

type StatusTone = "info" | "success" | "warning" | "error";

interface PanelStatus {
  tone: StatusTone;
  text: string;
}

interface PendingKmlImport {
  filename: string;
  kind: "kml" | "kmz";
  kmlText: string;
  result: GoogleEarthKmlImportResult;
  archiveWarnings: string[];
}

interface PendingBpfImport {
  filename: string;
  bpfText: string;
  observedAt: string;
  result: CornerGpsMapBpfImportPreview;
  sourceRef: CornerGpsMapSourceRef;
}

interface LegacyEvidenceReview {
  filename: string;
  kind: CornerGpsMapLegacyEvidenceKind;
  result: CornerGpsMapLegacyEvidence;
}

export function ProjectFilesPanel({
  dirty,
  project,
  result,
  repository,
  onImportProjectedGeoJson,
  onImportSurveyCsv,
  onMapPackageImported,
  onPreviewGoogleEarthKml,
  onApplyGoogleEarthKmlImport,
  onPreviewCornerGpsMapBpf,
  onApplyCornerGpsMapBpfImport,
  onProjectLoaded,
  onSaveProject,
  onOpenProject,
  onDeleteProject,
  onRefreshProjects,
}: ProjectFilesPanelProps): React.JSX.Element {
  const [status, setStatus] = useState<PanelStatus>({ tone: "info", text: "Project ZIP is the canonical project package." });
  const [pendingKmlImport, setPendingKmlImport] = useState<PendingKmlImport | null>(null);
  const [selectedKmlImportItemIds, setSelectedKmlImportItemIds] = useState<string[]>([]);
  const [pendingBpfImport, setPendingBpfImport] = useState<PendingBpfImport | null>(null);
  const [selectedBpfImportItemIds, setSelectedBpfImportItemIds] = useState<string[]>([]);
  const [legacyEvidenceReview, setLegacyEvidenceReview] = useState<LegacyEvidenceReview | null>(null);
  const [geoJsonImport, setGeoJsonImport] = useState("");
  const [surveyCsvImport, setSurveyCsvImport] = useState("");

  async function exportZip(): Promise<void> {
    try {
      const bundle = buildProjectArchiveBundle(project, result, exportScenarioGeoJson(project, result), new Date().toISOString());
      const zip = exportProjectArchiveZip(bundle);
      const filename = `${project.id}.center-pivot.zip`;
      const outcome = await exportZipFileAsync(filename, zip);
      setStatus({
        tone: outcome.ok ? "success" : "error",
        text: `${outcome.message} Project package includes canonical project JSON, GIS exchange files, survey CSV, metrics CSV, and map-package metadata.`,
      });
    } catch (error) {
      setStatus({ tone: "error", text: errorMessage(error) });
    }
  }

  async function exportKml(): Promise<void> {
    try {
      const exported = exportProjectGoogleEarthKml(project, result);
      const filename = `${project.id}.google-earth.kml`;
      const outcome = await exportFileAsync(filename, exported.kml, { mimeType: "application/vnd.google-earth.kml+xml" });
      setStatus({
        tone: outcome.ok ? "success" : "error",
        text: `${outcome.message} Exported ${exported.exportedFeatureCount} Google Earth feature${exported.exportedFeatureCount === 1 ? "" : "s"}.`,
      });
    } catch (error) {
      setStatus({ tone: "error", text: errorMessage(error) });
    }
  }

  async function exportKmz(): Promise<void> {
    try {
      const exported = exportProjectGoogleEarthKml(project, result);
      const filename = `${project.id}.google-earth.kmz`;
      const outcome = await exportFileAsync(filename, createGoogleEarthKmz(exported.kml), {
        mimeType: "application/vnd.google-earth.kmz",
      });
      setStatus({
        tone: outcome.ok ? "success" : "error",
        text: `${outcome.message} KMZ contains doc.kml with ${exported.exportedFeatureCount} feature${exported.exportedFeatureCount === 1 ? "" : "s"}.`,
      });
    } catch (error) {
      setStatus({ tone: "error", text: errorMessage(error) });
    }
  }

  async function exportBpf(): Promise<void> {
    try {
      const exported = exportCornerGpsMapBpf(project, { sourceLabel: project.name });
      const filename = `${project.id}.cornergpsmap.bpf`;
      const outcome = await exportFileAsync(filename, exported.xmlText, { mimeType: "application/xml;charset=utf-8" });
      setStatus({
        tone: outcome.ok ? "success" : "error",
        text: `${outcome.message} Exported ${exported.exportedPointCounts.borderPoints} BorderPoint entries, ${exported.exportedPointCounts.centerPoints} CenterPoint, and ${exported.exportedPointCounts.benchmarkPoints} BenchMark point${exported.exportedPointCounts.benchmarkPoints === 1 ? "" : "s"}. ${formatWarnings(exported.compatibilityWarnings)}`,
      });
    } catch (error) {
      setStatus({ tone: "error", text: errorMessage(error) });
    }
  }

  async function importZip(): Promise<void> {
    try {
      const bytes = await importZipFileAsync();
      if (!bytes) {
        setStatus({ tone: "info", text: "No project package selected." });
        return;
      }
      const imported = importProjectArchiveZip(bytes);
      onProjectLoaded(imported);
      const saved = await repository.saveProject(imported);
      setStatus({
        tone: saved ? "success" : "warning",
        text: saved
          ? `Imported ${imported.name}. Retired legacy package files are ignored; only canonical project data is restored.`
          : `Opened ${imported.name}, but it was not saved locally. Retired legacy package files are ignored.`,
      });
    } catch (error) {
      setStatus({ tone: "error", text: errorMessage(error) });
    }
  }

  async function importMapPackageZip(): Promise<void> {
    try {
      if (Platform.OS === "web") {
        setStatus({ tone: "warning", text: "Map package ZIP install is native-only until web package storage is configured." });
        return;
      }
      const bytes = await importZipFileAsync();
      if (!bytes) {
        setStatus({ tone: "info", text: "No map package selected." });
        return;
      }
      const installed = await installMapPackageArchiveZipAsync(bytes);
      const message = onMapPackageImported(installed.manifest, installed.runtimeManifest);
      setStatus({
        tone: "success",
        text: `${message} Installed ${installed.fileCount} file${installed.fileCount === 1 ? "" : "s"} under app document storage.`,
      });
    } catch (error) {
      setStatus({ tone: "error", text: errorMessage(error) });
    }
  }

  async function importKmlOrKmz(): Promise<void> {
    try {
      const file = await importFileAsync({
        accept: ".kml,.kmz,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz,application/xml,text/xml",
        errorLabel: "KML/KMZ",
      });
      if (!file) {
        setStatus({ tone: "info", text: "No Google Earth file selected." });
        return;
      }
      const googleEarthFile = readGoogleEarthKmlFile(file);
      const result = onPreviewGoogleEarthKml(googleEarthFile.kmlText);
      setPendingKmlImport({
        filename: googleEarthFile.filename,
        kind: googleEarthFile.kind,
        kmlText: googleEarthFile.kmlText,
        result,
        archiveWarnings: googleEarthFile.warnings,
      });
      setSelectedKmlImportItemIds(result.items.filter((item) => item.selected).map((item) => item.id));
      const tone: StatusTone = result.warnings.length > 0 || googleEarthFile.warnings.length > 0 ? "warning" : "info";
      setStatus({
        tone,
        text: `${googleEarthFile.filename} is ready for import selection. ${kmlImportSummary(result)}${formatWarnings([...googleEarthFile.warnings, ...result.warnings])}`,
      });
    } catch (error) {
      setStatus({ tone: "error", text: errorMessage(error) });
    }
  }

  async function importCornerGpsMapBpf(): Promise<void> {
    try {
      const file = await importFileAsync({
        accept: ".bpf,text/plain,text/xml,application/xml",
        errorLabel: "CornerGPSMap BPF",
      });
      if (!file) {
        setStatus({ tone: "info", text: "No CornerGPSMap BPF selected." });
        return;
      }
      const bpfText = decodeUtf8(file.bytes);
      const observedAt = new Date().toISOString();
      const sourceRef = sourceRefForFile(file.filename, observedAt, "CornerGPSMap BPF");
      const result = onPreviewCornerGpsMapBpf(bpfText, undefined, observedAt, sourceRef);
      setPendingKmlImport(null);
      setSelectedKmlImportItemIds([]);
      setPendingBpfImport({
        filename: file.filename,
        bpfText,
        observedAt,
        result,
        sourceRef,
      });
      setSelectedBpfImportItemIds(result.items.filter((item) => item.selected).map((item) => item.id));
      setStatus({
        tone: result.canApply && result.warnings.length === 0 ? "info" : "warning",
        text: `${file.filename} is ready for BPF import review. ${bpfImportSummary(result)}${formatWarnings(result.warnings)}`,
      });
    } catch (error) {
      setStatus({ tone: "error", text: errorMessage(error) });
    }
  }

  async function importLegacyEvidence(): Promise<void> {
    try {
      const file = await importFileAsync({
        accept: ".opt,.csv,.out,.vri,text/plain,text/csv,application/octet-stream",
        errorLabel: "CornerGPSMap or FLT legacy evidence",
      });
      if (!file) {
        setStatus({ tone: "info", text: "No legacy evidence file selected." });
        return;
      }
      const kind = inferCornerGpsMapLegacyEvidenceKind(file.filename);
      if (!kind) throw new Error("Legacy evidence review accepts only .opt, .csv, .out, and .vri files.");
      const observedAt = new Date().toISOString();
      const result = parseCornerGpsMapLegacyEvidence(kind, decodeUtf8(file.bytes), {
        sourceRef: sourceRefForFile(file.filename, observedAt, `CornerGPSMap/FLT ${kind.toUpperCase()} evidence`),
      });
      setLegacyEvidenceReview({ filename: file.filename, kind, result });
      setStatus({
        tone: result.statusSummary.blockerCount > 0 || result.warnings.length > 0 ? "warning" : "info",
        text: `${file.filename} parsed for advisory evidence. ${legacyEvidenceSummary(result)}${formatWarnings([...result.warnings, ...result.diagnostics])}`,
      });
    } catch (error) {
      setStatus({ tone: "error", text: errorMessage(error) });
    }
  }

  function applyGeoJsonImport(): void {
    try {
      const message = onImportProjectedGeoJson(geoJsonImport);
      setGeoJsonImport("");
      setStatus({ tone: "success", text: message });
    } catch (error) {
      setStatus({ tone: "error", text: errorMessage(error) });
    }
  }

  function applySurveyCsvImport(): void {
    try {
      const message = onImportSurveyCsv(surveyCsvImport);
      setSurveyCsvImport("");
      setStatus({ tone: "success", text: message });
    } catch (error) {
      setStatus({ tone: "error", text: errorMessage(error) });
    }
  }

  function applyPendingKmlImport(): void {
    if (!pendingKmlImport) return;
    const selectedResult = onPreviewGoogleEarthKml(pendingKmlImport.kmlText, selectedKmlImportItemIds);
    onApplyGoogleEarthKmlImport(selectedResult.project);
    setStatus({
      tone: "success",
      text: `Applied ${pendingKmlImport.filename}. ${kmlImportSummary(selectedResult)}`,
    });
    setPendingKmlImport(null);
    setSelectedKmlImportItemIds([]);
  }

  function applyPendingBpfImport(): void {
    if (!pendingBpfImport) return;
    const selectedResult = onPreviewCornerGpsMapBpf(
      pendingBpfImport.bpfText,
      selectedBpfImportItemIds,
      pendingBpfImport.observedAt,
      pendingBpfImport.sourceRef,
    );
    if (!selectedResult.canApply) {
      setStatus({
        tone: "warning",
        text: `Could not apply ${pendingBpfImport.filename}. ${bpfImportSummary(selectedResult)}${formatWarnings(selectedResult.warnings)}`,
      });
      return;
    }
    onApplyCornerGpsMapBpfImport(selectedResult.project);
    setStatus({
      tone: "success",
      text: `Applied ${pendingBpfImport.filename}. ${bpfImportSummary(selectedResult)}`,
    });
    setPendingBpfImport(null);
    setSelectedBpfImportItemIds([]);
  }

  function cancelPendingKmlImport(): void {
    setPendingKmlImport(null);
    setSelectedKmlImportItemIds([]);
    setStatus({ tone: "info", text: "Canceled Google Earth import selection." });
  }

  function cancelPendingBpfImport(): void {
    setPendingBpfImport(null);
    setSelectedBpfImportItemIds([]);
    setStatus({ tone: "info", text: "Canceled CornerGPSMap BPF import selection." });
  }

  function toggleKmlImportItem(itemId: string): void {
    setSelectedKmlImportItemIds((current) =>
      current.includes(itemId)
        ? current.filter((candidate) => candidate !== itemId)
        : [...current, itemId],
    );
  }

  function toggleBpfImportItem(itemId: string): void {
    if (!pendingBpfImport?.result.canApply) return;
    setSelectedBpfImportItemIds((current) =>
      current.includes(itemId)
        ? current.filter((candidate) => candidate !== itemId)
        : [...current, itemId],
    );
  }

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <Archive size={20} color="#254234" />
        <Text style={styles.title}>Project Files</Text>
      </View>
      <View style={[styles.statusBox, statusToneStyle(status.tone)]} testID="files-status" {...webStatusProps()}>
        <Database size={17} color={statusToneColor(status.tone)} />
        <Text style={[styles.statusText, statusTextToneStyle(status.tone)]}>{dirty ? "Unsaved edits. " : ""}{repository.statusMessage} · {status.text}</Text>
      </View>
      <FileLane icon={<Archive size={18} color="#254234" />} title="Project Package">
        <View style={styles.actionRow}>
          <FileAction accessibilityLabel="Save local project" icon={<Save size={18} color="#ffffff" />} label={dirty ? "Save *" : "Save"} primary onPress={onSaveProject} testID="files-action-save-local" />
          <FileAction accessibilityLabel="Export project ZIP" icon={<Download size={18} color="#254234" />} label="Export ZIP" onPress={exportZip} testID="files-action-export-zip" />
          <FileAction accessibilityLabel="Import project ZIP" icon={<Upload size={18} color="#254234" />} label="Import ZIP" onPress={importZip} testID="files-action-import-zip" />
          <FileAction accessibilityLabel="Refresh local projects" icon={<RefreshCw size={18} color="#254234" />} label="Refresh" onPress={onRefreshProjects} testID="files-action-refresh" />
        </View>
        <View style={styles.destructiveActionRow}>
          <FileAction accessibilityLabel="Delete local project" icon={<Trash2 size={18} color="#8b1e18" />} label="Delete Local Project" danger onPress={() => void onDeleteProject(project.id)} testID="files-action-delete-local-project" />
        </View>
      </FileLane>
      {repository.backendInfo && (
        <View style={styles.backendGrid}>
          <BackendTile label="Backend" value={repository.backendInfo.backendLabel} />
          <BackendTile label="Runtime" value={repository.backendInfo.runtime} />
          <BackendTile label="Schema" value={repository.backendInfo.schemaVersion === undefined ? "n/a" : `v${repository.backendInfo.schemaVersion}`} />
          <BackendTile label="Projects" value={`${repository.backendInfo.projectCount ?? repository.projects.length}`} />
        </View>
      )}
      {repository.backendInfo?.notes.map((note) => (
        <Text key={note} style={styles.backendNote}>{note}</Text>
      ))}

      <FileLane icon={<Map size={18} color="#254234" />} title="Offline Maps">
        <View style={styles.actionRow}>
          <FileAction accessibilityLabel="Import map package ZIP" icon={<Upload size={18} color="#254234" />} label="Import Map Package" onPress={importMapPackageZip} testID="files-action-import-map-package" />
        </View>
        <Text style={styles.backendNote}>Map package ZIPs install generated local tiles. Project archives store logical package metadata and visible attribution, not tile binaries.</Text>
      </FileLane>

      <FileLane icon={<Download size={18} color="#254234" />} title="GIS Exchange">
        <View style={styles.gisExchangeGrid}>
          <View style={styles.gisActionBox}>
            <View style={styles.actionRow}>
              <FileAction accessibilityLabel="Import KML or KMZ" icon={<Upload size={18} color="#254234" />} label="Import KML/KMZ" onPress={importKmlOrKmz} testID="files-action-import-kml-kmz" />
              <FileAction accessibilityLabel="Export KML" icon={<Download size={18} color="#254234" />} label="Export KML" onPress={exportKml} testID="files-action-export-kml" />
              <FileAction accessibilityLabel="Export KMZ" icon={<Download size={18} color="#254234" />} label="Export KMZ" onPress={exportKmz} testID="files-action-export-kmz" />
            </View>
          </View>
          <GoogleEarthImportWizard />
        </View>
        <View style={styles.importGrid}>
          <View style={styles.importBox}>
            <Text style={styles.importTitle}>Projected GeoJSON Import</Text>
            <TextInput
              multiline
              onChangeText={setGeoJsonImport}
              placeholder="FeatureCollection with projectCrs and field_boundary/obstacle features"
              style={styles.importInput}
              testID="files-geojson-import-input"
              value={geoJsonImport}
            />
            <FileAction accessibilityLabel="Import projected GeoJSON" icon={<Upload size={18} color="#254234" />} label="Import GeoJSON" onPress={applyGeoJsonImport} testID="files-action-import-geojson" />
          </View>
          <View style={styles.importBox}>
            <Text style={styles.importTitle}>Survey CSV Import</Text>
            <TextInput
              multiline
              onChangeText={setSurveyCsvImport}
              placeholder="id,label,role,x,y,source,confidence"
              style={styles.importInput}
              testID="files-survey-csv-import-input"
              value={surveyCsvImport}
            />
            <FileAction accessibilityLabel="Import survey CSV" icon={<Upload size={18} color="#254234" />} label="Import CSV" onPress={applySurveyCsvImport} testID="files-action-import-csv" />
          </View>
        </View>
      </FileLane>

      <FileLane icon={<Database size={18} color="#254234" />} title="Legacy Review">
        <View style={styles.gisActionBox}>
          <View style={styles.actionRow}>
            <FileAction accessibilityLabel="Import CornerGPSMap BPF" icon={<Upload size={18} color="#254234" />} label="Import BPF" onPress={importCornerGpsMapBpf} testID="files-action-import-bpf" />
            <FileAction accessibilityLabel="Export CornerGPSMap BPF" icon={<Download size={18} color="#254234" />} label="Export BPF" onPress={exportBpf} testID="files-action-export-bpf" />
            <FileAction accessibilityLabel="Review FLT or CornerGPSMap legacy evidence" icon={<Upload size={18} color="#254234" />} label="Review Legacy" onPress={importLegacyEvidence} testID="files-action-review-legacy-evidence" />
          </View>
        </View>
      </FileLane>
      {pendingKmlImport ? (
        <View style={styles.importPreviewBox}>
          <View>
            <Text style={styles.importTitle}>Select {pendingKmlImport.kind.toUpperCase()} Import Features</Text>
            <Text style={styles.importPreviewText}>
              {pendingKmlImport.filename} · {kmlImportSummary(pendingKmlImport.result)}
            </Text>
            <View style={styles.importPreviewItemGrid}>
              {kmlImportItems(pendingKmlImport.result).map((item) => {
                const selected = selectedKmlImportItemIds.includes(item.id);
                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    onPress={() => toggleKmlImportItem(item.id)}
                    style={[styles.importPreviewItem, selected && styles.importPreviewItemSelected]}
                  >
                    <Text style={[styles.importPreviewItemTitle, selected && styles.importPreviewItemTitleSelected]}>{item.title}</Text>
                    <Text style={[styles.importPreviewItemMeta, selected && styles.importPreviewItemMetaSelected]}>{item.detail}</Text>
                  </Pressable>
                );
              })}
            </View>
            {pendingKmlImport.result.importedBoundary ? (
              <Text style={styles.importPreviewWarning}>Existing field boundary will be replaced after projection into {project.projectCrs}.</Text>
            ) : null}
            {pendingKmlImport.result.warnings.map((warning) => (
              <Text key={warning} style={styles.importPreviewWarning}>{warning}</Text>
            ))}
            {pendingKmlImport.archiveWarnings.map((warning) => (
              <Text key={warning} style={styles.importPreviewWarning}>{warning}</Text>
            ))}
          </View>
          <View style={styles.actionRow}>
            <FileAction accessibilityLabel="Apply KML KMZ import" icon={<Upload size={18} color="#ffffff" />} label="Apply Import" primary onPress={applyPendingKmlImport} testID="files-action-apply-kml-kmz-import" />
            <FileAction accessibilityLabel="Cancel KML KMZ import" icon={<Trash2 size={18} color="#254234" />} label="Cancel" onPress={cancelPendingKmlImport} testID="files-action-cancel-kml-kmz-import" />
          </View>
        </View>
      ) : null}
      {legacyEvidenceReview ? (
        <View style={styles.importPreviewBox} testID="files-legacy-evidence-review">
          <View>
            <Text style={styles.importTitle}>Legacy Evidence Review</Text>
            <Text style={styles.importPreviewText}>
              {legacyEvidenceReview.filename} · {legacyEvidenceReview.kind.toUpperCase()} · {legacyEvidenceSummary(legacyEvidenceReview.result)}
            </Text>
            <View style={styles.importPreviewItemGrid}>
              {legacyEvidenceItems(legacyEvidenceReview.result).map((item) => (
                <View key={item.title} style={styles.importPreviewItem}>
                  <Text style={styles.importPreviewItemTitle}>{item.title}</Text>
                  <Text style={styles.importPreviewItemMeta}>{item.detail}</Text>
                </View>
              ))}
            </View>
            <Text style={styles.importPreviewWarning}>Legacy output is advisory evidence only; raw coordinates, local paths, controller files, and customer identifiers are not displayed or saved here.</Text>
            {legacyEvidenceReview.result.warnings.map((warning) => (
              <Text key={warning} style={styles.importPreviewWarning}>{warning}</Text>
            ))}
            {legacyEvidenceReview.result.violations.slice(0, 4).map((violation) => (
              <Text key={`${violation.severity}-${violation.code}`} style={styles.importPreviewWarning}>{violation.severity.toUpperCase()}: {violation.message}</Text>
            ))}
          </View>
        </View>
      ) : null}
      {pendingBpfImport ? (
        <View style={styles.importPreviewBox}>
          <View>
            <Text style={styles.importTitle}>Select BPF Import Evidence</Text>
            <Text style={styles.importPreviewText}>
              {pendingBpfImport.filename} · {bpfImportSummary(pendingBpfImport.result)}
            </Text>
            <View style={styles.importPreviewItemGrid}>
              {bpfImportItems(pendingBpfImport.result).map((item) => {
                const selected = selectedBpfImportItemIds.includes(item.id);
                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    disabled={!pendingBpfImport.result.canApply || item.id === "none"}
                    onPress={() => toggleBpfImportItem(item.id)}
                    style={[styles.importPreviewItem, selected && styles.importPreviewItemSelected, (!pendingBpfImport.result.canApply || item.id === "none") && styles.importPreviewItemDisabled]}
                  >
                    <Text style={[styles.importPreviewItemTitle, selected && styles.importPreviewItemTitleSelected]}>{item.title}</Text>
                    <Text style={[styles.importPreviewItemMeta, selected && styles.importPreviewItemMetaSelected]}>{item.detail}</Text>
                  </Pressable>
                );
              })}
            </View>
            {pendingBpfImport.result.importedBoundary ? (
              <Text style={styles.importPreviewWarning}>Selected BPF boundary will replace the active field boundary after projection into {project.projectCrs}.</Text>
            ) : null}
            <Text style={styles.importPreviewWarning}>BPF center point evidence imports as a survey point only; it does not move the active pivot center.</Text>
            {pendingBpfImport.result.warnings.map((warning) => (
              <Text key={warning} style={styles.importPreviewWarning}>{warning}</Text>
            ))}
          </View>
          <View style={styles.actionRow}>
            <FileAction accessibilityLabel="Apply CornerGPSMap BPF import" disabled={!pendingBpfImport.result.canApply || selectedBpfImportItemIds.length === 0} icon={<Upload size={18} color="#ffffff" />} label="Apply BPF" primary onPress={applyPendingBpfImport} testID="files-action-apply-bpf-import" />
            <FileAction accessibilityLabel="Cancel CornerGPSMap BPF import" icon={<Trash2 size={18} color="#254234" />} label="Cancel" onPress={cancelPendingBpfImport} testID="files-action-cancel-bpf-import" />
          </View>
        </View>
      ) : null}

      <View style={styles.projectList}>
        {repository.projects.length === 0 ? (
          <Text style={styles.emptyText}>No local projects saved yet.</Text>
        ) : repository.projects.map((summary) => (
          <View key={summary.id} style={styles.projectRow}>
            <View style={styles.projectMeta}>
              <Text style={styles.projectName}>{summary.name}</Text>
              <Text style={styles.projectDetail}>{summary.projectCrs} · {summary.unitSystem.replaceAll("_", " ")} · {new Date(summary.updatedAt).toLocaleString()}</Text>
            </View>
            <View style={styles.rowActions}>
              <Pressable accessibilityLabel={`Open ${summary.name}`} onPress={() => void onOpenProject(summary.id)} style={styles.iconButton}>
                <FolderOpen size={18} color="#254234" />
              </Pressable>
              <Pressable accessibilityLabel={`Delete ${summary.name}`} onPress={() => void onDeleteProject(summary.id)} style={styles.iconButtonDanger}>
                <Trash2 size={18} color="#8b1e18" />
              </Pressable>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function FileLane({ children, icon, title }: { children: React.ReactNode; icon: React.ReactNode; title: string }): React.JSX.Element {
  return (
    <View style={styles.fileLane}>
      <View style={styles.fileLaneHeader}>
        {icon}
        <Text style={styles.groupTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

function BackendTile({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <View style={styles.backendTile}>
      <Text style={styles.backendLabel}>{label}</Text>
      <Text style={styles.backendValue}>{value}</Text>
    </View>
  );
}

function FileAction({
  accessibilityLabel,
  disabled = false,
  icon,
  label,
  onPress,
  primary = false,
  danger = false,
  testID,
}: {
  accessibilityLabel?: string;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  onPress: () => void | Promise<void>;
  primary?: boolean;
  danger?: boolean;
  testID?: string;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityHint={accessibilityLabel}
      accessibilityLabel={label}
      accessibilityRole="button"
      disabled={disabled}
      onPress={disabled ? undefined : onPress}
      style={[styles.actionButton, primary && styles.actionButtonPrimary, danger && styles.actionButtonDanger, disabled && styles.actionButtonDisabled]}
      testID={testID}
    >
      {icon}
      <Text style={[styles.actionText, primary && styles.actionTextPrimary, danger && styles.actionTextDanger, disabled && styles.actionTextDisabled]}>{label}</Text>
    </Pressable>
  );
}

function webStatusProps(): Record<string, unknown> {
  if (Platform.OS !== "web") return {};
  return {
    "aria-live": "polite",
    role: "status",
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Project file operation failed.";
}

function kmlImportSummary(result: GoogleEarthKmlImportResult): string {
  const parts = [
    result.importedBoundary ? "1 boundary" : "no boundary",
    `${result.importedObstacleCount} obstacle${result.importedObstacleCount === 1 ? "" : "s"}`,
    `${result.importedSurveyPointCount} point${result.importedSurveyPointCount === 1 ? "" : "s"}`,
  ];
  if (result.importedMapFeatureCount > 0) parts.push(`${result.importedMapFeatureCount} map feature${result.importedMapFeatureCount === 1 ? "" : "s"}`);
  if (result.skippedFeatureCount > 0) parts.push(`${result.skippedFeatureCount} skipped`);
  return parts.join(", ");
}

function kmlImportItems(result: GoogleEarthKmlImportResult): { id: string; title: string; detail: string }[] {
  const items = result.items.map((item) => ({
    id: item.id,
    title: item.name,
    detail: `${item.classification.replaceAll("_", " ")}${item.featureKind ? ` · ${item.featureKind.replaceAll("_", " ")}` : ""} · ${item.geometryType}${item.warning ? ` · ${item.warning}` : ""}`,
  }));
  return items.length > 0
    ? items
    : [{
      id: "none",
      title: "No imported project geometry",
      detail: "The parser did not return selectable boundary, obstacle, survey, or map-feature candidates.",
    }];
}

function bpfImportSummary(result: CornerGpsMapBpfImportPreview): string {
  const parts = [
    result.importedBoundary ? "1 boundary" : "no boundary",
    `${result.importedSurveyPointCount} pivot point${result.importedSurveyPointCount === 1 ? "" : "s"}`,
  ];
  if (!result.canApply) parts.push("blocked");
  if (result.evidence.duplicateClosingPointRemoved) parts.push("duplicate closure normalized");
  parts.push(`${result.evidence.normalizedBorderPoints.length} boundary point${result.evidence.normalizedBorderPoints.length === 1 ? "" : "s"}`);
  return parts.join(", ");
}

function bpfImportItems(result: CornerGpsMapBpfImportPreview): { id: string; title: string; detail: string }[] {
  const items = result.items.map((item) => ({
    id: item.id,
    title: item.name,
    detail: `${item.classification.replaceAll("_", " ")} · ${item.geometryType}${item.warning ? ` · ${item.warning}` : ""}`,
  }));
  return items.length > 0
    ? items
    : [{
      id: "none",
      title: "No importable BPF evidence",
      detail: "The BPF did not return a usable projected boundary or pivot-center evidence item.",
    }];
}

function legacyEvidenceSummary(result: CornerGpsMapLegacyEvidence): string {
  const parts = [
    `${result.pathPointSummary.pointCount} path row${result.pathPointSummary.pointCount === 1 ? "" : "s"}`,
    `${result.vriSummary.zoneCount} VRI zone${result.vriSummary.zoneCount === 1 ? "" : "s"}`,
    `${result.statusSummary.values.length} status value${result.statusSummary.values.length === 1 ? "" : "s"}`,
    `${result.statusSummary.violationCount} violation${result.statusSummary.violationCount === 1 ? "" : "s"}`,
  ];
  if (result.machineDimensions.rawFieldCount > 0) parts.push(`${result.machineDimensions.rawFieldCount} machine field${result.machineDimensions.rawFieldCount === 1 ? "" : "s"}`);
  return parts.join(", ");
}

function legacyEvidenceItems(result: CornerGpsMapLegacyEvidence): { title: string; detail: string }[] {
  return [
    {
      title: "Path Evidence",
      detail: `${result.pathPointSummary.pointCount} row${result.pathPointSummary.pointCount === 1 ? "" : "s"} · ${result.pathPointSummary.hasCoordinateColumns ? "coordinate columns redacted" : "no coordinate columns detected"}`,
    },
    {
      title: "Machine Metadata",
      detail: [
        result.machineDimensions.cornerLengthMeters !== undefined ? `corner ${formatMeters(result.machineDimensions.cornerLengthMeters)}` : null,
        result.machineDimensions.lrduBoundaryDistanceMeters !== undefined ? `LRDU min ${formatMeters(result.machineDimensions.lrduBoundaryDistanceMeters)}` : null,
        result.machineDimensions.endGunReachMeters !== undefined ? `end gun ${formatMeters(result.machineDimensions.endGunReachMeters)}` : null,
        result.machineDimensions.rawFieldCount === 0 ? "no machine fields" : null,
      ].filter((item): item is string => Boolean(item)).join(" · "),
    },
    {
      title: "VRI Summary",
      detail: result.vriSummary.zoneCount > 0
        ? `${result.vriSummary.zoneCount} zone${result.vriSummary.zoneCount === 1 ? "" : "s"} · rate ${result.vriSummary.minRatePercent ?? "?"}-${result.vriSummary.maxRatePercent ?? "?"}%`
        : "No VRI zones detected",
    },
    {
      title: "Status Fields",
      detail: `${result.statusSummary.warningCount} warning${result.statusSummary.warningCount === 1 ? "" : "s"} · ${result.statusSummary.blockerCount} blocker${result.statusSummary.blockerCount === 1 ? "" : "s"}`,
    },
  ];
}

function sourceRefForFile(filename: string, observedAt: string, label: string): CornerGpsMapSourceRef {
  return {
    sourceId: `SRC-${label}-${filename}`.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 96) || "SRC-CORNERGPSMAP-IMPORT",
    title: `${label}: ${filename}`,
    checkedAt: observedAt,
    limit: "Operator-selected local file; raw coordinates, local paths, credentials, and customer identifiers are not persisted in CPLayout compatibility metadata.",
  };
}

function formatMeters(value: number): string {
  return `${value.toFixed(2)} m`;
}

function decodeUtf8(bytes: Uint8Array): string {
  if (typeof TextDecoder !== "undefined") return new TextDecoder("utf-8").decode(bytes);
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("utf8");
  throw new Error("This runtime cannot decode the selected text file.");
}

function formatWarnings(warnings: string[]): string {
  const uniqueWarnings = [...new Set(warnings)];
  return uniqueWarnings.length > 0 ? ` Warnings: ${uniqueWarnings.join(" ")}` : "";
}

function statusToneColor(tone: StatusTone): string {
  if (tone === "error") return "#8b1e18";
  if (tone === "warning") return "#805116";
  if (tone === "success") return "#1f5f39";
  return "#254234";
}

function statusToneStyle(tone: StatusTone) {
  if (tone === "error") return styles.statusError;
  if (tone === "warning") return styles.statusWarning;
  if (tone === "success") return styles.statusSuccess;
  return styles.statusInfo;
}

function statusTextToneStyle(tone: StatusTone) {
  if (tone === "error") return styles.statusTextError;
  if (tone === "warning") return styles.statusTextWarning;
  if (tone === "success") return styles.statusTextSuccess;
  return styles.statusTextInfo;
}

const styles = StyleSheet.create({
  panel: {
    gap: 12,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  title: {
    color: "#17241c",
    fontSize: 17,
    fontWeight: "900",
  },
  groupTitle: {
    color: "#405146",
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  fileLane: {
    borderColor: "#dce3da",
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    padding: 12,
  },
  fileLaneHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  destructiveActionRow: {
    alignItems: "flex-start",
  },
  actionButton: {
    alignItems: "center",
    backgroundColor: "#f1f5ee",
    borderColor: "#cdd8ca",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 7,
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  actionButtonPrimary: {
    backgroundColor: "#254234",
    borderColor: "#254234",
  },
  actionButtonDanger: {
    backgroundColor: "#fff0ee",
    borderColor: "#dfa59d",
  },
  actionButtonDisabled: {
    backgroundColor: "#eef1ec",
    borderColor: "#d9dfd6",
    opacity: 0.65,
  },
  actionText: {
    color: "#254234",
    fontSize: 13,
    fontWeight: "900",
  },
  actionTextPrimary: {
    color: "#ffffff",
  },
  actionTextDanger: {
    color: "#8b1e18",
  },
  actionTextDisabled: {
    color: "#7f8b83",
  },
  statusBox: {
    alignItems: "flex-start",
    backgroundColor: "#eef4ed",
    borderColor: "#bed0bd",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    padding: 10,
  },
  statusInfo: {
    backgroundColor: "#eef4ed",
    borderColor: "#bed0bd",
  },
  statusSuccess: {
    backgroundColor: "#edf8ef",
    borderColor: "#a8d3b5",
  },
  statusWarning: {
    backgroundColor: "#fff7e7",
    borderColor: "#e0bf79",
  },
  statusError: {
    backgroundColor: "#fff0ee",
    borderColor: "#dfa59d",
  },
  statusText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 18,
  },
  statusTextInfo: {
    color: "#254234",
  },
  statusTextSuccess: {
    color: "#1f5f39",
  },
  statusTextWarning: {
    color: "#805116",
  },
  statusTextError: {
    color: "#8b1e18",
  },
  backendGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  backendTile: {
    backgroundColor: "#f8faf4",
    borderColor: "#d8e0d4",
    borderRadius: 8,
    borderWidth: 1,
    minWidth: 128,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  backendLabel: {
    color: "#5a6c60",
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  backendValue: {
    color: "#21382b",
    fontSize: 13,
    fontWeight: "900",
    marginTop: 3,
  },
  backendNote: {
    color: "#53655a",
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17,
  },
  importGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  gisExchangeGrid: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  gisActionBox: {
    flexBasis: 280,
    flexGrow: 1,
  },
  importBox: {
    borderColor: "#dce3da",
    borderRadius: 8,
    borderWidth: 1,
    flexBasis: 320,
    flexGrow: 1,
    gap: 9,
    padding: 12,
  },
  importTitle: {
    color: "#17241c",
    fontSize: 14,
    fontWeight: "900",
  },
  importPreviewBox: {
    borderColor: "#e0bf79",
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    padding: 12,
  },
  importPreviewText: {
    color: "#26372c",
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 18,
    marginTop: 4,
  },
  importPreviewItemGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10,
  },
  importPreviewItem: {
    backgroundColor: "#f8faf4",
    borderColor: "#d4decf",
    borderRadius: 8,
    borderWidth: 1,
    flexBasis: 190,
    flexGrow: 1,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  importPreviewItemSelected: {
    backgroundColor: "#254234",
    borderColor: "#254234",
  },
  importPreviewItemDisabled: {
    opacity: 0.62,
  },
  importPreviewItemTitle: {
    color: "#26372c",
    fontSize: 13,
    fontWeight: "900",
  },
  importPreviewItemTitleSelected: {
    color: "#ffffff",
  },
  importPreviewItemMeta: {
    color: "#53655a",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 16,
    marginTop: 3,
  },
  importPreviewItemMetaSelected: {
    color: "#e9f1e7",
  },
  importPreviewWarning: {
    color: "#805116",
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17,
    marginTop: 4,
  },
  importInput: {
    backgroundColor: "#ffffff",
    borderColor: "#cdd8ca",
    borderRadius: 8,
    borderWidth: 1,
    color: "#1d2c22",
    fontFamily: "monospace",
    fontSize: 12,
    minHeight: 96,
    paddingHorizontal: 10,
    paddingVertical: 8,
    textAlignVertical: "top",
  },
  projectList: {
    gap: 9,
  },
  emptyText: {
    color: "#5b6b61",
    fontSize: 13,
    fontWeight: "800",
  },
  projectRow: {
    alignItems: "center",
    borderColor: "#dce3da",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "space-between",
    padding: 12,
  },
  projectMeta: {
    flex: 1,
    minWidth: 220,
  },
  projectName: {
    color: "#1d2c22",
    fontSize: 15,
    fontWeight: "900",
  },
  projectDetail: {
    color: "#5b6b61",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
  },
  rowActions: {
    flexDirection: "row",
    gap: 8,
  },
  iconButton: {
    alignItems: "center",
    backgroundColor: "#edf4eb",
    borderColor: "#c4d4c3",
    borderRadius: 8,
    borderWidth: 1,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  iconButtonDanger: {
    alignItems: "center",
    backgroundColor: "#fff0ee",
    borderColor: "#e2aaa4",
    borderRadius: 8,
    borderWidth: 1,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
});
