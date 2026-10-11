package local.cplayout.storage;

import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.CoderResult;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import local.cplayout.storage.ArtifactSessionRegistry.Backend.Attempt;
import local.cplayout.storage.ArtifactSessionRegistry.Backend.Inspection;

/** In-memory ownership only. Filesystem checks and artifact retention belong to Backend. */
public final class ArtifactSessionRegistry {
  public static final int MAX_SESSIONS = 16;
  public static final int MAX_HANDLES_PER_SESSION = 256;
  public static final int MAX_HANDLES = 1024;
  public static final int MAX_PREPARED_BYTES = 65536;
  public static final long MAX_SAFE_INTEGER = 9007199254740991L;

  public static final class Sealed {
    public final String path;
    public final String sha256;
    public final long bytes;

    public Sealed(String path, String sha256, long bytes) {
      this.path = path;
      this.sha256 = sha256;
      this.bytes = bytes;
    }
  }

  public interface Backend {
    interface Attempt {}
    interface Inspection {}

    String root() throws Exception;
    Attempt allocateAttempt(String id) throws Exception;
    Attempt openRetainedAttempt(String id) throws Exception;
    String backupPath(Attempt attempt) throws Exception;
    Sealed sealBackup(Attempt attempt) throws Exception;
    Inspection verifyAndCopy(Attempt attempt, String digest, String id) throws Exception;
    String inspectionPath(Inspection inspection) throws Exception;
    void closeInspection(Inspection inspection) throws Exception;
    void publishPrepared(Attempt attempt, byte[] content) throws Exception;
    byte[] readPrepared(Attempt attempt) throws Exception;
  }

  public interface Factory {
    Backend create() throws Exception;
  }

  private static final class InspectionEntry {
    final Inspection value;
    boolean closeStarted;

    InspectionEntry(Inspection value) { this.value = value; }
  }

  private static final class Session {
    final Backend backend;
    final Map<String, Attempt> attempts = new HashMap<>();
    final Map<String, InspectionEntry> inspections = new HashMap<>();

    Session(Backend backend) { this.backend = backend; }
    int size() { return attempts.size() + inspections.size(); }
  }

  private final Factory factory;
  private final String namespace = UUID.randomUUID().toString();
  private final Map<String, Session> sessions = new HashMap<>();
  private long sequence;
  private int handleCount;
  private boolean stopped;

  public ArtifactSessionRegistry(Factory factory) {
    this.factory = Objects.requireNonNull(factory, "factory");
  }

  public synchronized Map<String, Object> createSession() throws Exception {
    active();
    state(sessions.size() < MAX_SESSIONS, "Session limit reached");
    String id = nextId();
    Backend backend = Objects.requireNonNull(factory.create(), "backend");
    String root = path(backend.root());
    Map<String, Object> result = new LinkedHashMap<>();
    result.put("sessionId", id);
    result.put("protocolVersion", 1);
    result.put("artifactRoot", root);
    sessions.put(id, new Session(backend));
    return result;
  }

  public synchronized String allocateAttempt(String sessionId, String id) throws Exception {
    Session session = session(sessionId);
    token(id);
    capacity(session);
    String handle = nextId();
    Attempt attempt = Objects.requireNonNull(session.backend.allocateAttempt(id), "attempt");
    session.attempts.put(handle, attempt);
    handleCount++;
    return handle;
  }

  public synchronized String openRetainedAttempt(String sessionId, String id) throws Exception {
    Session session = session(sessionId);
    token(id);
    capacity(session);
    String handle = nextId();
    Attempt attempt = Objects.requireNonNull(session.backend.openRetainedAttempt(id), "attempt");
    session.attempts.put(handle, attempt);
    handleCount++;
    return handle;
  }

  public synchronized String backupPath(String sessionId, String handle) throws Exception {
    Session session = session(sessionId);
    return path(session.backend.backupPath(attempt(session, handle)));
  }

  public synchronized Map<String, Object> sealBackup(String sessionId, String handle) throws Exception {
    Session session = session(sessionId);
    Sealed sealed = Objects.requireNonNull(session.backend.sealBackup(attempt(session, handle)), "sealed");
    path(sealed.path);
    digest(sealed.sha256);
    state(sealed.bytes >= 100 && sealed.bytes <= MAX_SAFE_INTEGER, "Invalid sealed byte count");
    Map<String, Object> result = new LinkedHashMap<>();
    result.put("path", sealed.path);
    result.put("sha256", sealed.sha256);
    result.put("bytes", sealed.bytes);
    return result;
  }

  public synchronized String verifyAndCopy(String sessionId, String handle, String digest, String id)
      throws Exception {
    Session session = session(sessionId);
    Attempt attempt = attempt(session, handle);
    digest(digest);
    token(id);
    capacity(session);
    String inspectionHandle = nextId();
    Inspection inspection = Objects.requireNonNull(session.backend.verifyAndCopy(attempt, digest, id), "inspection");
    session.inspections.put(inspectionHandle, new InspectionEntry(inspection));
    handleCount++;
    return inspectionHandle;
  }

