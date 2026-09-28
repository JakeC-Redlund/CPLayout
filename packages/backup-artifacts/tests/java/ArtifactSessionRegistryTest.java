package local.cplayout.storage;

import java.io.IOException;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Dependency-free JVM contract tests; no Android or filesystem implementation. */
public final class ArtifactSessionRegistryTest {
  private static final String DIGEST = repeat("a", 64);
  private static int assertions;

  @FunctionalInterface private interface Action { void run() throws Exception; }

  private static final class Fake implements ArtifactSessionRegistry.Backend {
    private static final class A implements Attempt {}
    private static final class I implements Inspection {}
    int allocations, opens, copies, closes, pathReads, inspectionPathReads, publishes, reads, seals;
    boolean failAllocate, failOpen, failCopy, failClose, failPath, failInspectionPath, failPublish, failRead;
    String lastId, lastDigest;
    Attempt lastAttempt;
    Inspection lastInspection;
    byte[] prepared = "{}".getBytes(StandardCharsets.UTF_8);
    ArtifactSessionRegistry.Sealed sealed = new ArtifactSessionRegistry.Sealed("/owned/backup.db", DIGEST, 100);

    public String root() { return "/owned"; }
    public Attempt allocateAttempt(String id) throws Exception {
      allocations++; lastId = id;
      if (failAllocate) throw new IOException("allocate failed; artifacts preserved");
      return new A();
    }
    public Attempt openRetainedAttempt(String id) throws Exception {
      opens++; lastId = id;
      if (failOpen) throw new IOException("open failed");
      return new A();
    }
    public String backupPath(Attempt attempt) throws Exception {
      pathReads++; lastAttempt = attempt;
      if (failPath) throw new IOException("source identity changed");
      return "/owned/backup.db";
    }
    public ArtifactSessionRegistry.Sealed sealBackup(Attempt attempt) {
      seals++; lastAttempt = attempt; return sealed;
    }
    public Inspection verifyAndCopy(Attempt attempt, String digest, String id) throws Exception {
      copies++; lastAttempt = attempt; lastDigest = digest; lastId = id;
      if (failCopy) throw new IOException("copy failed; artifacts preserved");
      return new I();
    }
    public String inspectionPath(Inspection inspection) throws Exception {
      inspectionPathReads++; lastInspection = inspection;
      if (failInspectionPath) throw new IOException("inspection identity changed");
      return "/owned/inspect/copy.db";
    }
    public void closeInspection(Inspection inspection) throws Exception {
      closes++; lastInspection = inspection;
      if (failClose) throw new IOException("close failed; artifacts preserved");
    }
    public void publishPrepared(Attempt attempt, byte[] content) throws Exception {
      publishes++; lastAttempt = attempt;
      if (failPublish) throw new IOException("publish failed");
      prepared = content.clone();
    }
    public byte[] readPrepared(Attempt attempt) throws Exception {
      reads++; lastAttempt = attempt;
      if (failRead) throw new IOException("read failed");
      return prepared;
    }
    int calls() {
      return allocations + opens + copies + closes + pathReads + inspectionPathReads + publishes + reads + seals;
    }
  }

  private static final class Fixture {
    final List<Fake> backends = new ArrayList<>();
    int creates;
    boolean failCreate;
    final ArtifactSessionRegistry registry = new ArtifactSessionRegistry(() -> {
      creates++;
      if (failCreate) throw new IOException("create failed");
      Fake backend = new Fake(); backends.add(backend); return backend;
    });
    String session() throws Exception { return (String) registry.createSession().get("sessionId"); }
    Fake backend() { return backends.get(backends.size() - 1); }
  }

  public static void main(String[] args) throws Exception {
    apiAndDelegation();
    ownershipAndTokens();
    closeAndRelease();
    shutdown();
    utf8();
    sealedBounds();
    failures();
    limits();
    System.out.println("PASS ArtifactSessionRegistryTest: 8 groups, " + assertions + " assertions");
  }

