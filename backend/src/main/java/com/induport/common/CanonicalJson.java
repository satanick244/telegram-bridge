package com.induport.common;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

/**
 * Matches Node's canonical JSON + SHA-256 so historical audit hashes and business keys remain
 * valid.
 */
public final class CanonicalJson {
  private CanonicalJson() {}

  public static String encode(Object value) {
    if (value == null) return "null";
    if (value instanceof String s) return string(s);
    if (value instanceof Boolean) return value.toString();
    if (value instanceof Number n) {
      double d = n.doubleValue();
      if (!Double.isFinite(d)) return "null";
      if (d == 0) return "0";
      String s = BigDecimal.valueOf(d).stripTrailingZeros().toPlainString();
      if (Math.abs(d) >= 1e21 || Math.abs(d) < 1e-6) {
        s = Double.toString(d).toLowerCase(Locale.ROOT);
        String[] parts = s.split("e");
        s =
            parts[0].replaceAll("\\.0$", "")
                + "e"
                + (Integer.parseInt(parts[1]) >= 0 ? "+" : "")
                + Integer.parseInt(parts[1]);
      }
      return s;
    }
    if (value instanceof Map<?, ?> map) {
      List<String> keys = new ArrayList<>();
      map.keySet().forEach(k -> keys.add((String) k));
      keys.sort(
          (a, b) -> {
            long x = index(a), y = index(b);
            return x >= 0 && y >= 0
                ? Long.compare(x, y)
                : x >= 0 ? -1 : y >= 0 ? 1 : a.compareTo(b);
          });
      return "{"
          + String.join(",", keys.stream().map(k -> string(k) + ":" + encode(map.get(k))).toList())
          + "}";
    }
    if (value instanceof Collection<?> a)
      return "[" + String.join(",", a.stream().map(CanonicalJson::encode).toList()) + "]";
    throw new IllegalArgumentException("Unsupported canonical value");
  }

  private static long index(String s) {
    try {
      long n = Long.parseLong(s);
      return n >= 0 && n < 4294967295L && Long.toString(n).equals(s) ? n : -1;
    } catch (NumberFormatException e) {
      return -1;
    }
  }

  private static String string(String s) {
    StringBuilder b = new StringBuilder("\"");
    for (int i = 0; i < s.length(); i++) {
      char c = s.charAt(i);
      switch (c) {
        case '"' -> b.append("\\\"");
        case '\\' -> b.append("\\\\");
        case '\b' -> b.append("\\b");
        case '\f' -> b.append("\\f");
        case '\n' -> b.append("\\n");
        case '\r' -> b.append("\\r");
        case '\t' -> b.append("\\t");
        default -> {
          if (c < 32
              || Character.isSurrogate(c)
                  && !(Character.isHighSurrogate(c)
                      && i + 1 < s.length()
                      && Character.isLowSurrogate(s.charAt(i + 1)))
                  && !(Character.isLowSurrogate(c)
                      && i > 0
                      && Character.isHighSurrogate(s.charAt(i - 1))))
            b.append(String.format("\\u%04x", (int) c));
          else b.append(c);
        }
      }
    }
    return b.append('"').toString();
  }

  public static String sha256(String s) {
    try {
      return HexFormat.of()
          .formatHex(
              MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)));
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  public static String digest(Object value) {
    return sha256(encode(value));
  }

  public static String key(String kind, Object owner, Object value) {
    return kind + ":" + digest(Arrays.asList(owner, value));
  }
}