  public synchronized String inspectionPath(String sessionId, String handle) throws Exception {
    Session session = session(sessionId);
    return path(session.backend.inspectionPath(inspection(session, handle).value));
  }

  public synchronized void closeInspection(String sessionId, String handle) throws Exception {
    Session session = session(sessionId);
    InspectionEntry entry = inspection(session, handle);
    // Set before delegation: a partially completed close must never be retried through this token.
    entry.closeStarted = true;
    session.backend.closeInspection(entry.value);
    session.inspections.remove(handle);
    handleCount--;
  }

  public synchronized void publishPrepared(String sessionId, String handle, String content) throws Exception {
    Session session = session(sessionId);
    Attempt attempt = attempt(session, handle);
    session.backend.publishPrepared(attempt, encode(content));
  }

  public synchronized String readPrepared(String sessionId, String handle) throws Exception {
    Session session = session(sessionId);
    byte[] content = session.backend.readPrepared(attempt(session, handle));
    argument(content != null && content.length > 0 && content.length <= MAX_PREPARED_BYTES,
        "Invalid prepared receipt size");
    return StandardCharsets.UTF_8.newDecoder()
        .onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT)
        .decode(ByteBuffer.wrap(content)).toString();
  }

  public synchronized void releaseSession(String sessionId) {
    Session session = session(sessionId);
    handleCount -= session.size();
    sessions.remove(sessionId);
  }

  public synchronized void shutdown() {
    active();
    stopped = true;
    sessions.clear();
    handleCount = 0;
  }

  private void active() { state(!stopped, "Registry has shut down"); }

  private Session session(String id) {
    active();
    token(id);
    Session session = sessions.get(id);
    argument(session != null, "Unknown session");
    return session;
  }

  private static Attempt attempt(Session session, String handle) {
    token(handle);
    Attempt attempt = session.attempts.get(handle);
    argument(attempt != null, "Unknown attempt handle for session");
    return attempt;
  }

  private static InspectionEntry inspection(Session session, String handle) {
    token(handle);
    InspectionEntry entry = session.inspections.get(handle);
    argument(entry != null, "Unknown inspection handle for session");
    state(!entry.closeStarted, "Inspection close already attempted; token is unusable");
    return entry;
  }

  private void capacity(Session session) {
    state(session.size() < MAX_HANDLES_PER_SESSION && handleCount < MAX_HANDLES, "Handle limit reached");
  }

  private String nextId() {
    state(sequence < Long.MAX_VALUE, "Registry identifiers exhausted");
    return namespace + "_" + Long.toString(++sequence, 36);
  }

  private static void token(String value) {
    argument(value != null && value.length() > 0 && value.length() <= 100, "Invalid token length");
    for (int i = 0; i < value.length(); i++) {
      char c = value.charAt(i);
      argument((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
          (c >= '0' && c <= '9') || c == '_' || c == '-', "Invalid token character");
    }
  }

  private static void digest(String value) {
    argument(value != null && value.length() == 64, "Invalid SHA-256 digest length");
    for (int i = 0; i < value.length(); i++) {
      char c = value.charAt(i);
      argument((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'), "Invalid SHA-256 digest character");
    }
  }

  private static String path(String value) {
    state(value != null && !value.isEmpty(), "Missing backend path");
    return value;
  }

  private static byte[] encode(String content) throws CharacterCodingException {
    argument(content != null && content.length() > 0 && content.length() <= MAX_PREPARED_BYTES,
        "Invalid prepared receipt size");
    // Count UTF-8 bytes before allocating; reject lone UTF-16 surrogates explicitly.
    int size = 0;
    for (int i = 0; i < content.length(); i++) {
      char c = content.charAt(i);
      if (Character.isHighSurrogate(c)) {
        if (++i >= content.length() || !Character.isLowSurrogate(content.charAt(i))) {
          throw new CharacterCodingException();
        }
        size += 4;
      } else if (Character.isLowSurrogate(c)) {
        throw new CharacterCodingException();
      } else {
        size += c < 0x80 ? 1 : c < 0x800 ? 2 : 3;
      }
      argument(size <= MAX_PREPARED_BYTES, "Prepared receipt exceeds byte limit");
    }
    ByteBuffer bytes = ByteBuffer.allocate(size);
    java.nio.charset.CharsetEncoder encoder = StandardCharsets.UTF_8.newEncoder()
        .onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT);
    CoderResult encoded = encoder.encode(CharBuffer.wrap(content), bytes, true);
    if (encoded.isError()) encoded.throwException();
    state(encoded.isUnderflow(), "UTF-8 byte count mismatch");
    CoderResult flushed = encoder.flush(bytes);
    if (flushed.isError()) flushed.throwException();
    state(flushed.isUnderflow() && bytes.position() == size, "UTF-8 byte count mismatch");
    return bytes.array();
  }

  private static void argument(boolean valid, String message) {
    if (!valid) throw new IllegalArgumentException(message);
  }

  private static void state(boolean valid, String message) {
    if (!valid) throw new IllegalStateException(message);
  }
}
