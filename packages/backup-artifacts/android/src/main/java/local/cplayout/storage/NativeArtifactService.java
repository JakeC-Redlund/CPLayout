package local.cplayout.storage;

import android.os.Process;
import android.os.Build;
import android.system.ErrnoException;
import android.system.Os;
import android.system.OsConstants;
import android.system.StructStat;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileDescriptor;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;

/** App-private artifact primitives. Callers must quiesce managed writers first. */
public final class NativeArtifactService {
  private static final String[] SIDECARS = { "-wal", "-shm", "-journal" };
  private static final int MAX_RECEIPT_BYTES = 65536;
  private final File root;
  private final StructStat rootIdentity;
  private final Io io;

  // Narrow fault-injection surface used by on-device tests; not exposed to the JS bridge.
  static class Io {
    int read(FileDescriptor fd, byte[] bytes, int count) throws Exception { return Os.read(fd, bytes, 0, count); }
    int write(FileDescriptor fd, byte[] bytes, int offset, int count) throws Exception { return Os.write(fd, bytes, offset, count); }
    void sync(FileDescriptor fd) throws Exception { Os.fsync(fd); }
  }
  private static final class Handle implements AutoCloseable {
    final FileDescriptor fd;
    Handle(File file, int flags) throws Exception {
      fd = Os.open(file.getPath(), flags | OsConstants.O_NOFOLLOW | OsConstants.O_CLOEXEC, 0600);
    }
    public void close() throws ErrnoException { Os.close(fd); }
  }
  public static final class Attempt {
    private final NativeArtifactService owner;
    private final File directory;
    private final StructStat directoryIdentity;
    private final StructStat backupIdentity;
    private final boolean newlyAllocated;
    private Attempt(NativeArtifactService owner, File directory, StructStat directoryIdentity, StructStat backupIdentity, boolean newlyAllocated) {
      this.owner = owner; this.directory = directory; this.directoryIdentity = directoryIdentity; this.backupIdentity = backupIdentity; this.newlyAllocated = newlyAllocated;
    }
    public String backupPath() throws Exception {
      owner.checkAttempt(this); File backup = new File(directory, "backup.db");
      sameIdentity(backupIdentity, regular(backup)); absentSidecars(backup);
      return backup.getPath();
    }
  }
  public static final class Artifact {
    public final String path;
    public final String sha256;
    public final long bytes;
    private final StructStat identity;
    private Artifact(File file, String sha256, long bytes, StructStat identity) { this.path = file.getPath(); this.sha256 = sha256; this.bytes = bytes; this.identity = identity; }
  }
  public final class Inspection implements AutoCloseable {
    public final String path;
    private final Attempt attempt;
    private final File directory;
    private final StructStat identity;
    private StructStat copyIdentity;
    private Artifact retained;
    private boolean closed;
    private Inspection(Attempt attempt, File directory) throws Exception {
      this.attempt = attempt; this.directory = directory; this.identity = privateDirectory(directory);
      path = new File(directory, "copy.db").getPath();
    }
    public synchronized String checkedPath() throws Exception {
      require(!closed && copyIdentity != null && retained != null, "Inspection is not available");
      checkAttempt(attempt);
      require(directory.getPath().equals(directory.getCanonicalPath()), "Inspection path changed");
      sameObject(identity, privateDirectory(directory));
      File copy = new File(path); sameSnapshot(copyIdentity, regular(copy)); absentSidecars(copy);
      return path;
    }
    public synchronized void close() throws Exception {
      if (closed) return;
      checkAttempt(attempt); sameObject(identity, privateDirectory(directory));
      File[] entries = directory.listFiles();
      require(entries != null, "Cannot inventory inspection directory");
      require(entries.length == 1 && entries[0].getName().equals("copy.db"), "Unexpected inspection artifact; preserved");
      sameIdentity(copyIdentity, regular(entries[0]));
      File backup = new File(attempt.directory, "backup.db");
      sameSnapshot(retained.identity, regular(backup)); inspect(backup, null, retained.sha256, false);
      Os.remove(entries[0].getPath()); Os.remove(directory.getPath());
      syncDirectory(attempt.directory); closed = true;
    }
  }