  private static void apiAndDelegation() throws Exception {
    for (Method method : ArtifactSessionRegistry.class.getDeclaredMethods()) {
      if (Modifier.isPublic(method.getModifiers())) {
        check(Modifier.isSynchronized(method.getModifiers()), "Public method must be synchronized: " + method);
      }
    }
    Fixture f = new Fixture();
    Map<String, Object> session = f.registry.createSession();
    equal(session.size(), 3);
    equal(session.get("protocolVersion"), 1);
    equal(session.get("artifactRoot"), "/owned");
    String s = (String) session.get("sessionId");
    String a = f.registry.allocateAttempt(s, "attempt-1");
    Fake b = f.backend(); equal(b.lastId, "attempt-1");
    equal(f.registry.backupPath(s, a), "/owned/backup.db");
    Object attempt = b.lastAttempt;
    b.failPath = true;
    rejects(IOException.class, () -> f.registry.backupPath(s, a));
    equal(b.pathReads, 2); b.failPath = false;
    Map<String, Object> sealed = f.registry.sealBackup(s, a);
    equal(sealed.size(), 3); equal(sealed.get("bytes"), 100L);
    equal(sealed.get("path"), "/owned/backup.db"); equal(sealed.get("sha256"), DIGEST);
    String i = f.registry.verifyAndCopy(s, a, DIGEST, "inspect-1");
    check(b.lastAttempt == attempt, "Attempt delegated by identity");
    equal(b.lastDigest, DIGEST); equal(b.lastId, "inspect-1");
    equal(f.registry.inspectionPath(s, i), "/owned/inspect/copy.db");
    Object inspection = b.lastInspection;
    b.failInspectionPath = true;
    rejects(IOException.class, () -> f.registry.inspectionPath(s, i));
    equal(b.inspectionPathReads, 2); b.failInspectionPath = false;
    f.registry.closeInspection(s, i);
    check(b.lastInspection == inspection, "Inspection delegated by identity");
    String retained = f.registry.openRetainedAttempt(s, "retained-1");
    equal(b.opens, 1); equal(b.lastId, "retained-1");
    equal(f.registry.readPrepared(s, retained), "{}");
    check(!s.equals(a) && !a.equals(i) && !i.equals(retained), "Opaque IDs are unique across kinds");
    session.put("sessionId", "tampered");
    f.registry.backupPath(s, a);
    Fixture other = new Fixture();
    String otherSession = other.session();
    check(!s.equals(otherSession), "Registry namespaces differ");
    rejects(IllegalArgumentException.class, () -> other.registry.backupPath(otherSession, a));
  }

  private static void ownershipAndTokens() throws Exception {
    Fixture f = new Fixture(); String s = f.session(); Fake b = f.backend();
    String a = f.registry.allocateAttempt(s, "a");
    String i = f.registry.verifyAndCopy(s, a, DIGEST, "i");
    String other = f.session(); Fake second = f.backend();
    int before = b.calls() + second.calls();
    rejects(IllegalArgumentException.class, () -> f.registry.backupPath(other, a));
    rejects(IllegalArgumentException.class, () -> f.registry.inspectionPath(other, i));
    rejects(IllegalArgumentException.class, () -> f.registry.closeInspection(other, i));
    rejects(IllegalArgumentException.class, () -> f.registry.backupPath(s, i));
    rejects(IllegalArgumentException.class, () -> f.registry.sealBackup(s, i));
    rejects(IllegalArgumentException.class, () -> f.registry.publishPrepared(s, i, "{}"));
    rejects(IllegalArgumentException.class, () -> f.registry.readPrepared(s, i));
    rejects(IllegalArgumentException.class, () -> f.registry.verifyAndCopy(s, i, DIGEST, "j"));
    rejects(IllegalArgumentException.class, () -> f.registry.inspectionPath(s, a));
    rejects(IllegalArgumentException.class, () -> f.registry.closeInspection(s, a));
    for (String bad : new String[] { null, "", "../a", "a.b", "a/b", "a\\b", "a b", "a\n", "\u00e9", "\0", repeat("a", 101) }) {
      rejects(IllegalArgumentException.class, () -> f.registry.allocateAttempt(s, bad));
      rejects(IllegalArgumentException.class, () -> f.registry.openRetainedAttempt(s, bad));
      rejects(IllegalArgumentException.class, () -> f.registry.verifyAndCopy(s, a, DIGEST, bad));
      rejects(IllegalArgumentException.class, () -> f.registry.backupPath(bad, a));
      rejects(IllegalArgumentException.class, () -> f.registry.backupPath(s, bad));
    }
    for (String bad : new String[] { null, "", repeat("A", 64), repeat("a", 63), repeat("g", 64), repeat("a", 65) }) {
      rejects(IllegalArgumentException.class, () -> f.registry.verifyAndCopy(s, a, bad, "j"));
    }
    equal(b.calls() + second.calls(), before);
    f.registry.allocateAttempt(s, repeat("a", 100));
    f.registry.openRetainedAttempt(s, "AZ_09-az");
  }

