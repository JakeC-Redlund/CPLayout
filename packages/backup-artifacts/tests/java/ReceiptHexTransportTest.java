package local.cplayout.storage;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

public final class ReceiptHexTransportTest {
  private interface Checked { void run() throws Exception; }
  private static int checks;
  private static void check(boolean value) { if (!value) throw new AssertionError("Codec check failed"); checks++; }
  private static void rejects(Checked body) throws Exception {
    try { body.run(); } catch (Exception expected) { checks++; return; }
    throw new AssertionError("Expected invalid transport rejection");
  }
  private static String repeat(String value, int count) { StringBuilder result = new StringBuilder(); for (int i = 0; i < count; i++) result.append(value); return result.toString(); }
  public static void main(String[] args) throws Exception {
    if (args.length == 1 && args[0].equals("echo")) {
      BufferedReader input = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.US_ASCII));
      String line; while ((line = input.readLine()) != null) System.out.println(ReceiptHexTransport.encode(ReceiptHexTransport.decode(line)));
      return;
    }
    for (String value : new String[] { "a\0b", "\u00e9", "\ud83c\udf3e", "e\u0301", "\ufeffvalue", "%?#/\\\n", repeat("a", 65536) }) {
      String hex = ReceiptHexTransport.encode(value);
      check(hex.matches("[0-9a-f]+")); check(ReceiptHexTransport.decode(hex).equals(value));
      check(hex.length() == value.getBytes(StandardCharsets.UTF_8).length * 2);
    }
    check(ReceiptHexTransport.encode("a\0b").equals("610062"));
    check(ReceiptHexTransport.encode("\ud83c\udf3e").equals("f09f8cbe"));
    for (String hex : new String[] { "", "0", "GG", "C3A9", "c0af", "eda080", "f4908080", "e282", "ff", repeat("61", 65537) }) rejects(() -> ReceiptHexTransport.decode(hex));
    for (String value : new String[] { "", "\ud800", "\udc00", "a\ud800b", repeat("\u00e9", 32769) }) rejects(() -> ReceiptHexTransport.encode(value));
    System.out.println("PASS ReceiptHexTransportTest: " + checks + " assertions");
  }
}
