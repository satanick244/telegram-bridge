package com.induport.common;

import static com.induport.common.BusinessException.*;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.*;
import java.util.*;

public final class Inputs {
  private Inputs() {}

  public static String now() {
    return java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'")
        .withZone(ZoneOffset.UTC)
        .format(Instant.now());
  }

  public static String today() {
    return LocalDate.now(ZoneOffset.UTC).toString();
  }

  public static String id(String prefix) {
    return prefix + UUID.randomUUID();
  }

  public static boolean blank(Object v) {
    return v == null || v instanceof String s && s.trim().isEmpty();
  }

  public static String text(Object v, String label, int max, boolean optional) {
    if (blank(v) && optional) return null;
    require(
        v instanceof String
            && !((String) v).trim().isEmpty()
            && ((String) v).trim().length() <= max,
        400,
        label + "无效");
    return ((String) v).trim();
  }

  public static String text(Object v, String label, int max) {
    return text(v, label, max, false);
  }

  public static String choice(Object v, List<String> options, String label, boolean optional) {
    if (blank(v) && optional) return null;
    require(v instanceof String && options.contains(v), 400, label + "无效");
    return (String) v;
  }

  public static String choice(Object v, List<String> options, String label) {
    return choice(v, options, label, false);
  }

  public static Double number(Object v, String label, double min, double max, boolean optional) {
    if (blank(v) && optional) return null;
    require(v instanceof String || v instanceof Number, 400, label + "无效");
    double d;
    try {
      d = Double.parseDouble(String.valueOf(v));
    } catch (Exception e) {
      throw fail(400, label + "无效");
    }
    require(Double.isFinite(d) && d >= min && d <= max, 400, label + "无效");
    return d;
  }

  public static double number(Object v, String label, double min, double max) {
    return number(v, label, min, max, false);
  }

  public static double strictNumber(Object v, String label, double min, double max) {
    require(v instanceof Number, 400, label + "须为数值");
    return number(v, label, min, max);
  }

  public static Long minor(Object v, String label, boolean optional) {
    if (blank(v) && optional) return null;
    String s =
        v instanceof Number
            ? new BigDecimal(v.toString()).stripTrailingZeros().toPlainString()
            : String.valueOf(v);
    require(s.matches("\\d{1,10}(\\.\\d{1,2})?"), 400, label + "须为非负金额，最多两位小数");
    return new BigDecimal(s).movePointRight(2).longValueExact();
  }

  public static Long minor(Object v, String label) {
    return minor(v, label, true);
  }

  public static long positive(Object v) {
    long n = minor(v, "金额", false);
    require(n > 0, 400, "金额须大于零");
    return n;
  }

  public static Boolean bool(Object v, String label) {
    if (blank(v)) return null;
    if (Boolean.TRUE.equals(v) || "true".equals(v)) return true;
    if (Boolean.FALSE.equals(v) || "false".equals(v)) return false;
    throw fail(400, label + "须为 true/false 或空值");
  }

  public static String day(Object v) {
    if (blank(v)) return null;
    require(v instanceof String && ((String) v).matches("\\d{4}-\\d{2}-\\d{2}"), 400, "到期日无效");
    try {
      LocalDate d = LocalDate.parse((String) v);
      require(d.toString().equals(v), 400, "到期日无效");
      return (String) v;
    } catch (java.time.DateTimeException e) {
      throw fail(400, "到期日无效");
    }
  }

  public static String pastDay(Object v, String label) {
    String d = day(v);
    require(d != null && d.compareTo(today()) <= 0, 400, label + "须为不晚于今天的日期");
    return d;
  }

  public static long days(String a, String b) {
    return java.time.temporal.ChronoUnit.DAYS.between(LocalDate.parse(a), LocalDate.parse(b));
  }

  public static long round(double n) {
    require(Double.isFinite(n) && Math.abs(n) <= 9007199254740991L, 400, "测算金额超出支持精度");
    return (long) Math.floor(n + 0.5d);
  }

  public static double round2(double n) {
    return BigDecimal.valueOf(n).setScale(2, RoundingMode.HALF_UP).doubleValue();
  }

  public static void fields(Doc b, Collection<String> allowed) {
    require(allowed.containsAll(b.keySet()), 400, "包含未知字段，不能指定所属账号、核验人或审批结果");
  }

  public static boolean real(Object s) {
    return List.of("manual", "import").contains(s == null ? "" : s);
  }
}
