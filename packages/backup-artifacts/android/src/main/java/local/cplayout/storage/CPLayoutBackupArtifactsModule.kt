package local.cplayout.storage

import android.os.Build
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class CPLayoutBackupArtifactsModule : Module() {
  private val artifactRegistry = ArtifactSessionRegistry {
    check(Build.VERSION.SDK_INT >= 27) { "Native backup artifacts require Android API 27 or newer" }
    val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
    AndroidArtifactBackend(context.filesDir)
  }

  override fun definition() = ModuleDefinition {
    Name("CPLayoutBackupArtifacts")
    Constant("protocolVersion") { 1 }
    AsyncFunction("createSession") { artifactRegistry.createSession() }
    AsyncFunction("allocateAttempt") { session: String, id: String -> artifactRegistry.allocateAttempt(session, id) }
    AsyncFunction("openRetainedAttempt") { session: String, id: String -> artifactRegistry.openRetainedAttempt(session, id) }
    AsyncFunction("backupPath") { session: String, handle: String -> artifactRegistry.backupPath(session, handle) }
    AsyncFunction("sealBackup") { session: String, handle: String -> artifactRegistry.sealBackup(session, handle) }
    AsyncFunction("verifyAndCopy") { session: String, handle: String, digest: String, id: String -> artifactRegistry.verifyAndCopy(session, handle, digest, id) }
    AsyncFunction("inspectionPath") { session: String, handle: String -> artifactRegistry.inspectionPath(session, handle) }
    AsyncFunction("closeInspection") { session: String, handle: String -> artifactRegistry.closeInspection(session, handle) }
    AsyncFunction("publishPreparedHex") { session: String, handle: String, hex: String -> artifactRegistry.publishPrepared(session, handle, ReceiptHexTransport.decode(hex)) }
    AsyncFunction("readPreparedHex") { session: String, handle: String -> ReceiptHexTransport.encode(artifactRegistry.readPrepared(session, handle)) }
    AsyncFunction("releaseSession") { session: String -> artifactRegistry.releaseSession(session) }
    OnDestroy { artifactRegistry.shutdown() }
  }
}
