import type { ClientRecord } from "@cplayout/project-store";
import { AlertTriangle, CheckCircle2, Database, FolderOpen, FolderPlus, Layers, Map as MapIcon, MoveRight, UserRound } from "lucide-react-native";
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { workspaceRecoveryStableJson, type WorkspaceEditRecoveryUi } from "../workspace/workspaceEditRecovery";
import type { WorkspaceRecoveryParticipants } from "../workspace/workspaceRecoveryParticipants";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";

export type ProjectCatalogDialogMode = "client" | "project" | "fieldMap" | "design";

export type CatalogFormRawState = Omit<NonNullable<WorkspaceEditRecoveryUi["catalog"]["form"]>, "kind" | "context" | "baselineFingerprint" | "defaultName">;
export interface CatalogFormRecoveryHandle { capture(): CatalogFormRawState; isBusy(): boolean }
export interface CatalogFormRecoveryDelivery {
  readonly id: string; readonly value: CatalogFormRawState; readonly isCurrent: () => boolean;
  readonly acknowledge: () => void; readonly reject: (error: Error) => void;
}
export interface CatalogFormRecoveryProps {
  recoveryHandle?: React.MutableRefObject<CatalogFormRecoveryHandle | null>;
  recoveryDelivery?: CatalogFormRecoveryDelivery | null;
  recoveryParticipants?: WorkspaceRecoveryParticipants;
  onRecoveryReady?: () => void;
  /** Admitted raw/disclosure events, after the form updates its own refs. */
  onRawInputChange?: () => void;
}
const profileFields = ["companyName", "primaryContactFirstName", "primaryContactMiddleInitial", "primaryContactLastName", "primaryContactSuffix", "email", "phone", "location", "notes"] as const;
/** Validation is detached and setter-free, including inactive local fields. */
export function validateCatalogFormRawState(value: unknown, profile: boolean): CatalogFormRawState {
  const raw = JSON.parse(workspaceRecoveryStableJson(value)) as CatalogFormRawState;
  const keys = ["name", "fieldName", "client", "detailsOpen", "errors", "error", "fieldError", "saveError"];
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).length !== keys.length || keys.some(key => !Object.hasOwn(raw, key))
    || typeof raw.name !== "string" || typeof raw.fieldName !== "string" || typeof raw.detailsOpen !== "boolean"
    || [raw.error, raw.fieldError, raw.saveError].some(error => error !== null && typeof error !== "string") || !Array.isArray(raw.errors)) throw new Error("The recovered catalog form fields are invalid.");
  const seen = new Set<string>();
  for (const error of raw.errors) {
    if (!error || Object.keys(error).length !== 2 || typeof error.field !== "string" || typeof error.message !== "string"
      || !profileFields.some(field => field === error.field) || seen.has(error.field)) throw new Error("Recovered customer errors do not belong to their actual fields.");
    seen.add(error.field);
  }
  if (profile) {
    if (!raw.client || Object.keys(raw.client).length !== profileFields.length || profileFields.some(field => typeof raw.client![field] !== "string")
      || raw.name !== "" || raw.fieldName !== "" || raw.error !== null || raw.fieldError !== null) throw new Error("The recovered customer form belongs to another form kind.");
  } else if (raw.client !== null || raw.detailsOpen || raw.errors.length) throw new Error("The recovered item form belongs to another form kind.");
  return raw;
}

function useCatalogFormRecovery(props: CatalogFormRecoveryProps, readSnapshot: () => CatalogFormRawState, profile: boolean,
  busy: () => boolean, apply: (value: CatalogFormRawState) => void, focus: (key: string, selection?: { start: number; end: number }) => void) {
  const snapshot = readSnapshot();
  const current = useRef({ props, readSnapshot, busy, apply, focus }); current.current = { props, readSnapshot, busy, apply, focus };
  const [installed, setInstalled] = useState<string | null>(null);
  const handled = useRef<string | null>(null), mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const handle: CatalogFormRecoveryHandle = { capture: () => {
      if (current.current.busy()) throw new Error("Wait for the catalog form's admitted save before checkpointing its result.");
      return validateCatalogFormRawState(current.current.readSnapshot(), profile);
    }, isBusy: () => current.current.busy() };
    if (props.recoveryHandle) props.recoveryHandle.current = handle;
    props.onRecoveryReady?.();
    return () => { mounted.current = false; if (props.recoveryHandle?.current === handle) props.recoveryHandle.current = null; };
  }, [props.recoveryHandle, profile]);
  // A keyed body has already initialized its ordinary fields before delivery.
  useEffect(() => {
    const delivery = props.recoveryDelivery;
    if (!delivery || handled.current === delivery.id) return;
    try {
      if (!delivery.isCurrent() || current.current.busy()) throw new Error("The catalog form recovery delivery was retired or is busy.");
      const value = validateCatalogFormRawState(delivery.value, profile);
      handled.current = delivery.id; current.current.apply(value); setInstalled(delivery.id);
    } catch (error) { delivery.reject(error instanceof Error ? error : new Error(String(error))); }
  }, [props.recoveryDelivery?.id, profile]);
  // Acknowledge on the later committed render containing every restored raw value.
  useEffect(() => {
    const delivery = props.recoveryDelivery;
    if (!delivery || installed !== delivery.id) return;
    if (!mounted.current || !delivery.isCurrent() || current.current.busy()) { delivery.reject(new Error("The catalog child retired or became busy before acknowledging recovery.")); return; }
    if (workspaceRecoveryStableJson(snapshot) !== workspaceRecoveryStableJson(delivery.value)) return;
    const retained = props.recoveryParticipants?.getFocus();
    if (retained) focus(retained.key, retained.selection);
    delivery.acknowledge();
  }, [installed, props.recoveryDelivery, snapshot]);
}