  public NativeArtifactService(File ownedRoot) throws Exception { this(ownedRoot, new Io()); }
  /** The native module supplies Context.filesDir; JavaScript cannot choose this root. */
  public static NativeArtifactService openAppPrivate(File contextFilesDir) throws Exception {
    require(Build.VERSION.SDK_INT >= 27, "Artifact service requires Android API 27 or newer");
    File parent = contextFilesDir.getCanonicalFile(); StructStat parentIdentity = Os.lstat(parent.getPath());
    require(parent.getPath().matches("[\\x21-\\x7e]+") && !parent.getPath().matches(".*[\\\\%?#].*"), "App path is not bridge-safe ASCII");
    require(OsConstants.S_ISDIR(parentIdentity.st_mode) && parentIdentity.st_uid == Process.myUid(), "App files directory is not owned");
    File directory = new File(parent, "cplayout-upgrade-artifacts-v1");
    try { Os.mkdir(directory.getPath(), 0700); }
    catch (ErrnoException error) { if (error.errno != OsConstants.EEXIST) throw error; }
    NativeArtifactService service = new NativeArtifactService(directory);
    service.syncDirectory(directory);
    try (Handle handle = new Handle(parent, OsConstants.O_RDONLY)) {
      sameObject(parentIdentity, Os.fstat(handle.fd)); Os.fsync(handle.fd);
      sameObject(parentIdentity, Os.lstat(parent.getPath()));
    }
    service.checkRoot(); return service;
  }
  public synchronized String rootPath() throws Exception { checkRoot(); return root.getPath(); }
  NativeArtifactService(File ownedRoot, Io io) throws Exception {
    require(Build.VERSION.SDK_INT >= 27, "Artifact service requires Android API 27 or newer");
    this.root = ownedRoot.getAbsoluteFile(); this.io = io;
    require(root.getPath().equals(root.getCanonicalPath()), "Artifact root must be canonical");
    rootIdentity = privateDirectory(root);
  }
  public synchronized Attempt allocateAttempt(String id) throws Exception {
    token(id); checkRoot();
    File directory = new File(root, id);
    Os.mkdir(directory.getPath(), 0700);
    StructStat identity = privateDirectory(directory);
    File backup = new File(directory, "backup.db");
    StructStat fileIdentity;
    try (Handle handle = create(backup)) {
      fileIdentity = regular(backup); sameIdentity(fileIdentity, Os.fstat(handle.fd)); io.sync(handle.fd);
    }
    syncDirectory(directory); syncDirectory(root);
    return new Attempt(this, directory, identity, fileIdentity, true);
  }
  /** Existing-only evidence access, not admission. Caller must validate receipt binding and digest. */
  public synchronized Attempt openRetainedAttempt(String id) throws Exception {
    token(id); checkRoot(); File directory = new File(root, id);
    require(directory.getPath().equals(directory.getCanonicalPath()), "Retained attempt path changed");
    StructStat identity = privateDirectory(directory); File backup = new File(directory, "backup.db");
    StructStat backupIdentity = regular(backup); absentSidecars(backup);
    Attempt attempt = new Attempt(this, directory, identity, backupIdentity, false);
    readPrepared(attempt); checkAttempt(attempt);
    return attempt;
  }
  public synchronized Artifact sealBackup(Attempt attempt) throws Exception {
    checkAttempt(attempt);
    require(attempt.newlyAllocated, "Retained artifacts cannot be resealed");
    File backup = new File(attempt.directory, "backup.db");
    sameIdentity(attempt.backupIdentity, regular(backup));
    Artifact artifact = inspect(backup, null, null, true);
    syncDirectory(attempt.directory); syncDirectory(root); checkAttempt(attempt);
    return artifact;
  }
  public synchronized Inspection verifyAndCopy(Attempt attempt, String expectedSha256, String inspectionId) throws Exception {
    token(inspectionId); require(expectedSha256 != null && expectedSha256.matches("[a-f0-9]{64}"), "Invalid backup digest");
    checkAttempt(attempt);
    File backup = new File(attempt.directory, "backup.db");
    sameIdentity(attempt.backupIdentity, regular(backup));
    File directory = new File(attempt.directory, "inspect-" + inspectionId);
    Os.mkdir(directory.getPath(), 0700);
    Inspection inspection = new Inspection(attempt, directory);
    // Failed inspection copies are retained, never confused with an approved result.
    inspection.retained = inspect(backup, new File(inspection.path), expectedSha256, false);
    inspection.copyIdentity = regular(new File(inspection.path));
    syncDirectory(directory); checkAttempt(attempt);
    return inspection;
  }
  public synchronized void publishPrepared(Attempt attempt, byte[] content) throws Exception {
    require(content != null && content.length > 0 && content.length <= MAX_RECEIPT_BYTES, "Invalid prepared receipt size");
    byte[] captured = content.clone(); checkAttempt(attempt);
    require(attempt.newlyAllocated, "Retained attempts cannot publish new receipts");
    File file = new File(attempt.directory, "prepared.json");
    try (Handle handle = create(file)) {
      StructStat identity = regular(file); sameIdentity(identity, Os.fstat(handle.fd));
      writeAll(handle.fd, captured, captured.length); io.sync(handle.fd);
      sameIdentity(identity, regular(file));
      require(Os.fstat(handle.fd).st_size == captured.length, "Prepared receipt write length differs");
    }
    syncDirectory(attempt.directory); syncDirectory(root); checkAttempt(attempt);
    require(Arrays.equals(captured, readPrepared(attempt)), "Prepared receipt readback differs");
  }
  public synchronized byte[] readPrepared(Attempt attempt) throws Exception {
    checkAttempt(attempt); File file = new File(attempt.directory, "prepared.json");
    StructStat before = regular(file);
    require(before.st_size > 0 && before.st_size <= MAX_RECEIPT_BYTES, "Invalid prepared receipt size");
    try (Handle handle = new Handle(file, OsConstants.O_RDONLY)) {
      sameSnapshot(before, Os.fstat(handle.fd));
      ByteArrayOutputStream bytes = new ByteArrayOutputStream(); byte[] buffer = new byte[4096]; int count;
      while ((count = io.read(handle.fd, buffer, buffer.length)) > 0) {
        require(bytes.size() + count <= MAX_RECEIPT_BYTES, "Prepared receipt grew while reading"); bytes.write(buffer, 0, count);
      }
      require(bytes.size() == before.st_size, "Prepared receipt read length differs");
      sameSnapshot(before, Os.fstat(handle.fd)); sameSnapshot(before, regular(file)); checkAttempt(attempt);
      return bytes.toByteArray();
    }
  }

