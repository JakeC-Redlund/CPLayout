package local.cplayout.storage;

import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.os.Build;
import android.os.Process;
import android.system.Os;
import android.system.OsConstants;
import android.system.ErrnoException;
import java.io.File;
import java.io.FileDescriptor;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.Arrays;

public final class NativeArtifactServiceTest {
  interface Checked { void run() throws Exception; }
  private static File root;
  private static int passed, failed, skipped, sequence;
  private static final class Skip extends Exception {
    private static final long serialVersionUID = 1L;
    Skip(String message) { super(message); }
  }
  private static void check(boolean value, String message) { if (!value) throw new AssertionError(message); }
  private static void test(String name, Checked body) {
    try { body.run(); passed++; System.out.println("PASS " + name); }
    catch (Skip reason) { skipped++; System.out.println("SKIP " + name + ": " + reason.getMessage()); }
    catch (Throwable error) { failed++; System.out.println("FAIL " + name); error.printStackTrace(System.out); }
  }
  private static void rejects(Checked body) throws Exception {
    try { body.run(); } catch (Exception expected) { return; }
    throw new AssertionError("Expected rejected operation");
  }
  private static void rejectsIo(String message, Checked body) throws Exception {
    try { body.run(); }
    catch (IOException expected) { check(message.equals(expected.getMessage()), "Wrong rejection: " + expected); return; }
    throw new AssertionError("Expected IOException: " + message);
  }
  private static String sha256(byte[] data) throws Exception {
    byte[] digest = MessageDigest.getInstance("SHA-256").digest(data);
    StringBuilder hex = new StringBuilder();
    for (byte value : digest) hex.append(Character.forDigit((value & 255) >>> 4, 16)).append(Character.forDigit(value & 15, 16));
    return hex.toString();
  }
  private static File directory() throws Exception {
    File path = new File(root, "case-" + (++sequence)); Os.mkdir(path.getPath(), 0700); return path;
  }
  private static byte[] bytes(String value) { return value.getBytes(StandardCharsets.UTF_8); }
  private static byte[] read(File file) throws Exception { return Files.readAllBytes(file.toPath()); }
  private static void write(File file, byte[] data) throws Exception { Files.write(file.toPath(), data); Os.chmod(file.getPath(), 0600); }
  private static void database(String path) throws Exception {
    SQLiteDatabase db = SQLiteDatabase.openOrCreateDatabase(path, null);
    try {
      try (Cursor mode = db.rawQuery("PRAGMA journal_mode=DELETE", null)) { check(mode.moveToFirst() && mode.getString(0).equals("delete"), "Journal mode differs"); }
      db.execSQL("PRAGMA synchronous=FULL");
      db.execSQL("CREATE TABLE evidence(id INTEGER PRIMARY KEY,value TEXT,payload BLOB)");
      db.execSQL("INSERT INTO evidence VALUES(1,'preserved',zeroblob(262144))"); db.setVersion(7);
    } finally { db.close(); }
    Os.chmod(path, 0600);
  }
  private static final class Fixture {
    final File directory; final NativeArtifactService service; final NativeArtifactService.Attempt attempt; final File backup;
    Fixture() throws Exception { this(new NativeArtifactService.Io()); }
    Fixture(NativeArtifactService.Io io) throws Exception {
      directory = directory(); service = new NativeArtifactService(directory, io); attempt = service.allocateAttempt("first");
      backup = new File(attempt.backupPath()); database(backup.getPath());
    }
  }
  public static void main(String[] arguments) throws Exception {
    root = new File(arguments[0]);
    if (arguments.length > 1) {
      if (arguments[1].equals("prepare")) {
        Os.mkdir(root.getPath(), 0700); NativeArtifactService service = new NativeArtifactService(root);
        NativeArtifactService.Attempt attempt = service.allocateAttempt("restart"); database(attempt.backupPath());
        NativeArtifactService.Artifact artifact = service.sealBackup(attempt);
        service.publishPrepared(attempt, bytes("{\"sha256\":\"" + artifact.sha256 + "\"}"));
        System.out.println("PREPARED pid=" + Process.myPid() + " sha256=" + artifact.sha256);
      } else if (arguments[1].equals("reopen")) {
        NativeArtifactService service = new NativeArtifactService(root);
        NativeArtifactService.Attempt attempt = service.openRetainedAttempt("restart");
        File backup = new File(root, "restart/backup.db");
        byte[] retainedBefore = read(backup), receiptBefore = service.readPrepared(attempt);
        String hash = new org.json.JSONObject(new String(receiptBefore, StandardCharsets.UTF_8)).getString("sha256");
        String copy;
        try (NativeArtifactService.Inspection inspection = service.verifyAndCopy(attempt, hash, "restart")) {
          copy = inspection.checkedPath();
          check(Arrays.equals(retainedBefore, read(new File(copy))), "Reopened copy differs");
          SQLiteDatabase db = SQLiteDatabase.openDatabase(copy, null, SQLiteDatabase.OPEN_READONLY);
          try (Cursor rows = db.rawQuery("SELECT id,value,length(payload) FROM evidence", null)) {
            check(db.getVersion() == 7, "Reopened schema differs");
            check(rows.moveToFirst() && rows.getInt(0) == 1 && rows.getString(1).equals("preserved")
                && rows.getInt(2) == 262144 && !rows.moveToNext(), "Reopened data differs");
          } finally { db.close(); }
        }
        check(!new File(copy).exists(), "Reopened inspection not cleaned");
        rejects(() -> service.sealBackup(attempt)); rejects(() -> service.publishPrepared(attempt, bytes("replacement")));
        check(Arrays.equals(retainedBefore, read(backup)), "Reopened retained bytes changed");
        check(Arrays.equals(receiptBefore, service.readPrepared(attempt)), "Reopened receipt changed");
        System.out.println("REOPENED pid=" + Process.myPid() + " sha256=" + hash);
      } else { throw new IllegalArgumentException("Unknown phase"); }
      return;
    }
    Os.mkdir(root.getPath(), 0700);
    System.out.println("RUNTIME sdk=" + Build.VERSION.SDK_INT + " fingerprint=" + Build.FINGERPRINT + " uid=" + Process.myUid());
    test("checked backup path rejects replacement and preserves both files", () -> {
      Fixture f = new Fixture(); File original = new File(f.directory, "original.db");
      Os.rename(f.backup.getPath(), original.getPath()); database(f.backup.getPath());
      rejectsIo("Artifact identity changed", () -> f.attempt.backupPath()); check(original.exists() && f.backup.exists(), "Replacement evidence lost");
    });
    test("checked backup path rejects a sidecar", () -> {
      Fixture f = new Fixture(); File sidecar = new File(f.backup.getPath() + "-wal"); write(sidecar, new byte[0]);
      rejectsIo("Backup sidecar exists: -wal", () -> f.attempt.backupPath()); check(sidecar.exists(), "Sidecar lost");
    });
    test("checked inspection path validates before read and rejects after close", () -> {
      Fixture f = new Fixture(); NativeArtifactService.Artifact sealed = f.service.sealBackup(f.attempt);
      NativeArtifactService.Inspection copy = f.service.verifyAndCopy(f.attempt, sealed.sha256, "checked");
      check(copy.checkedPath().equals(copy.path), "Checked path differs");
      SQLiteDatabase db = SQLiteDatabase.openDatabase(copy.checkedPath(), null, SQLiteDatabase.OPEN_READONLY); db.close();
      check(copy.checkedPath().equals(copy.path), "Read changed inspection"); copy.close(); rejects(() -> copy.checkedPath());
    });
    test("checked inspection path rejects replacement", () -> {
      Fixture f = new Fixture(); NativeArtifactService.Artifact sealed = f.service.sealBackup(f.attempt);
      NativeArtifactService.Inspection copy = f.service.verifyAndCopy(f.attempt, sealed.sha256, "changed");
      File original = new File(copy.path + ".original"); Os.rename(copy.path, original.getPath()); database(copy.path);
      rejectsIo("Artifact identity changed", () -> copy.checkedPath()); check(original.exists() && new File(copy.path).exists(), "Copy evidence lost");
    });
    test("checked inspection path rejects changed bytes", () -> {
      Fixture f = new Fixture(); NativeArtifactService.Artifact sealed = f.service.sealBackup(f.attempt);
      NativeArtifactService.Inspection copy = f.service.verifyAndCopy(f.attempt, sealed.sha256, "mutated");
      File file = new File(copy.path); write(file, Arrays.copyOf(read(file), (int) file.length() + 1));
      rejectsIo("Artifact changed while reading", () -> copy.checkedPath()); check(file.exists(), "Failed copy lost");
    });
    test("app-private bootstrap uses a fixed retained root", () -> {
      File parent = directory(); NativeArtifactService first = NativeArtifactService.openAppPrivate(parent);
      check(first.rootPath().equals(new File(parent, "cplayout-upgrade-artifacts-v1").getPath()), "Unexpected app root");
      File retained = new File(first.rootPath(), "retained-marker"); write(retained, bytes("retained"));
      NativeArtifactService second = NativeArtifactService.openAppPrivate(parent);
      check(second.rootPath().equals(first.rootPath()) && retained.exists(), "Existing root changed");
    });
    test("app-private bootstrap rejects a linked root without repairing it", () -> {
      File parent = directory(), target = directory(), link = new File(parent, "cplayout-upgrade-artifacts-v1");
      Os.symlink(target.getPath(), link.getPath()); rejects(() -> NativeArtifactService.openAppPrivate(parent));
      check(OsConstants.S_ISLNK(Os.lstat(link.getPath()).st_mode) && target.exists(), "Existing link or target changed");
    });
    test("Android backend composes session registry and retained reopening", () -> {
      File parent = directory(); ArtifactSessionRegistry registry = new ArtifactSessionRegistry(() -> new AndroidArtifactBackend(parent));
      String session = (String) registry.createSession().get("sessionId");
      String attempt = registry.allocateAttempt(session, "registry");
      String backup = registry.backupPath(session, attempt); database(backup);
      java.util.Map<String, Object> sealed = registry.sealBackup(session, attempt);
      String digest = (String) sealed.get("sha256");
      String inspection = registry.verifyAndCopy(session, attempt, digest, "read");
      String copy = registry.inspectionPath(session, inspection);
      SQLiteDatabase db = SQLiteDatabase.openDatabase(copy, null, SQLiteDatabase.OPEN_READONLY);
      try (Cursor rows = db.rawQuery("SELECT value FROM evidence", null)) {
        check(rows.moveToFirst() && rows.getString(0).equals("preserved"), "Registry copy data differs");
      } finally { db.close(); }
      registry.closeInspection(session, inspection); check(!new File(copy).exists(), "Registry copy cleanup failed");
      String receipt = "{\"value\":\"retained-\u00e9\"}";
      String encoded = ReceiptHexTransport.encode(receipt);
      check(encoded.contains("c3a9"), "Unicode fixture was not encoded as UTF-8");
      registry.publishPrepared(session, attempt, ReceiptHexTransport.decode(encoded));
      check(ReceiptHexTransport.decode(ReceiptHexTransport.encode(registry.readPrepared(session, attempt))).equals(receipt), "Java receipt codec changed content");
      registry.releaseSession(session); check(new File(backup).exists(), "Release removed backup");
      String reopened = (String) registry.createSession().get("sessionId");
      String retained = registry.openRetainedAttempt(reopened, "registry");
      check(registry.readPrepared(reopened, retained).equals(receipt), "Retained receipt differs");
      rejects(() -> registry.sealBackup(reopened, retained));
      registry.releaseSession(reopened); registry.shutdown(); check(new File(backup).exists(), "Shutdown removed backup");
    });
    test("real SQLite seal, private inspection and unchanged retained bytes", () -> {
      Fixture f = new Fixture(); byte[] before = read(f.backup);
      NativeArtifactService.Artifact sealed = f.service.sealBackup(f.attempt);
      check(sealed.bytes == before.length && sealed.sha256.equals(sha256(before)), "Invalid artifact identity");
      String copy;
      try (NativeArtifactService.Inspection inspection = f.service.verifyAndCopy(f.attempt, sealed.sha256, "read")) {
        copy = inspection.path; check(!copy.equals(sealed.path), "Retained path handed to SQLite");
        SQLiteDatabase db = SQLiteDatabase.openDatabase(copy, null, SQLiteDatabase.OPEN_READONLY);
        try (Cursor rows = db.rawQuery("SELECT value,length(payload) FROM evidence", null)) {
          check(rows.moveToFirst() && rows.getString(0).equals("preserved") && rows.getInt(1) == 262144, "Copy data differs");
        } finally { db.close(); }
      }
      check(!new File(copy).exists(), "Inspection copy not cleaned"); check(Arrays.equals(before, read(f.backup)), "Retained bytes changed");
    });
    test("attempt collisions never adopt or delete existing artifacts", () -> {
      Fixture f = new Fixture(); byte[] before = read(f.backup);
      rejects(() -> f.service.allocateAttempt("first")); check(Arrays.equals(before, read(f.backup)), "Existing backup changed");
      Os.symlink("missing", new File(f.directory, "linked").getPath()); rejects(() -> f.service.allocateAttempt("linked"));
      check(OsConstants.S_ISLNK(Os.lstat(new File(f.directory, "linked").getPath()).st_mode), "Collision link changed");
    });
    for (String id : new String[] { "", "..", "../other", "/absolute", "white space", "a/b" }) {
      test("invalid attempt token: " + id, () -> { NativeArtifactService service = new NativeArtifactService(directory()); rejects(() -> service.allocateAttempt(id)); });
    }
    for (String suffix : new String[] { "-wal", "-shm", "-journal" }) for (String kind : new String[] { "empty", "directory", "dangling" }) {
      test("sidecar rejected without mutation: " + suffix + " " + kind, () -> {
        Fixture f = new Fixture(); NativeArtifactService.Artifact sealed = f.service.sealBackup(f.attempt);
        String path = f.backup.getPath() + suffix;
        if (kind.equals("empty")) write(new File(path), new byte[0]);
        if (kind.equals("directory")) Os.mkdir(path, 0700);
        if (kind.equals("dangling")) Os.symlink("absent", path);
        byte[] before = read(f.backup); long inode = Os.lstat(path).st_ino;
        rejectsIo("Backup sidecar exists: " + suffix, () -> f.service.sealBackup(f.attempt));
        rejectsIo("Backup sidecar exists: " + suffix, () -> f.service.verifyAndCopy(f.attempt, sealed.sha256, "bad"));
        check(Os.lstat(path).st_ino == inode && Arrays.equals(before, read(f.backup)), "Sidecar/source modified");
      });
    }
    test("hardlinked backups rejected", () -> {
      Fixture f = new Fixture();
      try { Os.link(f.backup.getPath(), new File(f.directory, "second-link").getPath()); }
      catch (ErrnoException error) {
        if (error.errno == OsConstants.EACCES || error.errno == OsConstants.EPERM) throw new Skip("Android denied hardlink fixture creation; service rejection unverified here");
        throw error;
      }
      rejects(() -> f.service.sealBackup(f.attempt));
    });
    test("symlink backup substitution rejected", () -> {
      Fixture f = new Fixture(); File moved = new File(f.directory, "moved.db"); Os.rename(f.backup.getPath(), moved.getPath());
      Os.symlink(moved.getPath(), f.backup.getPath()); rejects(() -> f.service.sealBackup(f.attempt));
    });
    test("WAL format rejected even without companions", () -> {
      Fixture f = new Fixture(); byte[] data = read(f.backup); data[18] = 2; data[19] = 2; write(f.backup, data);
      rejects(() -> f.service.sealBackup(f.attempt)); check(Arrays.equals(data, read(f.backup)), "WAL header modified");
    });
    test("wrong digest cannot return an inspection", () -> {
      Fixture f = new Fixture(); rejectsIo("Backup digest differs", () -> f.service.verifyAndCopy(f.attempt, new String(new char[64]).replace('\0', '0'), "wrong"));
    });
    test("exclusive receipt publication and bounded readback", () -> {
      Fixture f = new Fixture(); byte[] receipt = bytes("{\"prepared\":true}"); f.service.publishPrepared(f.attempt, receipt);
      check(Arrays.equals(receipt, f.service.readPrepared(f.attempt)), "Receipt differs");
      rejects(() -> f.service.publishPrepared(f.attempt, bytes("replacement")));
      check(Arrays.equals(receipt, f.service.readPrepared(f.attempt)), "Receipt overwritten");
    });
    test("oversized receipt rejected before publication on a fresh attempt", () -> {
      Fixture f = new Fixture(); byte[] before = read(f.backup);
      File receipt = new File(f.backup.getParentFile(), "prepared.json");
      check(!receipt.exists(), "Receipt fixture is not fresh");
      rejectsIo("Invalid prepared receipt size", () -> f.service.publishPrepared(f.attempt, new byte[65537]));
      check(!receipt.exists(), "Oversized receipt created an artifact");
      check(Arrays.equals(before, read(f.backup)), "Oversized receipt changed backup");
      byte[] bounded = new byte[65536]; Arrays.fill(bounded, (byte) 'a');
      f.service.publishPrepared(f.attempt, bounded);
      check(Arrays.equals(bounded, f.service.readPrepared(f.attempt)), "Maximum-size receipt differs");
    });
    test("short native writes are completed", () -> {
      Fixture f = new Fixture(new NativeArtifactService.Io() {
        @Override int write(FileDescriptor fd, byte[] data, int offset, int count) throws Exception { return super.write(fd, data, offset, Math.min(7, count)); }
      });
      byte[] receipt = bytes("{\"multipleShortWrites\":true}"); f.service.publishPrepared(f.attempt, receipt);
      check(Arrays.equals(receipt, f.service.readPrepared(f.attempt)), "Short-write receipt differs");
    });
    test("zero-progress write rejects and preserves partial receipt", () -> {
      Fixture f = new Fixture(new NativeArtifactService.Io() { @Override int write(FileDescriptor fd, byte[] data, int offset, int count) { return 0; } });
      rejects(() -> f.service.publishPrepared(f.attempt, bytes("content")));
      check(new File(f.backup.getParentFile(), "prepared.json").exists(), "Failed receipt discarded");
      rejects(() -> f.service.readPrepared(f.attempt));
    });
    test("flush failure is not durable receipt success", () -> {
      class SyncFailure extends NativeArtifactService.Io {
        boolean armed;
        @Override void sync(FileDescriptor fd) throws Exception { if (armed) throw new IOException("injected fsync failure"); super.sync(fd); }
      }
      SyncFailure io = new SyncFailure(); Fixture f = new Fixture(io); io.armed = true;
      rejects(() -> f.service.publishPrepared(f.attempt, bytes("{\"retainedFailure\":true}")));
      check(new File(f.backup.getParentFile(), "prepared.json").exists(), "Failed receipt lost");
    });
    for (String operation : new String[] { "allocate", "seal", "receipt" }) for (int barrier = 1; barrier <= 3; barrier++) {
      final int failAt = barrier;
      test(operation + " flush barrier " + barrier + " withholds success", () -> {
        class FailingSync extends NativeArtifactService.Io {
          boolean armed; int calls;
          @Override void sync(FileDescriptor fd) throws Exception {
            if (armed && ++calls == failAt) throw new IOException("injected barrier " + failAt); super.sync(fd);
          }
        }
        FailingSync io = new FailingSync();
        if (operation.equals("allocate")) {
          File folder = directory(); NativeArtifactService service = new NativeArtifactService(folder, io); io.armed = true;
          rejectsIo("injected barrier " + failAt, () -> service.allocateAttempt("failed")); check(new File(folder, "failed/backup.db").exists(), "Failed allocation lost");
          io.armed = false; rejects(() -> service.allocateAttempt("failed"));
        } else {
          Fixture f = new Fixture(io); byte[] before = read(f.backup); io.armed = true;
          if (operation.equals("seal")) rejectsIo("injected barrier " + failAt, () -> f.service.sealBackup(f.attempt));
          else rejectsIo("injected barrier " + failAt, () -> f.service.publishPrepared(f.attempt, bytes("{\"barrier\":true}")));
          check(Arrays.equals(before, read(f.backup)), "Failed barrier changed backup");
        }
        check(io.calls == failAt, "Wrong barrier exercised");
      });
    }
    for (int barrier = 1; barrier <= 3; barrier++) {
      final int failAt = barrier;
      test("inspection flush barrier " + barrier + " withholds success", () -> {
        class FailingSync extends NativeArtifactService.Io {
          boolean armed; int calls;
          @Override void sync(FileDescriptor fd) throws Exception {
            if (armed && ++calls == failAt) throw new IOException("injected inspection barrier " + failAt);
            super.sync(fd);
          }
        }
        FailingSync io = new FailingSync(); Fixture f = new Fixture(io); byte[] before = read(f.backup);
        NativeArtifactService.Artifact sealed = f.service.sealBackup(f.attempt); io.armed = true;
        File scratch = new File(f.backup.getParentFile(), "inspect-sync");
        if (failAt <= 2) {
          rejectsIo("injected inspection barrier " + failAt, () -> f.service.verifyAndCopy(f.attempt, sealed.sha256, "sync"));
          check(scratch.isDirectory() && Arrays.equals(before, read(new File(scratch, "copy.db"))), "Failed inspection scratch not preserved");
        } else {
          NativeArtifactService.Inspection copy = f.service.verifyAndCopy(f.attempt, sealed.sha256, "sync");
          rejectsIo("injected inspection barrier " + failAt, () -> copy.close());
          check(!scratch.exists(), "Cleanup failure should occur after scratch removal");
        }
        check(io.calls == failAt && Arrays.equals(before, read(f.backup)), "Wrong inspection barrier or changed backup");
      });
    }
    test("short reads and writes preserve the complete inspection copy", () -> {
      Fixture f = new Fixture(new NativeArtifactService.Io() {
        @Override int read(FileDescriptor fd, byte[] data, int count) throws Exception { return super.read(fd, data, Math.min(127, count)); }
        @Override int write(FileDescriptor fd, byte[] data, int offset, int count) throws Exception { return super.write(fd, data, offset, Math.min(31, count)); }
      });
      NativeArtifactService.Artifact sealed = f.service.sealBackup(f.attempt);
      check(sealed.sha256.equals(sha256(read(f.backup))), "Short-read digest differs");
      try (NativeArtifactService.Inspection copy = f.service.verifyAndCopy(f.attempt, sealed.sha256, "short-io")) {
        check(Arrays.equals(read(f.backup), read(new File(copy.path))), "Short-IO copy differs");
      }
    });
    test("same-byte inode replacement during streaming is rejected", () -> {
      class Replacement extends NativeArtifactService.Io {
        File target; boolean armed;
        @Override int read(FileDescriptor fd, byte[] data, int count) throws Exception {
          int result = super.read(fd, data, count);
          if (armed) { armed = false; File replacement = new File(target.getParentFile(), "replacement"); NativeArtifactServiceTest.write(replacement, NativeArtifactServiceTest.read(target)); Os.rename(replacement.getPath(), target.getPath()); }
          return result;
        }
      }
      Replacement io = new Replacement(); Fixture f = new Fixture(io); io.target = f.backup; io.armed = true;
      rejects(() -> f.service.sealBackup(f.attempt));
    });
    test("retained mutation during inspection prevents successful close", () -> {
      Fixture f = new Fixture(); NativeArtifactService.Artifact sealed = f.service.sealBackup(f.attempt);
      NativeArtifactService.Inspection copy = f.service.verifyAndCopy(f.attempt, sealed.sha256, "mutation");
      byte[] changed = read(f.backup); changed[100] ^= 1; write(f.backup, changed);
      rejects(copy::close); check(new File(copy.path).exists(), "Failed inspection evidence deleted");
    });
    test("unexpected scratch entries prevent cleanup", () -> {
      Fixture f = new Fixture(); NativeArtifactService.Artifact sealed = f.service.sealBackup(f.attempt);
      NativeArtifactService.Inspection copy = f.service.verifyAndCopy(f.attempt, sealed.sha256, "extra");
      File extra = new File(new File(copy.path).getParentFile(), "unowned"); write(extra, bytes("preserve"));
      rejects(copy::close); check(extra.exists() && new File(copy.path).exists(), "Unexpected evidence deleted");
    });
    test("same-byte scratch replacement prevents cleanup", () -> {
      Fixture f = new Fixture(); NativeArtifactService.Artifact sealed = f.service.sealBackup(f.attempt);
      NativeArtifactService.Inspection copy = f.service.verifyAndCopy(f.attempt, sealed.sha256, "replace");
      File path = new File(copy.path), replacement = new File(path.getParentFile(), "other"); write(replacement, read(path)); Os.rename(replacement.getPath(), path.getPath());
      rejects(copy::close); check(path.exists(), "Replacement scratch deleted");
    });
    test("root inode substitution is rejected", () -> {
      Fixture f = new Fixture(); File moved = new File(root, "moved-root-" + sequence); Os.rename(f.directory.getPath(), moved.getPath()); Os.mkdir(f.directory.getPath(), 0700);
      rejects(() -> f.service.allocateAttempt("later")); check(new File(moved, "first/backup.db").exists(), "Original root lost");
    });
    test("attempt inode substitution is rejected", () -> {
      Fixture f = new Fixture(); File attempt = f.backup.getParentFile(), moved = new File(f.directory, "moved-attempt");
      Os.rename(attempt.getPath(), moved.getPath()); Os.mkdir(attempt.getPath(), 0700); rejects(() -> f.service.sealBackup(f.attempt));
    });
    test("another service cannot adopt an in-memory attempt", () -> {
      Fixture f = new Fixture(); NativeArtifactService other = new NativeArtifactService(f.directory); rejects(() -> other.sealBackup(f.attempt));
    });
    test("retained attempt reopening is existing-only and read-only", () -> {
      Fixture f = new Fixture(); NativeArtifactService.Artifact artifact = f.service.sealBackup(f.attempt);
      byte[] receipt = bytes("{\"sha256\":\"" + artifact.sha256 + "\"}"); f.service.publishPrepared(f.attempt, receipt);
      NativeArtifactService reopened = new NativeArtifactService(f.directory);
      NativeArtifactService.Attempt attempt = reopened.openRetainedAttempt("first");
      check(Arrays.equals(receipt, reopened.readPrepared(attempt)), "Retained receipt differs");
      try (NativeArtifactService.Inspection copy = reopened.verifyAndCopy(attempt, artifact.sha256, "reopened")) { check(new File(copy.path).exists(), "Copy missing"); }
      rejects(() -> reopened.sealBackup(attempt)); rejects(() -> reopened.publishPrepared(attempt, bytes("later")));
      rejects(() -> reopened.openRetainedAttempt("missing")); check(!new File(f.directory, "missing").exists(), "Read created missing attempt");
    });
    System.out.println("RESULT passed=" + passed + " failed=" + failed + " skipped=" + skipped);
    if (failed != 0) System.exit(1);
  }
}