function focusRecoveredInput(input: React.RefObject<TextInput | null>, value: string, selection?: { start: number; end: number }) {
  input.current?.focus();
  if (!selection) return;
  const start = Math.min(value.length, Math.max(0, selection.start)), end = Math.min(value.length, Math.max(start, selection.end));
  const node = input.current as unknown as { setSelectionRange?: (start: number, end: number) => void; setNativeProps?: (props: unknown) => void } | null;
  if (node?.setSelectionRange) node.setSelectionRange(start, end); else node?.setNativeProps?.({ selection: { start, end } });
}

interface ProjectCatalogDialogProps extends CatalogFormRecoveryProps {
  feedback?: React.ReactNode;
  createButtonLabel?: string;
  createAccessibilityLabel?: string;
  allowCancelWhileSubmitting?: boolean;
  cancelButtonLabel?: string;
  contextPreview: string;
  defaultName: string;
  defaultFieldName?: string;
  helper?: string;
  mode: ProjectCatalogDialogMode;
  onCancel: () => void;
  onCreate: (name: string, initialFieldName?: string) => void | Promise<void>;
  submitting?: boolean;
  title?: string;
  visible: boolean;
}

interface CatalogItemFormProps extends Omit<ProjectCatalogDialogProps, "visible"> {
  embedded?: boolean;
  modalVisible?: boolean;
}

const dialogCopy: Record<ProjectCatalogDialogMode, {
  createLabel: string;
  helper: string;
  title: string;
}> = {
  client: {
    createLabel: "customer",
    helper: "Adds a customer for a farm, grower, or service account in the catalog rail.",
    title: "Add Customer",
  },
  project: {
    createLabel: "project",
    helper: "Creates a project with its first field. Each field keeps its saved machine designs together.",
    title: "Create Project",
  },
  fieldMap: {
    createLabel: "field",
    helper: "Adds a field to this project. Create machine designs inside the field.",
    title: "Create Field",
  },
  design: {
    createLabel: "design",
    helper: "New design draft",
    title: "Create Design",
  },
};

export function ProjectCatalogDialog({ visible, ...props }: ProjectCatalogDialogProps): React.JSX.Element {
  // The form owns state above Modal: suspending its owner's task hides only presentation.
  // The parent unmounts this wrapper when the catalog session is explicitly closed.
  return <CatalogItemForm {...props} modalVisible={visible} />;
}

export function CatalogItemForm(props: CatalogItemFormProps): React.JSX.Element {
  return <CatalogItemFormBody key={props.mode} {...props} />;
}

