import { requireOptionalNativeModule } from "expo-modules-core";

// Project-store owns protocol validation and session lifetime; lookup opens no files.
export function getBackupArtifactsModule(): unknown {
  return requireOptionalNativeModule<unknown>("CPLayoutBackupArtifacts");
}