  private static void closeAndRelease() throws Exception {
    Fixture f = new Fixture(); String s = f.session(); Fake b = f.backend();
    String a = f.registry.allocateAttempt(s, "a");
    String poisoned = f.registry.verifyAndCopy(s, a, DIGEST, "poison");
    b.failClose = true;
    rejects(IOException.class, () -> f.registry.closeInspection(s, poisoned));
    b.failClose = false;
    rejects(IllegalStateException.class, () -> f.registry.closeInspection(s, poisoned));
    rejects(IllegalStateException.class, () -> f.registry.inspectionPath(s, poisoned));
    equal(b.closes, 1); equal(b.inspectionPathReads, 0);
    String closed = f.registry.verifyAndCopy(s, a, DIGEST, "closed");
    f.registry.closeInspection(s, closed);
    rejects(IllegalArgumentException.class, () -> f.registry.closeInspection(s, closed));
    rejects(IllegalArgumentException.class, () -> f.registry.inspectionPath(s, closed));
    f.registry.verifyAndCopy(s, a, DIGEST, "live");
    int before = b.calls();
    f.registry.releaseSession(s);
    equal(b.calls(), before);
    rejects(IllegalArgumentException.class, () -> f.registry.backupPath(s, a));
    rejects(IllegalArgumentException.class, () -> f.registry.releaseSession(s));
    String next = f.session(); check(!next.equals(s), "Released IDs are not reused");
    f.registry.shutdown(); equal(b.calls(), before);
  }

  private static void shutdown() throws Exception {
    Fixture f = new Fixture(); String s = f.session(); Fake b = f.backend();
    String a = f.registry.allocateAttempt(s, "a");
    String i = f.registry.verifyAndCopy(s, a, DIGEST, "i");
    int before = b.calls();
    f.registry.shutdown(); equal(b.calls(), before);
    Action[] calls = {
      () -> f.registry.createSession(), () -> f.registry.allocateAttempt(s, "a"),
      () -> f.registry.openRetainedAttempt(s, "a"), () -> f.registry.backupPath(s, a),
      () -> f.registry.sealBackup(s, a), () -> f.registry.verifyAndCopy(s, a, DIGEST, "i"),
      () -> f.registry.inspectionPath(s, i), () -> f.registry.closeInspection(s, i),
      () -> f.registry.publishPrepared(s, a, "{}"), () -> f.registry.readPrepared(s, a),
      () -> f.registry.releaseSession(s), () -> f.registry.shutdown()
    };
    for (Action call : calls) rejects(IllegalStateException.class, call);
    equal(b.calls(), before); equal(f.creates, 1);
  }