function CatalogItemFormBody({
  feedback,
  createButtonLabel,
  createAccessibilityLabel,
  allowCancelWhileSubmitting = false,
  cancelButtonLabel,
  contextPreview,
  defaultName,
  defaultFieldName,
  embedded = false,
  modalVisible,
  helper,
  mode,
  onCancel,
  onCreate,
  submitting = false,
  title,
  recoveryHandle, recoveryDelivery, recoveryParticipants, onRecoveryReady, onRawInputChange,
}: CatalogItemFormProps): React.JSX.Element {
  const { width } = useWindowDimensions();
  const compact = !embedded && width < 520;
  const nameRef = useRef<TextInput>(null);
  const fieldRef = useRef<TextInput>(null);
  const bodyRef = useRef<ScrollView>(null);
  const fieldOffsets = useRef({ name: 0, field: 0 });
  const [name, setName] = useState(defaultName);
  const [fieldName, setFieldName] = useState(defaultFieldName ?? "");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const submitInFlight = useRef(false);
  const [localSubmitting, setLocalSubmitting] = useState(false);
  const busy = submitting || localSubmitting || recoveryParticipants?.canEdit() === false;
  const [error, setError] = useState<string | null>(null);
  const copy = dialogCopy[mode];
  const icon = useMemo(() => catalogDialogIcon(mode), [mode]);
  const owner = useRef({ mode, token: {} });
  if (owner.current.mode !== mode) owner.current = { mode, token: {} };
  const renderedOwner = owner.current.token;
  const alive = useRef(true);
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const presentationVisible = useRef(modalVisible); presentationVisible.current = modalVisible;
  const raw = useRef<CatalogFormRawState>({ name, fieldName, client: null, detailsOpen: false, errors: [], error, fieldError, saveError });
  raw.current = { name, fieldName, client: null, detailsOpen: false, errors: [], error, fieldError, saveError };
  const canEdit = () => alive.current && owner.current.token === renderedOwner && presentationVisible.current !== false && recoveryParticipants?.canEdit() !== false;
  const changed = () => { if (onRawInputChange) onRawInputChange(); else recoveryParticipants?.notifyChanged(); };

  useCatalogFormRecovery({ recoveryHandle, recoveryDelivery, recoveryParticipants, onRecoveryReady }, () => raw.current, false,
    () => !alive.current || submitInFlight.current || submitting || localSubmitting, value => {
      owner.current.token = {}; raw.current = value; setName(value.name); setFieldName(value.fieldName);
      setError(value.error); setFieldError(value.fieldError); setSaveError(value.saveError);
    }, (key, selection) => {
      if (key === "catalog/form/name") focusRecoveredInput(nameRef, name, selection);
      else if (key === "catalog/form/fieldName" && mode === "project" && defaultFieldName !== undefined) focusRecoveredInput(fieldRef, fieldName, selection);
    });

  function cancel(): void {
    if (!canEdit() || (busy || submitInFlight.current) && !allowCancelWhileSubmitting) return;
    changed();
    onCancel();
  }

  async function submit(): Promise<void> {
    if (!canEdit() || busy || submitInFlight.current) return;
    changed();
    const submitted = raw.current;
    const trimmedName = submitted.name.trim();
    const needsField = mode === "project" && defaultFieldName !== undefined;
    setError(trimmedName ? null : "Enter a name before creating this item.");
    setFieldError(needsField && !submitted.fieldName.trim() ? "Enter a name for the first field." : null);
    if (!trimmedName || (needsField && !submitted.fieldName.trim())) {
      focusInvalidField(!trimmedName ? nameRef : fieldRef, bodyRef, !trimmedName ? fieldOffsets.current.name : fieldOffsets.current.field);
      return;
    }
    submitInFlight.current = true;
    setLocalSubmitting(true);
    setSaveError(null);
    try { await onCreate(trimmedName, needsField ? submitted.fieldName.trim() : undefined); }
    catch (failure) { setSaveError(failure instanceof Error ? failure.message : String(failure)); }
    finally { submitInFlight.current = false; setLocalSubmitting(false); }
  }

  const content = (
    <View accessibilityViewIsModal={!embedded} style={[styles.dialog, compact && styles.dialogCompact, embedded && styles.embeddedDialog]} testID="catalog-dialog">
      <View style={styles.header}>
        <View style={styles.iconBadge}>{icon}</View>
        <View style={styles.headerText}>
          <Text style={styles.title}>{title ?? copy.title}</Text>
          <Text style={styles.helper}>{helper ?? copy.helper}</Text>
        </View>
      </View>

      <ScrollView
        ref={bodyRef}
        keyboardShouldPersistTaps="handled"
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        testID="catalog-dialog-body"
      >
        {feedback}
        <Text style={styles.contextPreview} testID="catalog-dialog-context">
          {contextPreview}
        </Text>
        <View onLayout={event => { fieldOffsets.current.name = event.nativeEvent.layout.y; }} style={styles.field}>
          <Text style={styles.fieldLabel}>{mode === "project" ? "Project name (required)" : "Name (required)"}</Text>
          <TextInput
            ref={nameRef}
            editable={!busy}
            accessibilityLabel="Catalog item name"
            accessibilityHint={error ?? undefined}
            {...inputErrorAssociation(error, "catalog-dialog-error")}
            autoFocus={!embedded}
            onChangeText={(value) => {
              if (!canEdit() || busy || submitInFlight.current) return;
              raw.current = { ...raw.current, name: value, error: null };
              setName(value);
              if (error) setError(null);
              changed();
            }}
            onSubmitEditing={() => void submit()}
            returnKeyType="done"
            selectTextOnFocus
            style={[styles.input, error && styles.inputError]}
            testID="catalog-dialog-name-input"
            value={name}
            onFocus={() => { if (canEdit()) { recoveryParticipants?.recordFocus("catalog/form/name"); changed(); } }}
            onSelectionChange={event => { if (canEdit()) { recoveryParticipants?.recordFocus("catalog/form/name", event.nativeEvent.selection); changed(); } }}
          />
          {error ? <Text nativeID="catalog-dialog-error" accessibilityRole="alert" style={styles.errorText} testID="catalog-dialog-error">{error}</Text> : null}
        </View>
        {mode === "project" && defaultFieldName !== undefined && <>
          <DialogField editable={!busy} inputRef={fieldRef} onLayoutY={y => { fieldOffsets.current.field = y; }} label="First field name (required)" value={fieldName} onChangeText={text => { if (!canEdit() || busy || submitInFlight.current) return; raw.current = { ...raw.current, fieldName: text, fieldError: null }; setFieldName(text); setFieldError(null); changed(); }} error={fieldError} testID="catalog-dialog-first-field-input"
            onFocus={() => { if (canEdit()) { recoveryParticipants?.recordFocus("catalog/form/fieldName"); changed(); } }}
            onSelectionChange={event => { if (canEdit()) { recoveryParticipants?.recordFocus("catalog/form/fieldName", event.nativeEvent.selection); changed(); } }} />
          <Text style={styles.helper}>The field is a container for its boundary and saved machine designs. You can add more fields later.</Text>
        </>}
        {saveError && <Text accessibilityRole="alert" style={styles.errorText} testID="catalog-dialog-save-error">{saveError}</Text>}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          accessibilityLabel={cancelButtonLabel ?? `Cancel ${copy.createLabel} creation`}
          accessibilityRole="button"
          disabled={busy && !allowCancelWhileSubmitting}
          onPress={cancel}
          style={[styles.secondaryButton, busy && !allowCancelWhileSubmitting && styles.disabledButton]}
          testID="catalog-dialog-cancel"
        >
          <Text style={styles.secondaryButtonText}>{cancelButtonLabel ?? "Cancel"}</Text>
        </Pressable>
        <Pressable
          accessibilityLabel={createAccessibilityLabel ?? createButtonLabel ?? `Create ${copy.createLabel}`}
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void submit()}
          style={[styles.primaryButton, busy && styles.disabledButton]}
          testID="catalog-dialog-create"
        >
          <Text style={styles.primaryButtonText}>{busy ? "Working" : (createButtonLabel ?? `Create ${copy.createLabel}`)}</Text>
        </Pressable>
      </View>
    </View>
  );
  return <CatalogFormPresentation modalVisible={modalVisible} compact={compact} onCancel={cancel} backdropTestID="catalog-dialog-backdrop">{content}</CatalogFormPresentation>;
}

