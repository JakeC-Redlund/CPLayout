import React, { useEffect, useRef, useState } from "react";
import { CopyPlus } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { PivotProject } from "@cplayout/core";
import { parseWorkspaceCommand, type CopyProjectCommand } from "@cplayout/project-store";
import type { ProjectWorkspaceStatus } from "../hooks/useProjectRepository";
import { ProjectCatalogDialog } from "./ProjectCatalogDialog";

interface CopyForm { command: CopyProjectCommand; revision: number }

export function ProjectCopyButton({ project, sourceStored, repository, onCopy }: {
  project: PivotProject;
  sourceStored: boolean;
  repository: ProjectWorkspaceStatus;
  onCopy: (command: CopyProjectCommand, revision: number) => Promise<PivotProject>;
}): React.JSX.Element {
  const [form, setForm] = useState<CopyForm | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const owner = useRef<CopyForm | null>(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  const currentProject = useRef(project);
  currentProject.current = project;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    owner.current = null;
    setForm(null); setSubmitting(pending.current); setMessage(null); setError(null);
    return () => { owner.current = null; };
  }, [project]);

  function open(): void {
    if (pending.current) return;
    try {
      if (!repository.canCopyProject || repository.catalogRevision === null) throw new Error("Copy requires available revision-checked local storage.");
      const command = parseWorkspaceCommand({ type: "copy_project", source: project, sourceStored,
        newProjectId: `project-copy-${globalThis.crypto.randomUUID()}`, name: `${project.name} copy`.slice(0, 200), now: new Date().toISOString() }) as CopyProjectCommand;
      const next = { command, revision: repository.catalogRevision };
      owner.current = next; setForm(next); setError(null); setMessage(null);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Copy could not be prepared."); }
  }

  async function save(name: string): Promise<void> {
    const operation = owner.current;
    const source = currentProject.current;
    if (!operation || pending.current) return;
    pending.current = true; setSubmitting(true); setError(null);
    try {
      const copy = await onCopy({ ...operation.command, name }, operation.revision);
      if (owner.current === operation && currentProject.current === source) {
        owner.current = null; setForm(null); setMessage(`Saved copy: ${copy.name}.`);
      }
    } catch (error) {
      if (owner.current === operation && currentProject.current === source) setError(error instanceof Error ? error.message : "Copy was not saved.");
    } finally {
      pending.current = false;
      if (mounted.current) setSubmitting(false);
    }
  }

  return <View style={styles.wrapper}>
    <Pressable accessibilityRole="button" accessibilityLabel="Save project copy"
      disabled={!repository.canCopyProject || repository.catalogRevision === null || submitting}
      onPress={open} testID="project-save-copy"
      style={[styles.button, (!repository.canCopyProject || repository.catalogRevision === null || submitting) && styles.disabled]}>
      <CopyPlus size={18} color="#254234" /><Text style={styles.label}>Save Copy</Text>
    </Pressable>
    {message ? <Text accessibilityLiveRegion="polite" style={styles.message} testID="project-copy-status">{message}</Text> : null}
    {!repository.canCopyProject ? <Text style={styles.message}>Copy unavailable for this storage backend.</Text> : null}
    {form ? <ProjectCatalogDialog visible mode="project" title="Save Copy" helper=""
      contextPreview={`Source: ${form.command.source.name}`} defaultName={form.command.name}
      createButtonLabel="Save Copy" createAccessibilityLabel="Confirm Save Copy" submitting={submitting}
      allowCancelWhileSubmitting cancelButtonLabel={submitting ? "Close" : "Cancel"}
      feedback={error ? <Text accessibilityRole="alert" style={styles.error} testID="project-copy-error">{error}</Text> : undefined}
      onCreate={save} onCancel={() => { owner.current = null; setForm(null); }} /> : null}
  </View>;
}

const styles = StyleSheet.create({
  wrapper: { gap: 6, maxWidth: "100%" },
  button: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: "#cbd7cd", borderRadius: 8, backgroundColor: "#f2f5f0", minHeight: 42 },
  label: { color: "#254234", fontWeight: "700", fontSize: 13 },
  message: { color: "#45584d", fontSize: 13, flexShrink: 1 },
  error: { color: "#8b1e18", fontSize: 13, padding: 12 },
  disabled: { opacity: 0.5 },
});
