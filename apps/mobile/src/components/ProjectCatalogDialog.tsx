import type { ClientRecord } from "@cplayout/project-store";
import { AlertTriangle, CheckCircle2, Database, FolderOpen, FolderPlus, Layers, Map as MapIcon, MoveRight, UserRound } from "lucide-react-native";
import React, { useEffect, useMemo, useRef, useState } from "react";
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

interface ProjectCatalogDialogProps {
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

export function CatalogItemForm({
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
  const busy = submitting || localSubmitting;
  const [error, setError] = useState<string | null>(null);
  const copy = dialogCopy[mode];
  const icon = useMemo(() => catalogDialogIcon(mode), [mode]);

  useEffect(() => {
    setName(defaultName);
    setFieldName(defaultFieldName ?? "");
    setError(null);
    setFieldError(null);
    setSaveError(null);
    // Defaults can change after a sibling catalog refresh. A mounted form owns its text.
  }, [mode]);

  function cancel(): void {
    if ((busy || submitInFlight.current) && !allowCancelWhileSubmitting) return;
    onCancel();
  }

  async function submit(): Promise<void> {
    if (busy || submitInFlight.current) return;
    const trimmedName = name.trim();
    const needsField = mode === "project" && defaultFieldName !== undefined;
    setError(trimmedName ? null : "Enter a name before creating this item.");
    setFieldError(needsField && !fieldName.trim() ? "Enter a name for the first field." : null);
    if (!trimmedName || (needsField && !fieldName.trim())) {
      focusInvalidField(!trimmedName ? nameRef : fieldRef, bodyRef, !trimmedName ? fieldOffsets.current.name : fieldOffsets.current.field);
      return;
    }
    submitInFlight.current = true;
    setLocalSubmitting(true);
    setSaveError(null);
    try { await onCreate(trimmedName, needsField ? fieldName.trim() : undefined); }
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
              if (busy || submitInFlight.current) return;
              setName(value);
              if (error) setError(null);
            }}
            onSubmitEditing={() => void submit()}
            returnKeyType="done"
            selectTextOnFocus
            style={[styles.input, error && styles.inputError]}
            testID="catalog-dialog-name-input"
            value={name}
          />
          {error ? <Text nativeID="catalog-dialog-error" accessibilityRole="alert" style={styles.errorText} testID="catalog-dialog-error">{error}</Text> : null}
        </View>
        {mode === "project" && defaultFieldName !== undefined && <>
          <DialogField editable={!busy} inputRef={fieldRef} onLayoutY={y => { fieldOffsets.current.field = y; }} label="First field name (required)" value={fieldName} onChangeText={text => { if (busy || submitInFlight.current) return; setFieldName(text); setFieldError(null); }} error={fieldError} testID="catalog-dialog-first-field-input" />
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
          accessibilityLabel={createAccessibilityLabel ?? `Create ${copy.createLabel}`}
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
}: {
  feedback?: React.ReactNode;
  defaultDisplayName: string;
  initialClient?: ClientRecord | null;
  mode: "create" | "edit";
  onCancel: () => void;
  onSave: (value: ClientProfileDialogValue) => void | Promise<void>;
  submitting?: boolean;
  visible: boolean;
}): React.JSX.Element {
  return <ClientProfileForm
    feedback={feedback}
    defaultDisplayName={defaultDisplayName}
    initialClient={initialClient}
    mode={mode}
    onCancel={onCancel}
    onSave={onSave}
    submitting={submitting}
    modalVisible={visible}
  />;
}

export function ClientProfileForm({
  feedback,
  defaultDisplayName,
  embedded = false,
  modalVisible,
  initialClient,
  mode,
  onCancel,
  onSave,
  submitting = false,
}: {
  feedback?: React.ReactNode;
  defaultDisplayName: string;
  embedded?: boolean;
  modalVisible?: boolean;
  initialClient?: ClientRecord | null;
  mode: "create" | "edit";
  onCancel: () => void;
  onSave: (value: ClientProfileDialogValue) => void | Promise<void>;
  submitting?: boolean;
}): React.JSX.Element {
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
  const busy = submitting || localSubmitting;

  useEffect(() => {
    setValue(clientDialogValue(initialClient, defaultDisplayName));
    setErrors({});
    setSaveError(null);
    setDetailsOpen(false);
  }, [initialClient?.id, mode]);

  function cancel(): void {
    if (busy || submitInFlight.current) return;
    onCancel();
  }

  function updateField(field: keyof ClientProfileDialogValue, nextValue: string): void {
    if (busy || submitInFlight.current) return;
    setValue((current) => ({ ...current, [field]: nextValue }));
    setErrors(current => ({ ...current, [field]: undefined }));
  }

  async function submit(): Promise<void> {
    if (busy || submitInFlight.current) return;
    const required = {
      primaryContactFirstName: value.primaryContactFirstName.trim() ? undefined : "Enter the contact's first name.",
      primaryContactLastName: value.primaryContactLastName.trim() ? undefined : "Enter the contact's last name.",
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
      companyName: value.companyName.trim(),
      primaryContactFirstName: value.primaryContactFirstName.trim(),
      primaryContactMiddleInitial: value.primaryContactMiddleInitial.trim().replace(/\./g, "").slice(0, 1).toUpperCase(),
      primaryContactLastName: value.primaryContactLastName.trim(),
      primaryContactSuffix: value.primaryContactSuffix.trim(),
      email: value.email.trim(),
      phone: value.phone.trim(),
      location: value.location.trim(),
      notes: value.notes.trim(),
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
          <Text style={styles.helper}>Enter the primary contact. Company and contact details are optional and stay in this local customer catalog.</Text>
        </View>
      </View>

      <ScrollView ref={bodyRef} keyboardShouldPersistTaps="handled" style={styles.body} contentContainerStyle={styles.bodyContent} testID="client-profile-dialog-body">
        {feedback}
        <DialogField editable={!busy} inputRef={firstNameRef} autoFocus={!embedded} onLayoutY={y => { fieldOffsets.current.first = y; }} label="First name (required)" value={value.primaryContactFirstName} onChangeText={(text) => updateField("primaryContactFirstName", text)} error={errors.primaryContactFirstName} testID="client-profile-first-name-input" />
        <DialogField editable={!busy} inputRef={lastNameRef} onLayoutY={y => { fieldOffsets.current.last = y; }} label="Last name (required)" value={value.primaryContactLastName} onChangeText={(text) => updateField("primaryContactLastName", text)} error={errors.primaryContactLastName} testID="client-profile-last-name-input" />
        <DialogField editable={!busy} label="Company name (optional)" value={value.companyName} onChangeText={(text) => updateField("companyName", text)} testID="client-profile-company-input" />
        <Pressable accessibilityRole="button" aria-expanded={detailsOpen} accessibilityState={{ expanded: detailsOpen, disabled: busy }} disabled={busy} onPress={() => { if (!busy && !submitInFlight.current) setDetailsOpen(open => !open); }} style={[styles.secondaryButton, busy && styles.disabledButton]} testID="client-profile-details-toggle">
          <Text style={styles.secondaryButtonText}>{detailsOpen ? "Hide optional contact details" : "Optional contact details"}</Text>
        </Pressable>
        <View style={!detailsOpen && styles.hidden}>
        <DialogField editable={!busy} label="M.I." value={value.primaryContactMiddleInitial} onChangeText={(text) => updateField("primaryContactMiddleInitial", text)} testID="client-profile-middle-initial-input" />
        <DialogField editable={!busy} label="Suffix" value={value.primaryContactSuffix} onChangeText={(text) => updateField("primaryContactSuffix", text)} testID="client-profile-suffix-input" />
        <DialogField editable={!busy} label="Email" value={value.email} onChangeText={(text) => updateField("email", text)} testID="client-profile-email-input" />
        <DialogField editable={!busy} label="Phone" value={value.phone} onChangeText={(text) => updateField("phone", text)} testID="client-profile-phone-input" />
        <DialogField editable={!busy} label="Location" value={value.location} onChangeText={(text) => updateField("location", text)} testID="client-profile-location-input" />
        <DialogField editable={!busy} label="Notes" multiline value={value.notes} onChangeText={(text) => updateField("notes", text)} testID="client-profile-notes-input" />
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
        onChangeText={onChangeText}
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
