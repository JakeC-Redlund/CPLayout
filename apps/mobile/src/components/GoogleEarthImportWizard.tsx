import { Check, CheckSquare, Clipboard, Copy, FileDown, MapPin, MapPinned, MousePointer2, Route, Search, Square, Upload } from "lucide-react-native";
import React, { useRef, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View, type ImageSourcePropType } from "react-native";

const addMenuScreenshot = require("../assets/google-earth-wizard/google-earth-pro-add-menu.png") as ImageSourcePropType;
const mainWindowScreenshot = require("../assets/google-earth-wizard/google-earth-pro-main-window.png") as ImageSourcePropType;

interface WizardStep {
  title: string;
  icon: React.JSX.Element;
  screenshot?: ImageSourcePropType;
  bullets: string[];
  examples: string[];
}

const WIZARD_STEPS: WizardStep[] = [
  {
    title: "1. Search and stage Places",
    icon: <Search size={17} color="#254234" />,
    screenshot: mainWindowScreenshot,
    bullets: [
      "Use Search to find the field, then create a focused Places folder for CPLayout candidates.",
      "Places can contain polygons, paths, and placemarks. Google Earth Layers are visual context only.",
      "KML/KMZ is WGS84 exchange; CPLayout import previews project selected geometry into the project CRS before applying it.",
    ],
    examples: ["CPLayout import folder", "field_boundary", "survey_point"],
  },
  {
    title: "2. Add Polygon for boundaries",
    icon: <MousePointer2 size={17} color="#254234" />,
    screenshot: addMenuScreenshot,
    bullets: [
      "In Google Earth Pro, use Add > Polygon for the field outline and obstacle/no-spray areas.",
      "Name the field outline field_boundary or Boundary; name obstacle polygons by their CPLayout kind.",
      "Only selected import-preview polygons are applied. A selected boundary replaces the current CPLayout field boundary after projection.",
    ],
    examples: ["field_boundary", "road", "building", "exclusion"],
  },
  {
    title: "3. Add Path for utilities",
    icon: <Route size={17} color="#254234" />,
    screenshot: addMenuScreenshot,
    bullets: [
      "Use Add > Path for lines such as pipelines, power lines, access lanes, ditches, canals, and service routes.",
      "CPLayout keeps paths as selectable map features, separate from field and obstacle geometry.",
      "Line styling and labels help Google Earth inspection, but they do not change projected XY geometry.",
    ],
    examples: ["underground_pipeline", "power_line", "access_lane", "ditch"],
  },
  {
    title: "4. Add Placemark points",
    icon: <MapPin size={17} color="#254234" />,
    screenshot: addMenuScreenshot,
    bullets: [
      "Use Add > Placemark for pump locations, power poles, control points, survey points, and field notes.",
      "Point placemarks can become survey points or utility map features when selected in CPLayout import preview.",
      "LookAt, camera position, labels, icons, and screenshots remain display or evidence metadata only.",
    ],
    examples: ["pump_location", "power_pole", "survey_point", "note"],
  },
  {
    title: "5. Save KML or KMZ",
    icon: <FileDown size={17} color="#254234" />,
    screenshot: mainWindowScreenshot,
    bullets: [
      "Save the focused Places folder or selected places from Google Earth Pro as KML or KMZ.",
      "Use KMZ when Google Earth creates an archive; CPLayout expects one KML document inside the KMZ.",
      "Keep overlays, tours, 3D models, screenshots, and style-only items out of the import package.",
    ],
    examples: ["project-field.kml", "project-field.kmz"],
  },
  {
    title: "6. Select CPLayout Import Cards",
    icon: <Upload size={17} color="#254234" />,
    bullets: [
      "Press Import KML/KMZ, inspect every import card, and deselect anything that should not change the project.",
      "Apply only the intended cards; the import summary lists boundary, obstacle, survey point, map feature, and skipped counts.",
      "Imported geometry is projected into the project CRS; styles, labels, LookAt, imagery, and screenshots are not canonical geometry.",
    ],
    examples: ["select Boundary", "select underground_pipeline", "deselect extra notes"],
  },
];

const READY_CHECKLIST = [
  "Search result is staged in a focused Places folder.",
  "Boundary polygon is named field_boundary or Boundary.",
  "Obstacle polygons use road, ditch, fence, building, canal, tree, or exclusion names.",
  "Paths and placemarks use CPLayout utility or survey names.",
  "KML/KMZ contains only intended field data.",
  "Layers, styling, labels, LookAt, imagery, and screenshots are treated as visual context only.",
  "Import cards will be selected one by one before Apply Import.",
];

