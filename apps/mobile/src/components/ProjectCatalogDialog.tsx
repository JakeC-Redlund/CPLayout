import type { ClientRecord } from "@cplayout/project-store";
import { AlertTriangle, CheckCircle2, Database, FolderOpen, FolderPlus, Layers, Map as MapIcon, MoveRight, UserRound } from "lucide-react-native";
import React, { useEffect, useMemo, useState } from "react";
import {
  Modal,
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
  helper?: string;
  mode: ProjectCatalogDialogMode;
  onCancel: () => void;
  onCreate: (name: string) => void | Promise<void>;
  submitting?: boolean;
  title?: string;
  visible: boolean;
}

interface CatalogItemFormProps extends Omit<ProjectCatalogDialogProps, "visible"> {
  embedded?: boolean;
}

const dialogCopy: Record<ProjectCatalogDialogMode, {
  createLabel: string;
  helper: string;
  title: string;
}> = {
  client: {
    createLabel: "client folder",
    helper: "Adds a client folder for a farm, grower, or service account in the catalog rail.",
    title: "Add Client Folder",
  },
  project: {
    createLabel: "project",
    helper: "Creates a project folder where field maps and design passes stay together.",
    title: "Create Project",
  },
  fieldMap: {
    createLabel: "field map",
    helper: "Adds a field map under the selected project for boundaries, roads, and obstacles.",
    title: "Create Field Map",
  },
  design: {
    createLabel: "design",
    helper: "New design draft",
    title: "Create Design",
  },
};

export function ProjectCatalogDialog({
  feedback,
  createButtonLabel,
  createAccessibilityLabel,
  allowCancelWhileSubmitting,
  cancelButtonLabel,
  contextPreview,
  defaultName,
  helper,
  mode,
  onCancel,
  onCreate,
  submitting = false,
  title,
  visible,
}: ProjectCatalogDialogProps): React.JSX.Element {
  const { width } = useWindowDimensions();
  const compact = width < 520;
  return (
    <Modal
      animationType="fade"
      onRequestClose={onCancel}
      transparent
      visible={visible}
    >
      <View style={[styles.backdrop, compact && styles.backdropCompact]} testID="catalog-dialog-backdrop">
        <CatalogItemForm
          feedback={feedback}
          contextPreview={contextPreview}
          createButtonLabel={createButtonLabel}
          createAccessibilityLabel={createAccessibilityLabel}
          allowCancelWhileSubmitting={allowCancelWhileSubmitting}
          cancelButtonLabel={cancelButtonLabel}
          defaultName={defaultName}
          helper={helper}
          mode={mode}
          onCancel={onCancel}
          onCreate={onCreate}
          submitting={submitting}
          title={title}
        />
      </View>
    </Modal>
  );
}

