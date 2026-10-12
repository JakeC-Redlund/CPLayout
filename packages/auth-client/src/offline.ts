import { ed25519 } from "@noble/curves/ed25519.js";
import { OFFLINE_WORK_DURATION_MS, type OfflineGrant, type SignedOfflineGrant } from "./contracts";

export function bytesToHex(bytes: Uint8Array): string { return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join(""); }
export function hexToBytes(text: string): Uint8Array {
  if (!/^(?:[a-f0-9]{2})+$/i.test(text)) throw new Error("Invalid signing data.");
  return Uint8Array.from(text.match(/../g)!, byte => Number.parseInt(byte, 16));
}
export interface OfflineClock { now(): number; monotonic(): number }
export interface OfflineClockState { lastWallTime: number; serverTime: number; monotonicTime: number; processId: string }
export function verifyOfflineGrant(input: SignedOfflineGrant, verificationKey: string, expected: { subject: string; workspaceId: string }, now: number): OfflineGrant {
  if (!input || typeof input.payload !== "string" || input.payload.length > 256 * 1024 || !Number.isFinite(now)) throw new Error("Offline authorization is invalid.");
  if (!ed25519.verify(hexToBytes(input.signature), new TextEncoder().encode(input.payload), hexToBytes(verificationKey))) throw new Error("Offline authorization could not be verified.");
  const grant = JSON.parse(input.payload) as OfflineGrant;
  if (grant.grantVersion !== "cplayout-offline-grant-v1" || !grant.id || grant.subject !== expected.subject || grant.workspaceId !== expected.workspaceId
    || !grant.principal || grant.principal.id !== grant.subject || typeof grant.principal.username !== "string" || typeof grant.principal.displayName !== "string"
    || !Array.isArray(grant.principal.roles) || grant.principal.roles.some(role => !["operator", "admin", "support"].includes(role)) || typeof grant.workspaceName !== "string"
    || !Number.isSafeInteger(grant.policyRevision) || grant.policyRevision < 0 || !Array.isArray(grant.projectIds)
    || grant.projectIds.some(id => typeof id !== "string" || !id) || new Set(grant.projectIds).size !== grant.projectIds.length
    || !Array.isArray(grant.permissions) || grant.permissions.some(permission => !["field:read", "field:write"].includes(permission))) throw new Error("Offline authorization belongs to different access or unsupported data.");
  const issued = Date.parse(grant.issuedAt), expires = Date.parse(grant.expiresAt);
  if (!Number.isFinite(issued) || !Number.isFinite(expires) || expires - issued !== OFFLINE_WORK_DURATION_MS || now < issued || now >= expires) throw new Error("Offline access has expired or the device clock needs an online check. Your work is retained.");
  return grant;
}
/** Persist the returned state before admitting a mutation. A new process must retain
 * its previous maximum wall time; monotonic continuity is used only in one process. */
export function advanceOfflineClock(previous: OfflineClockState, clock: OfflineClock, processId: string): OfflineClockState {
  const wall = clock.now(), mono = clock.monotonic();
  if (!Number.isFinite(wall) || !Number.isFinite(mono) || wall < previous.lastWallTime || wall < previous.serverTime) throw new Error("The device clock changed. Connect to renew offline access; your work is retained.");
  if (previous.processId === processId && (mono < previous.monotonicTime || wall + 2000 < previous.lastWallTime + mono - previous.monotonicTime)) throw new Error("Offline clock continuity could not be verified. Your work is retained.");
  return { lastWallTime: wall, serverTime: previous.serverTime, monotonicTime: mono, processId };
}
const OFFLINE_FIELD_COMMANDS = new Set([
  "save_design_draft", "save_design_project", "save_field_design", "adopt_field_plan", "create_complete_design_from_draft", "convert_project_to_field_design", "prepare_surveyed_field",
  "create_survey_collection", "append_survey_capture", "bind_recorded_pivot", "set_survey_membership", "apply_survey_collection", "restore_design_survey_history",
  "review_survey", "create_reviewed_layout_session", "create_rtk_layout_session", "finalize_rtk_layout_session", "append_layout_mark", "create_layout_session", "append_layout_observation", "rename_layout_session", "copy_layout_session",
  "upgrade_workspace_to_v2", "upgrade_workspace_to_v3", "upgrade_workspace_to_v4", "upgrade_workspace_to_v5",
]);
export function offlineCommandAllowed(type: string): boolean { return OFFLINE_FIELD_COMMANDS.has(type); }