export function GoogleEarthImportWizard(): React.JSX.Element {
  const [open, setOpen] = useState(true);
  const [stepIndex, setStepIndex] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const [copiedExample, setCopiedExample] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [checkedItems, setCheckedItems] = useState<number[]>([]);
  const copyRequest = useRef(0);
  const step = WIZARD_STEPS[stepIndex];
  const progressText = `${completedSteps.length}/${WIZARD_STEPS.length}`;

  function toggleStepComplete(): void {
    setCompletedSteps((current) =>
      current.includes(stepIndex)
        ? current.filter((candidate) => candidate !== stepIndex)
        : [...current, stepIndex],
    );
  }

  async function copyExample(example: string): Promise<void> {
    const request = ++copyRequest.current;
    setCopiedExample(null);
    setCopyError(null);
    const clipboard = globalThis.navigator?.clipboard;
    try {
      if (!clipboard) throw new Error("Clipboard unavailable.");
      await clipboard.writeText(example);
      if (request === copyRequest.current) setCopiedExample(example);
    } catch {
      if (request === copyRequest.current) setCopyError("Could not copy. Select the example text instead.");
    }
  }

  function goToStep(index: number): void {
    setStepIndex(Math.max(0, Math.min(WIZARD_STEPS.length - 1, index)));
  }

  return (
    <View style={styles.panel} testID="google-earth-import-wizard">
      <View style={styles.headerRow}>
        <View style={styles.titleRow}>
          <Clipboard size={18} color="#254234" />
          <View>
            <Text style={styles.title}>Google Earth Import Wizard</Text>
            <Text style={styles.subtitle}>Interactive KML/KMZ trainer</Text>
          </View>
        </View>
        <Pressable accessibilityRole="button" onPress={() => setOpen((current) => !current)} style={styles.toggleButton}>
          <Text style={styles.toggleButtonText}>{open ? "Close" : "Open"}</Text>
        </Pressable>
      </View>

      {open ? (
        <View style={styles.body}>
          <View style={styles.progressRow}>
            {WIZARD_STEPS.map((wizardStep, index) => {
              const active = index === stepIndex;
              const complete = completedSteps.includes(index);
              return (
                <Pressable
                  accessibilityLabel={wizardStep.title}
                  accessibilityRole="button"
                  key={wizardStep.title}
                  onPress={() => goToStep(index)}
                  style={[styles.stepDot, active && styles.stepDotActive, complete && styles.stepDotComplete]}
                >
                  <Text style={[styles.stepDotText, (active || complete) && styles.stepDotTextActive]}>{index + 1}</Text>
                </Pressable>
              );
            })}
            <Text style={styles.progressText}>{progressText} complete</Text>
          </View>

          <View style={styles.stepBox}>
            <View style={styles.contextBox} testID="google-earth-wizard-boundary-note">
              <Text style={styles.contextText}>
                Places are import candidates. Layers and KML/KMZ styling are visual context; CPLayout alters only selected, projected import-preview geometry.
              </Text>
            </View>
            <View style={styles.stepTitleRow}>
              {step.icon}
              <Text style={styles.stepTitle}>{step.title}</Text>
            </View>
            {step.screenshot ? (
              <Image resizeMode="cover" source={step.screenshot} style={styles.screenshot} />
            ) : null}
            {step.bullets.map((bullet) => (
              <Text key={bullet} style={styles.bulletText}>- {bullet}</Text>
            ))}
            <View style={styles.exampleGrid}>
              {step.examples.map((example) => (
                <Pressable accessibilityRole="button" accessibilityLabel={`Copy ${example}`} key={example} onPress={() => copyExample(example)} style={styles.exampleToken}>
                  <Copy size={13} color="#254234" />
                  <Text selectable style={styles.exampleText}>{example}</Text>
                </Pressable>
              ))}
            </View>
            {copiedExample ? (
              <Text style={styles.copyStatus}>Copied: {copiedExample}</Text>
            ) : null}
          </View>

          <View style={styles.navigationRow}>
            <Pressable accessibilityRole="button" disabled={stepIndex === 0} onPress={() => goToStep(stepIndex - 1)} style={[styles.navButton, stepIndex === 0 && styles.navButtonDisabled]} testID="google-earth-wizard-back">
              <Text style={[styles.navButtonText, stepIndex === 0 && styles.navButtonTextDisabled]}>Back</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={toggleStepComplete} style={styles.doneButton} testID="google-earth-wizard-step-ready">
              {completedSteps.includes(stepIndex) ? <CheckSquare size={16} color="#ffffff" /> : <Square size={16} color="#ffffff" />}
              <Text style={styles.doneButtonText}>Step Reviewed</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={stepIndex === WIZARD_STEPS.length - 1} onPress={() => goToStep(stepIndex + 1)} style={[styles.navButton, stepIndex === WIZARD_STEPS.length - 1 && styles.navButtonDisabled]} testID="google-earth-wizard-next">
              <Text style={[styles.navButtonText, stepIndex === WIZARD_STEPS.length - 1 && styles.navButtonTextDisabled]}>Next</Text>
            </Pressable>
          </View>

          <View style={styles.checklistBox}>
            <Text style={styles.checklistTitle}>Import Review Checklist</Text>
            {copyError ? <Text accessibilityRole="alert" style={styles.checkText}>{copyError}</Text> : null}
            {READY_CHECKLIST.map((item, index) => (
              <Pressable key={item} accessibilityRole="checkbox" accessibilityLabel={item}
                aria-checked={checkedItems.includes(index)}
                onPress={() => setCheckedItems((current) => current.includes(index) ? current.filter((entry) => entry !== index) : [...current, index])}
                style={styles.checkRow}>
                {checkedItems.includes(index) ? <Check size={14} color="#1f5f39" /> : <Square size={14} color="#6a766d" />}
                <Text selectable style={styles.checkText}>{item}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : (
        <Text style={styles.closedText}>Guides Google Earth Pro drawing names, KML/KMZ export, and import-card selection.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderColor: "#d8e0d4",
    borderRadius: 8,
    borderWidth: 1,
    flexBasis: 360,
    flexGrow: 1,
    gap: 10,
    padding: 12,
  },
  headerRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "space-between",
  },
  titleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  title: {
    color: "#17241c",
    fontSize: 14,
    fontWeight: "900",
  },
  subtitle: {
    color: "#53655a",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 2,
  },
  toggleButton: {
    backgroundColor: "#edf4eb",
    borderColor: "#c4d4c3",
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 38,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  toggleButtonText: {
    color: "#254234",
    fontSize: 12,
    fontWeight: "900",
  },
  body: {
    gap: 10,
  },
  progressRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  stepDot: {
    alignItems: "center",
    backgroundColor: "#f8faf4",
    borderColor: "#cdd8ca",
    borderRadius: 8,
    borderWidth: 1,
    height: 30,
    justifyContent: "center",
    width: 30,
  },
  stepDotActive: {
    backgroundColor: "#e9f1e7",
    borderColor: "#254234",
  },
  stepDotComplete: {
    backgroundColor: "#254234",
    borderColor: "#254234",
  },
  stepDotText: {
    color: "#405146",
    fontSize: 12,
    fontWeight: "900",
  },
  stepDotTextActive: {
    color: "#ffffff",
  },
  progressText: {
    color: "#53655a",
    fontSize: 12,
    fontWeight: "800",
    marginLeft: 4,
  },
  stepBox: {
    gap: 8,
  },
  contextBox: {
    backgroundColor: "#f8faf4",
    borderColor: "#d8e0d4",
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
  },
  contextText: {
    color: "#405146",
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17,
  },
  stepTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 7,
  },
  stepTitle: {
    color: "#17241c",
    flex: 1,
    fontSize: 14,
    fontWeight: "900",
  },
  screenshot: {
    aspectRatio: 3.45,
    backgroundColor: "#0c100e",
    borderColor: "#d8e0d4",
    borderRadius: 8,
    borderWidth: 1,
    width: "100%",
  },
  bulletText: {
    color: "#26372c",
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17,
  },
  exampleGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  exampleToken: {
    alignItems: "center",
    backgroundColor: "#f8faf4",
    borderColor: "#cdd8ca",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 5,
    minHeight: 32,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  exampleText: {
    color: "#254234",
    fontFamily: "monospace",
    fontSize: 12,
    fontWeight: "800",
  },
  copyStatus: {
    color: "#1f5f39",
    fontSize: 12,
    fontWeight: "800",
  },
  navigationRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  navButton: {
    alignItems: "center",
    backgroundColor: "#f1f5ee",
    borderColor: "#cdd8ca",
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 38,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  navButtonDisabled: {
    opacity: 0.45,
  },
  navButtonText: {
    color: "#254234",
    fontSize: 12,
    fontWeight: "900",
  },
  navButtonTextDisabled: {
    color: "#6a766d",
  },
  doneButton: {
    alignItems: "center",
    backgroundColor: "#254234",
    borderColor: "#254234",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 7,
    minHeight: 38,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  doneButtonText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "900",
  },
  checklistBox: {
    backgroundColor: "#f8faf4",
    borderColor: "#d8e0d4",
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
    padding: 10,
  },
  checklistTitle: {
    color: "#405146",
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  checkRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 7,
  },
  checkText: {
    color: "#26372c",
    flex: 1,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17,
  },
  closedText: {
    color: "#53655a",
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17,
  },
});