export function CatalogItemForm({
  feedback,
  createButtonLabel,
  createAccessibilityLabel,
  allowCancelWhileSubmitting = false,
  cancelButtonLabel,
  contextPreview,
  defaultName,
  embedded = false,
  helper,
  mode,
  onCancel,
  onCreate,
  submitting = false,
  title,
}: CatalogItemFormProps): React.JSX.Element {
  const { width } = useWindowDimensions();
  const compact = !embedded && width < 520;
  const [name, setName] = useState(defaultName);
  const [error, setError] = useState<string | null>(null);
  const copy = dialogCopy[mode];
  const icon = useMemo(() => catalogDialogIcon(mode), [mode]);

  useEffect(() => {
    setName(defaultName);
    setError(null);
  }, [defaultName]);

  async function submit(): Promise<void> {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Enter a name before creating this item.");
      return;
    }
    setError(null);
    await onCreate(trimmedName);
  }

  return (
    <View accessibilityViewIsModal={!embedded} style={[styles.dialog, compact && styles.dialogCompact, embedded && styles.embeddedDialog]} testID="catalog-dialog">
      <View style={styles.header}>
        <View style={styles.iconBadge}>{icon}</View>
        <View style={styles.headerText}>
          <Text style={styles.title}>{title ?? copy.title}</Text>
          <Text style={styles.helper}>{helper ?? copy.helper}</Text>
        </View>
      </View>

      {feedback}
      <ScrollView
        keyboardShouldPersistTaps="handled"
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        testID="catalog-dialog-body"
      >
        <Text style={styles.contextPreview} testID="catalog-dialog-context">
          {contextPreview}
        </Text>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Name</Text>
          <TextInput
            accessibilityLabel="Catalog item name"
            autoFocus={!embedded}
            onChangeText={(value) => {
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
          {error ? <Text style={styles.errorText} testID="catalog-dialog-error">{error}</Text> : null}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          accessibilityLabel={cancelButtonLabel ?? `Cancel ${copy.createLabel} creation`}
          accessibilityRole="button"
          disabled={submitting && !allowCancelWhileSubmitting}
          onPress={onCancel}
          style={[styles.secondaryButton, submitting && !allowCancelWhileSubmitting && styles.disabledButton]}
          testID="catalog-dialog-cancel"
        >
          <Text style={styles.secondaryButtonText}>{cancelButtonLabel ?? "Cancel"}</Text>
        </Pressable>
        <Pressable
          accessibilityLabel={createAccessibilityLabel ?? `Create ${copy.createLabel}`}
          accessibilityRole="button"
          disabled={submitting}
          onPress={() => void submit()}
          style={[styles.primaryButton, submitting && styles.disabledButton]}
          testID="catalog-dialog-create"
        >
          <Text style={styles.primaryButtonText}>{submitting ? "Working" : (createButtonLabel ?? "Create")}</Text>
        </Pressable>
      </View>
    </View>
  );
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
  const { width } = useWindowDimensions();
  const compact = width < 520;
  return (
    <Modal animationType="fade" onRequestClose={onCancel} transparent visible={visible}>
      <View style={[styles.backdrop, compact && styles.backdropCompact]} testID="client-profile-dialog-backdrop">
        <ClientProfileForm
          feedback={feedback}
          defaultDisplayName={defaultDisplayName}
          initialClient={initialClient}
          mode={mode}
          onCancel={onCancel}
          onSave={onSave}
          submitting={submitting}
        />
      </View>
    </Modal>
  );
}

export function ClientProfileForm({
  feedback,
  defaultDisplayName,
  embedded = false,
  initialClient,
  mode,
  onCancel,
  onSave,
  submitting = false,
}: {
  feedback?: React.ReactNode;
  defaultDisplayName: string;
  embedded?: boolean;
  initialClient?: ClientRecord | null;
  mode: "create" | "edit";
  onCancel: () => void;
  onSave: (value: ClientProfileDialogValue) => void | Promise<void>;
  submitting?: boolean;
}): React.JSX.Element {
  const { width } = useWindowDimensions();
  const compact = !embedded && width < 520;
  const [value, setValue] = useState<ClientProfileDialogValue>(() => clientDialogValue(initialClient, defaultDisplayName));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setValue(clientDialogValue(initialClient, defaultDisplayName));
    setError(null);
  }, [defaultDisplayName, initialClient]);

  function updateField(field: keyof ClientProfileDialogValue, nextValue: string): void {
    setValue((current) => ({ ...current, [field]: nextValue }));
    if (error) setError(null);
  }

  async function submit(): Promise<void> {
    if (!value.primaryContactFirstName.trim() || !value.primaryContactLastName.trim()) {
      setError("Enter primary contact first and last name before saving.");
      return;
    }
    setError(null);
    await onSave({
      companyName: value.companyName.trim(),
      primaryContactFirstName: value.primaryContactFirstName.trim(),
      primaryContactMiddleInitial: value.primaryContactMiddleInitial.trim().replace(/\./g, "").slice(0, 1).toUpperCase(),
      primaryContactLastName: value.primaryContactLastName.trim(),
      primaryContactSuffix: value.primaryContactSuffix.trim(),
      email: value.email.trim(),
      phone: value.phone.trim(),
      location: value.location.trim(),
      notes: value.notes.trim(),
    });
  }

  return (
    <View accessibilityViewIsModal={!embedded} style={[styles.dialog, compact && styles.dialogCompact, embedded && styles.embeddedDialog]} testID="client-profile-dialog">
      <View style={styles.header}>
        <View style={styles.iconBadge}><UserRound size={22} color="#eef7f1" /></View>
        <View style={styles.headerText}>
          <Text style={styles.title}>{mode === "create" ? "Add Client" : "Edit Client"}</Text>
          <Text style={styles.helper}>Company is optional; primary contact first and last name are required. Client profile details stay in the local catalog and are not written into project ZIP packages.</Text>
        </View>
      </View>

      {feedback}
      <ScrollView keyboardShouldPersistTaps="handled" style={styles.body} contentContainerStyle={styles.bodyContent} testID="client-profile-dialog-body">
        <DialogField label="Company name" value={value.companyName} onChangeText={(text) => updateField("companyName", text)} testID="client-profile-company-input" />
        <DialogField label="Last name" value={value.primaryContactLastName} onChangeText={(text) => updateField("primaryContactLastName", text)} error={error} testID="client-profile-last-name-input" />
        <DialogField label="First name" value={value.primaryContactFirstName} onChangeText={(text) => updateField("primaryContactFirstName", text)} testID="client-profile-first-name-input" />
        <DialogField label="M.I." value={value.primaryContactMiddleInitial} onChangeText={(text) => updateField("primaryContactMiddleInitial", text)} testID="client-profile-middle-initial-input" />
        <DialogField label="Suffix" value={value.primaryContactSuffix} onChangeText={(text) => updateField("primaryContactSuffix", text)} testID="client-profile-suffix-input" />
        <DialogField label="Email" value={value.email} onChangeText={(text) => updateField("email", text)} testID="client-profile-email-input" />
        <DialogField label="Phone" value={value.phone} onChangeText={(text) => updateField("phone", text)} testID="client-profile-phone-input" />
        <DialogField label="Location" value={value.location} onChangeText={(text) => updateField("location", text)} testID="client-profile-location-input" />
        <DialogField label="Notes" multiline value={value.notes} onChangeText={(text) => updateField("notes", text)} testID="client-profile-notes-input" />
      </ScrollView>

      <View style={styles.footer}>
        <Pressable accessibilityRole="button" disabled={submitting} onPress={onCancel} style={[styles.secondaryButton, submitting && styles.disabledButton]} testID="client-profile-cancel">
          <Text style={styles.secondaryButtonText}>Cancel</Text>
        </Pressable>
        <Pressable accessibilityRole="button" disabled={submitting} onPress={() => void submit()} style={[styles.primaryButton, submitting && styles.disabledButton]} testID="client-profile-save">
          <Text style={styles.primaryButtonText}>{submitting ? "Saving" : "Save"}</Text>
        </Pressable>
      </View>
    </View>
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
    <Modal animationType="fade" onRequestClose={onCancel} transparent visible={visible}>
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
    <Modal animationType="fade" onRequestClose={onCancel} transparent visible={visible}>
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
    setSelectedClientId(targets[0]?.id ?? "");
  }, [targets]);

  return (
    <View accessibilityViewIsModal={!embedded} style={[styles.dialog, compact && styles.dialogCompact, embedded && styles.embeddedDialog]} testID="move-project-dialog">
      <View style={styles.header}>
        <View style={styles.iconBadge}><MoveRight size={22} color="#eef7f1" /></View>
        <View style={styles.headerText}>
          <Text style={styles.title}>Move Project</Text>
          <Text style={styles.helper}>Move {projectName} to another client folder. Project geometry and archive contents are unchanged.</Text>
        </View>
      </View>
      {feedback}
      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} testID="move-project-dialog-body">
        {targets.length === 0 ? (
          <Text style={styles.errorText}>Create another client folder before moving this project.</Text>
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
                <Text style={styles.choiceMeta}>{client.location || client.contactName || "Client folder"}</Text>
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
  error,
  label,
  multiline = false,
  onChangeText,
  testID,
  value,
}: {
  error?: string | null;
  label: string;
  multiline?: boolean;
  onChangeText: (value: string) => void;
  testID: string;
  value: string;
}): React.JSX.Element {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        multiline={multiline}
        onChangeText={onChangeText}
        style={[styles.input, multiline && styles.textArea, error && styles.inputError]}
        testID={testID}
        value={value}
      />
      {error ? <Text style={styles.errorText} testID="client-profile-error">{error}</Text> : null}
    </View>
  );
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
  body: {
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