  private static void utf8() throws Exception {
    Fixture f = new Fixture(); String s = f.session(); Fake b = f.backend();
    String a = f.registry.allocateAttempt(s, "a");
    for (String text : new String[] { "{}", "\u00e9\u6c34\ud83d\ude80\0", repeat("x", 65536), repeat("\ud83d\ude80", 16384), repeat("\u00e9", 32768) }) {
      f.registry.publishPrepared(s, a, text);
      check(Arrays.equals(b.prepared, text.getBytes(StandardCharsets.UTF_8)), "Exact UTF-8 encoding");
      equal(f.registry.readPrepared(s, a), text);
    }
    int before = b.publishes;
    for (String text : new String[] { null, "", repeat("x", 65537), repeat("\u00e9", 32769), repeat("\u6c34", 21846), repeat("\ud83d\ude80", 16385) }) {
      rejects(IllegalArgumentException.class, () -> f.registry.publishPrepared(s, a, text));
    }
    for (String text : new String[] { "\ud800", "\udc00", "a\ud800b", "\ud800\ud800" }) {
      rejects(CharacterCodingException.class, () -> f.registry.publishPrepared(s, a, text));
    }
    equal(b.publishes, before);
    for (byte[] bytes : new byte[][] { {(byte) 0xc0, (byte) 0x80}, {(byte) 0x80}, {(byte) 0xe2, (byte) 0x82}, {(byte) 0xed, (byte) 0xa0, (byte) 0x80}, {(byte) 0xf4, (byte) 0x90, (byte) 0x80, (byte) 0x80} }) {
      b.prepared = bytes;
      rejects(CharacterCodingException.class, () -> f.registry.readPrepared(s, a));
    }
    for (byte[] bytes : new byte[][] { null, new byte[0], new byte[65537] }) {
      b.prepared = bytes;
      rejects(IllegalArgumentException.class, () -> f.registry.readPrepared(s, a));
    }
  }

  private static void sealedBounds() throws Exception {
    Fixture f = new Fixture(); String s = f.session(); Fake b = f.backend();
    String a = f.registry.allocateAttempt(s, "a");
    for (long size : new long[] { Long.MIN_VALUE, -1, 0, 99, 9007199254740992L, Long.MAX_VALUE }) {
      b.sealed = new ArtifactSessionRegistry.Sealed("/owned/backup.db", DIGEST, size);
      rejects(IllegalStateException.class, () -> f.registry.sealBackup(s, a));
    }
    b.sealed = new ArtifactSessionRegistry.Sealed("/owned/backup.db", DIGEST, 9007199254740991L);
    equal(f.registry.sealBackup(s, a).get("bytes"), 9007199254740991L);
    b.sealed = new ArtifactSessionRegistry.Sealed(null, DIGEST, 100);
    rejects(IllegalStateException.class, () -> f.registry.sealBackup(s, a));
    b.sealed = new ArtifactSessionRegistry.Sealed("/owned/backup.db", "bad", 100);
    rejects(IllegalArgumentException.class, () -> f.registry.sealBackup(s, a));
  }

  private static void failures() throws Exception {
    Fixture f = new Fixture();
    f.failCreate = true; rejects(IOException.class, () -> f.session()); f.failCreate = false;
    String s = f.session(); Fake b = f.backend();
    b.failAllocate = true; rejects(IOException.class, () -> f.registry.allocateAttempt(s, "a")); b.failAllocate = false;
    b.failOpen = true; rejects(IOException.class, () -> f.registry.openRetainedAttempt(s, "a")); b.failOpen = false;
    String a = f.registry.allocateAttempt(s, "a");
    b.failCopy = true; rejects(IOException.class, () -> f.registry.verifyAndCopy(s, a, DIGEST, "i")); b.failCopy = false;
    b.failPublish = true; rejects(IOException.class, () -> f.registry.publishPrepared(s, a, "{}")); b.failPublish = false;
    b.failRead = true; rejects(IOException.class, () -> f.registry.readPrepared(s, a)); b.failRead = false;
    equal(b.closes, 0);
    for (int n = 1; n < ArtifactSessionRegistry.MAX_HANDLES_PER_SESSION; n++) {
      f.registry.allocateAttempt(s, "a" + n);
    }
    int calls = b.calls();
    rejects(IllegalStateException.class, () -> f.registry.allocateAttempt(s, "full"));
    equal(b.calls(), calls);
    for (int n = 1; n < ArtifactSessionRegistry.MAX_SESSIONS; n++) f.session();
    int creates = f.creates;
    rejects(IllegalStateException.class, () -> f.session()); equal(f.creates, creates);
  }

