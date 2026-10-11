import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { PivotProjectSchema, parseFieldLayoutTarget, qualifyProjectCrs, metersToFeet, isRecordedReferenceMetadataRecord,
  surveyPurposeGeometryType, type SurveyCollectionPurpose, type XY } from "@cplayout/core";
import type { useWorkspaceController } from "./useWorkspaceController";
import { serializeWorkspaceEditable } from "./workspaceDocumentAdapters";
import { workspaceRecoveryStableJson } from "./workspaceEditRecovery";
import { useWorkspaceRecoveryParticipant, type WorkspaceRecoveryParts } from "./workspaceRecoveryParticipants";

type Controller = ReturnType<typeof useWorkspaceController>;
export interface WorkspaceChoice { readonly id: string; readonly label: string }
export function WorkspaceSelect({ label, value, choices, onChange, disabled = false, testID, canEdit, onDisclosureChange }: {
  label: string; value: string; choices: readonly WorkspaceChoice[]; onChange: (value: string) => void; disabled?: boolean; testID?: string;
  canEdit?: () => boolean; onDisclosureChange?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return <View style={styles.group}><Text style={styles.label}>{label}</Text>
    {Platform.OS === "web" ? React.createElement("select", { "aria-label": label, value, disabled,
      "data-testid": testID, onChange: (event: React.ChangeEvent<HTMLSelectElement>) => onChange(event.target.value),
      style: { width: "100%", minHeight: 38, padding: 8, border: "1px solid #a8b9aa", borderRadius: 5, color: "#254234", background: "#fff" } },
      choices.map(choice => React.createElement("option", { key: choice.id, value: choice.id }, choice.label)))
      : <><Pressable accessibilityRole="button" accessibilityState={{ expanded: open, disabled }} disabled={disabled}
        testID={testID} style={styles.button} onPress={() => { if (disabled || canEdit?.() === false) return; setOpen(value => !value); onDisclosureChange?.(); }}><Text>{choices.find(choice => choice.id === value)?.label ?? "Choose…"}</Text></Pressable>
        {open && choices.map(choice => <Pressable key={choice.id} accessibilityRole="button" style={styles.button}
          onPress={() => { if (disabled || canEdit?.() === false) return; onChange(choice.id); setOpen(false); }}><Text>{choice.label}</Text></Pressable>)}</>}
  </View>;
}
export function WorkspaceButton({ label, onPress, disabled = false, testID }: { label: string; onPress: () => void; disabled?: boolean; testID?: string }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    testID={testID} style={[styles.button, disabled && { opacity: 0.5 }]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
}
function coordinate(point: XY, projectCrs: string): string {
  const unit = qualifyProjectCrs(projectCrs).unit;
  if (unit === "metre") return `E ${metersToFeet(point.x).toFixed(2)} ft · N ${metersToFeet(point.y).toFixed(2)} ft`;
  return `X ${point.x.toFixed(3)} · Y ${point.y.toFixed(3)} (${unit ?? "unconfirmed coordinate units"})`;
}
export function surveyPurposeLabel(purpose: SurveyCollectionPurpose): string {
  return purpose.kind === "point" ? `Point · ${purpose.role.replaceAll("_", " ")}`
    : purpose.kind === "field_boundary" ? "Field boundary"
      : purpose.kind === "obstacle" ? `Obstacle · ${purpose.obstacleKind}`
        : `${purpose.geometryType === "LineString" ? "Line" : purpose.geometryType === "Polygon" ? "Area" : "Point"} · ${purpose.featureKind.replaceAll("_", " ")}`;
}
/** Schema probes select available UI choices only. They are never field geometry,
 * saved observations, projected source data or a manufactured complete project. */
export function workspaceSurveyPurposes(): SurveyCollectionPurpose[] {
  const feature = PivotProjectSchema.shape.mapFeatures.unwrap().unwrap().element;
  const purposes: SurveyCollectionPurpose[] = [
    ...PivotProjectSchema.shape.surveyPoints.element.shape.role.options.map(role => ({ kind: "point" as const, role })),
    { kind: "field_boundary" },
    ...PivotProjectSchema.shape.obstacles.element.shape.kind.options.map(obstacleKind => ({ kind: "obstacle" as const, obstacleKind })),
  ];
  for (const featureKind of feature.shape.kind.options) for (const geometryType of ["Point", "LineString", "Polygon"] as const) {
    const geometry = geometryType === "Point" ? { type: geometryType, point: { x: 0, y: 0 } }
      : { type: geometryType, vertices: geometryType === "Polygon" ? [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] : [{ x: 0, y: 0 }, { x: 1, y: 0 }] };
    if (feature.safeParse({ id: "capability-probe", name: "Capability probe", kind: featureKind, geometry, confidence: "user_estimated" }).success) {
      purposes.push({ kind: "map_feature", featureKind, geometryType });
    }
  }
  return purposes;
}
const purposes = workspaceSurveyPurposes();
function referenceBaseline(editable: Controller["state"]["editable"], selected: Controller["selectedCollection"]) {
  const isReference = selected?.purpose.kind === "map_feature" && selected.purpose.featureKind.startsWith("reference_");
  const metadata = editable?.kind === "draft" ? editable.editor.draft.drawingMetadata
    : editable?.kind === "field" ? editable.editor.field.drawingMetadata : editable?.editor.project.drawingMetadata;
  const record = metadata?.records.find(item => isRecordedReferenceMetadataRecord(item)
    && item.attachment?.collectionId === selected?.id && item.attachment?.applicationId === selected?.applications.at(-1)?.id);
  return record && isRecordedReferenceMetadataRecord(record) ? { name: record.meaning.name, notes: record.meaning.notes ?? "" }
    : { name: isReference && selected?.purpose.kind === "map_feature" ? selected.purpose.featureKind.replaceAll("_", " ").replace(/^./, value => value.toUpperCase()) : "", notes: "" };
}
function recoveryPart<T>(value: T, text: readonly string[], flags: readonly string[]): T {
  const detached: unknown = JSON.parse(workspaceRecoveryStableJson(value));
  if (!detached || typeof detached !== "object" || Array.isArray(detached)
    || Object.keys(detached).length !== text.length + flags.length
    || text.some(key => typeof (detached as Record<string, unknown>)[key] !== "string")
    || flags.some(key => typeof (detached as Record<string, unknown>)[key] !== "boolean")) throw new Error("Recovery controls have unsupported or missing values.");
  return detached as T;
}
function editableRecoveryKey(editable: Controller["state"]["editable"]): string {
  return editable ? workspaceRecoveryStableJson([editable.identity, editable.sourceDocument, editable.designRevision, serializeWorkspaceEditable(editable)]) : "null";
}
export function WorkspaceSurveyPanel({ controller }: { controller: Controller }) {
  const [purposeId, setPurposeId] = useState(JSON.stringify({ kind: "point", role: "control" }));
  const purposeRef = useRef(purposeId); purposeRef.current = purposeId;
  const latestController = useRef(controller); latestController.current = controller;
  const eventOwner = useRef<object>({}), recoveryGeneration = useRef(0), mounted = useRef(true);
  const renderedRecoveryGeneration = recoveryGeneration.current;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  function changed() { eventOwner.current = {}; latestController.current.recoveryParticipants?.notifyChanged(); }
  function canEdit() { return latestController.current.recoveryParticipants?.canEdit() !== false; }
  const [label, setLabel] = useState(""); const labelRef = useRef(label); labelRef.current = label;
  const labelEpoch = useRef(0);
  const documentGeneration = controller.state.presentation.documentGeneration;
  const interactionKey = controller.interactionKey;
  function setLabelInput(value: string) {
    if (!ownsSurveyInput()) return;
    labelEpoch.current++; labelRef.current = value; setLabel(value);
    controller.setPendingInteractionInput("survey-label", value.length > 0, true);
    changed();
  }
  const identity = controller.state.editable?.identity;
  const selected = controller.selectedCollection;
  const isReference = selected?.purpose.kind === "map_feature" && selected.purpose.featureKind.startsWith("reference_");
  const editable = controller.state.editable;
  const drawingMetadata = editable?.kind === "draft" ? editable.editor.draft.drawingMetadata
    : editable?.kind === "field" ? editable.editor.field.drawingMetadata : editable?.editor.project.drawingMetadata;
  const applicationId = selected?.applications.at(-1)?.id;
  const referenceRecord = drawingMetadata?.records.find(record => isRecordedReferenceMetadataRecord(record)
    && record.attachment?.collectionId === selected?.id && record.attachment?.applicationId === applicationId);
  const baselineReference = referenceBaseline(editable, selected);
  const [reference, setReference] = useState(baselineReference);
  const referenceRef = useRef(reference); referenceRef.current = reference;
  const referenceOwner = useRef({ documentGeneration, collectionId: selected?.id, generation: 0, epoch: 0,
    baseline: baselineReference });
  const renderedReferenceGeneration = referenceOwner.current.generation;
  const referenceSubmission = useRef<{ documentGeneration: number; collectionId: string; epoch: number; value: typeof reference } | null>(null);
  const [referenceDetails, setReferenceDetails] = useState(false);
  const detailsRef = useRef(referenceDetails); detailsRef.current = referenceDetails;
  const renderedReferenceCollection = selected?.id;
  function ownsSurveyInput() {
    const current = controller.stateRef.current;
    return mounted.current && canEdit() && recoveryGeneration.current === renderedRecoveryGeneration
      && current.presentation.documentGeneration === documentGeneration && current.presentation.mode === "survey"
      && JSON.stringify([current.presentation.documentGeneration, current.presentation.interactionGeneration]) === interactionKey;
  }
  function ownsReferenceInput() {
    const current = controller.stateRef.current;
    return ownsSurveyInput() && current.presentation.documentGeneration === documentGeneration && current.presentation.mode === "survey"
      && JSON.stringify([current.presentation.documentGeneration, current.presentation.interactionGeneration]) === interactionKey
      && referenceOwner.current.collectionId === renderedReferenceCollection
      && referenceOwner.current.generation === renderedReferenceGeneration
      && controller.getSelectedCollectionId() === renderedReferenceCollection;
  }
  function referencePending(value: typeof reference) {
    const baseline = referenceOwner.current.baseline;
    return value.name !== baseline.name || value.notes !== baseline.notes;
  }
  function changeReference(key: "name" | "notes", value: string) {
    if (!ownsReferenceInput()) return;
    const next = { ...referenceRef.current, [key]: value };
    referenceOwner.current.epoch++; referenceRef.current = next; setReference(next);
    controller.setPendingInteractionInput("survey-reference", referencePending(next), true);
    changed();
  }
  function discardReference() {
    if (!ownsReferenceInput()) return;
    referenceOwner.current.epoch++; const next = { ...referenceOwner.current.baseline };
    referenceRef.current = next; setReference(next); controller.setPendingInteractionInput("survey-reference", false, true);
    changed();
  }
  useEffect(() => {
    const owner = referenceOwner.current;
    const next = baselineReference;
    const replaced = owner.documentGeneration !== documentGeneration || owner.collectionId !== selected?.id;
    const changed = owner.baseline.name !== next.name || owner.baseline.notes !== next.notes;
    if (!replaced && !changed) return;
    const submitted = referenceSubmission.current;
    const acknowledged = submitted?.documentGeneration === documentGeneration && submitted.collectionId === selected?.id
      && submitted.value.name === next.name && submitted.value.notes === next.notes;
    const clean = referenceRef.current.name === owner.baseline.name && referenceRef.current.notes === owner.baseline.notes;
    if (replaced || clean || acknowledged && submitted!.epoch === owner.epoch) {
      referenceRef.current = next; setReference(next);
    }
    referenceOwner.current = { documentGeneration, collectionId: selected?.id, generation: owner.generation + (replaced ? 1 : 0),
      epoch: owner.epoch + (replaced ? 1 : 0), baseline: next };
    if (replaced) { detailsRef.current = false; setReferenceDetails(false); }
    if (replaced || acknowledged) referenceSubmission.current = null;
    controller.setPendingInteractionInput("survey-reference", isReference && referencePending(referenceRef.current));
    controller.recoveryParticipants?.refresh();
  }, [documentGeneration, selected?.id, baselineReference.name, baselineReference.notes]);
  useEffect(() => { controller.setPendingInteractionInput("survey-reference", isReference && referencePending(reference)); }, [reference, isReference, controller.setPendingInteractionInput]);
  async function apply() {
    if (!ownsReferenceInput() || !selected) return;
    const submitted = { ...referenceRef.current }, epoch = referenceOwner.current.epoch;
    const submission = { documentGeneration, collectionId: selected.id, epoch, value: submitted };
    referenceSubmission.current = submission;
    changed();
    const accepted = await controller.applySurvey(isReference ? { name: submitted.name, ...(submitted.notes === "" ? {} : { notes: submitted.notes }) } : undefined);
    if (!accepted) { if (referenceSubmission.current === submission) referenceSubmission.current = null; return; }
    if (!ownsReferenceInput()) return;
    referenceOwner.current.baseline = submitted;
    if (referenceOwner.current.epoch === epoch) { referenceRef.current = submitted; setReference(submitted); }
    controller.setPendingInteractionInput("survey-reference", referencePending(referenceRef.current));
  }
  const crs = identity?.projectCrs;
  const gate = crs ? controller.receiver.collectionGate(crs) : null;
  const versionReady = controller.repository.workspaceVersion === "cplayout-workspace-v4";
  const alreadyCollected = !!selected && !!controller.receiver.getSnapshot().observation
    && selected.observations.some(point => point.captureEvidence?.observationId === controller.receiver.getSnapshot().observation?.id);
  // Refusal remains until the checked Core/store contract is integrated.
  const referenceSupported = controller.referenceApplicationSupported;
  useEffect(() => { controller.setPendingInteractionInput("survey-label", label.length > 0); }, [label, controller.setPendingInteractionInput]);
  async function collect() {
    if (!ownsSurveyInput()) return;
    const entered = labelRef.current;
    const epoch = labelEpoch.current;
    changed();
    if (await controller.collectSurvey(entered) && labelEpoch.current === epoch && labelRef.current === entered
      && controller.stateRef.current.presentation.documentGeneration === documentGeneration && ownsSurveyInput()) {
      labelEpoch.current++; labelRef.current = ""; setLabel(""); controller.setPendingInteractionInput("survey-label", false);
    }
  }
  useWorkspaceRecoveryParticipant(controller.recoveryParticipants, "survey", {
    capture: () => ({ purposeId: purposeRef.current, label: labelRef.current, referenceName: referenceRef.current.name,
      referenceNotes: referenceRef.current.notes, referenceBaselineName: referenceOwner.current.baseline.name,
      referenceBaselineNotes: referenceOwner.current.baseline.notes, referenceDetails: detailsRef.current }),
    stage(value, target) {
      const next = recoveryPart<WorkspaceRecoveryParts["survey"]>(value,
        ["purposeId", "label", "referenceName", "referenceNotes", "referenceBaselineName", "referenceBaselineNotes"], ["referenceDetails"]);
      if (!purposes.some(purpose => JSON.stringify(purpose) === next.purposeId)) throw new Error("Recovered Survey purpose is unavailable.");
      const selectedId = target.admission.staged.context.workspace.collectionId;
      const selected = target.admission.collections.find(item => item.id === selectedId) ?? null;
      const baseline = referenceBaseline(target.admission.editable, selected);
      if (next.referenceBaselineName !== baseline.name || next.referenceBaselineNotes !== baseline.notes)
        throw new Error("Recovered reference details have a different current source baseline.");
      const token = eventOwner.current, source = { ...latestController.current.stateRef.current.presentation };
      const sourceKey = () => workspaceRecoveryStableJson([editableRecoveryKey(latestController.current.stateRef.current.editable),
        latestController.current.getSelectedCollectionId(), latestController.current.stateRef.current.collections]);
      const stagedSource = sourceKey();
      let consumed = false;
      return { isCurrent: () => mounted.current && eventOwner.current === token
        && latestController.current.stateRef.current.presentation.documentGeneration === source.documentGeneration
        && latestController.current.stateRef.current.presentation.interactionGeneration === source.interactionGeneration && sourceKey() === stagedSource,
        consume(delivery) {
          const current = latestController.current, state = current.stateRef.current;
          if (consumed || !mounted.current || eventOwner.current !== token || !delivery.isCurrent()
            || state.presentation.documentGeneration !== delivery.target.documentGeneration
            || workspaceRecoveryStableJson(delivery.target.admission.ui.survey) !== workspaceRecoveryStableJson(next)
            || current.getSelectedCollectionId() !== selectedId
            || editableRecoveryKey(state.editable) !== editableRecoveryKey(target.admission.editable)
            || workspaceRecoveryStableJson(state.collections) !== workspaceRecoveryStableJson(target.admission.collections)) throw new Error("Recovered Survey controls belong to an earlier source.");
          consumed = true; recoveryGeneration.current++; eventOwner.current = {}; labelEpoch.current++;
          purposeRef.current = next.purposeId; labelRef.current = next.label;
          referenceRef.current = { name: next.referenceName, notes: next.referenceNotes }; detailsRef.current = next.referenceDetails;
          referenceOwner.current = { documentGeneration: state.presentation.documentGeneration, collectionId: selectedId ?? undefined,
            generation: referenceOwner.current.generation + 1, epoch: referenceOwner.current.epoch + 1, baseline };
          referenceSubmission.current = null;
          setPurposeId(next.purposeId); setLabel(next.label); setReference(referenceRef.current); setReferenceDetails(next.referenceDetails);
          current.setPendingInteractionInput("survey-label", next.label.length > 0);
          current.setPendingInteractionInput("survey-reference", selected?.purpose.kind === "map_feature"
            && selected.purpose.featureKind.startsWith("reference_") && (next.referenceName !== baseline.name || next.referenceNotes !== baseline.notes));
        } };
    },
  });
  function surveyAction(action: () => void) { if (!ownsSurveyInput()) return; action(); changed(); }
  const blocked = controller.busy || !canEdit();
  return <View style={styles.panel} testID="unified-survey-panel">
    <Text style={styles.heading}>Record your field</Text>
    <Text style={styles.help}>Collect receiver positions into a saved point, line or area. Apply a recorded shape when it is ready.</Text>
    {!identity?.designId ? <Text style={styles.help}>Open a saved design associated with a field to collect Survey work.</Text> : <>
      {!versionReady ? <><Text style={styles.help}>Enable saved Survey collections for this workspace. Existing designs and recovery sources are retained.</Text>
        <WorkspaceButton label="Enable saved Survey collections" disabled={blocked} testID="survey-enable" onPress={() => surveyAction(() => { void controller.enableSurvey(); })} /></>
        : <>
          <WorkspaceSelect label="New collection purpose" value={purposeId} testID="survey-purpose" disabled={blocked} canEdit={ownsSurveyInput} onDisclosureChange={changed}
            choices={purposes.map(purpose => ({ id: JSON.stringify(purpose), label: surveyPurposeLabel(purpose) }))} onChange={value => {
              if (!ownsSurveyInput() || !purposes.some(purpose => JSON.stringify(purpose) === value)) return;
              purposeRef.current = value; setPurposeId(value); changed();
            }} />
          <WorkspaceButton label="Start new collection" disabled={blocked || !crs} testID="survey-start" onPress={() => {
            if (!ownsSurveyInput()) return;
            const chosen = purposes.find(purpose => JSON.stringify(purpose) === purposeRef.current);
            if (chosen) { void controller.startSurvey(chosen); changed(); }
          }} />
          {controller.state.collections.length > 0 && <WorkspaceSelect label="Saved collections" value={controller.selectedCollectionId ?? ""}
            disabled={blocked} testID="survey-collection" canEdit={ownsSurveyInput} onDisclosureChange={changed} choices={[{ id: "", label: "Choose a collection" }, ...controller.state.collections.map(item => ({
              id: item.id, label: `${surveyPurposeLabel(item.purpose)} · ${item.observations.length} recorded · ${item.state}`,
            }))]} onChange={id => { if (id && ownsSurveyInput()) { controller.selectCollection(id); changed(); } }} />}
          {selected && <View style={styles.card}>
            <Text style={styles.label}>{surveyPurposeLabel(selected.purpose)}</Text>
            <Text style={styles.help}>{selected.observations.length} saved observations · {selected.activePointIds.length} active vertices · {selected.state}</Text>
            <Text style={styles.help} testID="survey-readiness">{controller.busy ? "Saving recorded work…" : alreadyCollected ? "This receiver position is already recorded. Wait for the next position."
              : gate?.accepted ? "Ready to collect — RTK Fixed, receiver reported" : gate?.reason ?? "Declare the field coordinate system before collecting."}</Text>
            <View style={styles.group}><Text style={styles.label}>Point label (optional)</Text><TextInput accessibilityLabel="Survey point label" value={label}
              testID="survey-point-label" style={styles.input} editable={!blocked} onChangeText={setLabelInput} /></View>
            <Text style={styles.help}>Leave the label blank to use Observation {selected.observations.length + 1} automatically.</Text>
            <WorkspaceButton label="Collect position" testID="survey-collect" disabled={blocked || !gate?.accepted || alreadyCollected || selected.state !== "pending"
              || (surveyPurposeGeometryType(selected.purpose) === "Point" && selected.activePointIds.length > 0)} onPress={() => { void collect(); }} />
            <View style={styles.row}>
              <WorkspaceButton label="Remove last vertex" disabled={blocked || !selected.activePointIds.length} onPress={() => surveyAction(() => { void controller.changeMembership("remove_last"); })} />
              <WorkspaceButton label="Clear active shape" disabled={blocked || !selected.activePointIds.length} onPress={() => surveyAction(() => { void controller.changeMembership("clear"); })} />
            </View>
            {isReference && <View style={styles.group}>
              {referenceRecord && isRecordedReferenceMetadataRecord(referenceRecord) && <Text style={styles.help} testID="survey-reference-provenance">{referenceRecord.binding === "recorded"
                ? "Recorded Survey reference — original observations retained."
                : "Edited reference geometry — original Survey observations retained."}</Text>}
              <WorkspaceButton label={referenceDetails ? "Hide reference details" : "Reference name & notes (optional)"} disabled={blocked} testID="survey-reference-details" onPress={() => {
                if (!ownsReferenceInput()) return; detailsRef.current = !detailsRef.current; setReferenceDetails(detailsRef.current); changed();
              }} />
              {referenceDetails && <>
                <Text style={styles.label}>Reference name</Text><TextInput accessibilityLabel="Reference name" testID="survey-reference-name" style={styles.input} value={reference.name}
                  editable={!blocked} onChangeText={value => changeReference("name", value)} />
                <Text style={styles.label}>Notes (optional)</Text><TextInput accessibilityLabel="Reference notes" testID="survey-reference-notes" style={styles.input} value={reference.notes} multiline
                  editable={!blocked} onChangeText={value => changeReference("notes", value)} />
                <WorkspaceButton label="Discard reference details" testID="survey-reference-discard" disabled={blocked || !referencePending(reference)} onPress={discardReference} />
              </>}
            </View>}
            {selected.purpose.kind !== "point" && <WorkspaceButton label="Apply recorded shape" testID="survey-apply"
              disabled={blocked || isReference && (!referenceSupported || !reference.name.trim()) || selected.state !== "pending" || !selected.activePointIds.length} onPress={() => { void apply(); }} />}
            {isReference && !referenceSupported && <Text style={styles.help}>Reference observations are saved. Applying a reference feature requires the recorded-reference document support currently being added; your recorded evidence is retained.</Text>}
            {selected.observations.map(point => <View key={point.id} style={styles.record}>
              <Text style={styles.label}>{point.label || point.role.replaceAll("_", " ")}</Text><Text style={styles.help}>{coordinate(point.projected, selected.owner.projectCrs)}</Text>
              <Text style={styles.help}>{point.observedAt} · {point.captureEvidence?.schemaVersion === "gnss-operational-fixed-v1" ? point.captureEvidence.gga.sentenceIdentifier : "Historical observation"}</Text>
            </View>)}
          </View>}
        </>}
    </>}
  </View>;
}

export interface WorkspaceLayoutPanelHandle {
  save(): Promise<boolean>;
  showDetails(section: "name" | "copy"): void;
}
export const WorkspaceLayoutPanel = forwardRef<WorkspaceLayoutPanelHandle, { controller: Controller }>(function WorkspaceLayoutPanel({ controller }, ref) {
  const latestController = useRef(controller); latestController.current = controller;
  const eventOwner = useRef<object>({}), recoveryGeneration = useRef(0), mounted = useRef(true);
  const renderedRecoveryGeneration = recoveryGeneration.current;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  function canEdit() { return latestController.current.recoveryParticipants?.canEdit() !== false; }
  function changed() { eventOwner.current = {}; latestController.current.recoveryParticipants?.notifyChanged(); }
  const session = controller.state.layout?.session;
  const [name, setName] = useState(session?.name ?? "Layout session");
  const [label, setLabel] = useState(""); const labelRef = useRef(label); labelRef.current = label;
  const [copyName, setCopyName] = useState("");
  const [details, setDetails] = useState(false);
  const detailsRef = useRef(details); detailsRef.current = details;
  const [copyReceipt, setCopyReceipt] = useState<{ id: string; sessionId: string; targetHash: string; documentGeneration: number } | null>(null);
  const nameRef = useRef(name); nameRef.current = name;
  const nameEpoch = useRef(0), labelEpoch = useRef(0), copyEpoch = useRef(0);
  const copyNameRef = useRef(copyName); copyNameRef.current = copyName;
  const documentGeneration = controller.state.presentation.documentGeneration;
  const interactionKey = controller.interactionKey;
  const panelRef = useRef<View>(null), nameInputRef = useRef<TextInput>(null), copyInputRef = useRef<TextInput>(null);
  const focusRequest = useRef<{ section: "name" | "copy"; isCurrent: () => boolean } | null>(null);
  const [, requestFocusRender] = useState(0);
  const nameBaseline = useRef({ documentGeneration, sessionId: session?.id, name: session?.name ?? "Layout session" });
  const nameSubmission = useRef<{ documentGeneration: number; sessionId: string | undefined; epoch: number; text: string } | null>(null);
  function ownsInput() {
    const presentation = controller.stateRef.current.presentation;
    return mounted.current && canEdit() && recoveryGeneration.current === renderedRecoveryGeneration
      && presentation.mode === "layout" && presentation.documentGeneration === documentGeneration && controller.stateRef.current.layout?.session.id === session?.id
      && JSON.stringify([presentation.documentGeneration, presentation.interactionGeneration]) === interactionKey;
  }
  function ownsRenderedSession() {
    const current = controller.stateRef.current.layout?.session;
    return ownsInput() && !!session && !!current && current.targetDocument === session.targetDocument
      && current.targetHash === session.targetHash && current.revision === session.revision;
  }
  function labelInput(value: string) { if (!ownsInput()) return; labelEpoch.current++; labelRef.current = value; setLabel(value); controller.setPendingInteractionInput("layout-label", value.length > 0, true); changed(); }
  function nameInput(value: string) {
    if (!ownsInput() || controller.stateRef.current.layout?.session.name !== session?.name) return;
    nameEpoch.current++; nameRef.current = value; setName(value);
    controller.setPendingInteractionInput("layout-name", value !== (controller.stateRef.current.layout?.session.name ?? "Layout session"), true);
    changed();
  }
  function copyInput(value: string) { if (!ownsInput()) return; copyEpoch.current++; copyNameRef.current = value; setCopyName(value); controller.setPendingInteractionInput("layout-copy-name", value.length > 0, true); changed(); }
  async function submitName(create: boolean): Promise<boolean> {
    if (!ownsInput() || controller.replacementGuard().busy || !create && !ownsRenderedSession()) return false;
    changed();
    const submitted = { documentGeneration, sessionId: session?.id, epoch: nameEpoch.current, text: nameRef.current };
    if (!submitted.text.trim()) {
      controller.reportError(new Error("Enter a Layout session name before saving."));
      return false;
    }
    // This predicate binds the literal rendered session/source, not the name
    // epoch: a submitted A may commit while newer B remains entered and pending.
    if (!create && submitted.text === session!.name) return controller.acknowledgeLayoutSession(ownsRenderedSession);
    nameSubmission.current = submitted;
    const accepted = await (create ? controller.createLayoutSession(submitted.text) : controller.renameLayout(submitted.text, ownsRenderedSession));
    if (!accepted && nameSubmission.current === submitted) nameSubmission.current = null;
    return accepted;
  }
  function focusDetailsInput() {
    const request = focusRequest.current;
    if (!request) return;
    if (!request.isCurrent()) { focusRequest.current = null; return; }
    const input = request.section === "name" ? nameInputRef.current : copyInputRef.current;
    if (!input) return;
    if (Platform.OS === "web") {
      const panel = panelRef.current as unknown as HTMLElement | null;
      const node = input as unknown as HTMLInputElement;
      // Hidden retained panels must neither take focus nor consume the request
      // before the common tools surface has become visible.
      if (!panel?.isConnected || !panel.getClientRects().length || !node.isConnected || !node.getClientRects().length || node.disabled) return;
    }
    input.focus(); focusRequest.current = null;
  }
  useImperativeHandle(ref, () => ({
    save: () => submitName(false),
    showDetails(section) {
      if (!ownsRenderedSession()) return;
      focusRequest.current = { section, isCurrent: ownsRenderedSession };
      detailsRef.current = true; setDetails(true); requestFocusRender(value => value + 1); changed();
    },
  }));
  useEffect(() => { focusDetailsInput(); });
  useEffect(() => {
    const nextName = session?.name ?? "Layout session", previous = nameBaseline.current;
    const replacedDocument = previous.documentGeneration !== documentGeneration;
    const submitted = nameSubmission.current;
    const acknowledged = !!submitted && submitted.documentGeneration === documentGeneration && submitted.text.trim() === nextName
      && (submitted.sessionId === session?.id || submitted.sessionId === undefined && previous.sessionId === undefined && !!session);
    const newerInput = acknowledged && nameEpoch.current !== submitted!.epoch;
    // A saved name is a new clean baseline. Keep newer text entered while the
    // command awaited persistence, including the first same-field Layout Open.
    if (replacedDocument || !newerInput && (acknowledged || nameRef.current === previous.name || nameRef.current === nextName)) {
      nameRef.current = nextName; setName(nextName);
    }
    nameBaseline.current = { documentGeneration, sessionId: session?.id, name: nextName };
    controller.setPendingInteractionInput("layout-name", nameRef.current !== nextName);
    if (acknowledged || replacedDocument) nameSubmission.current = null;
    if (replacedDocument) {
      nameEpoch.current++; labelEpoch.current++; copyEpoch.current++;
      labelRef.current = ""; copyNameRef.current = ""; setLabel(""); setCopyName("");
      setCopyReceipt(null); detailsRef.current = false; setDetails(false); focusRequest.current = null;
    }
    controller.recoveryParticipants?.refresh();
  }, [documentGeneration, session?.id, session?.name, session?.revision]);
  useEffect(() => { controller.setPendingInteractionInput("layout-label", label.length > 0); }, [label, controller.setPendingInteractionInput]);
  useEffect(() => { controller.setPendingInteractionInput("layout-name", name !== (session?.name ?? "Layout session")); }, [name, session?.name, controller.setPendingInteractionInput]);
  useEffect(() => { controller.setPendingInteractionInput("layout-copy-name", copyName.length > 0); }, [copyName, controller.setPendingInteractionInput]);
  const target = session ? parseFieldLayoutTarget(session.targetDocument) : null;
  const gate = target ? controller.receiver.collectionGate(target.field.projectCrs) : null;
  const observedId = controller.receiver.getSnapshot().observation?.id;
  const alreadySaved = !!session && !!observedId && session.observations.some(item => item.evidence.observationId === observedId);
  const copiedId = copyReceipt?.documentGeneration === documentGeneration && copyReceipt.sessionId === session?.id
    && copyReceipt.targetHash === session.targetHash ? copyReceipt.id : null;
  async function collect() {
    if (!ownsInput()) return; const entered = labelRef.current, epoch = labelEpoch.current; changed();
    if (await controller.collectLayout(entered) && ownsInput() && epoch === labelEpoch.current && labelRef.current === entered) {
      labelEpoch.current++; labelRef.current = ""; setLabel(""); controller.setPendingInteractionInput("layout-label", false);
    }
  }
  useWorkspaceRecoveryParticipant(controller.recoveryParticipants, "layout", {
    capture: () => ({ name: nameRef.current, nameBaseline: nameBaseline.current.name, label: labelRef.current,
      copyName: copyNameRef.current, details: detailsRef.current }),
    stage(value, target) {
      const next = recoveryPart<WorkspaceRecoveryParts["layout"]>(value, ["name", "nameBaseline", "label", "copyName"], ["details"]);
      const session = target.admission.layout?.session ?? null, baseline = session?.name ?? "Layout session";
      if (next.nameBaseline !== baseline) throw new Error("Recovered Layout name has a different saved session baseline.");
      const token = eventOwner.current, source = { ...latestController.current.stateRef.current.presentation }; let consumed = false;
      const sourceKey = () => workspaceRecoveryStableJson(latestController.current.stateRef.current.layout?.session ?? null), stagedSource = sourceKey();
      return { isCurrent: () => mounted.current && eventOwner.current === token
        && latestController.current.stateRef.current.presentation.documentGeneration === source.documentGeneration
        && latestController.current.stateRef.current.presentation.interactionGeneration === source.interactionGeneration && sourceKey() === stagedSource,
        consume(delivery) {
          const current = latestController.current, state = current.stateRef.current;
          if (consumed || !mounted.current || eventOwner.current !== token || !delivery.isCurrent()
            || state.presentation.documentGeneration !== delivery.target.documentGeneration
            || workspaceRecoveryStableJson(delivery.target.admission.ui.layout) !== workspaceRecoveryStableJson(next)
            || workspaceRecoveryStableJson(state.layout?.session ?? null) !== workspaceRecoveryStableJson(session)) throw new Error("Recovered Layout controls belong to an earlier session.");
          consumed = true; recoveryGeneration.current++; eventOwner.current = {}; nameEpoch.current++; labelEpoch.current++; copyEpoch.current++;
          nameRef.current = next.name; labelRef.current = next.label; copyNameRef.current = next.copyName; detailsRef.current = next.details;
          nameBaseline.current = { documentGeneration: state.presentation.documentGeneration, sessionId: session?.id, name: baseline };
          nameSubmission.current = null; focusRequest.current = null; setCopyReceipt(null);
          setName(next.name); setLabel(next.label); setCopyName(next.copyName); setDetails(next.details);
          current.setPendingInteractionInput("layout-name", next.name !== baseline);
          current.setPendingInteractionInput("layout-label", next.label.length > 0);
          current.setPendingInteractionInput("layout-copy-name", next.copyName.length > 0);
        } };
    },
  });
  function layoutAction(action: () => void) { if (!ownsInput()) return; action(); changed(); }
  const blocked = controller.busy || !canEdit();
  // A queued name Save owns its captured text; newer input remains a separate intention.
  const savedNameEditable = canEdit() && (!controller.busy || !!session
    && nameSubmission.current?.documentGeneration === documentGeneration
    && nameSubmission.current?.sessionId === session.id);
  return <View ref={panelRef} style={styles.panel} testID="unified-layout-panel" onLayout={focusDetailsInput}>
    <Text style={styles.heading}>Work from a frozen target</Text>
    <Text style={styles.help}>The target keeps its saved geometry. Receiver observations are saved separately.</Text>
    {!session ? <>
      {controller.state.editable?.kind === "project" ? <><Text style={styles.help}>Create a field design from this complete design before freezing a Layout target.</Text>
        <WorkspaceButton label="Create field design for Layout" disabled={blocked} testID="layout-create-field" onPress={() => layoutAction(() => { void controller.createFieldFromProject(); })} />
        {controller.savedFieldDesignId && <WorkspaceButton label="Open saved field design" disabled={blocked} onPress={() => layoutAction(() => { void controller.openDesign(controller.savedFieldDesignId!); })} />}</>
        : controller.state.editable?.kind === "field" ? <>
          <Text style={styles.label}>Layout session name</Text><TextInput value={name} editable={!blocked} onChangeText={nameInput} accessibilityLabel="New Layout session name" style={styles.input} />
          <WorkspaceButton label="Discard new session name" testID="layout-discard-new-name" disabled={blocked || name === "Layout session"} onPress={() => nameInput("Layout session")} />
          <WorkspaceButton label="Freeze selected machines and open Layout" testID="layout-freeze" disabled={blocked || !name.trim()} onPress={() => { void submitName(true); }} />
          <Text style={styles.help}>Choose the machine in Design and calculate its current preview before freezing.</Text>
        </> : <Text style={styles.help}>Open or complete a design, then create its field design. You can also open a saved Layout session below.</Text>}
    </> : <View style={styles.card}>
      <Text style={styles.label}>{session.name}{session.archived ? " · Archived" : ""}</Text>
      <Text style={styles.help}>Target: {target!.field.name} · Frozen revision {target!.source.inputRevision}</Text>
      <Text style={styles.help}>Machines: {target!.source.selectedMachineIds.map(id => target!.field.machines.find(machine => machine.id === id)?.configuration.name ?? id).join(", ")}</Text>
      <Text style={styles.help} testID="layout-readiness">{session.archived ? "Restore this session to collect." : controller.busy ? "Saving…" : alreadySaved ? "This receiver position is already saved. Wait for the next position."
        : gate?.accepted ? "Ready to collect — RTK Fixed, receiver reported" : gate?.reason}</Text>
      <Text style={styles.label}>Observation label (optional)</Text><TextInput accessibilityLabel="Layout observation label" value={label} editable={!blocked} testID="layout-observation-label" style={styles.input}
        onChangeText={labelInput} />
      <WorkspaceButton label="Collect Layout observation" testID="layout-collect" disabled={blocked || session.archived || !gate?.accepted || alreadySaved} onPress={() => { void collect(); }} />
      <WorkspaceButton label={details ? "Hide session details" : "Session details & actions"} disabled={blocked} onPress={() => {
        if (!ownsInput()) return; detailsRef.current = !detailsRef.current; setDetails(detailsRef.current); changed();
      }} />
      {details && <View style={styles.panel} onLayout={focusDetailsInput}>
        <Text style={styles.label}>Session name</Text><TextInput ref={nameInputRef} value={name} editable={savedNameEditable} accessibilityLabel="Layout session name" style={styles.input}
          onChangeText={nameInput} />
        <Text style={styles.help}>Use Save in the common toolbar to save the session name. Positions are saved by Collect.</Text>
        <Text style={styles.label}>Copy name</Text><TextInput ref={copyInputRef} value={copyName} editable={!blocked} onChangeText={copyInput} accessibilityLabel="Copy Layout session name" style={styles.input} />
        <WorkspaceButton label="Copy target into an empty session" disabled={blocked || !copyName.trim()} onPress={() => {
          if (!ownsInput()) return; changed();
          const entered = copyNameRef.current, epoch = copyEpoch.current;
          void controller.copyLayout(entered).then(id => { if (id && ownsInput()) {
            setCopyReceipt({ id, sessionId: session.id, targetHash: session.targetHash, documentGeneration });
            if (epoch === copyEpoch.current && copyNameRef.current === entered) { copyEpoch.current++; copyNameRef.current = ""; setCopyName(""); controller.setPendingInteractionInput("layout-copy-name", false); }
          } });
        }} />
        {copiedId && <WorkspaceButton label="Open saved session copy" disabled={blocked} onPress={() => layoutAction(() => { void controller.openLayoutSession(copiedId); })} />}
        <WorkspaceButton label={session.archived ? "Restore session" : "Archive session"} disabled={blocked} onPress={() => layoutAction(() => { void controller.archiveLayout(!session.archived); })} />
        <Text selectable style={styles.help}>Target hash: {session.targetHash}</Text>
      </View>}
      <Text style={styles.label}>{session.observations.length} saved observations</Text>
      {session.observations.map(item => <View key={item.id} style={styles.record}><Text style={styles.label}>{item.label || "Layout observation"}</Text>
        <Text style={styles.help}>{coordinate(item.projected, target!.field.projectCrs)}</Text><Text style={styles.help}>{item.capturedAt}</Text></View>)}
    </View>}
    <View style={styles.card}><Text style={styles.label}>Saved Layout sessions</Text>
      {controller.repository.layoutSessions.length === 0 && <Text style={styles.help}>No saved sessions yet.</Text>}
      {controller.repository.layoutSessions.map(item => <WorkspaceButton key={item.id} label={`${item.name}${item.archived ? " · Archived" : ""}`} disabled={blocked}
        onPress={() => layoutAction(() => { void controller.openLayoutSession(item.id); })} />)}
    </View>
  </View>;
});
const styles = StyleSheet.create({ panel: { gap: 12 }, group: { gap: 5 }, heading: { fontSize: 19, fontWeight: "700", color: "#254234" },
  label: { fontSize: 13, fontWeight: "600", color: "#254234" }, help: { fontSize: 12, color: "#526554", lineHeight: 18 },
  input: { borderWidth: 1, borderColor: "#a8b9aa", borderRadius: 5, minHeight: 38, padding: 8, backgroundColor: "#fff" },
  button: { borderWidth: 1, borderColor: "#bacabb", borderRadius: 5, paddingHorizontal: 10, paddingVertical: 10, backgroundColor: "#f5f8f3", alignSelf: "flex-start" },
  buttonText: { color: "#254234", fontWeight: "600", fontSize: 13 }, row: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  card: { borderWidth: 1, borderColor: "#d5dfd2", borderRadius: 6, padding: 10, gap: 10 }, record: { borderTopWidth: 1, borderColor: "#e0e7dd", paddingTop: 7, gap: 3 },
});
