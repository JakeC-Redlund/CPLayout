package local.cplayout.storage;

import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;

/** ASCII-only bridge transport avoids JNI modified-UTF-8 loss and NUL truncation. */
public final class ReceiptHexTransport {
  private static final int LIMIT = 65536;
  private static final char[] HEX = "0123456789abcdef".toCharArray();
  private ReceiptHexTransport() {}

  public static String encode(String content) throws Exception {
    require(content != null && content.length() > 0 && content.length() <= LIMIT, "Invalid receipt size");
    ByteBuffer bytes = StandardCharsets.UTF_8.newEncoder().onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT).encode(CharBuffer.wrap(content));
    require(bytes.remaining() <= LIMIT, "Receipt exceeds byte limit");
    StringBuilder hex = new StringBuilder(bytes.remaining() * 2);
    while (bytes.hasRemaining()) { int value = bytes.get() & 255; hex.append(HEX[value >>> 4]).append(HEX[value & 15]); }
    return hex.toString();
  }
  public static String decode(String hex) throws Exception {
    require(hex != null && hex.length() > 0 && hex.length() <= LIMIT * 2 && hex.length() % 2 == 0, "Invalid receipt transport size");
    byte[] bytes = new byte[hex.length() / 2];
    for (int i = 0; i < bytes.length; i++) bytes[i] = (byte) ((digit(hex.charAt(i * 2)) << 4) | digit(hex.charAt(i * 2 + 1)));
    return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
  }
  private static int digit(char value) {
    if (value >= '0' && value <= '9') return value - '0';
    if (value >= 'a' && value <= 'f') return value - 'a' + 10;
    throw new IllegalArgumentException("Invalid receipt hex character");
  }
  private static void require(boolean condition, String message) { if (!condition) throw new IllegalArgumentException(message); }
}