  private static void limits() throws Exception {
    Fixture f = new Fixture(); Set<String> ids = new HashSet<>();
    String s = f.session(); Fake b = f.backend();
    String a = f.registry.allocateAttempt(s, "a"); ids.add(a);
    for (int n = 1; n < ArtifactSessionRegistry.MAX_HANDLES_PER_SESSION; n++) {
      check(ids.add(f.registry.verifyAndCopy(s, a, DIGEST, "i" + n)), "Handle never reused");
    }
    int calls = b.calls();
    rejects(IllegalStateException.class, () -> f.registry.allocateAttempt(s, "full"));
    rejects(IllegalStateException.class, () -> f.registry.openRetainedAttempt(s, "full"));
    rejects(IllegalStateException.class, () -> f.registry.verifyAndCopy(s, a, DIGEST, "full"));
    equal(b.calls(), calls);
    String i = ids.stream().filter(id -> !id.equals(a)).findFirst().get();
    b.failClose = true;
    rejects(IOException.class, () -> f.registry.closeInspection(s, i));
    rejects(IllegalStateException.class, () -> f.registry.allocateAttempt(s, "stillFull"));
    b.failClose = false;
    String closable = ids.stream().filter(id -> !id.equals(a) && !id.equals(i)).findFirst().get();
    f.registry.closeInspection(s, closable);
    check(ids.add(f.registry.openRetainedAttempt(s, "space")), "Closed handle not reused");
    String extra = f.session(); Fake extraBackend = f.backend();
    String extraAttempt = f.registry.allocateAttempt(extra, "a");
    check(ids.add(extraAttempt), "Global IDs unique");
    int count = ArtifactSessionRegistry.MAX_HANDLES_PER_SESSION + 1;
    while (count < ArtifactSessionRegistry.MAX_HANDLES) {
      String last = f.session();
      for (int n = 0; n < ArtifactSessionRegistry.MAX_HANDLES_PER_SESSION && count < ArtifactSessionRegistry.MAX_HANDLES; n++, count++) {
        check(ids.add(f.registry.allocateAttempt(last, "a" + n)), "Global IDs unique");
      }
    }
    int extraCalls = extraBackend.calls();
    rejects(IllegalStateException.class, () -> f.registry.allocateAttempt(extra, "full"));
    rejects(IllegalStateException.class, () -> f.registry.openRetainedAttempt(extra, "full"));
    rejects(IllegalStateException.class, () -> f.registry.verifyAndCopy(extra, extraAttempt, DIGEST, "full"));
    equal(extraBackend.calls(), extraCalls);
    int before = b.calls();
    f.registry.releaseSession(s); equal(b.calls(), before);
    f.registry.allocateAttempt(extra, "space");
    f.registry.shutdown();
    for (Fake backend : f.backends) {
      if (backend != b) equal(backend.closes, 0);
    }
  }

  private static String repeat(String value, int count) {
    StringBuilder result = new StringBuilder();
    for (int i = 0; i < count; i++) result.append(value);
    return result.toString();
  }
  private static void equal(Object actual, Object expected) {
    check(java.util.Objects.equals(actual, expected), "Values differ");
  }
  private static void check(boolean condition, String message) {
    assertions++;
    if (!condition) throw new AssertionError(message);
  }
  private static void rejects(Class<? extends Exception> type, Action action) throws Exception {
    assertions++;
    try { action.run(); }
    catch (Exception error) {
      if (type.isInstance(error)) return;
      throw new AssertionError("Expected " + type.getName() + ", got " + error, error);
    }
    throw new AssertionError("Expected " + type.getName());
  }
}