export interface ClientProfileDialogValue {
  companyName: string;
  primaryContactFirstName: string;
  primaryContactMiddleInitial: string;
  primaryContactLastName: string;
  primaryContactSuffix: string;
  email: string;
  phone: string;
  location: string;
  notes: string;
}

export function ClientProfileDialog({
  feedback,
  defaultDisplayName,
  initialClient,
  mode,
  onCancel,
  onSave,
  submitting = false,
  visible,
  recoveryHandle, recoveryDelivery, recoveryParticipants, onRecoveryReady, onRawInputChange,
}: {
  feedback?: React.ReactNode;
  defaultDisplayName: string;
  initialClient?: ClientRecord | null;
  mode: "create" | "edit";
  onCancel: () => void;
  onSave: (value: ClientProfileDialogValue) => void | Promise<void>;
  submitting?: boolean;
  visible: boolean;
} & CatalogFormRecoveryProps): React.JSX.Element {
  return <ClientProfileForm
    feedback={feedback}
    defaultDisplayName={defaultDisplayName}
    initialClient={initialClient}
    mode={mode}
    onCancel={onCancel}
    onSave={onSave}
    submitting={submitting}
    modalVisible={visible}
    recoveryHandle={recoveryHandle} recoveryDelivery={recoveryDelivery} recoveryParticipants={recoveryParticipants} onRecoveryReady={onRecoveryReady} onRawInputChange={onRawInputChange}
  />;
}

interface ClientProfileFormProps extends CatalogFormRecoveryProps {
  feedback?: React.ReactNode;
  defaultDisplayName: string;
  embedded?: boolean;
  modalVisible?: boolean;
  initialClient?: ClientRecord | null;
  mode: "create" | "edit";
  onCancel: () => void;
  onSave: (value: ClientProfileDialogValue) => void | Promise<void>;
  submitting?: boolean;
}

export function ClientProfileForm(props: ClientProfileFormProps): React.JSX.Element {
  return <ClientProfileFormBody key={JSON.stringify([props.mode, props.initialClient?.id ?? null])} {...props} />;
}