  private Artifact inspect(File source, File copy, String expected, boolean flush) throws Exception {
    absentSidecars(source); StructStat before = regular(source);
    require(before.st_size >= 100, "Backup is shorter than SQLite header");
    try (Handle input = new Handle(source, OsConstants.O_RDONLY);
         Handle output = copy == null ? null : create(copy)) {
      sameSnapshot(before, Os.fstat(input.fd));
      MessageDigest digest = MessageDigest.getInstance("SHA-256");
      byte[] buffer = new byte[65536], header = new byte[100]; long total = 0; int count;
      while ((count = io.read(input.fd, buffer, buffer.length)) > 0) {
        if (total < header.length) System.arraycopy(buffer, 0, header, (int) total, (int) Math.min(count, header.length - total));
        total = Math.addExact(total, count); require(total <= before.st_size, "Backup grew while reading");
        digest.update(buffer, 0, count); if (output != null) writeAll(output.fd, buffer, count);
      }
      require(total == before.st_size, "Backup length changed while reading");
      require(Arrays.equals(Arrays.copyOf(header, 16), "SQLite format 3\0".getBytes(StandardCharsets.US_ASCII)), "Invalid SQLite header");
      require(header[18] == 1 && header[19] == 1, "Retained backup must use rollback format, not WAL");
      String hash = hex(digest.digest()); require(expected == null || expected.equals(hash), "Backup digest differs");
      if (flush) io.sync(input.fd);
      if (output != null) {
        io.sync(output.fd); sameSnapshot(Os.fstat(output.fd), regular(copy));
        require(Os.fstat(output.fd).st_size == total, "Inspection copy length differs");
      }
      sameSnapshot(before, Os.fstat(input.fd)); sameSnapshot(before, regular(source)); absentSidecars(source);
      return new Artifact(source, hash, total, before);
    }
  }
  private void writeAll(FileDescriptor fd, byte[] bytes, int count) throws Exception {
    int offset = 0;
    while (offset < count) {
      int written = io.write(fd, bytes, offset, count - offset);
      require(written > 0 && written <= count - offset, "Artifact write made no valid progress"); offset += written;
    }
  }
  private Handle create(File file) throws Exception {
    return new Handle(file, OsConstants.O_RDWR | OsConstants.O_CREAT | OsConstants.O_EXCL);
  }
  private void checkRoot() throws Exception {
    require(root.getPath().equals(root.getCanonicalPath()), "Artifact root path changed"); sameObject(rootIdentity, privateDirectory(root));
  }
  private void checkAttempt(Attempt attempt) throws Exception {
    require(attempt != null && attempt.owner == this, "Attempt belongs to another service"); checkRoot();
    require(attempt.directory.getPath().equals(attempt.directory.getCanonicalPath()), "Attempt path changed");
    sameObject(attempt.directoryIdentity, privateDirectory(attempt.directory));
  }
  private void syncDirectory(File directory) throws Exception {
    StructStat before = privateDirectory(directory);
    try (Handle handle = new Handle(directory, OsConstants.O_RDONLY)) {
      sameIdentity(before, Os.fstat(handle.fd)); io.sync(handle.fd); sameIdentity(before, privateDirectory(directory));
    }
  }
  private static StructStat privateDirectory(File file) throws Exception {
    StructStat value = Os.lstat(file.getPath());
    require(OsConstants.S_ISDIR(value.st_mode) && value.st_uid == Process.myUid() && (value.st_mode & 0077) == 0, "Directory is not private and owned");
    return value;
  }
  private static StructStat regular(File file) throws Exception {
    StructStat value = Os.lstat(file.getPath());
    require(OsConstants.S_ISREG(value.st_mode) && value.st_nlink == 1 && value.st_uid == Process.myUid() && (value.st_mode & 0077) == 0,
      "Artifact is not a private owned single-link regular file");
    return value;
  }
  private static void absentSidecars(File file) throws Exception {
    for (String suffix : SIDECARS) {
      try { Os.lstat(file.getPath() + suffix); }
      catch (ErrnoException error) { if (error.errno == OsConstants.ENOENT) continue; throw error; }
      throw new IOException("Backup sidecar exists: " + suffix);
    }
  }
  private static void sameIdentity(StructStat a, StructStat b) throws IOException {
    sameObject(a, b); require(a.st_nlink == b.st_nlink, "Artifact link count changed");
  }
  private static void sameObject(StructStat a, StructStat b) throws IOException {
    require(a.st_dev == b.st_dev && a.st_ino == b.st_ino && a.st_uid == b.st_uid && a.st_mode == b.st_mode, "Artifact identity changed");
  }
  private static void sameSnapshot(StructStat a, StructStat b) throws IOException {
    sameIdentity(a, b);
    require(a.st_size == b.st_size && a.st_mtim.equals(b.st_mtim) && a.st_ctim.equals(b.st_ctim), "Artifact changed while reading");
  }
  private static void token(String value) throws IOException { require(value != null && value.matches("[A-Za-z0-9_-]{1,100}"), "Invalid artifact identity"); }
  private static void require(boolean condition, String message) throws IOException { if (!condition) throw new IOException(message); }
  private static String hex(byte[] bytes) { StringBuilder value = new StringBuilder(); for (byte b : bytes) value.append(String.format(java.util.Locale.ROOT, "%02x", b & 255)); return value.toString(); }
}
