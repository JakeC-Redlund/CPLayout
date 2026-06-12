import { Database, Layers, Map, Ruler, Satellite, SlidersHorizontal } from "lucide-react-native";
import React, { useEffect, useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { COORDINATE_FORMAT_LABELS, COORDINATE_FORMATS, type CoordinateDisplayFormat } from "@cplayout/core";
import {
  AppSettings,
  describeTilePackageReadiness,
  GPS_FIX_ORDER,
  listAerialImageryCandidates,
  MAP_STYLES,
  OFFLINE_PACKAGE_TYPES,
  ONLINE_IMAGERY_PROVIDER_LIST,
  REFERENCE_OVERLAY_SCHEMAS,
  resolveAerialReferenceImagerySource,
  resolveReferenceOverlaySource,
  validateCustomOpenImagerySource,
  type AerialImageryMode,
  type OnlineImageryCustomSource,
  type MapStyle,
  type MapPackageManifest,
  type MinimumGpsFixType,
  type OfflinePackageType,
  type ReferenceOverlayMode,
  type ReferenceOverlaySchema,
} from "@cplayout/core";
import type { UnitSystem } from "@cplayout/core";

interface SettingsPanelProps {
  mapPackages?: MapPackageManifest[];
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
}

export function SettingsPanel({ mapPackages = [], settings, onChange }: SettingsPanelProps): React.JSX.Element {
  const [customFormVisible, setCustomFormVisible] = useState(settings.onlineImagery.providerId === "custom_open_xyz");
  const [customDraft, setCustomDraft] = useState<CustomImageryDraft>(() => customDraftFromSettings(settings));
  const customValidation = useMemo(() => validateCustomOpenImagerySource(customDraft), [customDraft]);
  const mapLibreTarget = Platform.OS === "android"
    ? "android_maplibre_rn"
    : Platform.OS === "ios"
      ? "ios_maplibre_rn"
      : "web_maplibre_gl_js";
  const localAerialCandidates = useMemo(
    () => listAerialImageryCandidates({
      mapPackages,
      target: mapLibreTarget,
    }),
    [mapLibreTarget, mapPackages],
  );
  const aerialReferenceStatus = useMemo(
    () => resolveAerialReferenceImagerySource({
      preferences: settings.aerialImagery,
      onlineImagery: settings.onlineImagery,
      mapPackages,
      target: mapLibreTarget,
    }),
    [mapLibreTarget, mapPackages, settings.aerialImagery, settings.onlineImagery],
  );
  const aerialWorkflow = settings.aerialImagery.mode === "off" && settings.onlineImagery.enabled && settings.onlineImagery.providerId === "usgs_imagery_only"
    ? "usgs_live_preview"
    : settings.aerialImagery.mode === "off"
      ? "off"
      : settings.aerialImagery.mode === "manual"
        ? "manual_local"
        : "auto_local";
  const referenceProvider = aerialReferenceStatus.onlineProvider;
  const aerialSummary = aerialReferenceStatus.sourceKind === "local_raster"
    ? `${aerialReferenceStatus.localAerial.autoApplied ? "Auto local first" : "Manual local"}: ${aerialReferenceStatus.localAerial.packageName ?? aerialReferenceStatus.localAerial.packageId} · ${aerialReferenceStatus.localAerial.reason}`
    : referenceProvider
      ? `${aerialProviderLabel(aerialReferenceStatus.autoFallback, settings.aerialImagery.mode, referenceProvider.id)}: ${referenceProvider.name} · ${referenceProvider.coverageLabel} · connected preview only`
      : aerialReferenceStatus.reason;
  const imagerySourceSummary = referenceProvider
    ? `${referenceProvider.coverageLabel} · ${referenceProvider.projection} · ${referenceProvider.tileScheme.toUpperCase()} ${referenceProvider.tileSize}px · z${referenceProvider.minZoom}-${referenceProvider.maxZoom} · live preview only`
    : "Live imagery disabled · browser map uses offline overlay only · no external tile source is requested";
  const imageryGuardrailSummary = referenceProvider
    ? `${referenceProvider.attribution} · ${referenceProvider.licenseText} · imagery is reference-only and never canonical geometry`
    : "Imagery settings are browser-local aids; project exports keep projected/local XY geometry and exclude live tile requests.";
  const referenceOverlayTarget = mapLibreTarget;
  const referenceOverlayCandidates = useMemo(
    () => mapPackages.filter((mapPackage) => {
      if (mapPackage.tileContentType !== "vector") return false;
      if (mapPackage.installStatus !== "available" && mapPackage.installStatus !== "indexed") return false;
      return describeTilePackageReadiness(mapPackage, referenceOverlayTarget).canRender;
    }),
    [mapPackages, referenceOverlayTarget],
  );
  const referenceOverlayStatus = useMemo(
    () => resolveReferenceOverlaySource({
      allowPublicNetwork: settings.onlineImagery.enabled,
      preferences: settings.referenceOverlay,
      mapPackages,
      target: referenceOverlayTarget,
    }),
    [mapPackages, referenceOverlayTarget, settings.onlineImagery.enabled, settings.referenceOverlay],
  );
  const referenceOverlaySummary = referenceOverlayStatus.canRender
    ? `${referenceOverlayStatus.autoApplied ? "Auto-applied" : "Manual"}: ${referenceOverlayStatus.packageName ?? referenceOverlayStatus.packageId} · ${referenceOverlayStatus.sourceKind === "public_raster" ? "public no-key raster" : referenceOverlayStatus.schema.replaceAll("_", " ")} · ${referenceOverlayStatus.reason}`
    : referenceOverlayStatus.reason;

  useEffect(() => {
    setCustomDraft(customDraftFromSettings(settings));
    setCustomFormVisible(settings.onlineImagery.providerId === "custom_open_xyz");
  }, [settings.onlineImagery.customSource, settings.onlineImagery.providerId]);

  function update(next: Partial<AppSettings>): void {
    onChange({ ...settings, ...next });
  }

  function updateReferenceOverlay(next: Partial<AppSettings["referenceOverlay"]>): void {
    update({
      referenceOverlay: {
        ...settings.referenceOverlay,
        ...next,
      },
    });
  }

  function updateAerialImagery(next: Partial<AppSettings["aerialImagery"]>): void {
    update({
      aerialImagery: {
        ...settings.aerialImagery,
        ...next,
      },
    });
  }

  function setAerialWorkflow(workflow: "off" | "auto_local" | "manual_local" | "usgs_live_preview"): void {
    if (workflow === "usgs_live_preview") {
      update({
        aerialImagery: { ...settings.aerialImagery, mode: "off" },
        onlineImagery: {
          ...settings.onlineImagery,
          enabled: true,
          providerId: "usgs_imagery_only",
        },
      });
      return;
    }
    if (workflow === "auto_local") {
      update({
        aerialImagery: {
          ...settings.aerialImagery,
          mode: "auto",
        },
        onlineImagery: {
          ...settings.onlineImagery,
          enabled: true,
          providerId: "usgs_imagery_only",
        },
      });
      return;
    }
    update({
      aerialImagery: {
        ...settings.aerialImagery,
        mode: workflow === "manual_local" ? "manual" : "off",
      },
      onlineImagery: {
        ...settings.onlineImagery,
        enabled: false,
      },
    });
  }

  function applyCustomSource(): void {
    if (!customValidation.ok) return;
    update({
      onlineImagery: {
        ...settings.onlineImagery,
        customSource: customValidation.source,
        enabled: true,
        providerId: "custom_open_xyz",
      },
    });
  }

  return (
    <View style={styles.shell} testID="settings-view">
      <SettingsSection title="Essentials">
        <SettingsGroup icon={<Ruler size={20} color="#254234" />} title="Units and Coordinates">
          <View style={styles.buttonRow}>
            <Choice active={settings.unitSystem === "metric"} label="Metric" onPress={() => update({ unitSystem: "metric" })} />
            <Choice active={settings.unitSystem === "us_survey_feet"} label="Imperial" onPress={() => update({ unitSystem: "us_survey_feet" })} />
          </View>
          <View style={styles.buttonRow}>
            {COORDINATE_FORMATS.map((format) => (
              <Choice
                key={format}
                active={settings.coordinateDisplayFormat === format}
                label={COORDINATE_FORMAT_LABELS[format]}
                onPress={() => update({ coordinateDisplayFormat: format as CoordinateDisplayFormat })}
              />
            ))}
          </View>
        </SettingsGroup>

        <SettingsGroup icon={<Map size={20} color="#254234" />} title="Map View">
          <Stepper
            label="Default zoom"
            value={settings.defaultZoomLevel.toFixed(2)}
            onDecrease={() => update({ defaultZoomLevel: clamp(settings.defaultZoomLevel / settings.drawing.zoomStepFactor, 0.25, 12) })}
            onIncrease={() => update({ defaultZoomLevel: clamp(settings.defaultZoomLevel * settings.drawing.zoomStepFactor, 0.25, 12) })}
          />
          <View style={styles.buttonRow}>
            {MAP_STYLES.map((style) => (
              <Choice
                key={style}
                active={settings.mapStyle === style}
                label={mapStyleLabel(style)}
                onPress={() => update({ mapStyle: style as MapStyle })}
              />
            ))}
          </View>
        </SettingsGroup>

        <SettingsGroup icon={<Satellite size={20} color="#254234" />} title="Aerial Imagery">
          <View style={styles.buttonRow}>
            <Choice
              active={aerialWorkflow === "off"}
              label="Aerial Off"
              onPress={() => setAerialWorkflow("off")}
              testID="settings-aerial-mode-off"
            />
            <Choice
              active={aerialWorkflow === "auto_local"}
              label="Auto"
              onPress={() => setAerialWorkflow("auto_local")}
              testID="settings-aerial-mode-auto"
            />
            <Choice
              active={aerialWorkflow === "manual_local"}
              label="Manual local"
              onPress={() => setAerialWorkflow("manual_local")}
              testID="settings-aerial-mode-manual-local"
            />
            <Choice
              active={aerialWorkflow === "usgs_live_preview"}
              label="USGS only"
              onPress={() => setAerialWorkflow("usgs_live_preview")}
              testID="settings-aerial-mode-usgs-only"
            />
          </View>
          {settings.aerialImagery.mode === "manual" && !settings.onlineImagery.enabled ? (
            <View style={styles.buttonRow}>
              {localAerialCandidates.map((candidate) => (
                <Choice
                  key={candidate.packageId}
                  active={settings.aerialImagery.sourcePackageId === candidate.packageId}
                  label={candidate.packageName}
                  onPress={() => updateAerialImagery({ mode: "manual" as AerialImageryMode, sourcePackageId: candidate.packageId })}
                />
              ))}
            </View>
          ) : null}
          <Text style={styles.lockedText} testID="settings-aerial-summary">
            {aerialSummary}
          </Text>
          <Text style={styles.lockedText} testID="settings-aerial-guardrail">
            Offline production imagery uses generated local raster TileJSON or tile templates, with NAIP packages as the preferred U.S. farm source. USGS live preview is connected-only; raw PMTiles/MBTiles and public tile caches remain blocked until separately adapter-proven.
          </Text>
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection title="Advanced">

      <SettingsGroup icon={<SlidersHorizontal size={20} color="#254234" />} title="Drawing and Snapping">
        <Stepper
          label="Vertex snap"
          value={`${settings.drawing.vertexSnapToleranceMeters.toFixed(1)} m`}
          onDecrease={() => update({ drawing: { ...settings.drawing, vertexSnapToleranceMeters: clamp(settings.drawing.vertexSnapToleranceMeters - 0.5, 0.1, 50) } })}
          onIncrease={() => update({ drawing: { ...settings.drawing, vertexSnapToleranceMeters: clamp(settings.drawing.vertexSnapToleranceMeters + 0.5, 0.1, 50) } })}
        />
        <Stepper
          label="Feature snap"
          value={`${settings.drawing.featureSnapToleranceMeters.toFixed(1)} m`}
          onDecrease={() => update({ drawing: { ...settings.drawing, featureSnapToleranceMeters: clamp(settings.drawing.featureSnapToleranceMeters - 1, 0.1, 100) } })}
          onIncrease={() => update({ drawing: { ...settings.drawing, featureSnapToleranceMeters: clamp(settings.drawing.featureSnapToleranceMeters + 1, 0.1, 100) } })}
        />
      </SettingsGroup>

      <SettingsGroup icon={<Ruler size={20} color="#254234" />} title="Layout Review">
        <Stepper
          label="Boundary clearance"
          testID="settings-layout-boundary-clearance"
          value={`${settings.layoutReview.requiredBoundaryClearanceMeters.toFixed(1)} m`}
          onDecrease={() => update({
            layoutReview: {
              ...settings.layoutReview,
              requiredBoundaryClearanceMeters: clamp(settings.layoutReview.requiredBoundaryClearanceMeters - 5, 0, 1000),
            },
          })}
          onIncrease={() => update({
            layoutReview: {
              ...settings.layoutReview,
              requiredBoundaryClearanceMeters: clamp(settings.layoutReview.requiredBoundaryClearanceMeters + 5, 0, 1000),
            },
          })}
        />
        <View style={styles.buttonRow}>
          <Choice
            active={settings.layoutReview.showMachineBoundaryDistances}
            label="Show distances"
            onPress={() => update({ layoutReview: { ...settings.layoutReview, showMachineBoundaryDistances: true } })}
            testID="settings-layout-show-machine-distances"
          />
          <Choice
            active={!settings.layoutReview.showMachineBoundaryDistances}
            label="Hide distances"
            onPress={() => update({ layoutReview: { ...settings.layoutReview, showMachineBoundaryDistances: false } })}
            testID="settings-layout-hide-machine-distances"
          />
        </View>
        <Text style={styles.lockedText} testID="settings-layout-review-summary">
          Advisory sampled machine-to-boundary rows use projected/local XY only and do not move pivots, vertices, machine settings, storage, archives, or exports.
        </Text>
      </SettingsGroup>

      <SettingsGroup icon={<Satellite size={20} color="#254234" />} title="GPS Quality Gate">
        <Stepper
          label="Minimum satellites"
          value={`${settings.gpsQuality.minSatellites}`}
          onDecrease={() => update({ gpsQuality: { ...settings.gpsQuality, minSatellites: Math.max(0, settings.gpsQuality.minSatellites - 1) } })}
          onIncrease={() => update({ gpsQuality: { ...settings.gpsQuality, minSatellites: Math.min(80, settings.gpsQuality.minSatellites + 1) } })}
        />
        <Stepper
          label="Max HDOP"
          value={settings.gpsQuality.maxHdop.toFixed(1)}
          onDecrease={() => update({ gpsQuality: { ...settings.gpsQuality, maxHdop: clamp(settings.gpsQuality.maxHdop - 0.1, 0.1, 99) } })}
          onIncrease={() => update({ gpsQuality: { ...settings.gpsQuality, maxHdop: clamp(settings.gpsQuality.maxHdop + 0.1, 0.1, 99) } })}
        />
        <View style={styles.buttonRow}>
          {GPS_FIX_ORDER.filter((fixType) => fixType !== "invalid").map((fixType) => (
            <Choice
              key={fixType}
              active={settings.gpsQuality.minimumFixType === fixType}
              label={fixType.replaceAll("_", " ")}
              onPress={() => update({ gpsQuality: { ...settings.gpsQuality, minimumFixType: fixType as MinimumGpsFixType } })}
            />
          ))}
        </View>
      </SettingsGroup>

      <SettingsGroup icon={<Database size={20} color="#254234" />} title="Offline Map Packages">
        <View style={styles.buttonRow}>
          {OFFLINE_PACKAGE_TYPES.map((packageType) => (
            <Choice
              key={packageType}
              active={settings.offlineMaps.preferredPackageType === packageType}
              label={packageType.replaceAll("_", " ").toUpperCase()}
              onPress={() => update({ offlineMaps: { ...settings.offlineMaps, preferredPackageType: packageType as OfflinePackageType } })}
            />
          ))}
        </View>
        <Text style={styles.lockedText} testID="settings-offline-package-summary">
          Network tiles: disabled · Attribution: required · Local directory: {settings.offlineMaps.packageDirectory}
        </Text>
      </SettingsGroup>

      <SettingsGroup icon={<Layers size={20} color="#254234" />} title="Reference Overlays">
        <View style={styles.buttonRow}>
          <Choice
            active={settings.referenceOverlay.mode === "auto"}
            label="Auto"
            onPress={() => updateReferenceOverlay({ mode: "auto" as ReferenceOverlayMode })}
          />
          <Choice
            active={settings.referenceOverlay.mode === "manual"}
            label="Manual"
            onPress={() => updateReferenceOverlay({ mode: "manual" as ReferenceOverlayMode })}
          />
          <Choice
            active={settings.referenceOverlay.mode === "off"}
            label="Hide overlays"
            onPress={() => updateReferenceOverlay({ mode: "off" as ReferenceOverlayMode })}
          />
        </View>
        {settings.referenceOverlay.mode === "manual" ? (
          <View style={styles.buttonRow}>
          {referenceOverlayCandidates.map((mapPackage) => (
            <Choice
              key={mapPackage.id}
              active={settings.referenceOverlay.sourcePackageId === mapPackage.id}
              label={mapPackage.name}
              onPress={() => updateReferenceOverlay({ mode: "manual" as ReferenceOverlayMode, sourcePackageId: mapPackage.id })}
            />
          ))}
          </View>
        ) : null}
        {settings.referenceOverlay.mode === "manual" ? (
          <View style={styles.buttonRow}>
            {REFERENCE_OVERLAY_SCHEMAS.map((schema) => (
              <Choice
                key={schema}
                active={settings.referenceOverlay.schema === schema}
                label={referenceOverlaySchemaLabel(schema)}
                onPress={() => updateReferenceOverlay({ schema: schema as ReferenceOverlaySchema })}
              />
            ))}
          </View>
        ) : null}
        <Text style={styles.lockedText} testID="settings-reference-overlay-summary">
          {referenceOverlaySummary}
        </Text>
        <Text style={styles.lockedText} testID="settings-reference-overlay-guardrail">
          Display-only overlays; local vector packages are preferred, then public no-key USGS Imagery Topo may be used when live reference sources are enabled. Project ZIPs keep projected/local XY geometry and no public OSM tiles, keys, accounts, or bulk network tile caches are used.
        </Text>
      </SettingsGroup>

      <SettingsGroup icon={<Satellite size={20} color="#254234" />} title="Online Imagery Preview">
        <View style={styles.buttonRow}>
          <Choice
            active={!settings.onlineImagery.enabled}
            label="Live Off"
            onPress={() => update({ onlineImagery: { ...settings.onlineImagery, enabled: false } })}
          />
          {ONLINE_IMAGERY_PROVIDER_LIST.map((provider) => (
            <Choice
              key={provider.id}
              active={settings.onlineImagery.enabled && settings.onlineImagery.providerId === provider.id}
              label={provider.id === "custom_open_xyz" ? "Custom open" : provider.name}
              onPress={() => {
                if (provider.id === "custom_open_xyz") {
                  setCustomFormVisible(true);
                  if (customValidation.ok) applyCustomSource();
                  return;
                }
                update({ onlineImagery: { ...settings.onlineImagery, enabled: true, providerId: provider.id } });
              }}
            />
          ))}
        </View>
        <Stepper
          label="Tile cap"
          testID="settings-tile-cap-stepper"
          value={`${settings.onlineImagery.maxTilesPerView}`}
          onDecrease={() => update({ onlineImagery: { ...settings.onlineImagery, maxTilesPerView: clamp(settings.onlineImagery.maxTilesPerView - 8, 8, 128) } })}
          onIncrease={() => update({ onlineImagery: { ...settings.onlineImagery, maxTilesPerView: clamp(settings.onlineImagery.maxTilesPerView + 8, 8, 128) } })}
        />
        <Text style={styles.lockedText} testID="settings-imagery-source-summary">
          {imagerySourceSummary}
        </Text>
        <Text style={styles.lockedText} testID="settings-imagery-guardrail-summary">
          {imageryGuardrailSummary}
        </Text>
        {customFormVisible ? (
          <View style={styles.customForm}>
            <Text style={styles.lockedText}>
              Custom sources must be open, no-key XYZ or WMTS-style tile templates. Hidden keys, tokens, paid hosted imagery, and bulk caching are blocked.
            </Text>
            <SettingsInput
              label="Source name"
              value={customDraft.name}
              onChangeText={(name) => setCustomDraft((current) => ({ ...current, name }))}
            />
            <SettingsInput
              label="Tile URL"
              value={customDraft.tileUrlTemplate}
              onChangeText={(tileUrlTemplate) => setCustomDraft((current) => ({ ...current, tileUrlTemplate }))}
            />
            <View style={styles.buttonRow}>
              <Choice
                active={customDraft.tileScheme === "xyz"}
                label="XYZ"
                onPress={() => setCustomDraft((current) => ({ ...current, tileScheme: "xyz" }))}
              />
              <Choice
                active={customDraft.tileScheme === "tms"}
                label="TMS"
                onPress={() => setCustomDraft((current) => ({ ...current, tileScheme: "tms" }))}
              />
            </View>
            <View style={styles.formRow}>
              <Stepper
                label="Min zoom"
                value={`${customDraft.minZoom}`}
                onDecrease={() => setCustomDraft((current) => ({ ...current, minZoom: Math.max(0, current.minZoom - 1) }))}
                onIncrease={() => setCustomDraft((current) => ({ ...current, minZoom: Math.min(23, current.minZoom + 1) }))}
              />
              <Stepper
                label="Max zoom"
                value={`${customDraft.maxZoom}`}
                onDecrease={() => setCustomDraft((current) => ({ ...current, maxZoom: Math.max(0, current.maxZoom - 1) }))}
                onIncrease={() => setCustomDraft((current) => ({ ...current, maxZoom: Math.min(23, current.maxZoom + 1) }))}
              />
            </View>
            <SettingsInput
              label="Coverage"
              value={customDraft.coverageLabel}
              onChangeText={(coverageLabel) => setCustomDraft((current) => ({ ...current, coverageLabel }))}
            />
            <SettingsInput
              label="Attribution"
              value={customDraft.attribution}
              onChangeText={(attribution) => setCustomDraft((current) => ({ ...current, attribution }))}
            />
            <SettingsInput
              label="License"
              multiline
              value={customDraft.licenseText}
              onChangeText={(licenseText) => setCustomDraft((current) => ({ ...current, licenseText }))}
            />
            <SettingsInput
              label="Terms URL"
              value={customDraft.termsUrl ?? ""}
              onChangeText={(termsUrl) => setCustomDraft((current) => ({ ...current, termsUrl }))}
            />
            <SettingsInput
              label="Source URL"
              value={customDraft.sourceUrl ?? ""}
              onChangeText={(sourceUrl) => setCustomDraft((current) => ({ ...current, sourceUrl }))}
            />
            <Text style={[styles.validationText, customValidation.ok && styles.validationTextOk]}>
              {customValidation.ok ? "Custom source ready" : customValidation.error}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Apply custom open imagery source"
              disabled={!customValidation.ok}
              onPress={applyCustomSource}
              style={[styles.applyButton, !customValidation.ok && styles.applyButtonDisabled]}
            >
              <Text style={styles.applyButtonText}>Apply Custom Source</Text>
            </Pressable>
          </View>
        ) : null}
      </SettingsGroup>
      </SettingsSection>
    </View>
  );
}

function SettingsSection({ children, title }: { children: React.ReactNode; title: string }): React.JSX.Element {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function SettingsGroup({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <View style={styles.group}>
      <View style={styles.groupHeader}>
        {icon}
        <Text style={styles.groupTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

function Choice({ active, label, onPress, testID }: { active: boolean; label: string; onPress: () => void; testID?: string }): React.JSX.Element {
  return (
    <Pressable accessibilityLabel={label} accessibilityRole="button" onPress={onPress} style={[styles.choice, active && styles.choiceActive]} testID={testID}>
      <Text style={[styles.choiceText, active && styles.choiceTextActive]}>{label}</Text>
    </Pressable>
  );
}

function Stepper({
  label,
  onDecrease,
  onIncrease,
  testID,
  value,
}: {
  label: string;
  onDecrease: () => void;
  onIncrease: () => void;
  testID?: string;
  value: string;
}): React.JSX.Element {
  return (
    <View style={styles.stepper} testID={testID}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <View style={styles.stepperControls}>
        <Pressable
          accessibilityLabel={`Decrease ${label}`}
          accessibilityRole="button"
          onPress={onDecrease}
          style={styles.stepperButton}
          testID={testID ? `${testID}-decrease` : undefined}
        >
          <Text style={styles.stepperButtonText}>-</Text>
        </Pressable>
        <Text style={styles.stepperValue} testID={testID ? `${testID}-value` : undefined}>{value}</Text>
        <Pressable
          accessibilityLabel={`Increase ${label}`}
          accessibilityRole="button"
          onPress={onIncrease}
          style={styles.stepperButton}
          testID={testID ? `${testID}-increase` : undefined}
        >
          <Text style={styles.stepperButtonText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

function SettingsInput({
  label,
  multiline,
  onChangeText,
  value,
}: {
  label: string;
  multiline?: boolean;
  onChangeText: (value: string) => void;
  value: string;
}): React.JSX.Element {
  return (
    <View style={styles.inputGroup}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize="none"
        multiline={multiline}
        onChangeText={onChangeText}
        style={[styles.input, multiline && styles.inputMultiline]}
        value={value}
      />
    </View>
  );
}

type CustomImageryDraft = Omit<OnlineImageryCustomSource, "termsUrl" | "sourceUrl"> & {
  termsUrl?: string;
  sourceUrl?: string;
};

function customDraftFromSettings(settings: AppSettings): CustomImageryDraft {
  return {
    name: settings.onlineImagery.customSource?.name ?? "",
    tileUrlTemplate: settings.onlineImagery.customSource?.tileUrlTemplate ?? "",
    minZoom: settings.onlineImagery.customSource?.minZoom ?? 0,
    maxZoom: settings.onlineImagery.customSource?.maxZoom ?? 16,
    tileScheme: settings.onlineImagery.customSource?.tileScheme ?? "xyz",
    tileSize: settings.onlineImagery.customSource?.tileSize ?? 256,
    projection: "EPSG:3857",
    coverageLabel: settings.onlineImagery.customSource?.coverageLabel ?? "User-provided open imagery source",
    termsUrl: settings.onlineImagery.customSource?.termsUrl ?? "",
    sourceUrl: settings.onlineImagery.customSource?.sourceUrl ?? "",
    cachePolicy: "interactive_only",
    attribution: settings.onlineImagery.customSource?.attribution ?? "",
    licenseText: settings.onlineImagery.customSource?.licenseText ?? "",
  };
}

function mapStyleLabel(style: MapStyle): string {
  switch (style) {
    case "field_light":
      return "Field";
    case "high_contrast":
      return "High contrast";
    case "imagery_package":
      return "Imagery";
    case "topographic":
      return "Topo";
  }
}

function aerialProviderLabel(autoFallback: boolean, aerialMode: AppSettings["aerialImagery"]["mode"], providerId: string): string {
  if (providerId === "usgs_imagery_only" && (autoFallback || aerialMode === "auto")) return "Auto USGS fallback";
  if (providerId === "usgs_imagery_only") return "USGS only";
  return "Connected preview";
}

function referenceOverlaySchemaLabel(schema: ReferenceOverlaySchema): string {
  return schema === "openmaptiles" ? "OpenMapTiles" : "CPLayout v1";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const styles = StyleSheet.create({
  shell: {
    gap: 14,
  },
  section: {
    gap: 12,
  },
  sectionTitle: {
    color: "#405146",
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  group: {
    backgroundColor: "#fbfcf8",
    borderColor: "#d8ded6",
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    padding: 16,
  },
  groupHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  groupTitle: {
    color: "#17241c",
    fontSize: 17,
    fontWeight: "900",
  },
  buttonRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  choice: {
    backgroundColor: "#f1f5ee",
    borderColor: "#cdd8ca",
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  choiceActive: {
    backgroundColor: "#254234",
    borderColor: "#254234",
  },
  choiceText: {
    color: "#314339",
    fontSize: 13,
    fontWeight: "900",
    textTransform: "capitalize",
  },
  choiceTextActive: {
    color: "#ffffff",
  },
  stepper: {
    alignItems: "center",
    borderColor: "#dce3da",
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "space-between",
    padding: 12,
  },
  stepperLabel: {
    color: "#293d31",
    fontSize: 14,
    fontWeight: "900",
  },
  stepperControls: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  stepperButton: {
    alignItems: "center",
    backgroundColor: "#254234",
    borderRadius: 8,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  stepperButtonText: {
    color: "#ffffff",
    fontSize: 19,
    fontWeight: "900",
  },
  stepperValue: {
    color: "#17241c",
    fontSize: 14,
    fontWeight: "900",
    minWidth: 72,
    textAlign: "center",
  },
  lockedText: {
    color: "#53655a",
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 18,
  },
  customForm: {
    borderColor: "#dce3da",
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    padding: 12,
  },
  formRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  inputGroup: {
    gap: 6,
  },
  inputLabel: {
    color: "#293d31",
    fontSize: 12,
    fontWeight: "900",
  },
  input: {
    backgroundColor: "#ffffff",
    borderColor: "#cdd8ca",
    borderRadius: 8,
    borderWidth: 1,
    color: "#17241c",
    fontSize: 13,
    fontWeight: "700",
    minHeight: 42,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  inputMultiline: {
    minHeight: 74,
    textAlignVertical: "top",
  },
  validationText: {
    color: "#8a4d1f",
    fontSize: 12,
    fontWeight: "900",
    lineHeight: 17,
  },
  validationTextOk: {
    color: "#254234",
  },
  applyButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "#254234",
    borderColor: "#254234",
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 42,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  applyButtonDisabled: {
    opacity: 0.45,
  },
  applyButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "900",
  },
});