function ClientProfileFormBody({
  feedback,
  defaultDisplayName,
  embedded = false,
  modalVisible,
  initialClient,
  mode,
  onCancel,
  onSave,
  submitting = false,
  recoveryHandle, recoveryDelivery, recoveryParticipants, onRecoveryReady, onRawInputChange,
}: ClientProfileFormProps): React.JSX.Element {
  const { width } = useWindowDimensions();
  const compact = !embedded && width < 520;
  const firstNameRef = useRef<TextInput>(null);
  const lastNameRef = useRef<TextInput>(null);
  const bodyRef = useRef<ScrollView>(null);
  const fieldOffsets = useRef({ first: 0, last: 0 });
  const [value, setValue] = useState<ClientProfileDialogValue>(() => clientDialogValue(initialClient, defaultDisplayName));
  const [errors, setErrors] = useState<Partial<Record<keyof ClientProfileDialogValue, string>>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const submitInFlight = useRef(false);
  const [localSubmitting, setLocalSubmitting] = useState(false);
  const busy = submitting || localSubmitting || recoveryParticipants?.canEdit() === false;
  const owner = useRef({ key: `${mode}:${initialClient?.id ?? ""}`, token: {} });
  const sourceKey = `${mode}:${initialClient?.id ?? ""}`;
  if (owner.current.key !== sourceKey) owner.current = { key: sourceKey, token: {} };
  const renderedOwner = owner.current.token;
  const alive = useRef(true);
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const presentationVisible = useRef(modalVisible); presentationVisible.current = modalVisible;
  const canEdit = () => alive.current && owner.current.token === renderedOwner && presentationVisible.current !== false && recoveryParticipants?.canEdit() !== false;
  const changed = () => { if (onRawInputChange) onRawInputChange(); else recoveryParticipants?.notifyChanged(); };
  const raw = useRef<CatalogFormRawState>({ name: "", fieldName: "", client: value, detailsOpen, errors: [], error: null, fieldError: null, saveError });
  raw.current = { name: "", fieldName: "", client: value, detailsOpen,
    errors: Object.entries(errors).flatMap(([field, message]) => message === undefined ? [] : [{ field, message }]), error: null, fieldError: null, saveError };
  const otherInputs = useRef<Record<string, React.RefObject<TextInput | null>>>({});
  const inputFor = (field: keyof ClientProfileDialogValue) => field === "primaryContactFirstName" ? firstNameRef : field === "primaryContactLastName" ? lastNameRef
    : otherInputs.current[field] ?? (otherInputs.current[field] = { current: null });
  const focusProps = (field: keyof ClientProfileDialogValue) => ({
    inputRef: inputFor(field),
    onFocus: () => { if (canEdit()) { recoveryParticipants?.recordFocus(`catalog/client/${field}`); changed(); } },
    onSelectionChange: (event: { nativeEvent: { selection: { start: number; end: number } } }) => {
      if (canEdit()) { recoveryParticipants?.recordFocus(`catalog/client/${field}`, event.nativeEvent.selection); changed(); }
    },
  });

  useCatalogFormRecovery({ recoveryHandle, recoveryDelivery, recoveryParticipants, onRecoveryReady }, () => raw.current, true,
    () => !alive.current || submitInFlight.current || submitting || localSubmitting, snapshot => {
      owner.current.token = {}; raw.current = snapshot; setValue({ ...snapshot.client! });
      setErrors(Object.fromEntries(snapshot.errors.map(error => [error.field, error.message]))); setSaveError(snapshot.saveError); setDetailsOpen(snapshot.detailsOpen);
    }, (key, selection) => {
      const field = profileFields.find(field => key === `catalog/client/${field}`);
      if (field) focusRecoveredInput(inputFor(field), value[field], selection);
    });

  function cancel(): void {
    if (!canEdit() || busy || submitInFlight.current) return;
    changed();
    onCancel();
  }

  function updateField(field: keyof ClientProfileDialogValue, nextValue: string): void {
    if (!canEdit() || busy || submitInFlight.current) return;
    raw.current = { ...raw.current, client: { ...raw.current.client!, [field]: nextValue }, errors: raw.current.errors.filter(error => error.field !== field) };
    setValue((current) => ({ ...current, [field]: nextValue }));
    setErrors(current => ({ ...current, [field]: undefined }));
    changed();
  }

  async function submit(): Promise<void> {
    if (!canEdit() || busy || submitInFlight.current) return;
    changed();
    const submitted = raw.current.client!;
    const required = {
      primaryContactFirstName: submitted.primaryContactFirstName.trim() ? undefined : "Enter the contact's first name.",
      primaryContactLastName: submitted.primaryContactLastName.trim() ? undefined : "Enter the contact's last name.",
    };
    setErrors(required);
    if (required.primaryContactFirstName || required.primaryContactLastName) {
      focusInvalidField(required.primaryContactFirstName ? firstNameRef : lastNameRef, bodyRef, required.primaryContactFirstName ? fieldOffsets.current.first : fieldOffsets.current.last);
      return;
    }
    submitInFlight.current = true;
    setLocalSubmitting(true);
    setSaveError(null);
    try { await onSave({
      companyName: submitted.companyName.trim(),
      primaryContactFirstName: submitted.primaryContactFirstName.trim(),
      primaryContactMiddleInitial: submitted.primaryContactMiddleInitial.trim().replace(/\./g, "").slice(0, 1).toUpperCase(),
      primaryContactLastName: submitted.primaryContactLastName.trim(),
      primaryContactSuffix: submitted.primaryContactSuffix.trim(),
      email: submitted.email.trim(),
      phone: submitted.phone.trim(),
      location: submitted.location.trim(),
      notes: submitted.notes.trim(),
    }); }
    catch (failure) { setSaveError(failure instanceof Error ? failure.message : String(failure)); }
    finally { submitInFlight.current = false; setLocalSubmitting(false); }
  }

  const content = (
    <View accessibilityViewIsModal={!embedded} style={[styles.dialog, compact && styles.dialogCompact, embedded && styles.embeddedDialog]} testID="client-profile-dialog">
      <View style={styles.header}>
        <View style={styles.iconBadge}><UserRound size={22} color="#eef7f1" /></View>
        <View style={styles.headerText}>
          <Text style={styles.title}>{mode === "create" ? "Add Customer" : "Edit Customer"}</Text>
          <Text style={styles.helper}>Enter the primary contact. Company and contact details are optional.</Text>
        </View>
      </View>

      <ScrollView ref={bodyRef} keyboardShouldPersistTaps="handled" style={styles.body} contentContainerStyle={styles.bodyContent} testID="client-profile-dialog-body">
        {feedback}
        <DialogField editable={!busy} autoFocus={!embedded} onLayoutY={y => { fieldOffsets.current.first = y; }} label="First name (required)" {...focusProps("primaryContactFirstName")} value={value.primaryContactFirstName} onChangeText={(text) => updateField("primaryContactFirstName", text)} error={errors.primaryContactFirstName} testID="client-profile-first-name-input" />
        <DialogField editable={!busy} onLayoutY={y => { fieldOffsets.current.last = y; }} label="Last name (required)" {...focusProps("primaryContactLastName")} value={value.primaryContactLastName} onChangeText={(text) => updateField("primaryContactLastName", text)} error={errors.primaryContactLastName} testID="client-profile-last-name-input" />
        <DialogField editable={!busy} label="Company name (optional)" {...focusProps("companyName")} value={value.companyName} onChangeText={(text) => updateField("companyName", text)} testID="client-profile-company-input" />
        <Pressable accessibilityRole="button" aria-expanded={detailsOpen} accessibilityState={{ expanded: detailsOpen, disabled: busy }} disabled={busy} onPress={() => { if (canEdit() && !busy && !submitInFlight.current) { raw.current = { ...raw.current, detailsOpen: !raw.current.detailsOpen }; setDetailsOpen(open => !open); changed(); } }} style={[styles.secondaryButton, busy && styles.disabledButton]} testID="client-profile-details-toggle">
          <Text style={styles.secondaryButtonText}>{detailsOpen ? "Hide optional contact details" : "Optional contact details"}</Text>
        </Pressable>
        <View style={!detailsOpen && styles.hidden}>
        <DialogField editable={!busy} label="M.I." {...focusProps("primaryContactMiddleInitial")} value={value.primaryContactMiddleInitial} onChangeText={(text) => updateField("primaryContactMiddleInitial", text)} testID="client-profile-middle-initial-input" />
        <DialogField editable={!busy} label="Suffix" {...focusProps("primaryContactSuffix")} value={value.primaryContactSuffix} onChangeText={(text) => updateField("primaryContactSuffix", text)} testID="client-profile-suffix-input" />
        <DialogField editable={!busy} label="Email" {...focusProps("email")} value={value.email} onChangeText={(text) => updateField("email", text)} testID="client-profile-email-input" />
        <DialogField editable={!busy} label="Phone" {...focusProps("phone")} value={value.phone} onChangeText={(text) => updateField("phone", text)} testID="client-profile-phone-input" />
        <DialogField editable={!busy} label="Location" {...focusProps("location")} value={value.location} onChangeText={(text) => updateField("location", text)} testID="client-profile-location-input" />
        <DialogField editable={!busy} label="Notes" multiline {...focusProps("notes")} value={value.notes} onChangeText={(text) => updateField("notes", text)} testID="client-profile-notes-input" />
        </View>
        {saveError && <Text accessibilityRole="alert" style={styles.errorText} testID="client-profile-save-error">{saveError}</Text>}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable accessibilityRole="button" disabled={busy} onPress={cancel} style={[styles.secondaryButton, busy && styles.disabledButton]} testID="client-profile-cancel">
          <Text style={styles.secondaryButtonText}>Cancel</Text>
        </Pressable>
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => void submit()} style={[styles.primaryButton, busy && styles.disabledButton]} testID="client-profile-save">
          <Text style={styles.primaryButtonText}>{busy ? "Saving" : mode === "create" ? "Create customer" : "Save changes"}</Text>
        </Pressable>
      </View>
    </View>
  );
  return <CatalogFormPresentation modalVisible={modalVisible} compact={compact} onCancel={cancel} backdropTestID="client-profile-dialog-backdrop">{content}</CatalogFormPresentation>;
}

