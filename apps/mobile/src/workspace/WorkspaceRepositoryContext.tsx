import React, { createContext, useContext } from "react";
import { projectRepository, type ProjectRepository } from "@cplayout/project-store";
import type { StorageLike } from "./workspaceEditRecoveryStore";
import type { WorkspaceLaunchIntent } from "../auth/AuthProvider";

export interface WorkspaceRepositoryAccess {
  repository: ProjectRepository;
  actorId: string | null;
  storage: StorageLike | null;
  partition: string;
  visible?: boolean;
  authorityBlocked?: boolean;
  fieldMutationsAvailable?: boolean;
  fieldMutationsUnavailableReason?: string | null;
  liveCaptureAvailable?: boolean;
  offlineFieldMutationsAvailable?: boolean;
  archives?: import("@cplayout/auth-client").WorkspaceArchiveState | null;
  maintenance?: (options: { selectedCustomerId: string | null; selectedProjectId: string | null; sourceGeneration: number; visible: boolean; showArchived: boolean; onShowArchivedChange: (value: boolean) => void; prepareBoundary: () => Promise<boolean>; onRefresh: () => Promise<void> }) => React.ReactNode;
  roles?: readonly import("@cplayout/auth-client").UserRole[];
  permissions?: readonly import("@cplayout/auth-client").WorkspacePermission[];
  launchIntent?: WorkspaceLaunchIntent | null;
  registerBoundaryGuard?: (guard: () => Promise<boolean>) => () => void;
}
// The default is for existing isolated component consumers. The application
// entry always supplies an authenticated, account-bound repository.
const Context = createContext<WorkspaceRepositoryAccess | null>(null);
export const WorkspaceRepositoryProvider = Context.Provider;
export function useWorkspaceRepositoryAccess(): WorkspaceRepositoryAccess {
  const value = useContext(Context);
  if (value) return value;
  let storage: StorageLike | null = null;
  try { storage = globalThis.localStorage ?? null; } catch { /* Optional edit recovery may be denied by the browser. */ }
  return { repository: projectRepository, actorId: null, storage, partition: "legacy" };
}
