import { sha256Text } from "@cplayout/core";

export interface EditorOutputSource {
  designId: string;
  documentId: string;
  document: string;
  savedRevision: number | null;
  inputRevision: number;
  scope: "draft" | "all-machines" | "frozen-target";
  machineIds: readonly string[];
}

/** Filename metadata only. Hash the exact document being packaged; never modify archive contents. */
export function editorOutputIdentity(source: EditorOutputSource): { stem: string; hash: string } {
  const hash = sha256Text(source.document);
  const part = (value: string, maximum = 32) => value.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, maximum) || "unnamed";
  const machine = source.scope === "all-machines" ? `all-machines-${source.machineIds.length}`
    : source.machineIds.length ? `machine-${source.machineIds.map(id => part(id, 20)).join("-").slice(0, 40)}` : "machine-unassigned";
  return { hash, stem: `design-${part(source.designId)}.${part(source.documentId)}.${machine}.r${source.savedRevision ?? "unconfirmed"}.e${source.inputRevision}.${hash.slice(0, 12)}` };
}