// Only the view subtree crosses the modal visibility boundary. Draft values, validation,
// optional-detail expansion and in-flight save state stay in the owning form above it.
function CatalogFormPresentation({ children, modalVisible, compact, onCancel, backdropTestID }: {
  children: React.ReactNode;
  modalVisible?: boolean;
  compact: boolean;
  onCancel: () => void;
  backdropTestID: string;
}): React.JSX.Element {
  if (modalVisible === undefined) return <>{children}</>;
  return (
    <Modal animationType="fade" onRequestClose={onCancel} transparent visible={modalVisible}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={[styles.backdrop, compact && styles.backdropCompact]} testID={backdropTestID}>
        {children}
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function ConfirmActionDialog({
  feedback,
  confirmLabel,
  message,
  onCancel,
  onConfirm,
  submitting = false,
  testID = "confirm-action-dialog",
  title,
  tone = "danger",
  visible,
}: {
  feedback?: React.ReactNode;
  confirmLabel: string;
  message: string;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
  submitting?: boolean;
  testID?: string;
  title: string;
  tone?: "danger" | "neutral";
  visible: boolean;
}): React.JSX.Element {
  const { width } = useWindowDimensions();
  const compact = width < 520;
  return (
    <Modal animationType="fade" onRequestClose={() => { if (!submitting) onCancel(); }} transparent visible={visible}>
      <View style={[styles.backdrop, compact && styles.backdropCompact]} testID={`${testID}-backdrop`}>
        <ConfirmActionPanel
          feedback={feedback}
          confirmLabel={confirmLabel}
          message={message}
          onCancel={onCancel}
          onConfirm={onConfirm}
          submitting={submitting}
          testID={testID}
          title={title}
          tone={tone}
        />
      </View>
    </Modal>
  );
}

export function ConfirmActionPanel({
  feedback,
  confirmLabel,
  embedded = false,
  message,
  onCancel,
  onConfirm,
  submitting = false,
  testID = "confirm-action-dialog",
  title,
  tone = "danger",
}: {
  feedback?: React.ReactNode;
  confirmLabel: string;
  embedded?: boolean;
  message: string;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
  submitting?: boolean;
  testID?: string;
  title: string;
  tone?: "danger" | "neutral";
}): React.JSX.Element {
  const { width } = useWindowDimensions();
  const compact = !embedded && width < 520;
  return (
    <View accessibilityRole="alert" accessibilityViewIsModal={!embedded} style={[styles.dialog, compact && styles.dialogCompact, embedded && styles.embeddedDialog]} testID={testID}>
      <View style={styles.header}>
        <View style={[styles.iconBadge, tone === "danger" && styles.dangerIconBadge]}><AlertTriangle size={22} color="#fff4ed" /></View>
        <View style={styles.headerText}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.helper}>{message}</Text>
        </View>
      </View>
      {feedback}
      <View style={styles.footer}>
        <Pressable accessibilityRole="button" disabled={submitting} onPress={onCancel} style={[styles.secondaryButton, submitting && styles.disabledButton]} testID={`${testID}-cancel`}>
          <Text style={styles.secondaryButtonText}>Cancel</Text>
        </Pressable>
        <Pressable accessibilityRole="button" disabled={submitting} onPress={() => void onConfirm()} style={[tone === "danger" ? styles.dangerButton : styles.primaryButton, submitting && styles.disabledButton]} testID={`${testID}-confirm`}>
          <Text style={styles.primaryButtonText}>{submitting ? "Working" : confirmLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function MoveProjectDialog({
  feedback,
  currentClientId,
  clients,
  onCancel,
  onMove,
  projectName,
  submitting = false,
  visible,
}: {
  feedback?: React.ReactNode;
  currentClientId: string;
  clients: ClientRecord[];
  onCancel: () => void;
  onMove: (clientId: string) => void | Promise<void>;
  projectName: string;
  submitting?: boolean;
  visible: boolean;
}): React.JSX.Element {
  const { width } = useWindowDimensions();
  const compact = width < 520;
  return (
    <Modal animationType="fade" onRequestClose={() => { if (!submitting) onCancel(); }} transparent visible={visible}>
      <View style={[styles.backdrop, compact && styles.backdropCompact]} testID="move-project-dialog-backdrop">
        <MoveProjectForm
          feedback={feedback}
          currentClientId={currentClientId}
          clients={clients}
          onCancel={onCancel}
          onMove={onMove}
          projectName={projectName}
          submitting={submitting}
        />
      </View>
    </Modal>
  );
}

export function MoveProjectForm({
  feedback,
  clients,
  currentClientId,
  embedded = false,
  onCancel,
  onMove,
  projectName,
  submitting = false,
}: {
  feedback?: React.ReactNode;
  currentClientId: string;
  clients: ClientRecord[];
  embedded?: boolean;
  onCancel: () => void;
  onMove: (clientId: string) => void | Promise<void>;
  projectName: string;
  submitting?: boolean;
}): React.JSX.Element {
  const { width } = useWindowDimensions();
  const compact = !embedded && width < 520;
  const targets = useMemo(() => clients.filter((client) => client.id !== currentClientId), [currentClientId, clients]);
  const [selectedClientId, setSelectedClientId] = useState(targets[0]?.id ?? "");

  useEffect(() => {
    setSelectedClientId(current => targets.some(client => client.id === current) ? current : targets[0]?.id ?? "");
  }, [targets]);

  return (
    <View accessibilityViewIsModal={!embedded} style={[styles.dialog, compact && styles.dialogCompact, embedded && styles.embeddedDialog]} testID="move-project-dialog">
      <View style={styles.header}>
        <View style={styles.iconBadge}><MoveRight size={22} color="#eef7f1" /></View>
        <View style={styles.headerText}>
          <Text style={styles.title}>Move Project</Text>
          <Text style={styles.helper}>Move {projectName} to another customer. Project geometry and archive contents are unchanged.</Text>
        </View>
      </View>
      {feedback}
      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} testID="move-project-dialog-body">
        {targets.length === 0 ? (
          <Text style={styles.errorText}>Create another customer before moving this project.</Text>
        ) : targets.map((client) => {
          const selected = selectedClientId === client.id;
          return (
            <Pressable
              accessibilityLabel={`Move to ${client.displayName}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              aria-checked={selected}
              key={client.id}
              onPress={() => setSelectedClientId(client.id)}
              style={[styles.choiceRow, selected && styles.choiceRowSelected]}
              testID={`move-project-target-${client.id}`}
            >
              {selected ? <CheckCircle2 size={18} color="#0f5e3d" /> : <FolderOpen size={18} color="#53645a" />}
              <View style={styles.choiceText}>
                <Text style={styles.choiceTitle}>{client.displayName}</Text>
                <Text style={styles.choiceMeta}>{client.location || client.contactName || "Customer"}</Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={styles.footer}>
        <Pressable accessibilityRole="button" disabled={submitting} onPress={onCancel} style={[styles.secondaryButton, submitting && styles.disabledButton]} testID="move-project-cancel">
          <Text style={styles.secondaryButtonText}>Cancel</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={submitting || !selectedClientId}
          onPress={() => selectedClientId ? void onMove(selectedClientId) : undefined}
          style={[styles.primaryButton, (submitting || !selectedClientId) && styles.disabledButton]}
          testID="move-project-confirm"
        >
          <Text style={styles.primaryButtonText}>{submitting ? "Moving" : "Move"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function DialogField({
  autoFocus = false,
  editable = true,
  error,
  inputRef,
  onLayoutY,
  label,
  multiline = false,
  onChangeText,
  onFocus, onSelectionChange,
  testID,
  value,
}: {
  autoFocus?: boolean;
  editable?: boolean;
  error?: string | null;
  inputRef?: React.RefObject<TextInput | null>;
  onLayoutY?: (y: number) => void;
  label: string;
  multiline?: boolean;
  onChangeText: (value: string) => void;
  onFocus?: () => void;
  onSelectionChange?: (event: { nativeEvent: { selection: { start: number; end: number } } }) => void;
  testID: string;
  value: string;
}): React.JSX.Element {
  return (
    <View onLayout={onLayoutY ? event => onLayoutY(event.nativeEvent.layout.y) : undefined} style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        ref={inputRef}
        autoFocus={autoFocus}
        editable={editable}
        {...inputErrorAssociation(error, `${testID}-error`)}
        accessibilityLabel={label}
        accessibilityHint={error ?? undefined}
        multiline={multiline}
        onChangeText={onChangeText} onFocus={onFocus} onSelectionChange={onSelectionChange}
        style={[styles.input, multiline && styles.textArea, error && styles.inputError]}
        testID={testID}
        value={value}
      />
      {error ? <Text nativeID={`${testID}-error`} style={styles.errorText} testID={`${testID}-error`} accessibilityRole="alert">{error}</Text> : null}
    </View>
  );
}

// React Native uses the hint; React Native Web exposes the matching inline message.
function inputErrorAssociation(error: string | null | undefined, errorId: string) {
  return Platform.OS === "web" ? { "aria-invalid": Boolean(error), "aria-describedby": error ? errorId : undefined } : {};
}

function focusInvalidField(input: React.RefObject<TextInput | null>, body: React.RefObject<ScrollView | null>, offset: number): void {
  if (Platform.OS === "web") {
    const requestedInput = input.current;
    // Validation can remove a preceding error without resizing this field. Web onLayout
    // observes size, so its cached y may be stale. Measure after React commits the errors.
    requestAnimationFrame(() => {
      if (input.current !== requestedInput) return;
      const target = input.current as unknown as HTMLElement | null;
      const scrollNode = body.current?.getScrollableNode() as HTMLElement | null;
      const field = target?.parentElement;
      if (!(target instanceof HTMLElement) || !(scrollNode instanceof HTMLElement) || !field
        || !target.isConnected || !scrollNode.isConnected || !target.getClientRects().length
        || !scrollNode.getClientRects().length) return;
      target.focus({ preventScroll: true });
      const fieldTop = field.getBoundingClientRect().top - scrollNode.getBoundingClientRect().top
        - scrollNode.clientTop + scrollNode.scrollTop;
      body.current?.scrollTo({ y: Math.max(0, fieldTop - 12), animated: false });
    });
    return;
  }
  body.current?.scrollTo({ y: Math.max(0, offset - 12), animated: false });
  input.current?.focus();
}

function clientDialogValue(client: ClientRecord | null | undefined, defaultDisplayName: string): ClientProfileDialogValue {
  return {
    companyName: client?.companyName ?? defaultDisplayName,
    primaryContactFirstName: client?.primaryContactFirstName ?? "",
    primaryContactMiddleInitial: client?.primaryContactMiddleInitial ?? "",
    primaryContactLastName: client?.primaryContactLastName ?? "",
    primaryContactSuffix: client?.primaryContactSuffix ?? "",
    email: client?.email ?? "",
    phone: client?.phone ?? "",
    location: client?.location ?? "",
    notes: client?.notes ?? "",
  };
}

function catalogDialogIcon(mode: ProjectCatalogDialogMode): React.ReactNode {
  switch (mode) {
    case "client":
      return <FolderPlus size={22} color="#eef7f1" />;
    case "project":
      return <Database size={22} color="#eef7f1" />;
    case "fieldMap":
      return <MapIcon size={22} color="#eef7f1" />;
    case "design":
      return <Layers size={22} color="#eef7f1" />;
  }
}

const styles = StyleSheet.create({
  backdrop: {
    alignItems: "center",
    backgroundColor: "rgba(19, 33, 27, 0.58)",
    flex: 1,
    justifyContent: "center",
    padding: 18,
  },
  backdropCompact: {
    justifyContent: "flex-end",
    padding: 10,
  },
  dialog: {
    backgroundColor: "#fbfcf8",
    borderColor: "#d6ded3",
    borderRadius: 8,
    borderWidth: 1,
    maxHeight: "88%",
    maxWidth: 540,
    minWidth: 0,
    overflow: "hidden",
    width: "100%",
  },
  dialogCompact: {
    maxHeight: "92%",
  },
  embeddedDialog: {
    maxHeight: "100%",
  },
  header: {
    flexShrink: 0,
    alignItems: "flex-start",
    backgroundColor: "#f4f8f1",
    borderBottomColor: "#d6ded3",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 12,
    padding: 16,
  },
  iconBadge: {
    alignItems: "center",
    backgroundColor: "#254234",
    borderRadius: 8,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  dangerIconBadge: {
    backgroundColor: "#8d2b20",
  },
  headerText: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  title: {
    color: "#14221b",
    fontSize: 18,
    fontWeight: "900",
  },
  helper: {
    color: "#526257",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
  },
  hidden: { display: "none" },
  body: {
    minHeight: 0,
    flexShrink: 1,
  },
  bodyContent: {
    gap: 14,
    padding: 16,
  },
  contextPreview: {
    backgroundColor: "#eef4ef",
    borderColor: "#c7d6ca",
    borderRadius: 8,
    borderWidth: 1,
    color: "#254234",
    fontSize: 12,
    fontWeight: "900",
    lineHeight: 18,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  field: {
    gap: 7,
  },
  fieldLabel: {
    color: "#3c4f43",
    fontSize: 12,
    fontWeight: "900",
  },
  input: {
    backgroundColor: "#ffffff",
    borderColor: "#cdd8ca",
    borderRadius: 8,
    borderWidth: 1,
    color: "#1d2c22",
    fontSize: 15,
    fontWeight: "800",
    minHeight: 44,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  inputError: {
    borderColor: "#b34a37",
  },
  textArea: {
    minHeight: 92,
    textAlignVertical: "top",
  },
  errorText: {
    color: "#8d2b20",
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17,
  },
  footer: {
    flexShrink: 0,
    alignItems: "center",
    backgroundColor: "#f4f8f1",
    borderTopColor: "#d6ded3",
    borderTopWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "flex-end",
    padding: 12,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#254234",
    borderColor: "#254234",
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 42,
    minWidth: 104,
    paddingHorizontal: 15,
    paddingVertical: 10,
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "900",
  },
  dangerButton: {
    alignItems: "center",
    backgroundColor: "#8d2b20",
    borderColor: "#8d2b20",
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 42,
    minWidth: 104,
    paddingHorizontal: 15,
    paddingVertical: 10,
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: "#f1f5ee",
    borderColor: "#cdd8ca",
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 42,
    minWidth: 104,
    paddingHorizontal: 15,
    paddingVertical: 10,
  },
  secondaryButtonText: {
    color: "#254234",
    fontSize: 13,
    fontWeight: "900",
  },
  disabledButton: {
    opacity: 0.55,
  },
  choiceRow: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderColor: "#cdd8ca",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 54,
    padding: 12,
  },
  choiceRowSelected: {
    backgroundColor: "#edf7f0",
    borderColor: "#77aa8b",
  },
  choiceText: {
    flex: 1,
    minWidth: 0,
  },
  choiceTitle: {
    color: "#17241c",
    fontSize: 14,
    fontWeight: "900",
  },
  choiceMeta: {
    color: "#5b6b61",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
});
