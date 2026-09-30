package local.cplayout.storage;

import java.io.File;

/** Owns the Android objects behind one session; no native path enters from JS. */
public final class AndroidArtifactBackend implements ArtifactSessionRegistry.Backend {
  private final NativeArtifactService service;
  public AndroidArtifactBackend(File contextFilesDir) throws Exception {
    service = NativeArtifactService.openAppPrivate(contextFilesDir);
  }
  private final class OwnedAttempt implements Attempt {
    final AndroidArtifactBackend owner = AndroidArtifactBackend.this;
    final NativeArtifactService.Attempt value;
    OwnedAttempt(NativeArtifactService.Attempt value) { this.value = value; }
  }
  private final class OwnedInspection implements Inspection {
    final AndroidArtifactBackend owner = AndroidArtifactBackend.this;
    final NativeArtifactService.Inspection value;
    OwnedInspection(NativeArtifactService.Inspection value) { this.value = value; }
  }
  private NativeArtifactService.Attempt attempt(Attempt input) {
    if (!(input instanceof OwnedAttempt) || ((OwnedAttempt) input).owner != this) throw new IllegalArgumentException("Foreign Android attempt");
    return ((OwnedAttempt) input).value;
  }
  private NativeArtifactService.Inspection inspection(Inspection input) {
    if (!(input instanceof OwnedInspection) || ((OwnedInspection) input).owner != this) throw new IllegalArgumentException("Foreign Android inspection");
    return ((OwnedInspection) input).value;
  }
  @Override public String root() throws Exception { return service.rootPath(); }
  @Override public Attempt allocateAttempt(String id) throws Exception { return new OwnedAttempt(service.allocateAttempt(id)); }
  @Override public Attempt openRetainedAttempt(String id) throws Exception { return new OwnedAttempt(service.openRetainedAttempt(id)); }
  @Override public String backupPath(Attempt handle) throws Exception { return attempt(handle).backupPath(); }
  @Override public ArtifactSessionRegistry.Sealed sealBackup(Attempt handle) throws Exception {
    NativeArtifactService.Artifact value = service.sealBackup(attempt(handle));
    return new ArtifactSessionRegistry.Sealed(value.path, value.sha256, value.bytes);
  }
  @Override public Inspection verifyAndCopy(Attempt handle, String digest, String id) throws Exception {
    return new OwnedInspection(service.verifyAndCopy(attempt(handle), digest, id));
  }
  @Override public String inspectionPath(Inspection handle) throws Exception { return inspection(handle).checkedPath(); }
  @Override public void closeInspection(Inspection handle) throws Exception { inspection(handle).close(); }
  @Override public void publishPrepared(Attempt handle, byte[] bytes) throws Exception { service.publishPrepared(attempt(handle), bytes); }
  @Override public byte[] readPrepared(Attempt handle) throws Exception { return service.readPrepared(attempt(handle)); }
}
