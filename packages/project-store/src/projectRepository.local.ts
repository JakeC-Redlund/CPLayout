import { createVersionedProjectRepository } from "./versionedProjectRepository";

export const localStorageProjectRepository = createVersionedProjectRepository({
  getStorage: () => typeof localStorage === "undefined" ? undefined : localStorage,
  getLocks: () => typeof navigator === "undefined" ? undefined : navigator.locks,
});

export const projectRepository = localStorageProjectRepository;
export type { ProjectSummary } from "./projectRepositoryTypes";
